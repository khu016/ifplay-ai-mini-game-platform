import os
import tempfile

import pytest

# 必须在导入 app 之前设置，确保测试用独立数据库
_tmp = tempfile.mkdtemp(prefix="pm_test_")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["SESSION_SECRET"] = "test-secret"
os.environ["DEV_EMAIL_CODE"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c


def login(client: TestClient, email: str = "a@example.com") -> None:
    r = client.post("/api/v1/auth/request-code", json={"email": email})
    assert r.status_code == 200, r.text
    code = r.json()["dev_code"]
    r = client.post(
        "/api/v1/auth/verify",
        json={"email": email, "code": code, "age_confirmed": True},
    )
    assert r.status_code == 200, r.text
