"""澄清上限强制执行：达到上限停止追问并生成方案；边界/重启恢复/非法状态。"""
import json

import pytest

from app.providers.deterministic import DeterministicTestProvider
from app.services import session_service


class _EndlessClarifyProvider(DeterministicTestProvider):
    """永远继续追问的 Provider（用于验证上限真正生效，而非依赖 Provider 自行停止）。"""

    def _raw(self, prompt, *, max_output_tokens, timeout_seconds):
        req = json.loads(prompt)
        if req["kind"] == "clarification":
            n = len(req.get("answers", [])) + 1
            return {
                "content": json.dumps({"question": f"第 {n} 个问题？", "done": False}, ensure_ascii=False),
                "input_tokens": 10,
                "output_tokens": 20,
            }
        return super()._raw(prompt, max_output_tokens=max_output_tokens, timeout_seconds=timeout_seconds)


@pytest.fixture()
def endless(monkeypatch):
    monkeypatch.setattr(session_service, "get_provider", lambda: _EndlessClarifyProvider())


@pytest.fixture()
def max_two(monkeypatch):
    monkeypatch.setenv("IFPLAY_MAX_CLARIFICATIONS", "2")
    import app.config as config

    config.get_settings.cache_clear()
    yield
    config.get_settings.cache_clear()


def test_limit_stops_and_generates_plan(db, endless, max_two):
    sid = session_service.create_session(db, "开一家深夜食堂")["session_id"]
    r1 = session_service.submit_clarification(db, sid, "答案一")
    assert r1["task_status"] == "clarifying"
    r2 = session_service.submit_clarification(db, sid, "答案二")
    # 达到上限：不再追问，直接生成方案
    assert r2["task_status"] == "plan_ready"
    assert r2["plan_card"] is not None
    assert len(r2["clarifications"]) == 2


def test_limit_illegal_state_after_plan(db, endless, max_two):
    from app.errors import StateError

    sid = session_service.create_session(db, "开一家深夜食堂")["session_id"]
    session_service.submit_clarification(db, sid, "答案一")
    session_service.submit_clarification(db, sid, "答案二")
    with pytest.raises(StateError) as e:
        session_service.submit_clarification(db, sid, "答案三")
    assert e.value.code == "not_clarifying"


def test_limit_survives_restart(client, restart_client, endless, max_two):
    r = client.post("/api/v1/sessions", json={"idea": "开一家深夜食堂"})
    sid = r.json()["session_id"]
    client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": "答案一"})
    # 重启后继续：已答 1 题，再答 1 题即达上限
    r = restart_client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": "答案二"})
    assert r.status_code == 200, r.text
    assert r.json()["task_status"] == "plan_ready"
    assert r.json()["plan_card"] is not None
