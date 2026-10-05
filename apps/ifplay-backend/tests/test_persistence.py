"""服务重启后数据恢复（SQLite 持久化 + 启动恢复检查）。"""


def _confirm_enqueue(client, key="rk-1"):
    r = client.post("/api/v1/sessions", json={"idea": "开一家深夜食堂"})
    sid = r.json()["session_id"]
    for ans in ["赚钱并升级", "一局约5分钟"]:
        client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": ans})
    client.post(f"/api/v1/sessions/{sid}/plan/confirm")
    r = client.post(f"/api/v1/sessions/{sid}/tasks", json={"idempotency_key": key})
    assert r.status_code == 202
    return sid, r.json()["task_id"]


def test_playable_data_survives_restart(client, restart_client, process_queued):
    sid, tid = _confirm_enqueue(client)
    process_queued()
    assert client.get(f"/api/v1/tasks/{tid}").json()["status"] == "playable"

    r = restart_client.get(f"/api/v1/tasks/{tid}")
    assert r.json()["status"] == "playable"
    r = restart_client.get(f"/api/v1/tasks/{tid}/result")
    assert r.json()["version"]["version_number"] == 1
    r = restart_client.get(f"/api/v1/sessions/{sid}/versions")
    assert len(r.json()) == 1


def test_queued_survives_restart_and_continues(client, restart_client, process_queued):
    sid, tid = _confirm_enqueue(client)
    # 未 drain：重启后 queued 保留，可继续执行
    r = restart_client.get(f"/api/v1/tasks/{tid}")
    assert r.json()["status"] == "queued"
    process_queued()
    r = restart_client.get(f"/api/v1/tasks/{tid}")
    assert r.json()["status"] == "playable"


def test_confirmed_survives_restart(client, restart_client):
    r = client.post("/api/v1/sessions", json={"idea": "点击打铁"})
    sid = r.json()["session_id"]
    for ans in ["打铁", "5分钟"]:
        client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": ans})
    client.post(f"/api/v1/sessions/{sid}/plan/confirm")
    r = restart_client.get(f"/api/v1/sessions/{sid}")
    assert r.json()["task_status"] == "confirmed"


def test_generating_restart_becomes_interrupted(client):
    """通过 lifespan 验证：generating 状态重启后变为 interrupted。"""
    sid, tid = _confirm_enqueue(client)

    # 领取到 generating（模拟进程在生成中崩溃，不完成）
    from app.db import new_session
    from app.services.task_service import claim_queued_task

    s = new_session()
    try:
        claimed = claim_queued_task(s)
    finally:
        s.close()
    assert claimed is not None

    # 手动模拟重启：重置引擎，新建应用触发 lifespan 恢复
    import app.config as config
    import app.db as dbmod

    config.get_settings.cache_clear()
    dbmod._engine = None
    dbmod._SessionLocal = None

    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c2:
        r = c2.get(f"/api/v1/tasks/{tid}")
        assert r.json()["status"] == "interrupted"
        assert r.json()["error_code"] == "generation_interrupted"
