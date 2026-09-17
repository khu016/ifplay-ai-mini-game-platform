import asyncio
import json
import subprocess
import sys
from datetime import date
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.budget import Budget
from backend.app.config import ROOT, Settings
from backend.app.errors import AppError
from backend.app.main import create_app
from backend.app.model import DeepSeek
from backend.app.schemas import Outline, ProjectInfo, Task
from backend.app.service import OutlineService, parse, verify_info
from backend.app.store import Store


def outline():
    titles = [
        "总论",
        "项目背景及必要性",
        "市场分析与预测",
        "建设方案与技术方案",
        "环境保护与安全生产",
        "投资估算与资金筹措",
        "财务评价",
        "风险分析与对策",
        "结论与建议",
    ]
    return {
        "chapters": [
            {
                "number": i,
                "title": title,
                "subtitles": ["项目概况", "论证要点", "资料依据（待补充）"],
            }
            for i, title in enumerate(titles, 1)
        ]
    }


@pytest.fixture
def settings(tmp_path):
    return Settings(
        data_dir=tmp_path,
        api_key="test-key-not-real",
        pricing_confirmed=True,
        pricing_checked_on=date.today().isoformat(),
    )


class FakeModel:
    def __init__(self):
        self.calls = []
        self.fail = None
        self.candidate = outline()

    async def stream(self, task_id, stage, messages, max_output):
        self.calls.append(stage)
        if self.fail:
            raise self.fail
        value = (
            ProjectInfo(
                technology="电解水制氢", evidence={"technology": "采用电解水制氢"}
            ).model_dump()
            if stage == "extract"
            else self.candidate
        )
        raw = json.dumps(value, ensure_ascii=False)
        yield raw[:20]
        yield raw[20:]


def collect(service, task):
    async def execute():
        return [event async for event in service.generate(service.claim(task.id))]

    return asyncio.run(execute())


def prepare(settings):
    store, fake = Store(settings.data_dir), FakeModel()
    task = Task(name="测试报告", description="公开示例项目采用电解水制氢，规模尚未确定。")
    store.save(task)
    return store, fake, task, OutlineService(store, settings, fake)


def test_generate_valid_and_preserve_previous_version(settings):
    store, fake, task, service = prepare(settings)
    events = collect(service, task)
    assert events[-1][0] == "done"
    assert [stage for stage in fake.calls] == ["extract", "outline"]
    assert store.get(task.id).status == "ready"
    old = store.get(task.id).versions[0]
    fake.candidate["chapters"][0]["subtitles"] = ["只有一条"]
    events = collect(service, store.get(task.id))
    assert events[-1][0] == "error"
    assert events[-1][1]["error"]["code"] == "INVALID_MODEL_OUTPUT"
    assert store.get(task.id).versions == [old]
    assert len(fake.calls) == 4  # 数量违规不自动重复收费。


@pytest.mark.parametrize("mutation", ["missing", "extra", "order", "empty"])
def test_invalid_outline_rejected(mutation):
    value = outline()
    if mutation == "missing":
        value["chapters"].pop()
    elif mutation == "extra":
        value["chapters"][0]["subtitles"] = ["要点"] * 6
    elif mutation == "order":
        value["chapters"].reverse()
    else:
        value["chapters"][0]["title"] = " "
    with pytest.raises(AppError, match="INVALID_MODEL_OUTPUT"):
        parse(json.dumps(value), Outline)


def test_parse_code_fence_without_paid_retry():
    assert len(parse("```json\n" + json.dumps(outline()) + "\n```", Outline).chapters) == 9


def test_missing_key_sse_ends_error(settings):
    settings.api_key = ""
    app = create_app(settings, lambda *_: FakeModel())
    with TestClient(app) as client:
        task_id = client.post(
            "/api/v1/tasks", json={"description": "测试脱敏项目资料，尚未确定具体技术路线。"}
        ).json()["id"]
        response = client.post(f"/api/v1/tasks/{task_id}/outline", json={})
        assert response.status_code == 200
        assert "event: error" in response.text
        assert "MISSING_KEY" in response.text
        assert response.text.rstrip().endswith("}")
        assert "Traceback" not in response.text


def test_api_success_export_and_validation_redaction(settings):
    with TestClient(create_app(settings, lambda *_: FakeModel())) as client:
        response = client.post("/api/v1/tasks", json={"description": "x", "secret": "do-not-echo"})
        assert response.status_code == 422
        assert "do-not-echo" not in response.text
        task_id = client.post(
            "/api/v1/tasks", json={"description": "公开测试项目采用电解水制氢，规模尚未确定。"}
        ).json()["id"]
        assert "OUTLINE_NOT_READY" in client.get(f"/api/v1/tasks/{task_id}/outline.md").text
        response = client.post(f"/api/v1/tasks/{task_id}/outline", json={})
        assert "event: chunk" in response.text and "event: done" in response.text
        assert "event: error" not in response.text
        exported = client.get(f"/api/v1/tasks/{task_id}/outline.md")
        assert exported.text.count("## 第") == 9
        assert "待补充" in exported.text
        assert exported.headers["x-content-type-options"] == "nosniff"
        assert "test-key-not-real" not in client.get("/health").text
        assert client.get("/api/v1/tasks/../../.env").status_code == 404


