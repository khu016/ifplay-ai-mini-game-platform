"""生成任务、内容修复、自然语言修改、版本、恢复与后台工作器业务逻辑。

任务生命周期（持久化长任务）：
  generation：confirmed --(enqueue)--> queued --(claim)--> generating --> validating --> playable
  modification：queued --(claim)--> applying --> validating --> succeeded
  任一步可进入 failed；generating/applying/validating 在服务重启时进入 interrupted（可显式 resume）。

本阶段新增：
- 统一费用账本（澄清/方案/生成/修复/修改 全部记账 + 预算预检 + 失败留痕）
- 内容修复（最多两轮，每轮单独记账，第 3 次禁止调用）
- 自然语言修改（结构化补丁 → 允许路径检查 → 副本 → 完整校验 → 新版本）
- 版本数量上限（超出归档，不物理删除）
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession

from .. import models, state
from ..billing import provider_call_with_billing
from ..config import get_settings
from ..contract import ContractValidator
from ..errors import ApiError, ConflictError, NotFoundError, StateError
from ..patch import apply_patch
from ..providers.base import ProviderError
from ..providers.factory import get_provider
from .session_service import _load_session


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _task_payload(task: models.GenerationTask) -> dict:
    return {
        "task_id": task.id,
        "session_id": task.session_id,
        "status": task.status,
        "track": task.track,
        "kind": task.kind,
        "error_code": task.error_code,
        "parent_version_id": task.parent_version_id,
        "request_text": task.request_text,
    }


# ---- 任务创建 / 队列领取 ----

def create_task(db: DbSession, session_id: str, idempotency_key: str) -> dict:
    """创建生成任务 = 持久化入队（confirmed -> queued），不等待生成结束。"""
    session, task = _load_session(db, session_id)

    if task.idempotency_key == idempotency_key and task.status in (
        "queued", "generating", "validating", "playable", "failed", "interrupted"
    ):
        return _task_payload(task)
    if task.status in ("queued", "generating", "validating", "playable"):
        raise ConflictError("task_in_progress", f"任务已在进行中（{task.status}）")

    if task.status != "confirmed":
        raise StateError("not_confirmed", f"当前状态 {task.status} 不能开始生成，需先确认方案")

    state.assert_transition(task.status, "queued", task.kind)
    task.status = "queued"
    task.idempotency_key = idempotency_key
    task.error_code = None
    db.commit()
    return _task_payload(task)


def claim_queued_task(db: DbSession) -> models.GenerationTask | None:
    """原子领取一个 queued 任务：条件 UPDATE 防止重复领取；按 kind 进入对应工作态。"""
    row = db.execute(
        select(models.GenerationTask.id, models.GenerationTask.kind)
        .where(models.GenerationTask.status == "queued")
        .order_by(models.GenerationTask.created_at)
        .limit(1)
    ).first()
    if row is None:
        return None
    new_status = "applying" if row.kind == "modification" else "generating"
    result = db.execute(
        update(models.GenerationTask)
        .where(models.GenerationTask.id == row.id, models.GenerationTask.status == "queued")
        .values(status=new_status)
    )
    db.commit()
    if result.rowcount == 1:
        return db.get(models.GenerationTask, row.id)
    return None


# ---- 内容修复与生成编排 ----

def _all_passed(validation: list[dict]) -> bool:
    return all(bool(v["passed"]) for v in validation)


def _machine_readable_errors(validation: list[dict]) -> list[dict]:
    out: list[dict] = []
    for v in validation:
        if v["passed"]:
            continue
        details = v.get("details") or {}
        errs = list(details.get("errors") or []) + list(details.get("hits") or [])
        out.append({"check_type": v["check_type"], "errors": errs})
    return out


def _save_validation(db: DbSession, task_id: str, validation: list[dict]) -> None:
    for v in validation:
        db.add(
            models.ValidationResult(
                task_id=task_id,
                check_type=v["check_type"],
                passed=bool(v["passed"]),
                details=v.get("details") or {},
            )
        )


def _generate_with_repair(db: DbSession, session: models.CreationSession, task: models.GenerationTask, plan: models.PlanCard, provider, validator, settings) -> tuple[dict, list[dict]]:
    """生成 GameBundle + 最多两轮内容修复（每轮单独记账，调用前预算预检）。"""
    idea = session.original_idea
    primary_module = plan.primary_module

    gen_prompt = json.dumps(
        {"kind": "gamebundle", "idea": idea, "primary_module": primary_module}, ensure_ascii=False
    )
    result = provider_call_with_billing(
        db, provider, settings,
        session_id=session.id, task_id=task.id, purpose="gamebundle",
        prompt=gen_prompt,
        max_output_tokens=settings.max_output_tokens,
        timeout_seconds=settings.timeout_seconds,
        max_retries=settings.max_retries,
        parse=json.loads,
        input_tokens_estimate=500,
    )
    bundle = result.content
    validation = validator.validate(bundle)

    rounds = 0
    while not _all_passed(validation) and rounds < settings.max_repair_rounds:
        errors = _machine_readable_errors(validation)
        repair_prompt = json.dumps(
            {"kind": "repair", "idea": idea, "primary_module": primary_module, "bundle": bundle, "errors": errors},
            ensure_ascii=False,
        )
        repair = provider_call_with_billing(
            db, provider, settings,
            session_id=session.id, task_id=task.id, purpose="repair",
            prompt=repair_prompt,
            max_output_tokens=settings.max_output_tokens,
            timeout_seconds=settings.timeout_seconds,
            max_retries=settings.max_retries,
            parse=json.loads,
            input_tokens_estimate=1000,
        )
        bundle = repair.content
        validation = validator.validate(bundle)
        rounds += 1
    return bundle, validation


def _run_generation(db: DbSession, task: models.GenerationTask) -> dict:
    settings = get_settings()
    provider = get_provider()
    validator = ContractValidator(settings.contract_path)

    session = db.get(models.CreationSession, task.session_id)
    if session is None:
        return _fail(db, task, "session_not_found")

    plan = db.scalars(
        select(models.PlanCard)
        .where(models.PlanCard.session_id == session.id, models.PlanCard.is_current.is_(True))
        .order_by(models.PlanCard.created_at.desc())
    ).first()
    if plan is None:
        return _fail(db, task, "plan_not_found")

    try:
        bundle, validation = _generate_with_repair(db, session, task, plan, provider, validator, settings)
    except ProviderError as e:
        return _fail(db, task, e.code)
    except Exception:  # noqa: BLE001
        return _fail(db, task, "internal_error")

    _save_validation(db, task.id, validation)
    db.commit()

    if not _all_passed(validation):
        return _fail(db, task, "validation_failed")

    state.assert_transition(task.status, "validating", task.kind)
    task.status = "validating"
    db.commit()

    state.assert_transition(task.status, "playable", task.kind)
    task.status = "playable"
    task.error_code = None
    version = _create_version(db, task.session_id, task.id, bundle, parent_version_id=None)
    db.commit()
    return {**_task_payload(task), "version_id": version.id}


# ---- 自然语言修改 ----

def _run_modification(db: DbSession, task: models.GenerationTask) -> dict:
    settings = get_settings()
    provider = get_provider()
    validator = ContractValidator(settings.contract_path)

    session = db.get(models.CreationSession, task.session_id)
    if session is None:
        return _fail(db, task, "session_not_found")

    base_version = db.get(models.GameVersion, task.parent_version_id)
    if base_version is None:
        return _fail(db, task, "version_not_found")
    if base_version.is_archived:
        return _fail(db, task, "version_archived")

    # 1) Provider 只能返回结构化补丁（purpose=modify）
    try:
        patch_result = provider_call_with_billing(
            db, provider, settings,
            session_id=session.id, task_id=task.id, purpose="modify",
            prompt=json.dumps({"kind": "modify", "request_text": task.request_text or ""}, ensure_ascii=False),
            max_output_tokens=500,
            timeout_seconds=settings.timeout_seconds,
            max_retries=0,
            parse=json.loads,
            input_tokens_estimate=300,
        )
    except ProviderError as e:
        return _fail(db, task, e.code)
    patch = patch_result.content

    # 2) 允许路径检查 + 应用到副本（不覆盖当前可玩版本）
    try:
        new_bundle = apply_patch(base_version.bundle, patch)
    except ApiError as e:
        return _fail(db, task, e.code)

    # 3) 完整契约/引用/白名单/安全校验
    validation = validator.validate(new_bundle)
    _save_validation(db, task.id, validation)
    db.commit()

    if not _all_passed(validation):
        return _fail(db, task, "modification_validation_failed")

    state.assert_transition(task.status, "validating", task.kind)
    task.status = "validating"
    db.commit()

    state.assert_transition(task.status, "succeeded", task.kind)
    task.status = "succeeded"
    task.error_code = None
    version = _create_version(db, task.session_id, task.id, new_bundle, parent_version_id=base_version.id)
    db.commit()
    return {**_task_payload(task), "version_id": version.id}


def process_queued_tasks(db: DbSession, max_tasks: int | None = None) -> int:
    """工作器主循环体（同步、可测试）：领取并处理所有 queued 任务，返回处理数。"""
    processed = 0
    while True:
        task = claim_queued_task(db)
        if task is None:
            break
        try:
            if task.kind == "modification":
                _run_modification(db, task)
            else:
                _run_generation(db, task)
        except Exception:  # noqa: BLE001  兜底：绝不把任务留在中间态
            _fail(db, task, "worker_error")
        processed += 1
        if max_tasks is not None and processed >= max_tasks:
            break
    return processed


def recover_interrupted_tasks(db: DbSession) -> int:
    """服务启动恢复：进行中的任务 -> interrupted（不自动重试，避免重复计费）。queued 保留。"""
    r1 = db.execute(
        update(models.GenerationTask)
        .where(models.GenerationTask.status.in_(["generating", "validating"]), models.GenerationTask.kind == "generation")
        .values(status="interrupted", error_code="generation_interrupted")
    )
    r2 = db.execute(
        update(models.GenerationTask)
        .where(models.GenerationTask.status.in_(["applying", "validating"]), models.GenerationTask.kind == "modification")
        .values(status="interrupted", error_code="modification_interrupted")
    )
    db.commit()
    return (r1.rowcount or 0) + (r2.rowcount or 0)


def resume_task(db: DbSession, task_id: str, idempotency_key: str, confirm_retry: bool) -> dict:
    """显式恢复：仅 interrupted 可恢复 -> queued；同 key 幂等；保留旧用量。"""
    if not confirm_retry:
        raise ApiError("confirm_retry_required", "恢复任务需要 confirm_retry=true", 400)
    task = db.get(models.GenerationTask, task_id)
    if task is None:
        raise NotFoundError("task_not_found", f"生成任务不存在：{task_id}")

    if task.resume_key == idempotency_key and task.status != "interrupted":
        return _task_payload(task)

    if task.status != "interrupted":
        raise StateError("not_interrupted", f"只有 interrupted 状态可恢复，当前 {task.status}")

    state.assert_transition(task.status, "queued", task.kind)
    task.status = "queued"
    task.resume_key = idempotency_key
    task.error_code = None
    db.commit()
    return _task_payload(task)


def _fail(db: DbSession, task: models.GenerationTask, code: str) -> dict:
    if not state.is_terminal(task.status, task.kind):
        task.status = "failed"
        task.error_code = code
        db.commit()
    return _task_payload(task)


# ---- 版本 ----

def _archive_overflow(db: DbSession, session_id: str) -> None:
    settings = get_settings()
    if settings.max_versions <= 0:
        return
    rows = db.scalars(
        select(models.GameVersion)
        .where(models.GameVersion.session_id == session_id, models.GameVersion.is_archived.is_(False))
        .order_by(models.GameVersion.version_number.desc())
    ).all()
    for v in rows[settings.max_versions:]:
        v.is_archived = True
        v.archived_at = _now()


def _create_version(db: DbSession, session_id: str, task_id: str, bundle: dict, parent_version_id: str | None) -> models.GameVersion:
    max_num = db.scalar(
        select(func.coalesce(func.max(models.GameVersion.version_number), 0)).where(models.GameVersion.session_id == session_id)
    ) or 0
    version = models.GameVersion(
        session_id=session_id,
        task_id=task_id,
        version_number=max_num + 1,
        parent_version_id=parent_version_id,
        bundle=bundle,
        status="playable",
    )
    db.add(version)
    db.flush()
    _archive_overflow(db, session_id)
    return version


def get_task(db: DbSession, task_id: str) -> dict:
    task = db.get(models.GenerationTask, task_id)
    if task is None:
        raise NotFoundError("task_not_found", f"生成任务不存在：{task_id}")
    return _task_payload(task)


def get_task_result(db: DbSession, task_id: str) -> dict:
    task = db.get(models.GenerationTask, task_id)
    if task is None:
        raise NotFoundError("task_not_found", f"生成任务不存在：{task_id}")
    validations = db.scalars(
        select(models.ValidationResult).where(models.ValidationResult.task_id == task_id).order_by(models.ValidationResult.created_at)
    ).all()
    version = db.scalars(
        select(models.GameVersion).where(models.GameVersion.task_id == task_id).order_by(models.GameVersion.version_number.desc())
    ).first()
    ledger = db.scalars(
        select(models.UsageLedger).where(models.UsageLedger.task_id == task_id).order_by(models.UsageLedger.created_at)
    ).all()
    return {
        "task": _task_payload(task),
        "validation_summary": [
            {"check_type": v.check_type, "passed": v.passed, "details": v.details} for v in validations
        ],
        "version": _version_payload(version) if version else None,
        "usage": [
            {
                "provider": u.provider_name,
                "model": u.model,
                "version": u.version,
                "purpose": u.purpose,
                "input_tokens": u.input_tokens,
                "output_tokens": u.output_tokens,
                "image_count": u.image_count,
                "duration_ms": u.duration_ms,
                "cost_cny": u.cost_cny,
                "status": u.status,
                "error_code": u.error_code,
            }
            for u in ledger
        ],
    }


def _version_payload(version: models.GameVersion) -> dict:
    return {
        "version_id": version.id,
        "version_number": version.version_number,
        "parent_version_id": version.parent_version_id,
        "status": version.status,
        "is_archived": version.is_archived,
        "created_at": version.created_at.isoformat(),
        "bundle": version.bundle,
    }


def list_versions(db: DbSession, session_id: str, include_archived: bool = False) -> list[dict]:
    q = select(models.GameVersion).where(models.GameVersion.session_id == session_id)
    if not include_archived:
        q = q.where(models.GameVersion.is_archived.is_(False))
    versions = db.scalars(q.order_by(models.GameVersion.version_number.desc())).all()
    return [_version_payload(v) for v in versions]


def restore_version(db: DbSession, version_id: str) -> dict:
    target = db.get(models.GameVersion, version_id)
    if target is None:
        raise NotFoundError("version_not_found", f"版本不存在：{version_id}")
    new_version = _create_version(db, target.session_id, target.task_id, target.bundle, parent_version_id=target.id)
    db.commit()
    return _version_payload(new_version)


# ---- 修改任务 ----

def create_modification_task(db: DbSession, session_id: str, version_id: str, request_text: str, idempotency_key: str) -> dict:
    session = db.get(models.CreationSession, session_id)
    if session is None:
        raise NotFoundError("session_not_found", f"创作会话不存在：{session_id}")
    version = db.get(models.GameVersion, version_id)
    if version is None or version.session_id != session_id:
        raise NotFoundError("version_not_found", f"版本不存在或不属于该会话：{version_id}")
    if version.is_archived:
        raise ConflictError("version_archived", "归档版本不能作为修改基线，请先恢复为新版本")
    if version.status != "playable":
        raise ConflictError("version_not_playable", f"版本状态 {version.status} 不能作为修改基线")

    # 幂等：同 key 的修改任务直接返回（含已终态）
    existing = db.scalars(
        select(models.GenerationTask).where(
            models.GenerationTask.session_id == session_id,
            models.GenerationTask.kind == "modification",
            models.GenerationTask.idempotency_key == idempotency_key,
        )
    ).first()
    if existing is not None:
        return _task_payload(existing)

    task = models.GenerationTask(
        session_id=session_id,
        status="queued",
        track="gamebundle",
        kind="modification",
        idempotency_key=idempotency_key,
        request_text=request_text,
        parent_version_id=version_id,
    )
    db.add(task)
    db.commit()
    return _task_payload(task)


def get_modification_task(db: DbSession, task_id: str) -> dict:
    task = db.get(models.GenerationTask, task_id)
    if task is None or task.kind != "modification":
        raise NotFoundError("modification_not_found", f"修改任务不存在：{task_id}")
    return _task_payload(task)


def get_modification_result(db: DbSession, task_id: str) -> dict:
    task = db.get(models.GenerationTask, task_id)
    if task is None or task.kind != "modification":
        raise NotFoundError("modification_not_found", f"修改任务不存在：{task_id}")
    return get_task_result(db, task_id)
