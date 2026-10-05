from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import new_session
from ..schemas import CreateModificationRequest, ResumeTaskRequest
from ..services import task_service

router = APIRouter(prefix="/api/v1", tags=["modifications"])


def get_db():
    db = new_session()
    try:
        yield db
    finally:
        db.close()


@router.post("/sessions/{session_id}/versions/{version_id}/modifications", status_code=202)
def create_modification(session_id: str, version_id: str, body: CreateModificationRequest, db: Session = Depends(get_db)) -> dict:
    return task_service.create_modification_task(db, session_id, version_id, body.request_text, body.idempotency_key)


@router.get("/modifications/{task_id}")
def get_modification(task_id: str, db: Session = Depends(get_db)) -> dict:
    return task_service.get_modification_task(db, task_id)


@router.get("/modifications/{task_id}/result")
def get_modification_result(task_id: str, db: Session = Depends(get_db)) -> dict:
    return task_service.get_modification_result(db, task_id)


@router.post("/modifications/{task_id}/resume", status_code=202)
def resume_modification(task_id: str, body: ResumeTaskRequest, db: Session = Depends(get_db)) -> dict:
    return task_service.resume_task(db, task_id, body.idempotency_key, body.confirm_retry)
