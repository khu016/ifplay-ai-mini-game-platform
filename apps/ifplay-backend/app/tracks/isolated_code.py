"""隔离代码生成轨道：本阶段仅记录/返回「尚未接入」，不执行任何代码。"""
from __future__ import annotations

from .base import GenerationTrack, TrackResult


class IsolatedCodeTrack(GenerationTrack):
    name = "isolated-code"

    def run(self, **kwargs) -> TrackResult:
        del kwargs
        return TrackResult(
            bundle=None,
            validation=[],
            not_implemented=True,
            message="IsolatedCodeTrack 尚未接入，本阶段只支持受控 GameBundle 主轨。",
        )
