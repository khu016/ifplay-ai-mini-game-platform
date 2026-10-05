"""创作会话、澄清与方案卡业务逻辑。

本轮补充：统一费用账本（澄清/方案/方案修改/重推全部记账+预算预检）、澄清上限强制执行、
方案卡补充字段与方案历史（修改/重推保留旧方案）。
"""
from __future__ import annotations

import json

from sqlalchemy import select, update
from sqlalchemy.orm import Session as DbSession

from .. import models, state
from ..billing import provider_call_with_billing
from ..config import get_settings
from ..errors import NotFoundError, StateError
from ..providers.base import Provider
from ..providers.factory import get_provider


def _ask_clarification(db: DbSession, provider: Provider, settings, session: models.CreationSession, task: models.GenerationTask, idea: str, answers: list[str]) -> dict:
    prompt = json.dumps({"kind": "clarification", "idea": idea, "answers": answers}, ensure_ascii=False)
    return provider_call_with_billing(
        db,
        provider,
        settings,
        session_id=session.id,
        task_id=task.id,
        purpose="clarification",
        prompt=prompt,
        max_output_tokens=200,
        timeout_seconds=10.0,
        max_retries=0,
        parse=json.loads,
        input_tokens_estimate=200,
    ).content


def _generate_plan(db: DbSession, provider: Provider, settings, session: models.CreationSession, task: models.GenerationTask, *, kind: str, purpose: str, primary_module: str | None, extra: dict | None = None) -> models.PlanCard:
    payload = {"kind": kind, "idea": session.original_idea}
    if primary_module is not None:
        payload["primary_module"] = primary_module
    if extra:
        payload.update(extra)
    prompt = json.dumps(payload, ensure_ascii=False)
    card = provider_call_with_billing(
        db,
        provider,
        settings,
        session_id=session.id,
        task_id=task.id,
        purpose=purpose,
        prompt=prompt,
        max_output_tokens=1000,
        timeout_seconds=10.0,
        max_retries=0,
        parse=json.loads,
        input_tokens_estimate=500,
    ).content
    return models.PlanCard(
        session_id=session.id,
        title=card.get("title", "未命名游戏"),
        one_liner=card.get("one_liner", session.original_idea),
        player_role=card.get("player_role", "玩家"),
        goal=card.get("goal", session.original_idea),
        primary_module=card.get("primary_module", "business"),
        auxiliary_modules=card.get("auxiliary_modules", []),
        theme=card.get("theme", "通用"),
        core_loop=card.get("core_loop", ""),
        risk_notes=card.get("risk_notes", []),
        track=card.get("track", "gamebundle"),
        estimated_minutes=card.get("estimated_minutes"),
        resources=card.get("resources", []),
        fail_conditions=card.get("fail_conditions", []),
        progression=card.get("progression", []),
        visual_direction=card.get("visual_direction"),
        asset_plan=card.get("asset_plan", {}),
        limitations=card.get("limitations", []),
        track_reason=card.get("track_reason"),
        is_current=True,
    )


def _build_plan_card(db: DbSession, provider: Provider, settings, session: models.CreationSession, task: models.GenerationTask) -> models.PlanCard:
    return _generate_plan(db, provider, settings, session, task, kind="plan_card", purpose="plan", primary_module=None)


def create_session(db: DbSession, idea: str) -> dict:
    provider = get_provider()
    settings = get_settings()
    session = models.CreationSession(original_idea=idea, status="draft")
    db.add(session)
    db.flush()  # 生成 session.id
    task = models.GenerationTask(session_id=session.id, status="draft", track="gamebundle", kind="generation")
    db.add(task)
    db.flush()

    if settings.max_clarifications <= 0:
        # 上限为 0：不追问，直接生成方案卡
        state.assert_transition(task.status, "plan_ready")
        task.status = "plan_ready"
        session.status = "plan_ready"
        db.add(_build_plan_card(db, provider, settings, session, task))
        db.commit()
        return _session_payload(db, session, task)

    # 生成第一个澄清问题：draft -> clarifying
    state.assert_transition(task.status, "clarifying")
    task.status = "clarifying"
    q = _ask_clarification(db, provider, settings, session, task, idea, [])
    if q.get("done") or not q.get("question"):
        state.assert_transition(task.status, "plan_ready")
        task.status = "plan_ready"
        session.status = "plan_ready"
        db.add(_build_plan_card(db, provider, settings, session, task))
    else:
        db.add(models.Clarification(session_id=session.id, question=q["question"], answer=None))
        session.status = "clarifying"
    db.commit()

    return _session_payload(db, session, task)


