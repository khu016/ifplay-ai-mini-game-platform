import re
from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import AppError
from ..models import Session as SessionModel
from ..models import User, VerificationCode
from ..schemas import RequestCodeRequest, VerifyRequest
from ..security import (
    COOKIE_NAME,
    _utcnow,
    create_session,
    get_current_user,
    hash_code,
    new_code,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email))


@router.post("/request-code")
def request_code(body: RequestCodeRequest, db: Session = Depends(get_db)):
    email = body.email.strip()
    if not _valid_email(email):
        raise AppError(422, "invalid_email", "邮箱格式不正确")
    s = get_settings()
    code = new_code()
    db.add(
        VerificationCode(
            email=email,
            code_hash=hash_code(code),
            expires_at=_utcnow() + timedelta(minutes=s.code_ttl_minutes),
        )
    )
    db.commit()
    if s.dev_email_code:
        return {"dev_code": code, "message": "开发模式：验证码已直接返回，无需真实邮件"}
    return {"message": "验证码已发送"}


@router.post("/verify")
def verify(
    body: VerifyRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    email = body.email.strip()
    if not _valid_email(email):
        raise AppError(422, "invalid_email", "邮箱格式不正确")
    if not body.age_confirmed:
        raise AppError(403, "age_not_confirmed", "需确认年满 18 岁后才能进入")

    code = (
        db.query(VerificationCode)
        .filter(
            VerificationCode.email == email,
            VerificationCode.code_hash == hash_code(body.code),
            VerificationCode.used_at.is_(None),
            VerificationCode.expires_at > _utcnow(),
        )
        .order_by(VerificationCode.id.desc())
        .first()
    )
    if code is None:
        raise AppError(401, "invalid_code", "验证码错误或已过期")

    code.used_at = _utcnow()
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(email=email, age_confirmed=True)
        db.add(user)
        db.flush()
    else:
        user.age_confirmed = True

    token = create_session(db, user.id)
    s = get_settings()
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        max_age=s.session_ttl_days * 86400,
    )
    db.commit()
    return {"email": user.email, "age_confirmed": user.age_confirmed}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        db.query(SessionModel).filter(SessionModel.token == token).delete()
        db.commit()
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"email": user.email, "age_confirmed": user.age_confirmed}
