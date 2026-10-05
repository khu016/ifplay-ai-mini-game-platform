from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import new_session
from ..services import task_service

router = APIRouter(prefix="/api/v1", tags=["versions"])


def get_db():
    db = new_session()
    try:
        yield db
    finally:
        db.close()


@router.post("/versions/{version_id}/restore")
def restore_version(version_id: str, db: Session = Depends(get_db)) -> dict:
    return task_service.restore_version(db, version_id)
