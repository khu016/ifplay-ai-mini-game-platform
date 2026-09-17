import json
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse
from starlette.exceptions import HTTPException

from .budget import Budget
from .config import Settings
from .errors import AppError
from .model import DeepSeek
from .schemas import (
    BudgetView,
    CreateTask,
    ErrorResponse,
    GenerateRequest,
    Health,
    Outline,
    Task,
    markdown,
)
from .service import OutlineService
from .store import Store


def create_app(settings=None, model_factory=None):
    settings = settings or Settings.load()
    store = Store(settings.data_dir)
    budget = Budget(store, settings)
    model = model_factory(settings, budget) if model_factory else DeepSeek(settings, budget)
    service = OutlineService(store, settings, model)

    @asynccontextmanager
    async def lifespan(app):
        store.acquire()
        try:
            store.recover()
            yield
        finally:
            store.release()

    app = FastAPI(title="氢能大纲助手｜本机验收 API", lifespan=lifespan)
    app.state.store, app.state.service, app.state.settings = store, service, settings

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        # 不开放 CORS；防止网页或 DNS rebinding 调用本机付费接口。
        allowed = {"127.0.0.1", "localhost", "testserver"}
        if request.url.hostname not in allowed:
            return JSONResponse(AppError("LOCAL_ONLY", "仅允许本机访问。", 403).payload(), 403)
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse(AppError("LOCAL_ONLY", "不允许跨来源访问。", 403).payload(), 403)
        if (
            request.method == "POST"
            and request.headers.get("content-type", "").split(";")[0] != "application/json"
        ):
            return JSONResponse(
                AppError("INVALID_REQUEST", "请求需使用 application/json。", 415).payload(), 415
            )
        return await call_next(request)

    @app.exception_handler(AppError)
    async def handle_error(request, exc):
        return JSONResponse(exc.payload(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse(
            AppError("INVALID_REQUEST", "请求字段或任务标识无效。", 422).payload(), 422
        )

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return JSONResponse(
            AppError("HTTP_ERROR", "请求路径或方法不可用。", exc.status_code).payload(),
            exc.status_code,
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        return JSONResponse(
            AppError("INTERNAL_ERROR", "服务暂时不可用，请联系执行者。", 500).payload(), 500
        )

    errors = {code: {"model": ErrorResponse} for code in [400, 403, 404, 409, 415, 422, 500, 503]}

    @app.get("/health", response_model=Health)
    def health():
        return Health(model=settings.model, key_configured=bool(settings.api_key))

    @app.post("/api/v1/tasks", response_model=Task, status_code=201, responses=errors)
    def create_task(body: CreateTask):
        task = Task(name=body.name, description=body.description)
        store.save(task)
        return task

    @app.get("/api/v1/tasks/{task_id}", response_model=Task, responses=errors)
    def get_task(task_id: UUID):
        return store.get(task_id)

    @app.post(
        "/api/v1/tasks/{task_id}/outline",
        responses=errors,
        response_class=StreamingResponse,
        openapi_extra={
            "responses": {
                "200": {
                    "description": "SSE: chunk* → done 或 error",
                    "content": {"text/event-stream": {"schema": {"type": "string"}}},
                }
            }
        },
    )
    async def generate_outline(task_id: UUID, body: GenerateRequest):
        task = service.claim(task_id)

        async def events():
            generation = service.generate(task)
            try:
                async for event, data in generation:
                    yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            finally:
                await generation.aclose()
                service.active.discard(task.id)

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    def ready_task(task_id):
        task = store.get(task_id)
        if not task.versions:
            raise AppError("OUTLINE_NOT_READY", "尚无有效大纲。", 409)
        return task

    @app.get(
        "/api/v1/tasks/{task_id}/outline.md", response_class=PlainTextResponse, responses=errors
    )
    def get_markdown(task_id: UUID):
        return PlainTextResponse(
            markdown(ready_task(task_id)),
            media_type="text/plain",
            headers={
                "Content-Disposition": 'attachment; filename="outline.md"',
                "X-Content-Type-Options": "nosniff",
            },
        )

    @app.get("/api/v1/tasks/{task_id}/outline.json", response_model=Outline, responses=errors)
    def get_outline(task_id: UUID):
        return ready_task(task_id).versions[-1].outline

    @app.get("/api/v1/budget", response_model=BudgetView, responses=errors)
    def get_budget():
        return budget.view()

    return app
