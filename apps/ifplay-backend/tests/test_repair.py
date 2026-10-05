"""内容修复：首轮非法→修复后合法；两轮仍失败；每轮单独记账；失败不产出可玩版本。"""
from app.providers.deterministic import FIXTURE_FAIL_ALWAYS, FIXTURE_FAIL_ONCE


def _confirm_enqueue(client, idea, key="k1"):
    r = client.post("/api/v1/sessions", json={"idea": idea})
    sid = r.json()["session_id"]
    for ans in ["赚钱并升级", "一局约5分钟"]:
        client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": ans})
    client.post(f"/api/v1/sessions/{sid}/plan/confirm")
    r = client.post(f"/api/v1/sessions/{sid}/tasks", json={"idempotency_key": key})
    return sid, r.json()["task_id"]


def test_first_round_invalid_then_fixed(client, process_queued):
    sid, tid = _confirm_enqueue(client, f"开一家深夜食堂 {FIXTURE_FAIL_ONCE}")
    assert process_queued() == 1

    r = client.get(f"/api/v1/tasks/{tid}")
    assert r.json()["status"] == "playable", r.text

    result = client.get(f"/api/v1/tasks/{tid}/result").json()
    assert result["version"]["version_number"] == 1
    assert all(v["passed"] for v in result["validation_summary"])
    # 首轮非法后触发了一轮修复，且单独记账
    purposes = [u["purpose"] for u in result["usage"]]
    assert purposes.count("repair") == 1
    assert "gamebundle" in purposes


def test_two_rounds_still_fail(client, process_queued):
    sid, tid = _confirm_enqueue(client, f"开一家深夜食堂 {FIXTURE_FAIL_ALWAYS}")
    assert process_queued() == 1

    r = client.get(f"/api/v1/tasks/{tid}")
    assert r.json()["status"] == "failed", r.text
    assert r.json()["error_code"] == "validation_failed"

    # 恰好两轮修复，第 3 次禁止调用
    result = client.get(f"/api/v1/tasks/{tid}/result").json()
    purposes = [u["purpose"] for u in result["usage"]]
    assert purposes.count("repair") == 2

    # 修复失败不得创建可玩版本
    versions = client.get(f"/api/v1/sessions/{sid}/versions").json()
    assert versions == []
