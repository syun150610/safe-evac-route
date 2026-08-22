"""JWTアクセストークンとリフレッシュトークンの生成・検証。"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import get_settings


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    expire = datetime.now(UTC) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": user_id, "exp": expire},
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def verify_access_token(token: str) -> str:
    """JWTを検証してuser_idを返す。無効な場合はjwt.PyJWTErrorを送出する。"""
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.jwt_secret_key.get_secret_value(),
        algorithms=[settings.jwt_algorithm],
    )
    user_id = payload.get("sub")
    if not user_id:
        raise jwt.InvalidTokenError("sub claim missing")
    return str(user_id)


def generate_refresh_token() -> tuple[str, str]:
    """(raw_token, token_hash) を返す。rawはCookieへ、hashはDBへ保存する。"""
    raw = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, token_hash


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