def _load_session(db: DbSession, session_id: str) -> tuple[models.CreationSession, models.GenerationTask]:
    session = db.get(models.CreationSession, session_id)
    if session is None:
        raise NotFoundError("session_not_found", f"创作会话不存在：{session_id}")
    task = db.scalars(
        select(models.GenerationTask).where(
            models.GenerationTask.session_id == session_id,
            models.GenerationTask.kind == "generation",
        )
    ).one_or_none()
    if task is None:
        raise NotFoundError("task_not_found", f"会话 {session_id} 没有生成任务")
    return session, task


def _session_payload(db: DbSession, session: models.CreationSession, task: models.GenerationTask) -> dict:
    clarifications = db.scalars(
        select(models.Clarification).where(models.Clarification.session_id == session.id).order_by(models.Clarification.created_at)
    ).all()
    plan = db.scalars(
        select(models.PlanCard)
        .where(models.PlanCard.session_id == session.id, models.PlanCard.is_current.is_(True))
        .order_by(models.PlanCard.created_at.desc())
    ).first()
    return {
        "session_id": session.id,
        "idea": session.original_idea,
        "status": session.status,
        "task_id": task.id,
        "task_status": task.status,
        "clarifications": [
            {"id": c.id, "question": c.question, "answer": c.answer} for c in clarifications
        ],
        "plan_card": _plan_payload(plan) if plan else None,
    }


def get_session(db: DbSession, session_id: str) -> dict:
    session, task = _load_session(db, session_id)
    return _session_payload(db, session, task)


def _plan_payload(plan: models.PlanCard) -> dict:
    return {
        "id": plan.id,
        "title": plan.title,
        "one_liner": plan.one_liner,
        "player_role": plan.player_role,
        "goal": plan.goal,
        "primary_module": plan.primary_module,
        "auxiliary_modules": plan.auxiliary_modules,
        "theme": plan.theme,
        "core_loop": plan.core_loop,
        "risk_notes": plan.risk_notes,
        "track": plan.track,
        "estimated_minutes": plan.estimated_minutes,
        "resources": plan.resources,
        "fail_conditions": plan.fail_conditions,
        "progression": plan.progression,
        "visual_direction": plan.visual_direction,
        "asset_plan": plan.asset_plan,
        "limitations": plan.limitations,
        "track_reason": plan.track_reason,
        "is_current": plan.is_current,
    }


def _answered(db: DbSession, session_id: str) -> list[str]:
    return [
        c.answer
        for c in db.scalars(
            select(models.Clarification).where(models.Clarification.session_id == session_id).order_by(models.Clarification.created_at)
        ).all()
        if c.answer is not None
    ]


def submit_clarification(db: DbSession, session_id: str, answer: str) -> dict:
    provider = get_provider()
    settings = get_settings()
    session, task = _load_session(db, session_id)
    if task.status not in ("draft", "clarifying"):
        raise StateError("not_clarifying", f"当前状态 {task.status} 不接受澄清答案")

    unanswered = db.scalars(
        select(models.Clarification)
        .where(models.Clarification.session_id == session.id, models.Clarification.answer.is_(None))
        .order_by(models.Clarification.created_at)
    ).first()
    if unanswered is None:
        raise StateError("no_open_question", "没有待回答的澄清问题")
    unanswered.answer = answer
    db.flush()

    answers = _answered(db, session.id)

    # 强制执行澄清上限：达到上限后停止追问，直接生成方案（或明确不足以生成）
    if len(answers) >= settings.max_clarifications:
        state.assert_transition(task.status, "plan_ready")
        task.status = "plan_ready"
        session.status = "plan_ready"
        db.add(_build_plan_card(db, provider, settings, session, task))
        db.commit()
        return _session_payload(db, session, task)

    q = _ask_clarification(db, provider, settings, session, task, session.original_idea, answers)
    if q.get("done") or not q.get("question"):
        # 澄清充分：clarifying -> plan_ready，生成方案卡
        state.assert_transition(task.status, "plan_ready")
        task.status = "plan_ready"
        session.status = "plan_ready"
        db.add(_build_plan_card(db, provider, settings, session, task))
    else:
        # 继续追问：保持 clarifying
        db.add(models.Clarification(session_id=session.id, question=q["question"], answer=None))
    db.commit()
    return _session_payload(db, session, task)


