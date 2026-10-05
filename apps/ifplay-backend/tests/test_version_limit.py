"""版本数量上限：默认最近 10 个可玩版本；超出归档不删除；归档不可作修改基线；恢复=新建版本。"""
import pytest

from app.config import Settings


def test_default_max_versions_is_10():
    assert Settings().max_versions == 10


@pytest.fixture()
def max_three(monkeypatch):
    monkeypatch.setenv("IFPLAY_MAX_VERSIONS", "3")
    import app.config as config

    config.get_settings.cache_clear()
    yield
    config.get_settings.cache_clear()


def _make_game(client, process_queued):
    r = client.post("/api/v1/sessions", json={"idea": "开一家深夜食堂，经营小餐馆"})
    sid = r.json()["session_id"]
    for ans in ["赚钱并升级", "一局约5分钟"]:
        client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": ans})
    client.post(f"/api/v1/sessions/{sid}/plan/confirm")
    r = client.post(f"/api/v1/sessions/{sid}/tasks", json={"idempotency_key": "gen-1"})
    assert process_queued() == 1
    v = client.get(f"/api/v1/tasks/{r.json()['task_id']}/result").json()["version"]
    return sid, v


def test_archive_beyond_limit(client, process_queued, max_three):
    sid, v1 = _make_game(client, process_queued)
    latest_id = v1["version_id"]
    # 再恢复 3 次 → 共 4 个版本，超过上限 3
    for _ in range(3):
        r = client.post(f"/api/v1/versions/{latest_id}/restore").json()
        latest_id = r["version_id"]

    visible = client.get(f"/api/v1/sessions/{sid}/versions").json()
    assert len(visible) == 3
    assert all(not v["is_archived"] for v in visible)

    all_versions = client.get(f"/api/v1/sessions/{sid}/versions", params={"include_archived": "true"}).json()
    assert len(all_versions) == 4
    archived = [v for v in all_versions if v["is_archived"]]
    assert len(archived) == 1
    # 归档的是最旧的 v1
    assert archived[0]["version_id"] == v1["version_id"]


def test_archived_not_modifiable_baseline(client, process_queued, max_three):
    sid, v1 = _make_game(client, process_queued)
    latest_id = v1["version_id"]
    for _ in range(3):
        latest_id = client.post(f"/api/v1/versions/{latest_id}/restore").json()["version_id"]

    r = client.post(
        f"/api/v1/sessions/{sid}/versions/{v1['version_id']}/modifications",
        json={"request_text": "改一下", "idempotency_key": "m1"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "version_archived"


def test_restore_from_archived_creates_new_version(client, process_queued, max_three):
    sid, v1 = _make_game(client, process_queued)
    latest_id = v1["version_id"]
    for _ in range(3):
        latest_id = client.post(f"/api/v1/versions/{latest_id}/restore").json()["version_id"]

    # 从归档的 v1 恢复：仍以“创建新版本”方式，保留审计关系
    r = client.post(f"/api/v1/versions/{v1['version_id']}/restore").json()
    assert r["parent_version_id"] == v1["version_id"]
    assert r["is_archived"] is False
    # 新版本成为可见版本之一
    visible = client.get(f"/api/v1/sessions/{sid}/versions").json()
    assert r["version_id"] in {v["version_id"] for v in visible}


def test_parent_child_relations(client, process_queued, max_three):
    sid, v1 = _make_game(client, process_queued)
    latest_id = v1["version_id"]
    for _ in range(3):
        r = client.post(f"/api/v1/versions/{latest_id}/restore").json()
        assert r["parent_version_id"] == latest_id
        latest_id = r["version_id"]
