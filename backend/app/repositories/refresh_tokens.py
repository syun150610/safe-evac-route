"""REFRESH_TOKENSテーブルへのデータ操作。"""

from pydantic import BaseModel

from app.clients.d1 import D1Writer


class RefreshTokenRow(BaseModel):
    id: str
    user_id: str
    token_hash: str
    expires_at: str
    revoked: int
    created_at: str


class RefreshTokenRepository:
    def __init__(self, d1_client: D1Writer) -> None:
        self._d1 = d1_client

    async def create(
        self,
        token_id: str,
        user_id: str,
        token_hash: str,
        expires_at: str,
        created_at: str,
    ) -> None:
        await self._d1.post(
            "/execute",
            {
                "sql": (
                    "INSERT INTO REFRESH_TOKENS"
                    " (id, user_id, token_hash, expires_at, revoked, created_at)"
                    " VALUES (?, ?, ?, ?, 0, ?)"
                ),
                "params": [token_id, user_id, token_hash, expires_at, created_at],
            },
        )

    async def find_by_hash(self, token_hash: str) -> RefreshTokenRow | None:
        response = await self._d1.post(
            "/query",
            {
                "sql": (
                    "SELECT id, user_id, token_hash, expires_at, revoked, created_at"
                    " FROM REFRESH_TOKENS WHERE token_hash = ?"
                ),
                "params": [token_hash],
            },
        )
        results = response.json()["results"]
        return RefreshTokenRow.model_validate(results[0]) if results else None

    async def revoke(self, token_id: str) -> None:
        await self._d1.post(
            "/execute",
            {
                "sql": "UPDATE REFRESH_TOKENS SET revoked = 1 WHERE id = ?",
                "params": [token_id],
            },
        )
