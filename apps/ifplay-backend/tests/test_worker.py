"""持久化长任务：队列领取、重启恢复、显式恢复、幂等、用量保留。"""
import json

from sqlalchemy import select, update

from app import models
from app.services import session_service, task_service


def _seed_queued(db, key="k1"):
    s = session_service.create_session(db, "开一家深夜食堂")
    sid = s["session_id"]
    session_service.submit_clarification(db, sid, "赚钱并升级")
    session_service.submit_clarification(db, sid, "一局约5分钟")
    session_service.confirm_plan(db, sid)
    t = task_service.create_task(db, sid, key)
    return sid, t["task_id"]


def _status(db, task_id):
    return db.get(models.GenerationTask, task_id).status


def _set_status(db, task_id, status):
    db.execute(update(models.GenerationTask).where(models.GenerationTask.id == task_id).values(status=status))
    db.commit()


def test_create_task_returns_queued(db):
    sid, tid = _seed_queued(db)
    assert _status(db, tid) == "queued"
    assert task_service.get_task(db, tid)["status"] == "queued"


def test_worker_processes_to_playable(db):
    sid, tid = _seed_queued(db)
    assert task_service.process_queued_tasks(db) == 1
    assert _status(db, tid) == "playable"


def test_no_double_claim(db):
    sid, tid = _seed_queued(db)
    first = task_service.claim_queued_task(db)
    assert first is not None and first.id == tid
    # 已领取为 generating，不再是 queued；再次领取应返回 None
    assert task_service.claim_queued_task(db) is None


def test_recover_generating_to_interrupted(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)  # -> generating，模拟进程在生成中崩溃
    assert _status(db, tid) == "generating"
    n = task_service.recover_interrupted_tasks(db)
    assert n == 1
    task = db.get(models.GenerationTask, tid)
    assert task.status == "interrupted"
    assert task.error_code == "generation_interrupted"


def test_recover_validating_to_interrupted(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)
    _set_status(db, tid, "validating")  # 模拟进程在校验阶段崩溃
    n = task_service.recover_interrupted_tasks(db)
    assert n == 1
    task = db.get(models.GenerationTask, tid)
    assert task.status == "interrupted"
    assert task.error_code == "generation_interrupted"


def test_recover_keeps_queued(db):
    sid, tid = _seed_queued(db)
    n = task_service.recover_interrupted_tasks(db)
    assert n == 0
    assert _status(db, tid) == "queued"


def test_interrupted_not_auto_processed(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)
    task_service.recover_interrupted_tasks(db)  # -> interrupted
    # 工作器不处理 interrupted：处理数为 0，状态不变
    assert task_service.process_queued_tasks(db) == 0
    assert _status(db, tid) == "interrupted"


def test_resume_to_queued(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)
    task_service.recover_interrupted_tasks(db)
    r = task_service.resume_task(db, tid, idempotency_key="r1", confirm_retry=True)
    assert r["status"] == "queued"
    assert _status(db, tid) == "queued"


def test_resume_requires_confirm(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)
    task_service.recover_interrupted_tasks(db)
    from app.errors import ApiError
    import pytest

    with pytest.raises(ApiError) as e:
        task_service.resume_task(db, tid, idempotency_key="r1", confirm_retry=False)
    assert e.value.code == "confirm_retry_required"


def test_resume_idempotent(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)
    task_service.recover_interrupted_tasks(db)
    r1 = task_service.resume_task(db, tid, idempotency_key="r1", confirm_retry=True)
    r2 = task_service.resume_task(db, tid, idempotency_key="r1", confirm_retry=True)
    assert r1["status"] == "queued"
    assert r2["task_id"] == r1["task_id"]


def test_resume_only_interrupted(db):
    from app.errors import StateError
    import pytest

    sid, tid = _seed_queued(db)
    with pytest.raises(StateError):
        task_service.resume_task(db, tid, idempotency_key="r1", confirm_retry=True)


def test_usage_preserved_across_interrupt_resume(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)  # generating
    # 模拟中断前已有一次模型调用记录
    manual = models.UsageLedger(task_id=tid, session_id=sid, provider_name="deterministic-test", model="m", version="v",
                                purpose="gamebundle", input_tokens=100, output_tokens=200, image_count=0,
                                duration_ms=1, cost_cny=0.0014, status="ok")
    db.add(manual)
    db.commit()
    manual_id = manual.id
    task_service.recover_interrupted_tasks(db)  # interrupted
    task_service.resume_task(db, tid, idempotency_key="r1", confirm_retry=True)  # queued
    task_service.process_queued_tasks(db)  # playable，再记录一次用量

    usage = db.scalars(select(models.UsageLedger).where(models.UsageLedger.task_id == tid)).all()
    # 中断前的调用保留，且恢复后的 gamebundle 调用也已记账（澄清/方案等账本条目也都在）
    assert manual_id in {u.id for u in usage}
    assert any(u.purpose == "gamebundle" and u.status == "ok" for u in usage)
    assert _status(db, tid) == "playable"


def test_resume_then_playable(db):
    sid, tid = _seed_queued(db)
    task_service.claim_queued_task(db)
    task_service.recover_interrupted_tasks(db)
    task_service.resume_task(db, tid, idempotency_key="r1", confirm_retry=True)
    assert task_service.process_queued_tasks(db) == 1
    assert _status(db, tid) == "playable"