def test_local_origin_and_content_type_guard(settings):
    with TestClient(create_app(settings, lambda *_: FakeModel())) as client:
        assert client.post("/api/v1/tasks", data="{}").status_code == 415
        assert (
            client.post(
                "/api/v1/tasks", json={}, headers={"origin": "https://evil.example"}
            ).status_code
            == 403
        )
        assert client.get("/health", headers={"host": "evil.example"}).status_code == 403


def test_concurrent_task_claim_rejected(settings):
    store, fake, task, service = prepare(settings)
    service.claim(task.id)
    with pytest.raises(AppError, match="TASK_BUSY"):
        service.claim(task.id)


def test_process_restart_preserves_data_marks_interruption(settings):
    store, fake, task, service = prepare(settings)
    collect(service, task)
    task = store.get(task.id)
    task.status = "generating"
    store.save(task)
    code = """
import sys
from pathlib import Path
from backend.app.store import Store
store = Store(Path(sys.argv[1]))
store.acquire()
store.recover()
store.release()
"""
    subprocess.run([sys.executable, "-c", code, str(settings.data_dir)], check=True)
    restored = store.get(task.id)
    assert restored.status == "interrupted"
    assert len(restored.versions) == 1
    assert restored.description == task.description


def test_corrupt_store_not_overwritten(settings):
    store = Store(settings.data_dir)
    task_id = uuid4()
    path = store.task_path(task_id)
    path.write_text("broken", encoding="utf-8")
    with pytest.raises(AppError, match="STORAGE_CORRUPT"):
        store.get(task_id)
    assert path.read_text() == "broken"


def test_process_lock_prevents_second_owner(settings):
    first, second = Store(settings.data_dir), Store(settings.data_dir)
    first.acquire()
    try:
        with pytest.raises(AppError, match="STORE_BUSY"):
            second.acquire()
    finally:
        first.release()


def test_budget_reservation_survives_restart(settings):
    store = Store(settings.data_dir)
    budget = Budget(store, settings)
    task_id = uuid4()
    charge_id = budget.reserve(task_id, "outline", 10000, 10000)
    assert budget.view().spent_or_reserved_cny == Decimal("0.1")
    reopened = Budget(Store(settings.data_dir), settings)
    reopened.settle(charge_id, None, 1.2, None)
    assert reopened.view().spent_or_reserved_cny == Decimal("0.1")
    settings.task_limit = Decimal("0.15")
    with pytest.raises(AppError, match="BUDGET_EXCEEDED"):
        reopened.reserve(task_id, "outline", 10000, 10000)


def test_budget_settle_and_month_limit(settings):
    settings.monthly_limit = Decimal("0.12")
    budget = Budget(Store(settings.data_dir), settings)
    first = budget.reserve(uuid4(), "outline", 10000, 10000)
    with pytest.raises(AppError, match="BUDGET_EXCEEDED"):
        budget.reserve(uuid4(), "outline", 10000, 10000)
    budget.settle(first, (1000, 1000), 1.5, 0.2)
    assert budget.view().spent_or_reserved_cny == Decimal("0.01")


def test_overestimate_failure_blocks_more_calls(settings):
    budget = Budget(Store(settings.data_dir), settings)
    charge = budget.reserve(uuid4(), "extract", 100, 100)
    budget.settle(charge, (100000, 100000), 1, None)
    with pytest.raises(AppError, match="PRICING_UNCONFIRMED"):
        budget.reserve(uuid4(), "extract", 100, 100)


def test_unconfirmed_price_no_model_call(settings):
    settings.pricing_confirmed = False
    store, fake, task, service = prepare(settings)
    events = collect(service, task)
    assert events[-1][1]["error"]["code"] == "PRICING_UNCONFIRMED"
    assert fake.calls == []


@pytest.mark.parametrize("failure", ["auth", "timeout", "disconnect", "init", "truncated"])
def test_real_adapter_errors_are_sanitized_and_reserved(settings, failure):
    budget = Budget(Store(settings.data_dir), settings)

    def handler(request):
        if failure == "auth":
            return httpx.Response(401, text="secret-upstream-detail")
        if failure == "timeout":
            raise httpx.ReadTimeout("secret-upstream-detail")
        if failure == "disconnect":
            return httpx.Response(200, text='data: {"choices":[]}\n\n')
        return httpx.Response(200, text='data: {"choices":[{"finish_reason":"length"}]}\n\n')

    def client_factory(**kwargs):
        if failure == "init":
            raise RuntimeError("secret-upstream-detail")
        return httpx.AsyncClient(transport=httpx.MockTransport(handler), **kwargs)

    model = DeepSeek(settings, budget, client_factory)

    async def call():
        return [chunk async for chunk in model.stream(uuid4(), "extract", [], 100)]

    with pytest.raises(AppError) as caught:
        asyncio.run(call())
    assert "secret-upstream-detail" not in caught.value.message
    assert budget.view().spent_or_reserved_cny > 0


