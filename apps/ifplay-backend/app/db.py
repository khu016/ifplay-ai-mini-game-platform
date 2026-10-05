"""SQLite 数据库连接与初始化（SQLAlchemy 2.x）。"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _ensure_data_dir(url: str) -> None:
    if url.startswith("sqlite:///"):
        db_path = url.removeprefix("sqlite:///")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)


_engine = None
_SessionLocal = None


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        url = get_settings().database_url
        _ensure_data_dir(url)
        _engine = create_engine(url, connect_args={"check_same_thread": False})
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def get_session_factory():
    get_engine()
    return _SessionLocal


def init_db() -> None:
    """初始化数据库表结构（幂等）。先 create_all 新建表，再做向后兼容的轻量列迁移。"""
    from . import models  # noqa: F401  确保模型已注册

    engine = get_engine()
    Base.metadata.create_all(engine)
    _migrate(engine)


def _migrate(engine) -> None:
    """向后兼容迁移：仅为已有表补充新增列，不删除、不重建、不丢数据。

    create_all 不会为已存在的表加列，因此这里用 PRAGMA/inspect 检测缺失列后 ALTER TABLE ADD COLUMN。
    """
    from sqlalchemy import inspect, text

    insp = inspect(engine)

    def add_column(table: str, column: str, ddl: str) -> None:
        if not insp.has_table(table):
            return
        existing = {c["name"] for c in insp.get_columns(table)}
        if column in existing:
            return
        with engine.begin() as conn:
            conn.execute(text(ddl))

    # usage_ledger：会话维度聚合 + 用途 + 失败错误码
    add_column("usage_ledger", "session_id", "ALTER TABLE usage_ledger ADD COLUMN session_id VARCHAR(32)")
    add_column("usage_ledger", "purpose", "ALTER TABLE usage_ledger ADD COLUMN purpose VARCHAR(32) NOT NULL DEFAULT 'gamebundle'")
    add_column("usage_ledger", "error_code", "ALTER TABLE usage_ledger ADD COLUMN error_code VARCHAR(64)")

    # plan_cards：方案卡补充字段 + 历史标记
    add_column("plan_cards", "estimated_minutes", "ALTER TABLE plan_cards ADD COLUMN estimated_minutes INTEGER")
    add_column("plan_cards", "resources", "ALTER TABLE plan_cards ADD COLUMN resources JSON")
    add_column("plan_cards", "fail_conditions", "ALTER TABLE plan_cards ADD COLUMN fail_conditions JSON")
    add_column("plan_cards", "progression", "ALTER TABLE plan_cards ADD COLUMN progression JSON")
    add_column("plan_cards", "visual_direction", "ALTER TABLE plan_cards ADD COLUMN visual_direction VARCHAR(500)")
    add_column("plan_cards", "asset_plan", "ALTER TABLE plan_cards ADD COLUMN asset_plan JSON")
    add_column("plan_cards", "limitations", "ALTER TABLE plan_cards ADD COLUMN limitations JSON")
    add_column("plan_cards", "track_reason", "ALTER TABLE plan_cards ADD COLUMN track_reason VARCHAR(1000)")
    add_column("plan_cards", "is_current", "ALTER TABLE plan_cards ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT 1")

    # game_versions：版本上限归档标记
    add_column("game_versions", "is_archived", "ALTER TABLE game_versions ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT 0")
    add_column("game_versions", "archived_at", "ALTER TABLE game_versions ADD COLUMN archived_at DATETIME")

    # generation_tasks：任务类型 + 修改任务字段
    add_column("generation_tasks", "kind", "ALTER TABLE generation_tasks ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'generation'")
    add_column("generation_tasks", "request_text", "ALTER TABLE generation_tasks ADD COLUMN request_text TEXT")
    add_column("generation_tasks", "parent_version_id", "ALTER TABLE generation_tasks ADD COLUMN parent_version_id VARCHAR(32)")

    # 回填：旧 usage_ledger 行补 session_id（从 generation_tasks 关联）
    with engine.begin() as conn:
        conn.execute(text(
            "UPDATE usage_ledger SET session_id = "
            "(SELECT session_id FROM generation_tasks WHERE generation_tasks.id = usage_ledger.task_id) "
            "WHERE session_id IS NULL"
        ))


def new_session() -> Session:
    return get_session_factory()()
