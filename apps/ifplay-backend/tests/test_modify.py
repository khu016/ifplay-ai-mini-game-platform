"""自然语言修改闭环：合法数值修改、非法字段、代码注入、幂等、预算、中断恢复、旧版本不被覆盖、多任务。"""
import json

import pytest

from app.providers.deterministic import DeterministicTestProvider
from app.services import task_service


def _make_game(client, process_queued, idea="开一家深夜食堂，经营小餐馆"):
    r = client.post("/api/v1/sessions", json={"idea": idea})
    sid = r.json()["session_id"]
    for ans in ["赚钱并升级", "一局约5分钟"]:
        client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": ans})
    client.post(f"/api/v1/sessions/{sid}/plan/confirm")
    r = client.post(f"/api/v1/sessions/{sid}/tasks", json={"idempotency_key": "gen-1"})
    assert process_queued() == 1
    v = client.get(f"/api/v1/tasks/{r.json()['task_id']}/result").json()["version"]
    return sid, v


def _submit(client, sid, vid, text, key):
    return client.post(
        f"/api/v1/sessions/{sid}/versions/{vid}/modifications",
        json={"request_text": text, "idempotency_key": key},
    )


def test_legal_numeric_modification(client, process_queued):
    sid, v1 = _make_game(client, process_queued)
    r = _submit(client, sid, v1["version_id"], "把回合数改成20", "m1")
    assert r.status_code == 202, r.text
    assert r.json()["status"] == "queued"
    mid = r.json()["task_id"]
    assert process_queued() == 1

    res = client.get(f"/api/v1/modifications/{mid}/result").json()
    assert res["task"]["status"] == "succeeded"
    v2 = res["version"]
    assert v2["parent_version_id"] == v1["version_id"]
    assert v2["bundle"]["primaryModule"]["config"]["totalTurns"] == 20

    # 旧版本不被覆盖
    versions = {v["version_id"]: v for v in client.get(f"/api/v1/sessions/{sid}/versions").json()}
    assert versions[v1["version_id"]]["bundle"]["primaryModule"]["config"]["totalTurns"] == 10


def test_idempotent_modification(client, process_queued):
    sid, v1 = _make_game(client, process_queued)
    r1 = _submit(client, sid, v1["version_id"], "把回合数改成20", "m1")
    r2 = _submit(client, sid, v1["version_id"], "把回合数改成20", "m1")
    assert r1.json()["task_id"] == r2.json()["task_id"]


def test_multiple_modification_tasks_per_session(client, process_queued):
    sid, v1 = _make_game(client, process_queued)
    r1 = _submit(client, sid, v1["version_id"], "把回合数改成20", "m1")
    r2 = _submit(client, sid, v1["version_id"], "把回合数改成30", "m2")
    assert r1.json()["task_id"] != r2.json()["task_id"]
    assert process_queued() == 2
    versions = client.get(f"/api/v1/sessions/{sid}/versions").json()
    assert len(versions) == 3


class _PatchProvider(DeterministicTestProvider):
    def __init__(self, patch):
        self.patch = patch

    def _raw(self, prompt, *, max_output_tokens, timeout_seconds):
        req = json.loads(prompt)
        if req["kind"] == "modify":
            return {
                "content": json.dumps(self.patch, ensure_ascii=False),
                "input_tokens": 10,
                "output_tokens": 20,
            }
        return super()._raw(prompt, max_output_tokens=max_output_tokens, timeout_seconds=timeout_seconds)


def test_illegal_field_modification_fails(client, process_queued, monkeypatch):
    sid, v1 = _make_game(client, process_queued)
    monkeypatch.setattr(
        task_service, "get_provider",
        lambda: _PatchProvider([{"op": "set", "path": "manifest.author", "value": "x"}]),
    )
    r = _submit(client, sid, v1["version_id"], "非法字段", "m1")
    mid = r.json()["task_id"]
    assert process_queued() == 1
    res = client.get(f"/api/v1/modifications/{mid}/result").json()
    assert res["task"]["status"] == "failed"
    assert res["task"]["error_code"] == "patch_invalid_path"


def test_code_injection_modification_fails(client, process_queued, monkeypatch):
    sid, v1 = _make_game(client, process_queued)
    monkeypatch.setattr(
        task_service, "get_provider",
        lambda: _PatchProvider([{"op": "set", "path": "experience.goal", "value": "eval('alert(1)')"}]),
    )
    r = _submit(client, sid, v1["version_id"], "注入代码", "m1")
    mid = r.json()["task_id"]
    assert process_queued() == 1
    res = client.get(f"/api/v1/modifications/{mid}/result").json()
    assert res["task"]["status"] == "failed"
    assert res["task"]["error_code"] == "patch_code_injection"


def test_budget_insufficient_modification_fails(client, process_queued, monkeypatch):
    sid, v1 = _make_game(client, process_queued)
    monkeypatch.setenv("IFPLAY_BUDGET_PER_TASK", "0.0001")
    monkeypatch.setenv("IFPLAY_SAFETY_MARGIN", "0")
    import app.config as config

    config.get_settings.cache_clear()
    r = _submit(client, sid, v1["version_id"], "把回合数改成20", "m1")
    mid = r.json()["task_id"]
    assert process_queued() == 1
    res = client.get(f"/api/v1/modifications/{mid}/result").json()
    assert res["task"]["status"] == "failed"
    assert res["task"]["error_code"] == "cost_limit"


def test_modification_interrupt_resume(client, process_queued):
    sid, v1 = _make_game(client, process_queued)
    r = _submit(client, sid, v1["version_id"], "把回合数改成20", "m1")
    mid = r.json()["task_id"]

    from app.db import new_session
    from app.services import task_service as ts

    s = new_session()
    try:
        claimed = ts.claim_queued_task(s)
        assert claimed is not None and claimed.id == mid
        assert claimed.status == "applying"
        assert ts.recover_interrupted_tasks(s) == 1
    finally:
        s.close()

    r = client.get(f"/api/v1/modifications/{mid}")
    assert r.json()["status"] == "interrupted"
    assert r.json()["error_code"] == "modification_interrupted"

    r = client.post(f"/api/v1/modifications/{mid}/resume", json={"idempotency_key": "r1", "confirm_retry": True})
    assert r.json()["status"] == "queued"
    assert process_queued() == 1
    res = client.get(f"/api/v1/modifications/{mid}/result").json()
    assert res["task"]["status"] == "succeeded"
    assert res["version"]["parent_version_id"] == v1["version_id"]
