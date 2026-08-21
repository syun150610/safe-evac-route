"""認証のビジネスロジック。"""

from datetime import UTC, datetime, timedelta

from ulid import ULID

from app.core.config import get_settings
from app.repositories.refresh_tokens import RefreshTokenRepository
from app.repositories.users import UserRepository
from app.schemas.auth import AccessTokenResponse, TokenResponse, UserResponse
from app.services.auth.password import hash_password, verify_password
from app.services.auth.token import (
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
)


class AuthService:
    def __init__(
        self,
        user_repo: UserRepository,
        token_repo: RefreshTokenRepository,
    ) -> None:
        self._users = user_repo
        self._tokens = token_repo

    async def register(
        self, name: str, password: str, email: str | None
    ) -> tuple[TokenResponse, str]:
        """ユーザー登録。(TokenResponse, refresh_token_raw) を返す。"""
        if await self._users.find_by_name(name):
            raise ValueError("name_conflict")

        now = datetime.now(UTC)
        user_id = str(ULID())
        await self._users.create(
            user_id, name, hash_password(password), email, now.isoformat()
        )

        return await self._issue_tokens(
            user_id=user_id,
            name=name,
            email=email,
            avatar_url=None,
            created_at=now.isoformat(),
        )

    async def login(self, name: str, password: str) -> tuple[TokenResponse, str]:
        """ログイン。認証失敗はValueError("auth_failed")を送出する。"""
        user = await self._users.find_by_name(name)
        if not user or not verify_password(password, user.password_hash):
            raise ValueError("auth_failed")

        return await self._issue_tokens(
            user_id=user.id,
            name=user.name,
            email=user.email,
            avatar_url=user.avatar_url,
            created_at=user.created_at,
        )

    async def refresh(self, raw_token: str) -> tuple[AccessTokenResponse, str]:
        """Refresh tokenをrotationして新しいaccess tokenとrefresh tokenを返す。"""
        record = await self._tokens.find_by_hash(hash_refresh_token(raw_token))

        if (
            not record
            or record.revoked
            or datetime.fromisoformat(record.expires_at) <= datetime.now(UTC)
        ):
            raise ValueError("invalid_token")

        await self._tokens.revoke(record.id)

        settings = get_settings()
        now = datetime.now(UTC)
        raw_new, hash_new = generate_refresh_token()
        await self._tokens.create(
            token_id=str(ULID()),
            user_id=record.user_id,
            token_hash=hash_new,
            expires_at=(
                now + timedelta(days=settings.refresh_token_expire_days)
            ).isoformat(),
            created_at=now.isoformat(),
        )

        return (
            AccessTokenResponse(access_token=create_access_token(record.user_id)),
            raw_new,
        )

    async def logout(self, raw_token: str | None) -> None:
        """ログアウト。トークンがなくても常に成功扱い。"""
        if not raw_token:
            return
        record = await self._tokens.find_by_hash(hash_refresh_token(raw_token))
        if record and not record.revoked:
            await self._tokens.revoke(record.id)

    async def get_me(self, user_id: str) -> UserResponse:
        user = await self._users.find_by_id(user_id)
        if not user:
            raise ValueError("user_not_found")
        return UserResponse(
            id=user.id,
            name=user.name,
            email=user.email,
            avatar_url=user.avatar_url,
            created_at=user.created_at,
        )

    async def _issue_tokens(
        self,
        user_id: str,
        name: str,
        email: str | None,
        avatar_url: str | None,
        created_at: str,
    ) -> tuple[TokenResponse, str]:
        settings = get_settings()
        now = datetime.now(UTC)
        raw, token_hash = generate_refresh_token()
        await self._tokens.create(
            token_id=str(ULID()),
            user_id=user_id,
            token_hash=token_hash,
            expires_at=(
                now + timedelta(days=settings.refresh_token_expire_days)
            ).isoformat(),
            created_at=now.isoformat(),
        )
        return (
            TokenResponse(
                user=UserResponse(
                    id=user_id,
                    name=name,
                    email=email,
                    avatar_url=avatar_url,
                    created_at=created_at,
                ),
                access_token=create_access_token(user_id),
            ),
            raw,
        )
