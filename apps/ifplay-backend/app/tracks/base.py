"""生成轨道抽象：GameBundleTrack（受控）与 IsolatedCodeTrack（隔离代码，尚未接入）。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class TrackResult:
    bundle: dict | None = None
    validation: list[dict] = field(default_factory=list)
    not_implemented: bool = False
    message: str | None = None


class GenerationTrack(ABC):
    name: str

    @abstractmethod
    def run(self, **kwargs) -> TrackResult:
        ...
