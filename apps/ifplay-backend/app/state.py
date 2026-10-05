"""生成任务状态机。"""
from __future__ import annotations

from .errors import StateError

TASK_STATES = [
    "draft",
    "clarifying",
    "plan_ready",
    "confirmed",
    "queued",
    "generating",
    "validating",
    "playable",
    "failed",
    "interrupted",
]

TERMINAL_STATES = {"playable", "failed"}

# 允许的合法转换（generation 主任务）
TRANSITIONS: dict[str, set[str]] = {
    "draft": {"clarifying", "failed"},
    "clarifying": {"plan_ready", "failed"},
    "plan_ready": {"confirmed", "failed"},
    "confirmed": {"queued", "failed"},
    "queued": {"generating", "failed"},
    "generating": {"validating", "failed", "interrupted"},
    "validating": {"playable", "failed", "interrupted"},
    "playable": set(),
    "failed": set(),
    "interrupted": {"queued"},  # 显式 resume 后重新入队
}

# 修改任务（modification）专用状态机
MODIFICATION_STATES = ["queued", "applying", "validating", "succeeded", "failed", "interrupted"]

MODIFICATION_TERMINAL = {"succeeded", "failed"}

MODIFICATION_TRANSITIONS: dict[str, set[str]] = {
    "queued": {"applying", "failed"},
    "applying": {"validating", "failed", "interrupted"},
    "validating": {"succeeded", "failed", "interrupted"},
    "succeeded": set(),
    "failed": set(),
    "interrupted": {"queued"},
}


def transitions_for(kind: str) -> dict[str, set[str]]:
    return MODIFICATION_TRANSITIONS if kind == "modification" else TRANSITIONS


def terminal_states_for(kind: str) -> set[str]:
    return MODIFICATION_TERMINAL if kind == "modification" else TERMINAL_STATES


def is_terminal(status: str, kind: str = "generation") -> bool:
    return status in terminal_states_for(kind)


def is_interrupted(status: str) -> bool:
    return status == "interrupted"


def can_transition(current: str, next_: str, kind: str = "generation") -> bool:
    return next_ in transitions_for(kind).get(current, set())


def assert_transition(current: str, next_: str, kind: str = "generation") -> None:
    if not can_transition(current, next_, kind):
        raise StateError(
            "invalid_transition",
            f"非法状态转换：{current} -> {next_}",
        )
