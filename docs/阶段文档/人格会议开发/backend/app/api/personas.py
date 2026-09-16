from fastapi import APIRouter

from ..personas import PERSONAS

router = APIRouter(prefix="/api/v1/personas", tags=["personas"])


@router.get("")
def list_personas():
    return {"personas": PERSONAS}