def test_adapter_usage_and_stream_protocol(settings):
    budget = Budget(Store(settings.data_dir), settings)
    raw = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'
    raw += 'data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":2}}\n\n'
    raw += "data: [DONE]\n\n"

    def handler(request):
        body = json.loads(request.content)
        assert body["thinking"] == {"type": "disabled"}
        assert body["response_format"] == {"type": "json_object"}
        return httpx.Response(200, text=raw)

    model = DeepSeek(
        settings,
        budget,
        lambda **kw: httpx.AsyncClient(transport=httpx.MockTransport(handler), **kw),
    )

    async def call():
        return [chunk async for chunk in model.stream(uuid4(), "extract", [], 100)]

    assert asyncio.run(call()) == ["ok"]
    assert budget.view().spent_or_reserved_cny == Decimal("0.000056")


def test_project_config_never_inherits_other_agents(tmp_path, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "other-agent-test-key")
    monkeypatch.setenv("DEEPSEEK_MODEL", "other-agent-model")
    assert Settings.load(tmp_path).api_key == ""
    local = tmp_path / ".env"
    local.write_text("DEEPSEEK_API_KEY=hydrogen-test-key\n", encoding="utf-8")
    assert Settings.load(tmp_path).api_key == "hydrogen-test-key"
    assert Settings.load(tmp_path).model == "deepseek-flash"
    assert __import__("os").environ["DEEPSEEK_API_KEY"] == "other-agent-test-key"
    local.write_text("DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}\n", encoding="utf-8")
    with pytest.raises(AppError, match="INVALID_CONFIG"):
        Settings.load(tmp_path)


def test_default_config_root_is_hydrogen_project():
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[2]
    assert ROOT == project_root
    assert Settings().data_dir == project_root / "data"


def test_info_requires_verbatim_evidence():
    description = "项目名称：绿氢示例。拟采用 PEM 电解水制氢，规模尚未确定。"
    info = ProjectInfo(
        project_name="绿氢示例",
        technology="PEM 电解水制氢",
        scale="100MW",
        evidence={
            "project_name": "项目名称：绿氢示例",
            "technology": "采用 PEM 电解水制氢",
            "scale": "规模100MW",
        },
    )
    verified = verify_info(info, description)
    assert verified.project_name == "绿氢示例"
    assert verified.technology == "PEM 电解水制氢"
    assert verified.scale is None
    assert verified.issues


def test_wrong_chapter_topics_rejected_and_prefix_normalized():
    candidate = outline()
    candidate["chapters"][0]["title"] = "第一章 总论"
    assert parse(json.dumps(candidate), Outline).chapters[0].title == "总论"
    candidate["chapters"][1]["title"] = "总论"
    with pytest.raises(AppError, match="INVALID_MODEL_OUTPUT"):
        parse(json.dumps(candidate), Outline)


def test_failed_ready_save_does_not_publish_candidate(settings, monkeypatch):
    store, fake, task, service = prepare(settings)
    collect(service, task)
    original = store.get(task.id).versions
    real_save = store.save

    def fail_candidate(value):
        if value.status == "ready":
            raise AppError("STORAGE_FAILED", "测试保存失败", 500)
        return real_save(value)

    monkeypatch.setattr(store, "save", fail_candidate)
    events = collect(service, store.get(task.id))
    assert events[-1][0] == "error"
    restored = store.get(task.id)
    assert restored.status == "error"
    assert restored.versions == original


def test_closing_incomplete_generator_marks_interrupted(settings):
    store, fake, task, service = prepare(settings)

    async def execute():
        generator = service.generate(service.claim(task.id))
        event, _ = await anext(generator)
        assert event == "chunk"
        await generator.aclose()

    asyncio.run(execute())
    assert store.get(task.id).status == "interrupted"
    assert task.id not in service.active
    assert not store.get(task.id).versions


def test_budget_rate_snapshot_and_month_boundary(settings, monkeypatch):
    budget = Budget(Store(settings.data_dir), settings)
    monkeypatch.setattr(budget, "month", lambda: "2026-09")
    reservation = budget.reserve(uuid4(), "outline", 10000, 10000)
    monkeypatch.setattr(budget, "month", lambda: "2026-10")
    assert budget.view().spent_or_reserved_cny == Decimal("0.1")
    settings.input_price, settings.output_price = Decimal("10"), Decimal("40")
    budget.settle(reservation, (1000, 1000), 2, 0.1)
    assert budget.view().spent_or_reserved_cny == Decimal("0.01")


def test_temporary_retry_is_finite(settings):
    store, fake, task, service = prepare(settings)
    fake.fail = AppError("MODEL_TEMPORARY", "测试临时故障", 502)
    events = collect(service, task)
    assert events[-1][0] == "error"
    assert len(fake.calls) == 2
    fake.fail = AppError("MODEL_AUTH", "测试认证失败", 502)
    previous = len(fake.calls)
    collect(service, store.get(task.id))
    assert len(fake.calls) == previous + 1
