"""状态机合法/非法转换测试。"""
import pytest

from app import state
from app.errors import StateError


def test_all_states_defined():
    for s in ["draft", "clarifying", "plan_ready", "confirmed", "generating", "validating", "playable", "failed"]:
        assert s in state.TRANSITIONS


def test_valid_chain():
    chain = ["draft", "clarifying", "plan_ready", "confirmed", "queued", "generating", "validating", "playable"]
    for cur, nxt in zip(chain, chain[1:]):
        assert state.can_transition(cur, nxt)


def test_interrupted_resume_transition():
    assert state.can_transition("interrupted", "queued")
    assert state.is_interrupted("interrupted")


def test_failed_from_active_states():
    for cur in ["draft", "clarifying", "plan_ready", "confirmed", "generating", "validating"]:
        assert state.can_transition(cur, "failed")


def test_terminal_no_forward():
    assert not state.can_transition("playable", "generating")
    assert not state.can_transition("failed", "playable")
    assert state.is_terminal("playable")
    assert state.is_terminal("failed")


def test_invalid_transition_raises():
    with pytest.raises(StateError) as e:
        state.assert_transition("draft", "playable")
    assert e.value.code == "invalid_transition"


def test_skip_transition_raises():
    # 不允许跳过状态：draft 不能直接到 plan_ready
    assert not state.can_transition("draft", "plan_ready")
    with pytest.raises(StateError):
        state.assert_transition("draft", "plan_ready")
