import asyncio
import json
from time import monotonic

import httpx

from .errors import AppError


class DeepSeek:
    def __init__(self, settings, budget, client_factory=httpx.AsyncClient):
        self.settings, self.budget = settings, budget
        self.client_factory = client_factory

    async def stream(self, task_id, stage, messages, max_output):
        payload = {"model": self.settings.model, "messages": messages,
                   "thinking": {"type": "disabled"}, "max_tokens": max_output,
                   "response_format": {"type": "json_object"}, "stream": True,
                   "stream_options": {"include_usage": True}}
        # UTF-8 字节数加协议开销是保守 token 上界；异常用量保持预留并阻止后续调用。
        input_bound = len(json.dumps(messages, ensure_ascii=False).encode("utf-8")) + 2048
        charge_id = self.budget.reserve(task_id, stage, input_bound, max_output)
        started, first_chunk, usage = monotonic(), None, None
        try:
            async with asyncio.timeout(self.settings.timeout):
                # 客户端初始化也在兜底范围内。禁止重定向将 Authorization 发到其他站点。
                async with self.client_factory(timeout=self.settings.timeout,
                                               follow_redirects=False) as client:
                    async with client.stream(
                        "POST", "https://api.deepseek.com/chat/completions",
                        headers={"Authorization": "Bearer " + self.settings.api_key}, json=payload,
                    ) as response:
                        if response.status_code in {401, 403}:
                            raise AppError("MODEL_AUTH", "DeepSeek 认证失败，请核对本地密钥。", 502)
                        if response.status_code == 429 or response.status_code >= 500:
                            raise AppError("MODEL_TEMPORARY", "模型服务暂时不可用。", 502)
                        if response.status_code != 200:
                            raise AppError("MODEL_FAILED", "模型请求失败，请核对账户与配置。", 502)
                        completed = False
                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                completed = True
                                break
                            item = json.loads(data)
                            if item.get("usage"):
                                info = item["usage"]
                                counts = [info.get("prompt_tokens"), info.get("completion_tokens")]
                                if all(type(n) is int and n >= 0 for n in counts):
                                    usage = tuple(counts)
                            for choice in item.get("choices", []):
                                if choice.get("finish_reason") == "length":
                                    raise AppError("INVALID_MODEL_OUTPUT", "模型输出被截断，请调整后重试。", 502)
                                content = choice.get("delta", {}).get("content")
                                if content:
                                    if not isinstance(content, str):
                                        raise ValueError()
                                    if first_chunk is None:
                                        first_chunk = monotonic() - started
                                    yield content
                        if not completed:
                            raise AppError("MODEL_FAILED", "模型流被中断，请显式重试。", 502)
        except (TimeoutError, httpx.TimeoutException):
            raise AppError("MODEL_TIMEOUT", "模型调用超时，可显式重试。", 504) from None
        except httpx.TransportError:
            raise AppError("MODEL_TEMPORARY", "模型网络连接失败。", 502) from None
        except AppError:
            raise
        except Exception:
            raise AppError("MODEL_FAILED", "模型初始化或响应处理失败。", 502) from None
        finally:
            self.budget.settle(charge_id, usage, monotonic() - started, first_chunk)
