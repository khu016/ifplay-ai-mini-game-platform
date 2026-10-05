"""Provider 工厂：按配置选择 provider。当前无真实 Key，仅 deterministic-test。"""
from __future__ import annotations

from ..config import get_settings
from ..errors import ApiError
from .base import Provider
from .deterministic import DeterministicTestProvider


def get_provider(name: str | None = None) -> Provider:
    provider_name = name or get_settings().provider
    if provider_name == "deterministic-test":
        return DeterministicTestProvider()
    raise ApiError("provider_not_configured", f"未配置的 provider：{provider_name}（当前无真实 Key）", 502)
