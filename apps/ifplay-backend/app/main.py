"""FastAPI 应用入口（lifespan：初始化 DB、恢复中断任务、启停后台工作器）。"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import init_db, new_session
from .errors import ApiError
from .routers import health, modifications, sessions, tasks, versions
from .services.task_service import recover_interrupted_tasks
from .worker import Worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # 启动恢复：generating/validating -> interrupted；queued 保留重新进入队列
    db = new_session()
    try:
        recover_interrupted_tasks(db)
    finally:
        db.close()
    worker = Worker(poll_interval=get_settings().worker_poll_interval)
    if get_settings().worker_enabled:
        worker.start()
    yield
    worker.stop()


app = FastAPI(title="IfPlay M2 Backend", version="0.2.0", lifespan=lifespan)

app.include_router(health.router)
app.include_router(sessions.router)
app.include_router(tasks.router)
app.include_router(versions.router)
app.include_router(modifications.router)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    del request
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    del request, exc
    # 不泄露堆栈
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "internal_error", "message": "服务器内部错误"}},
    )