def get_plan_card(db: DbSession, session_id: str) -> dict:
    session, task = _load_session(db, session_id)
    plan = db.scalars(
        select(models.PlanCard)
        .where(models.PlanCard.session_id == session.id, models.PlanCard.is_current.is_(True))
        .order_by(models.PlanCard.created_at.desc())
    ).first()
    if plan is None:
        raise NotFoundError("plan_not_found", "方案卡尚未生成")
    return _plan_payload(plan)


def list_plans(db: DbSession, session_id: str) -> list[dict]:
    session, task = _load_session(db, session_id)
    plans = db.scalars(
        select(models.PlanCard).where(models.PlanCard.session_id == session.id).order_by(models.PlanCard.created_at.desc())
    ).all()
    return [_plan_payload(p) for p in plans]


def _current_plan(db: DbSession, session: models.CreationSession) -> models.PlanCard:
    plan = db.scalars(
        select(models.PlanCard)
        .where(models.PlanCard.session_id == session.id, models.PlanCard.is_current.is_(True))
        .order_by(models.PlanCard.created_at.desc())
    ).first()
    if plan is None:
        raise NotFoundError("plan_not_found", "方案卡尚未生成")
    return plan


def _supersede_current_plans(db: DbSession, session: models.CreationSession) -> None:
    db.execute(
        update(models.PlanCard)
        .where(models.PlanCard.session_id == session.id, models.PlanCard.is_current.is_(True))
        .values(is_current=False)
    )


def modify_plan(db: DbSession, session_id: str, request_text: str) -> dict:
    provider = get_provider()
    settings = get_settings()
    session, task = _load_session(db, session_id)
    if task.status != "plan_ready":
        raise StateError("not_plan_ready", f"当前状态 {task.status} 不能修改方案")
    current = _current_plan(db, session)
    _supersede_current_plans(db, session)
    new_plan = _generate_plan(
        db, provider, settings, session, task,
        kind="plan_modify", purpose="plan_modify",
        primary_module=current.primary_module, extra={"request_text": request_text},
    )
    db.add(new_plan)
    db.commit()
    return _plan_payload(new_plan)


def recommend_plan(db: DbSession, session_id: str) -> dict:
    provider = get_provider()
    settings = get_settings()
    session, task = _load_session(db, session_id)
    if task.status != "plan_ready":
        raise StateError("not_plan_ready", f"当前状态 {task.status} 不能重推方案")
    current = _current_plan(db, session)
    _supersede_current_plans(db, session)
    new_plan = _generate_plan(
        db, provider, settings, session, task,
        kind="plan_recommend", purpose="plan_recommend",
        primary_module=current.primary_module,
    )
    db.add(new_plan)
    db.commit()
    return _plan_payload(new_plan)


def confirm_plan(db: DbSession, session_id: str) -> dict:
    session, task = _load_session(db, session_id)
    plan = _current_plan(db, session)
    if task.status != "plan_ready":
        if task.status == "confirmed":
            return _session_payload(db, session, task)  # 幂等
        raise StateError("not_plan_ready", f"当前状态 {task.status} 不能确认方案")
    state.assert_transition(task.status, "confirmed")
    task.status = "confirmed"
    task.track = plan.track
    session.status = "confirmed"
    db.commit()
    return _session_payload(db, session, task)
