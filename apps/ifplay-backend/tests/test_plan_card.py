"""方案卡补充字段 + 修改/重推保留历史。"""


def _plan_ready(client, idea="开一家深夜食堂，经营小餐馆"):
    r = client.post("/api/v1/sessions", json={"idea": idea})
    sid = r.json()["session_id"]
    for ans in ["赚钱并升级", "一局约5分钟"]:
        client.post(f"/api/v1/sessions/{sid}/clarifications", json={"answer": ans})
    return sid


def test_plan_card_has_extended_fields(client):
    sid = _plan_ready(client)
    r = client.get(f"/api/v1/sessions/{sid}/plan")
    assert r.status_code == 200, r.text
    plan = r.json()
    for field in [
        "estimated_minutes", "resources", "fail_conditions", "progression",
        "visual_direction", "asset_plan", "limitations", "track_reason",
    ]:
        assert field in plan, f"方案卡缺少字段 {field}"
    assert isinstance(plan["resources"], list)
    assert isinstance(plan["fail_conditions"], list)
    assert isinstance(plan["asset_plan"], dict)
    assert plan["track_reason"]


def test_modify_plan_preserves_history(client):
    sid = _plan_ready(client)
    before = client.get(f"/api/v1/sessions/{sid}/plan").json()

    r = client.post(f"/api/v1/sessions/{sid}/plan/modify", json={"request_text": "把名字改成更吸引人"})
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["id"] != before["id"]  # 新方案记录，非覆盖

    plans = client.get(f"/api/v1/sessions/{sid}/plans").json()
    assert len(plans) == 2
    current = [p for p in plans if p["is_current"]]
    assert len(current) == 1
    assert current[0]["id"] == after["id"]
    # 旧方案仍保留
    assert before["id"] in {p["id"] for p in plans}


def test_recommend_plan_changes_recommendation(client):
    sid = _plan_ready(client)
    before = client.get(f"/api/v1/sessions/{sid}/plan").json()
    r = client.post(f"/api/v1/sessions/{sid}/plan/recommend")
    assert r.status_code == 200, r.text
    after = r.json()
    assert after["primary_module"] != before["primary_module"]
    plans = client.get(f"/api/v1/sessions/{sid}/plans").json()
    assert len(plans) == 2


def test_modify_after_confirm_rejected(client):
    sid = _plan_ready(client)
    client.post(f"/api/v1/sessions/{sid}/plan/confirm")
    r = client.post(f"/api/v1/sessions/{sid}/plan/modify", json={"request_text": "再改"})
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "not_plan_ready"
