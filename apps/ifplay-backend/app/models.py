"""数据模型：创作会话、澄清、方案卡、生成任务、游戏版本、用量台账、校验结果。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CreationSession(Base):
    __tablename__ = "creation_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    original_idea: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class Clarification(Base):
    __tablename__ = "clarifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(32), ForeignKey("creation_sessions.id"), index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class PlanCard(Base):
    __tablename__ = "plan_cards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(32), ForeignKey("creation_sessions.id"), index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    one_liner: Mapped[str] = mapped_column(String(500), nullable=False)
    player_role: Mapped[str] = mapped_column(String(200), nullable=False)
    goal: Mapped[str] = mapped_column(String(500), nullable=False)
    primary_module: Mapped[str] = mapped_column(String(64), nullable=False)
    auxiliary_modules: Mapped[list] = mapped_column(JSON, default=list)
    theme: Mapped[str] = mapped_column(String(200), nullable=False)
    core_loop: Mapped[str] = mapped_column(String(1000), nullable=False)
    risk_notes: Mapped[list] = mapped_column(JSON, default=list)
    track: Mapped[str] = mapped_column(String(32), nullable=False, default="gamebundle")
    # 方案卡补充字段（PRD v2.1 §5.2）
    estimated_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resources: Mapped[list] = mapped_column(JSON, default=list)
    fail_conditions: Mapped[list] = mapped_column(JSON, default=list)
    progression: Mapped[list] = mapped_column(JSON, default=list)
    visual_direction: Mapped[str | None] = mapped_column(String(500), nullable=True)
    asset_plan: Mapped[dict] = mapped_column(JSON, default=dict)
    limitations: Mapped[list] = mapped_column(JSON, default=list)
    track_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # 方案历史：当前方案为 True；修改/重推后旧方案置 False（不覆盖历史）
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class GenerationTask(Base):
    __tablename__ = "generation_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(32), ForeignKey("creation_sessions.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    track: Mapped[str] = mapped_column(String(32), nullable=False, default="gamebundle")
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    resume_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # 任务类型：generation（创作主任务，一会话一个）| modification（自然语言修改，一会话多个）
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="generation")
    # 修改任务专用：自然语言要求 + 被修改的基线版本
    request_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)
    updated_at: Mapped[datetime] = mapped_column(default=_now, onupdate=_now)


class GameVersion(Base):
    __tablename__ = "game_versions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(32), ForeignKey("creation_sessions.id"), index=True)
    task_id: Mapped[str] = mapped_column(String(32), ForeignKey("generation_tasks.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    parent_version_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    bundle: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="playable")
    # 版本数量上限：超出最近 N 个标记归档，不物理删除
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class UsageLedger(Base):
    __tablename__ = "usage_ledger"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    session_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("creation_sessions.id"), index=True, nullable=True)
    task_id: Mapped[str] = mapped_column(String(32), ForeignKey("generation_tasks.id"), index=True)
    provider_name: Mapped[str] = mapped_column(String(64), nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    # 调用用途：clarification / plan / plan_modify / plan_recommend / gamebundle / repair / modify
    purpose: Mapped[str] = mapped_column(String(32), nullable=False, default="gamebundle")
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    cost_cny: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ok")  # ok / failed
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_now)


class ValidationResult(Base):
    __tablename__ = "validation_results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    task_id: Mapped[str] = mapped_column(String(32), ForeignKey("generation_tasks.id"), index=True)
    check_type: Mapped[str] = mapped_column(String(64), nullable=False)
    passed: Mapped[bool] = mapped_column(nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=_now)
