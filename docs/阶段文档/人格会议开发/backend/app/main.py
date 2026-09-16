import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import auth, meetings, personas
from .db import engine
from .models import Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("personality-meeting")

# 确保数据目录存在（SQLite 不自动创建父目录）
os.makedirs("data", exist_ok=True)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="人格会议", version="0.2.0")

app.include_router(auth.router)
app.include_router(personas.router)
app.include_router(meetings.router)

STATIC_DIR = Path(__file__).parent / "static"


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "validation_error", "message": "请求参数不合法"}},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("未处理异常")
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "internal_error", "message": "服务器内部错误"}},
    )


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
