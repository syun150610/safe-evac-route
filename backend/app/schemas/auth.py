"""認証API用のリクエスト・レスポンスモデル。"""

import re

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    name: str
    password: str
    email: EmailStr | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not re.match(r"^[a-z0-9_-]{3,20}$", v):
            raise ValueError(
                "nameは半角英数字・アンダースコア・ハイフンで3〜20文字にしてください"
            )
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("パスワードは8文字以上にしてください")
        return v


class LoginRequest(BaseModel):
    name: str
    password: str


class UserResponse(BaseModel):
    id: str
    name: str
    email: str | None
    avatar_url: str | None
    created_at: str


class TokenResponse(BaseModel):
    user: UserResponse
    access_token: str
    token_type: str = "bearer"


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
