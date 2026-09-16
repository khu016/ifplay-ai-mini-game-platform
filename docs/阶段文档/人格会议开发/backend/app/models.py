import enum
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class MeetingStatus(str, enum.Enum):
    NEW = "new"
    ROLE_CONFIRM = "role_confirm"
    HOST_CLARIFY = "host_clarify"
    FIRST_ROUND = "first_round"
    WAITING = "waiting"
    GENERATING = "generating"
    SUMMARIZING = "summarizing"
    FINISHED = "finished"
    FAILED = "failed"
    SAFETY_ABORT = "safety_abort"
    DELETED = "deleted"


STATUS_LABELS: dict[str, str] = {
    "new": "新建",
    "role_confirm": "角色确认",
    "host_clarify": "主持人澄清",
    "first_round": "首轮生成",
    "waiting": "等待用户",
    "generating": "讨论单元生成",
    "summarizing": "纪要生成",
    "finished": "已结束",
    "failed": "失败",
    "safety_abort": "安全中止",
    "deleted": "已删除",
}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    age_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class VerificationCode(Base):
    __tablename__ = "verification_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default=MeetingStatus.NEW.value)
    current_fact_version_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    units_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class FactVersion(Base):
    __tablename__ = "fact_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    question: Mapped[str] = mapped_column(Text)
    known_choices: Mapped[str] = mapped_column(Text, default="")
    concerns: Mapped[str] = mapped_column(Text, default="")
    extra_conditions: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Participant(Base):
    __tablename__ = "participants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    role_type: Mapped[str] = mapped_column(String(8))
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    fact_version_id: Mapped[int] = mapped_column(ForeignKey("fact_versions.id"))
    speaker: Mapped[str] = mapped_column(String(32))  # host / user / role_type
    role_type: Mapped[str | None] = mapped_column(String(8), nullable=True)
    claim_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    viewpoint: Mapped[str] = mapped_column(Text)
    fact_refs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    assumptions: Mapped[str | None] = mapped_column(Text, nullable=True)
    responds_to: Mapped[str | None] = mapped_column(String(64), nullable=True)
    change_condition: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    problem_and_conditions: Mapped[str] = mapped_column(Text)
    consensus: Mapped[str] = mapped_column(Text)
    disagreements: Mapped[str] = mapped_column(Text)
    unknowns: Mapped[str] = mapped_column(Text)
    next_step: Mapped[str] = mapped_column(Text)
    change_conditions: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)


class Feedback(Base):
    __tablename__ = "feedbacks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id"), index=True)
    interesting: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    new_perspective: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    next_step_intent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    reuse_intent: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
