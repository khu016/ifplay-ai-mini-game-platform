from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import new_session
from ..providers.factory import get_provider

router = APIRouter(prefix="/api/v1", tags=["health"])


def get_db():
    db = new_session()
    try:
        yield db
    finally:
        db.close()


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    provider = get_provider()
    return {
        "status": "ok",
        "provider": provider.name,
        "provider_is_real_model": provider.is_real,
        "note": "deterministic-test 为测试 Provider，非真实模型；真实模型冒烟待验。",
        "database": "ok",
    }
