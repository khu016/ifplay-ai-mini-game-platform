from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import new_session
from ..schemas import (
    ConfirmPlanRequest,
    CreateSessionRequest,
    CreateTaskRequest,
    ModifyPlanRequest,
    RecommendPlanRequest,
    SubmitClarificationRequest,
)
from ..services import session_service, task_service

router = APIRouter(prefix="/api/v1", tags=["sessions"])


def get_db():
    db = new_session()
    try:
        yield db
    finally:
        db.close()


@router.post("/sessions")
def create_session(body: CreateSessionRequest, db: Session = Depends(get_db)) -> dict:
    return session_service.create_session(db, body.idea)


@router.get("/sessions/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db)) -> dict:
    return session_service.get_session(db, session_id)


@router.post("/sessions/{session_id}/clarifications")
def submit_clarification(session_id: str, body: SubmitClarificationRequest, db: Session = Depends(get_db)) -> dict:
    return session_service.submit_clarification(db, session_id, body.answer)


@router.get("/sessions/{session_id}/plan")
def get_plan_card(session_id: str, db: Session = Depends(get_db)) -> dict:
    return session_service.get_plan_card(db, session_id)


@router.post("/sessions/{session_id}/plan/confirm")
def confirm_plan(session_id: str, _body: ConfirmPlanRequest | None = None, db: Session = Depends(get_db)) -> dict:
    return session_service.confirm_plan(db, session_id)


@router.post("/sessions/{session_id}/plan/modify")
def modify_plan(session_id: str, body: ModifyPlanRequest, db: Session = Depends(get_db)) -> dict:
    return session_service.modify_plan(db, session_id, body.request_text)


@router.post("/sessions/{session_id}/plan/recommend")
def recommend_plan(session_id: str, _body: RecommendPlanRequest | None = None, db: Session = Depends(get_db)) -> dict:
    return session_service.recommend_plan(db, session_id)


@router.get("/sessions/{session_id}/plans")
def list_plans(session_id: str, db: Session = Depends(get_db)) -> list[dict]:
    return session_service.list_plans(db, session_id)


@router.post("/sessions/{session_id}/tasks", status_code=202)
def create_task(session_id: str, body: CreateTaskRequest, db: Session = Depends(get_db)) -> dict:
    return task_service.create_task(db, session_id, body.idempotency_key)


@router.get("/sessions/{session_id}/versions")
def list_versions(session_id: str, include_archived: bool = False, db: Session = Depends(get_db)) -> list[dict]:
    return task_service.list_versions(db, session_id, include_archived=include_archived)
