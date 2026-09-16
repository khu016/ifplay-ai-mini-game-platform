"""模型统一适配器：无 Key 时用 mock（确定性），有 Key 时走 OpenAI 兼容接口。"""

import json

import httpx

from .config import get_settings
from .personas import DEFAULT_RECOMMENDATION


class ModelError(Exception):
    pass


class ModelAdapter:
    def generate(self, *, task: str, context: dict) -> str:
        raise NotImplementedError


class MockAdapter(ModelAdapter):
    """确定性 mock，仅用于开发期推进；不得冒充真实模型验证。"""

    def generate(self, *, task: str, context: dict) -> str:
        q = context.get("question", "") or ""
        if task == "recommend":
            roles = [
                {"role_type": code, "reason": f"围绕“{q}”，{reason}"}
                for code, reason in DEFAULT_RECOMMENDATION
            ]
            return json.dumps(roles, ensure_ascii=False)
        if task == "host_opening":
            return json.dumps(
                {
                    "opening": f"我们先确认一下：你正在纠结“{q}”。讨论中我会不断更新已知条件。",
                    "clarify_question": "如果方便，能补充一个最影响你决定的条件吗？",
                },
                ensure_ascii=False,
            )
        if task == "role_speech":
            role = context.get("role", {})
            code = role.get("type_code", "INTJ")
            return json.dumps(
                {
                    "role_type": code,
                    "claim_id": f"{code.lower()}-1",
                    "viewpoint": (
                        f"我作为{code}，更关注“{role.get('focus', '这个角度')}”。"
                        f"对“{q}”，我会先问：{role.get('good_questions', '还有哪些条件？')}"
                    ),
                    "fact_refs": [],
                    "assumptions": f"在信息有限的情况下，我假设“{q}”的基本前提成立。",
                    "responds_to": "",
                    "change_condition": "如果出现了新的关键事实，我会调整这个判断。",
                },
                ensure_ascii=False,
            )
        if task == "summarize":
            return json.dumps(
                {
                    "problem_and_conditions": q,
                    "consensus": "各方都认为需要先明确关键条件再做决定。",
                    "disagreements": "探索型角色倾向先尝试，稳健型角色倾向先核实风险。",
                    "unknowns": "还缺一个关键事实：你目前最不能接受的代价是什么。",
                    "next_step": "用一句话写下你最不能接受的代价，再来比较各选项。",
                    "change_conditions": "如果时间或成本约束发生变化，结论可能改变。",
                },
                ensure_ascii=False,
            )
        return "{}"


class RemoteAdapter(ModelAdapter):
    """OpenAI 兼容接口（DeepSeek / 通义千问 / 智谱 GLM 等）。"""

    def __init__(self, settings):
        self.base_url = (settings.model_base_url or "https://api.deepseek.com/v1").rstrip("/")
        self.api_key = settings.model_api_key
        self.model = settings.model_name or "deepseek-chat"
        self.timeout = settings.model_timeout_seconds
        self.max_retries = max(0, settings.model_max_retries)

    def generate(self, *, task: str, context: dict) -> str:
        url = f"{self.base_url}/chat/completions"
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": context.get("system", "")},
                {"role": "user", "content": context.get("user", "")},
            ],
            "temperature": 0.7,
        }
        retryable = {429, 500, 502, 503, 504}
        for attempt in range(self.max_retries + 1):
            try:
                resp = httpx.post(
                    url, headers=headers, json=payload, timeout=self.timeout
                )
                if resp.status_code in retryable and attempt < self.max_retries:
                    continue
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
            except httpx.TimeoutException:
                if attempt < self.max_retries:
                    continue
                raise ModelError("模型调用超时")
            except httpx.HTTPStatusError as e:
                raise ModelError(f"模型接口返回 {e.response.status_code}")
            except Exception as e:  # 含 SDK/网络初始化失败
                raise ModelError(f"模型调用失败: {type(e).__name__}")
        raise ModelError("模型调用失败")


def get_adapter() -> ModelAdapter:
    s = get_settings()
    if s.model_api_key:
        return RemoteAdapter(s)
    return MockAdapter()
