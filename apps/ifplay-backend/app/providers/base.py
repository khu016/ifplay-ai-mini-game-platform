"""Provider 统一接口（供应商无关）。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ProviderResult:
    content: dict  # 结构化输出（澄清问题 / 方案卡 / GameBundle）
    input_tokens: int | None
    output_tokens: int | None
    model: str
    version: str
    duration_ms: int = 0


class ProviderError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# 可重试的错误码（超时/暂时性错误），非可重试的（missing_usage、超预算）不重试
RETRYABLE_CODES = {"timeout", "provider_error", "rate_limit"}


class Provider(ABC):
    name: str
    model: str
    version: str
    is_real: bool = False  # 真实模型为 True；deterministic-test 为 False

    @abstractmethod
    def _raw(self, prompt: str, *, max_output_tokens: int, timeout_seconds: float) -> dict:
        """返回 {"content": str(json), "input_tokens": int, "output_tokens": int}。

        必须抛出 ProviderError：timeout / provider_error / rate_limit / missing_usage。
        缺失 usage 时必须抛 missing_usage，不得返回 None 当作 0。
        """

    def call(
        self,
        prompt: str,
        *,
        max_output_tokens: int,
        timeout_seconds: float,
        max_retries: int,
        parse,
    ) -> ProviderResult:
        last: ProviderError | None = None
        for attempt in range(max_retries + 1):
            try:
                raw = self._raw(
                    prompt,
                    max_output_tokens=max_output_tokens,
                    timeout_seconds=timeout_seconds,
                )
                input_tokens = raw.get("input_tokens")
                output_tokens = raw.get("output_tokens")
                if input_tokens is None or output_tokens is None:
                    raise ProviderError("missing_usage", "模型响应缺少 usage，按失败处理（不能按 0 元）")
                content = parse(raw.get("content"))
                return ProviderResult(
                    content=content,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    model=self.model,
                    version=self.version,
                    duration_ms=raw.get("duration_ms", 0),
                )
            except ProviderError as e:
                last = e
                if e.code in RETRYABLE_CODES and attempt < max_retries:
                    continue
                raise
        raise last  # pragma: no cover
