from .conftest import login


def test_request_code_returns_dev_code(client):
    r = client.post("/api/v1/auth/request-code", json={"email": "a@example.com"})
    assert r.status_code == 200
    assert "dev_code" in r.json()


def test_request_code_invalid_email(client):
    r = client.post("/api/v1/auth/request-code", json={"email": "not-an-email"})
    assert r.status_code == 422


def test_verify_requires_age_confirmation(client):
    r = client.post("/api/v1/auth/request-code", json={"email": "a@example.com"})
    code = r.json()["dev_code"]
    r = client.post(
        "/api/v1/auth/verify",
        json={"email": "a@example.com", "code": code, "age_confirmed": False},
    )
    assert r.status_code == 403


def test_verify_wrong_code(client):
    client.post("/api/v1/auth/request-code", json={"email": "a@example.com"})
    r = client.post(
        "/api/v1/auth/verify",
        json={"email": "a@example.com", "code": "000000", "age_confirmed": True},
    )
    assert r.status_code == 401


def test_verify_and_me(client):
    login(client)
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "a@example.com"
    assert r.json()["age_confirmed"] is True


def test_me_requires_login(client):
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401
