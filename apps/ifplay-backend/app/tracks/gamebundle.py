"""受控 GameBundle 主轨：单次生成调用（计费/修复由 task_service 编排）。

本模块只负责一次「生成 GameBundle」的 Provider 调用；预算预检、计费、校验与修复循环在
task_service._generate_with_repair 中统一处理（避免轨道各自记账导致账本不一致）。
"""
from __future__ import annotations

import json

from .base import GenerationTrack, TrackResult


class GameBundleTrack(GenerationTrack):
    name = "gamebundle"

    def generate(self, provider, settings, idea: str, primary_module: str):
        prompt = json.dumps(
            {"kind": "gamebundle", "idea": idea, "primary_module": primary_module},
            ensure_ascii=False,
        )
        return provider.call(
            prompt,
            max_output_tokens=settings.max_output_tokens,
            timeout_seconds=settings.timeout_seconds,
            max_retries=settings.max_retries,
            parse=json.loads,
        )

    def run(self, **kwargs) -> TrackResult:
        del kwargs
        # 本阶段生成+修复+计费统一在 task_service 编排，这里仅保留占位（不被调用）
        return TrackResult(bundle=None, validation=[], not_implemented=True, message="请走 task_service 编排")
