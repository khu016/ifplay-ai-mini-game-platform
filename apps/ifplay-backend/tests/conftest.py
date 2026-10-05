import os

import pytest
from fastapi.testclient import TestClient

_CONTRACT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "ifplay-m0", "contract", "gamebundle-contract.json")
)


def _reset_app_state() -> None:
    import app.config as config
    import app.db as db

    config.get_settings.cache_clear()
    db._engine = None
    db._SessionLocal = None


def _set_env(monkeypatch, db_url: str) -> None:
    monkeypatch.setenv("IFPLAY_DATABASE_URL", db_url)
    monkeypatch.setenv("IFPLAY_WORKER_ENABLED", "false")  # 测试禁用后台线程，手动驱动队列
    monkeypatch.setenv("IFPLAY_CONTRACT_PATH", _CONTRACT)


@pytest.fixture()
def db_url(tmp_path):
    return f"sqlite:///{tmp_path / 'test.db'}"


@pytest.fixture()
def client(db_url, monkeypatch):
    _set_env(monkeypatch, db_url)
    _reset_app_state()
    from app.main import app

    with TestClient(app) as c:
        yield c
    _reset_app_state()


@pytest.fixture()
def restart_client(db_url, monkeypatch):
    """模拟服务重启：同一 DB 文件重新创建引擎与应用（触发 lifespan 恢复检查）。"""
    _set_env(monkeypatch, db_url)
    _reset_app_state()
    from app.main import app

    with TestClient(app) as c:
        yield c
    _reset_app_state()


@pytest.fixture()
def db(db_url, monkeypatch):
    """直接数据库会话（用于驱动队列/领取/恢复）。"""
    _set_env(monkeypatch, db_url)
    _reset_app_state()
    from app.db import init_db, new_session

    init_db()
    s = new_session()
    yield s
    s.close()
    _reset_app_state()


@pytest.fixture()
def process_queued():
    from app.services.task_service import process_queued_tasks

    def _process(max_tasks=None):
        from app.db import new_session

        s = new_session()
        try:
            return process_queued_tasks(s, max_tasks)
        finally:
            s.close()

    return _process
