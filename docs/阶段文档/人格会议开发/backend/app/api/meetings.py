import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import AppError
from ..models import Summary, User
from ..schemas import (
    CreateMeetingRequest,
    FeedbackRequest,
    RecommendRequest,
    StepRequest,
)
from ..security import get_current_user
from ..services import meeting_service as svc

router = APIRouter(
    prefix="/api/v1/meetings",
    tags=["meetings"],
    dependencies=[Depends(get_current_user)],
)


def _sse(event: str, data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/recommend")
def recommend(body: RecommendRequest):
    return {"roles": svc.recommend_roles(body.question)}


@router.post("")
def create(
    body: CreateMeetingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return svc.create_meeting(db, user.id, body)


@router.get("")
def list_meetings(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"meetings": svc.list_meetings(db, user.id)}


@router.get("/{meeting_id}")
def get_meeting(
    meeting_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = svc._get_owned_meeting(db, user.id, meeting_id)
    return svc.meeting_detail(db, meeting)


@router.delete("/{meeting_id}")
def delete_meeting(
    meeting_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = svc._get_owned_meeting(db, user.id, meeting_id)
    svc.delete_meeting(db, meeting)
    return {"ok": True}


@router.post("/{meeting_id}/start")
def start(
    meeting_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = svc._get_owned_meeting(db, user.id, meeting_id)
    return svc.start_meeting(db, user.id, meeting)


@router.post("/{meeting_id}/steps")
def steps(
    meeting_id: int,
    body: StepRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = svc._get_owned_meeting(db, user.id, meeting_id)

    def gen():
        try:
            messages, limit_reached = svc.run_step(db, meeting, body)
        except AppError as e:
            yield _sse("error", e.detail)
            return
        except Exception:
            yield _sse(
                "error",
                {"error": {"code": "generation_failed", "message": "生成失败，请稍后重试"}},
            )
            return

        for m in messages:
            text = f"{m['speaker']}：{m['viewpoint']}\n\n"
            for i in range(0, len(text), 16):
                yield _sse("chunk", {"text": text[i : i + 16]})
        yield _sse("done", {"messages": messages, "limit_reached": limit_reached})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/{meeting_id}/summarize")
def summarize(
    meeting_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = svc._get_owned_meeting(db, user.id, meeting_id)
    return svc.summarize_meeting(db, meeting)


@router.post("/{meeting_id}/finish")
def finish(
    meeting_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = svc._get_owned_meeting(db, user.id, meeting_id)
    existing = db.query(Summary).filter(Summary.meeting_id == meeting.id).first()
    if existing is None:
        return svc.summarize_meeting(db, meeting)
    return {"ok": True, "summary": svc._summary_to_dict(existing)}


@router.post("/{meeting_id}/feedback")
def feedback(
    meeting_id: int,
    body: FeedbackRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meeting = svc._get_owned_meeting(db, user.id, meeting_id)
    svc.save_feedback(db, meeting, body)
    return {"ok": True}
