"""健康检查、端到端纵向闭环、幂等、版本恢复。"""
import json


def _confirm(client, idea="开一家深夜食堂，经营小餐馆"):
    r = client.post("/api/v1/sessions", json={"idea": idea})
    assert r.status_code == 200, r.text
    sid = r.json()["session_id"]
    for ans in ["经营深夜小餐馆，赚钱并升级", "一局约5分钟"]:
        r = client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": ans})
        assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/sessions/{sid}/plan")
    assert r.json()["primary_module"] == "business"
    r = client.post(f"/api/v1/sessions/{sid}/plan/confirm")
    assert r.json()["task_status"] == "confirmed"
    return sid


def _enqueue(client, sid, key="key-1"):
    r = client.post(f"/api/v1/sessions/{sid}/tasks", json={"idempotency_key": key})
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued"
    return r.json()["task_id"]


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["provider_is_real_model"] is False


def test_full_flow_playable(client, process_queued):
    sid = _confirm(client)
    tid = _enqueue(client, sid)
    assert process_queued() == 1

    r = client.get(f"/api/v1/tasks/{tid}")
    assert r.json()["status"] == "playable"

    r = client.get(f"/api/v1/tasks/{tid}/result")
    assert r.status_code == 200
    result = r.json()
    assert result["task"]["status"] == "playable"
    assert all(v["passed"] for v in result["validation_summary"])
    assert result["version"]["version_number"] == 1
    assert result["version"]["bundle"]["primaryModule"]["id"] == "business"
    assert len(result["usage"]) >= 1
    assert all("key" not in u for u in result["usage"])


def test_idempotency(client):
    sid = _confirm(client)
    tid = _enqueue(client, sid, key="key-1")
    # 同一 idempotency_key 重复创建，返回同一任务
    r = client.post(f"/api/v1/sessions/{sid}/tasks", json={"idempotency_key": "key-1"})
    assert r.status_code == 202
    assert r.json()["task_id"] == tid


def test_version_restore(client, process_queued):
    sid = _confirm(client)
    _enqueue(client, sid)
    assert process_queued() == 1

    versions = client.get(f"/api/v1/sessions/{sid}/versions").json()
    assert len(versions) == 1
    v1 = versions[0]

    r = client.post(f"/api/v1/versions/{v1['version_id']}/restore")
    assert r.status_code == 200, r.text
    restored = r.json()
    assert restored["version_number"] == 2
    assert restored["parent_version_id"] == v1["version_id"]
    assert restored["bundle"] == v1["bundle"]

    versions = client.get(f"/api/v1/sessions/{sid}/versions").json()
    assert len(versions) == 2


def test_isolated_code_track_stub():
    from app.tracks import get_track

    track = get_track("isolated-code")
    result = track.run()
    assert result.not_implemented is True
    assert result.bundle is None
