import json

from fastapi.testclient import TestClient

from app.main import app

from .conftest import login


def _create(client, question="我该留下还是跳槽？", mode="quick", role_types=None):
    body = {
        "question": question,
        "known_choices": "留下 / 跳槽",
        "concerns": "怕不稳定",
        "mode": mode,
        "role_types": role_types or [],
    }
    return client.post("/api/v1/meetings", json=body)


def _steps(client, meeting_id, body):
    r = client.post(f"/api/v1/meetings/{meeting_id}/steps", json=body)
    assert r.status_code == 200, r.text
    events = [
        json.loads(line[6:])
        for line in r.text.split("\n\n")
        if line.startswith("data: ")
    ]
    done = [e for e in events if "messages" in e]
    assert done, "SSE 未以 done 收尾"
    return done[-1]


def test_create_quick_recommends_4_roles(client):
    login(client)
    r = _create(client)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "role_confirm"
    assert len(data["roles"]) == 4


def test_create_manual_requires_3_to_5(client):
    login(client)
    r = _create(client, mode="manual", role_types=["INTJ", "ENFP"])
    assert r.status_code == 422
    r = _create(client, mode="manual", role_types=["INTJ", "ENFP", "ENTP"])
    assert r.status_code == 200


def test_high_risk_aborts(client):
    login(client)
    r = _create(client, question="我觉得活不下去了，想结束自己")
    assert r.status_code == 200
    assert r.json()["safety_abort"] is True
    assert r.json()["category"] == "self_harm"


def test_full_flow(client):
    login(client)
    r = _create(client)
    mid = r.json()["id"]
    n_roles = len(r.json()["roles"])

    # 开始会议：主持人 + 首轮每角色一次
    r = client.post(f"/api/v1/meetings/{mid}/start", json={})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["opening"]
    assert len(data["messages"]) == n_roles

    # 继续：一个讨论单元
    evt = _steps(client, mid, {"action": "continue"})
    assert len(evt["messages"]) == n_roles

    # 补充条件：新事实版本，仍生成单元
    evt = _steps(client, mid, {"action": "add_condition", "text": "其实我已经拿到 offer 了"})
    assert len(evt["messages"]) >= 1

    # 生成纪要
    r = client.post(f"/api/v1/meetings/{mid}/summarize", json={})
    assert r.status_code == 200, r.text
    s = r.json()
    for k in ("consensus", "disagreements", "unknowns", "next_step", "change_conditions"):
        assert k in s

    # 历史与详情
    r = client.get("/api/v1/meetings")
    assert len(r.json()["meetings"]) == 1
    r = client.get(f"/api/v1/meetings/{mid}")
    assert r.json()["summary"] is not None

    # 删除
    r = client.delete(f"/api/v1/meetings/{mid}")
    assert r.status_code == 200
    r = client.get("/api/v1/meetings")
    assert len(r.json()["meetings"]) == 0


def test_cross_user_isolation(client):
    login(client, "a@example.com")
    r = _create(client)
    mid = r.json()["id"]

    with TestClient(app) as c2:
        login(c2, "b@example.com")
        assert c2.get(f"/api/v1/meetings/{mid}").status_code == 404
        assert c2.delete(f"/api/v1/meetings/{mid}").status_code == 404
