"""向后兼容迁移：已有 SQLite 表补列，不删除数据。"""
import sqlite3


def _old_db(path):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE usage_ledger ("
        "id VARCHAR(32) PRIMARY KEY, task_id VARCHAR(32), provider_name VARCHAR(64), "
        "model VARCHAR(128), version VARCHAR(64), input_tokens INTEGER, output_tokens INTEGER, "
        "image_count INTEGER, duration_ms INTEGER, cost_cny FLOAT, status VARCHAR(32), created_at DATETIME)"
    )
    conn.execute(
        "INSERT INTO usage_ledger (id, task_id, provider_name, model, version, input_tokens, output_tokens, "
        "image_count, duration_ms, cost_cny, status) "
        "VALUES ('old1', 't1', 'p', 'm', 'v', 10, 20, 0, 1, 0.01, 'ok')"
    )
    conn.commit()
    conn.close()


def test_migration_adds_columns_and_preserves_rows(tmp_path, monkeypatch):
    db_path = tmp_path / "old.db"
    _old_db(db_path)

    monkeypatch.setenv("IFPLAY_DATABASE_URL", f"sqlite:///{db_path}")
    import app.config as config
    import app.db as dbmod

    config.get_settings.cache_clear()
    dbmod._engine = None
    dbmod._SessionLocal = None

    from app.db import init_db

    init_db()

    conn = sqlite3.connect(db_path)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(usage_ledger)")}
    assert {"purpose", "session_id", "error_code"} <= cols

    row = conn.execute("SELECT id, purpose, status FROM usage_ledger WHERE id='old1'").fetchone()
    assert row[0] == "old1"  # 旧数据保留
    assert row[1] == "gamebundle"  # 新列回填默认值
    assert row[2] == "ok"
    conn.close()


def test_migration_idempotent(tmp_path, monkeypatch):
    db_path = tmp_path / "old.db"
    _old_db(db_path)

    monkeypatch.setenv("IFPLAY_DATABASE_URL", f"sqlite:///{db_path}")
    import app.config as config
    import app.db as dbmod

    config.get_settings.cache_clear()
    dbmod._engine = None
    dbmod._SessionLocal = None

    from app.db import init_db

    init_db()
    init_db()  # 再次运行不应报错、不应丢数据

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT id FROM usage_ledger WHERE id='old1'").fetchone()
    assert row[0] == "old1"
    conn.close()
