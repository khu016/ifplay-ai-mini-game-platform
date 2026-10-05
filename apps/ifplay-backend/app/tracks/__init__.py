from .base import GenerationTrack, TrackResult
from .gamebundle import GameBundleTrack
from .isolated_code import IsolatedCodeTrack


def get_track(name: str) -> GenerationTrack:
    if name == "gamebundle":
        return GameBundleTrack()
    if name == "isolated-code":
        return IsolatedCodeTrack()
    from ..errors import NotFoundError

    raise NotFoundError("track_not_found", f"未知生成轨道：{name}")


__all__ = ["GenerationTrack", "TrackResult", "GameBundleTrack", "IsolatedCodeTrack", "get_track"]
