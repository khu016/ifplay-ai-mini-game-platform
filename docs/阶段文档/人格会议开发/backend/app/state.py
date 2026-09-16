"""会议状态机：宿主代码管理状态流转，模型不得改状态。"""

from .models import MeetingStatus

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    MeetingStatus.NEW.value: {
        MeetingStatus.ROLE_CONFIRM.value,
        MeetingStatus.SAFETY_ABORT.value,
    },
    MeetingStatus.ROLE_CONFIRM.value: {
        MeetingStatus.HOST_CLARIFY.value,
        MeetingStatus.SAFETY_ABORT.value,
    },
    MeetingStatus.HOST_CLARIFY.value: {MeetingStatus.FIRST_ROUND.value},
    MeetingStatus.FIRST_ROUND.value: {MeetingStatus.WAITING.value},
    MeetingStatus.WAITING.value: {
        MeetingStatus.GENERATING.value,
        MeetingStatus.SUMMARIZING.value,
        MeetingStatus.SAFETY_ABORT.value,
    },
    MeetingStatus.GENERATING.value: {
        MeetingStatus.WAITING.value,
        MeetingStatus.FAILED.value,
        MeetingStatus.SAFETY_ABORT.value,
    },
    MeetingStatus.SUMMARIZING.value: {
        MeetingStatus.FINISHED.value,
        MeetingStatus.FAILED.value,
    },
    MeetingStatus.FAILED.value: {MeetingStatus.WAITING.value},
    MeetingStatus.FINISHED.value: {MeetingStatus.DELETED.value},
    MeetingStatus.SAFETY_ABORT.value: {MeetingStatus.DELETED.value},
    MeetingStatus.DELETED.value: set(),
}


def can_transition(current: str, target: str) -> bool:
    return target in ALLOWED_TRANSITIONS.get(current, set())


def assert_transition(current: str, target: str) -> None:
    if not can_transition(current, target):
        raise ValueError(f"非法状态流转: {current} -> {target}")
