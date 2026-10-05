"""统一费用账本与调用计费。

规则（本轮 M2 后端第二阶段）：
- 澄清 / 方案生成 / 方案修改 / 重新推荐 / GameBundle 生成 / 内容修复 / 自然语言修改
  全部进入同一个会话费用账本（按 session_id 聚合，跨任务累计）。
- 每次调用记录 provider / model / version / 输入 Token / 输出 Token / 耗时 / 费用 / 用途 / 状态。
- usage 缺失立即失败（由 Provider.call 抛 missing_usage，绝不按 0 元）。
- 每次调用前执行预算预检。
- 累计费用不因中断、恢复或修改而清零（只累加，不重置）。
- 失败调用也保存可审计状态（status=failed + error_code），但不记录提示词全文或敏感信息。
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from . import models
from .cost import CostTracker
from .providers.base import Provider, ProviderError, ProviderResult


def session_spend(db: DbSession, session_id: str) -> float:
    """会话累计已记账费用（只读，跨任务聚合，不清零）。"""
    return float(
        db.scalar(
            select(func.coalesce(func.sum(models.UsageLedger.cost_cny), 0)).where(
                models.UsageLedger.session_id == session_id
            )
        )
        or 0.0
    )


def record_success(
    db: DbSession,
    *,
    session_id: str,
    task_id: str,
    provider: Provider,
    purpose: str,
    result: ProviderResult,
    cost: float,
) -> models.UsageLedger:
    row = models.UsageLedger(
        session_id=session_id,
        task_id=task_id,
        provider_name=provider.name,
        model=result.model,
        version=result.version,
        purpose=purpose,
        input_tokens=result.input_tokens or 0,
        output_tokens=result.output_tokens or 0,
        image_count=0,
        duration_ms=result.duration_ms,
        cost_cny=cost,
        status="ok",
    )
    db.add(row)
    db.flush()  # 同事务内后续 session_spend 需看到本次费用
    return row


def record_failure(
    db: DbSession,
    *,
    session_id: str,
    task_id: str,
    provider: Provider,
    purpose: str,
    error_code: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> models.UsageLedger:
    row = models.UsageLedger(
        session_id=session_id,
        task_id=task_id,
        provider_name=provider.name,
        model=provider.model,
        version=provider.version,
        purpose=purpose,
        input_tokens=input_tokens or 0,
        output_tokens=output_tokens or 0,
        image_count=0,
        duration_ms=0,
        cost_cny=0.0,
        status="failed",
        error_code=error_code,
    )
    db.add(row)
    db.flush()
    return row


def provider_call_with_billing(
    db: DbSession,
    provider: Provider,
    settings,
    *,
    session_id: str,
    task_id: str,
    purpose: str,
    prompt: str,
    max_output_tokens: int,
    timeout_seconds: float,
    max_retries: int,
    parse,
    input_tokens_estimate: int,
    images: int = 0,
) -> ProviderResult:
    """带预算预检 + 计费 + 失败留痕的统一模型调用入口。"""
    spent = session_spend(db, session_id)
    cost_tracker = CostTracker(settings)

    # 1) 调用前最坏成本预检（被拦截也留痕）
    try:
        cost_tracker.precheck(spent, input_tokens_estimate, images)
    except ProviderError as e:
        record_failure(
            db, session_id=session_id, task_id=task_id, provider=provider, purpose=purpose, error_code=e.code
        )
        raise

    # 2) 调用（usage 缺失/超时/暂时性错误在 Provider.call 内处理）
    try:
        result = provider.call(
            prompt,
            max_output_tokens=max_output_tokens,
            timeout_seconds=timeout_seconds,
            max_retries=max_retries,
            parse=parse,
        )
    except ProviderError as e:
        record_failure(
            db, session_id=session_id, task_id=task_id, provider=provider, purpose=purpose, error_code=e.code
        )
        raise

    # 3) 实际用量结算（usage 缺失已在 Provider.call 抛错；超预算在此拦截并留痕）
    try:
        cost = cost_tracker.account(spent, result.input_tokens, result.output_tokens, images)
    except ProviderError as e:
        record_failure(
            db,
            session_id=session_id,
            task_id=task_id,
            provider=provider,
            purpose=purpose,
            error_code=e.code,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )
        raise

    record_success(
        db, session_id=session_id, task_id=task_id, provider=provider, purpose=purpose, result=result, cost=cost
    )
    return result
