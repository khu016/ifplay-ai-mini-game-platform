"""会话与验证码：服务端会话（HttpOnly Cookie），验证码哈希存储。"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import AppError
from .models import Session as SessionModel
from .models import User

COOKIE_NAME = "pm_session"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def create_session(db: Session, user_id: int) -> str:
    s = get_settings()
    token = new_token()
    db.add(
        SessionModel(
            token=token,
            user_id=user_id,
            expires_at=_utcnow() + timedelta(days=s.session_ttl_days),
        )
    )
    db.commit()
    return token


def get_current_user(
    request: Request, db: Session = Depends(get_db)
) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise AppError(401, "unauthorized", "请先登录")
    sess = db.query(SessionModel).filter(SessionModel.token == token).first()
    if sess is None or sess.expires_at < _utcnow():
        raise AppError(401, "unauthorized", "登录已失效，请重新登录")
    user = db.get(User, sess.user_id)
    if user is None:
        raise AppError(401, "unauthorized", "用户不存在")
    return user
