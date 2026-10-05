"""Provider 超时/失败/重试、usage 缺失、费用预检与限额。"""
import pytest

from app.config import Settings
from app.cost import CostTracker
from app.providers.base import Provider, ProviderError


class _TimeoutThenOkProvider(Provider):
    name = "timeout-then-ok"
    model = "m"
    version = "v"

    def __init__(self):
        self.calls = 0

    def _raw(self, prompt, *, max_output_tokens, timeout_seconds):
        self.calls += 1
        if self.calls < 3:
            raise ProviderError("timeout", "模拟超时")
        return {"content": '{"x":1}', "input_tokens": 10, "output_tokens": 20}


class _AlwaysFailProvider(Provider):
    name = "always-fail"
    model = "m"
    version = "v"

    def _raw(self, prompt, *, max_output_tokens, timeout_seconds):
        raise ProviderError("provider_error", "模拟错误")


class _MissingUsageProvider(Provider):
    name = "missing-usage"
    model = "m"
    version = "v"

    def _raw(self, prompt, *, max_output_tokens, timeout_seconds):
        return {"content": '{"x":1}'}  # 无 usage


def _parse(s):
    import json

    return json.loads(s)


def test_timeout_retry_then_ok():
    p = _TimeoutThenOkProvider()
    r = p.call("x", max_output_tokens=100, timeout_seconds=5, max_retries=2, parse=_parse)
    assert r.content == {"x": 1}
    assert p.calls == 3  # 2 次失败 + 1 次成功


def test_non_retryable_after_retries_exhausted():
    p = _AlwaysFailProvider()
    with pytest.raises(ProviderError) as e:
        p.call("x", max_output_tokens=100, timeout_seconds=5, max_retries=2, parse=_parse)
    assert e.value.code == "provider_error"


def test_missing_usage_raises():
    p = _MissingUsageProvider()
    with pytest.raises(ProviderError) as e:
        p.call("x", max_output_tokens=100, timeout_seconds=5, max_retries=1, parse=_parse)
    assert e.value.code == "missing_usage"


def _settings(**overrides):
    s = Settings()
    for k, v in overrides.items():
        setattr(s, k, v)
    return s


def test_cost_precheck_blocks_when_over_budget():
    s = _settings(budget_per_task=1.0, safety_margin=0.0, max_output_tokens=4096,
                  input_price_per_1k=0.01, output_price_per_1k=0.01)
    t = CostTracker(s)
    with pytest.raises(ProviderError) as e:
        t.precheck(spent=0.9, input_tokens=20000)
    assert e.value.code == "cost_limit"


def test_cost_account_missing_usage():
    t = CostTracker(_settings())
    with pytest.raises(ProviderError) as e:
        t.account(spent=0.0, input_tokens=None, output_tokens=100)
    assert e.value.code == "missing_usage"


def test_cost_account_accumulates_and_blocks():
    s = _settings(budget_per_task=1.0, safety_margin=0.0, input_price_per_1k=0.1, output_price_per_1k=0.1,
                  max_output_tokens=100, max_images=3)
    t = CostTracker(s)
    spent = 0.0
    blocked = False
    for _ in range(20):
        try:
            spent += t.account(spent, input_tokens=1000, output_tokens=0)
        except ProviderError as e:
            assert e.code == "cost_limit"
            blocked = True
            break
    assert blocked
    assert spent > 0.5


def test_image_limit():
    s = _settings(max_images=3)
    t = CostTracker(s)
    with pytest.raises(ProviderError) as e:
        t.precheck(spent=0.0, input_tokens=10, images=4)
    assert e.value.code == "image_limit"
