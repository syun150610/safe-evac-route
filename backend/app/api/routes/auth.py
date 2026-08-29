"""アカウント認証エンドポイント。"""

from typing import Annotated

import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.clients.d1 import D1Client, get_d1_client
from app.core.config import get_settings
from app.repositories.refresh_tokens import RefreshTokenRepository
from app.repositories.users import UserRepository
from app.schemas.auth import (
    AccessTokenResponse,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
    UserUpdateRequest,
)
from app.services.auth.service import AuthService
from app.services.auth.token import verify_access_token

_COOKIE_NAME = "refresh_token"
_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30日

security = HTTPBearer()
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _get_auth_service(
    d1_client: Annotated[D1Client, Depends(get_d1_client)],
) -> AuthService:
    return AuthService(
        user_repo=UserRepository(d1_client),
        token_repo=RefreshTokenRepository(d1_client),
    )


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    secure = get_settings().app_env != "development"
    response.set_cookie(
        key=_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=secure,
        samesite="strict",
        path="/api/auth",
        max_age=_COOKIE_MAX_AGE,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=_COOKIE_NAME, path="/api/auth")


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    body: RegisterRequest,
    response: Response,
    service: Annotated[AuthService, Depends(_get_auth_service)],
) -> TokenResponse:
    try:
        token_response, raw = await service.register(
            body.name, body.password, body.email
        )
    except ValueError as exc:
        if str(exc) == "name_conflict":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="このユーザー名はすでに使われています",
            ) from exc
        raise
    _set_refresh_cookie(response, raw)
    return token_response


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    response: Response,
    service: Annotated[AuthService, Depends(_get_auth_service)],
) -> TokenResponse:
    try:
        token_response, raw = await service.login(body.name, body.password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザー名またはパスワードが正しくありません",
        ) from exc
    _set_refresh_cookie(response, raw)
    return token_response


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(
    response: Response,
    service: Annotated[AuthService, Depends(_get_auth_service)],
    refresh_token: Annotated[str | None, Cookie(alias=_COOKIE_NAME)] = None,
) -> AccessTokenResponse:
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="refresh tokenがありません",
        )
    try:
        token_response, raw = await service.refresh(refresh_token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="refresh tokenが無効または期限切れです",
        ) from exc
    _set_refresh_cookie(response, raw)
    return token_response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    service: Annotated[AuthService, Depends(_get_auth_service)],
    refresh_token: Annotated[str | None, Cookie(alias=_COOKIE_NAME)] = None,
) -> None:
    await service.logout(refresh_token)
    _clear_refresh_cookie(response)


@router.patch("/me", response_model=UserResponse)
async def update_me(
    body: UserUpdateRequest,
    response: Response,
    service: Annotated[AuthService, Depends(_get_auth_service)],
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> UserResponse:
    try:
        user_id = verify_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="access tokenが無効または期限切れです",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    try:
        return await service.update_me(
            user_id,
            name=body.name,
            email=body.email,
            current_password=body.current_password,
            new_password=body.new_password,
        )
    except ValueError as exc:
        match str(exc):
            case "name_conflict":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="このユーザー名はすでに使われています",
                ) from exc
            case "wrong_password":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="現在のパスワードが正しくありません",
                ) from exc
            case _:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="ユーザーが見つかりません",
                ) from exc


@router.get("/me", response_model=UserResponse)
async def me(
    service: Annotated[AuthService, Depends(_get_auth_service)],
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> UserResponse:
    try:
        user_id = verify_access_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="access tokenが無効または期限切れです",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    try:
        return await service.get_me(user_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ユーザーが見つかりません",
        ) from exc
