"""统一费用账本：澄清/方案/生成全部记账 + 失败留痕 + 不含提示词/敏感信息。"""
import json

import pytest
from sqlalchemy import select

from app import models
from app.providers.base import Provider, ProviderError
from app.services import session_service, task_service


class _FailProvider(Provider):
    name = "fail-provider"
    model = "fail-model"
    version = "0.0.0"

    def _raw(self, prompt, *, max_output_tokens, timeout_seconds):
        raise ProviderError("provider_error", "模拟上游失败")


def _ledger(db, session_id):
    return db.scalars(
        select(models.UsageLedger).where(models.UsageLedger.session_id == session_id).order_by(models.UsageLedger.created_at)
    ).all()


def test_clarification_plan_generation_all_recorded(db):
    sid = session_service.create_session(db, "开一家深夜食堂")["session_id"]
    session_service.submit_clarification(db, sid, "赚钱并升级")
    session_service.submit_clarification(db, sid, "一局约5分钟")
    session_service.confirm_plan(db, sid)
    tid = task_service.create_task(db, sid, "k1")["task_id"]
    task_service.process_queued_tasks(db)

    rows = _ledger(db, sid)
    purposes = {r.purpose for r in rows}
    assert {"clarification", "plan", "gamebundle"} <= purposes

    for r in rows:
        # 每个成功调用都记录 provider/model/version/token/耗时/费用/用途/状态
        assert r.provider_name == "deterministic-test"
        assert r.model
        assert r.version
        assert r.status == "ok"
        assert r.input_tokens > 0
        assert r.output_tokens > 0
        assert r.cost_cny > 0
    # 会话累计费用不为 0，且跨任务聚合（同一 session）
    from app.billing import session_spend

    assert session_spend(db, sid) > 0
    # 账本不含提示词全文：没有任何列存储 idea
    for r in rows:
        serialized = json.dumps(
            {c: getattr(r, c) for c in ("provider_name", "model", "version", "purpose", "status", "error_code")},
            ensure_ascii=False,
        )
        assert "深夜食堂" not in serialized


def test_failed_call_recorded_without_prompt(db, monkeypatch):
    monkeypatch.setattr(session_service, "get_provider", lambda: _FailProvider())
    with pytest.raises(ProviderError):
        session_service.create_session(db, "这段想法绝不能进账本")

    sid = db.scalar(select(models.CreationSession.id))
    rows = _ledger(db, sid)
    assert len(rows) == 1
    row = rows[0]
    assert row.status == "failed"
    assert row.error_code == "provider_error"
    assert row.purpose == "clarification"
    # 失败调用不记录提示词全文
    assert "绝不能进账本" not in (row.error_code or "")
    assert "绝不能进账本" not in row.purpose
