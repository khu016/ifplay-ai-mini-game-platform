from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import new_session
from ..schemas import ResumeTaskRequest
from ..services import task_service

router = APIRouter(prefix="/api/v1", tags=["tasks"])


def get_db():
    db = new_session()
    try:
        yield db
    finally:
        db.close()


@router.get("/tasks/{task_id}")
def get_task(task_id: str, db: Session = Depends(get_db)) -> dict:
    return task_service.get_task(db, task_id)


@router.get("/tasks/{task_id}/result")
def get_task_result(task_id: str, db: Session = Depends(get_db)) -> dict:
    return task_service.get_task_result(db, task_id)


@router.post("/tasks/{task_id}/resume", status_code=202)
def resume_task(task_id: str, body: ResumeTaskRequest, db: Session = Depends(get_db)) -> dict:
    return task_service.resume_task(db, task_id, body.idempotency_key, body.confirm_retry)
