from app.state import assert_transition, can_transition


def test_valid_transitions():
    assert can_transition("new", "role_confirm")
    assert can_transition("role_confirm", "host_clarify")
    assert can_transition("host_clarify", "first_round")
    assert can_transition("first_round", "waiting")
    assert can_transition("waiting", "generating")
    assert can_transition("generating", "waiting")
    assert can_transition("waiting", "summarizing")
    assert can_transition("summarizing", "finished")
    assert can_transition("finished", "deleted")


def test_invalid_transition_raises():
    try:
        assert_transition("waiting", "role_confirm")
        assert False, "应当抛出非法流转"
    except ValueError:
        pass


def test_waiting_cannot_jump_to_finished_without_summary():
    # 结束会议必须先经过纪要生成
    assert not can_transition("waiting", "finished")
