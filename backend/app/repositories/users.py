"""USERSテーブルへのデータ操作。"""

from pydantic import BaseModel

from app.clients.d1 import D1Writer


class UserRow(BaseModel):
    id: str
    name: str
    email: str | None
    password_hash: str
    avatar_url: str | None
    created_at: str


_SELECT_COLS = (
    "SELECT id, name, email, password_hash, avatar_url, created_at FROM USERS"
)


class UserRepository:
    def __init__(self, d1_client: D1Writer) -> None:
        self._d1 = d1_client

    async def find_by_name(self, name: str) -> UserRow | None:
        response = await self._d1.post(
            "/query",
            {
                "sql": f"{_SELECT_COLS} WHERE name = ?",
                "params": [name],
            },
        )
        results = response.json()["results"]
        return UserRow.model_validate(results[0]) if results else None

    async def find_by_id(self, user_id: str) -> UserRow | None:
        response = await self._d1.post(
            "/query",
            {
                "sql": f"{_SELECT_COLS} WHERE id = ?",
                "params": [user_id],
            },
        )
        results = response.json()["results"]
        return UserRow.model_validate(results[0]) if results else None

    async def update(
        self,
        user_id: str,
        name: str | None = None,
        password_hash: str | None = None,
    ) -> None:
        fields = []
        params: list[str] = []
        if name is not None:
            fields.append("name = ?")
            params.append(name)
        if password_hash is not None:
            fields.append("password_hash = ?")
            params.append(password_hash)
        if not fields:
            return
        params.append(user_id)
        await self._d1.post(
            "/execute",
            {
                "sql": f"UPDATE USERS SET {', '.join(fields)} WHERE id = ?",
                "params": params,
            },
        )

    async def create(
        self,
        user_id: str,
        name: str,
        password_hash: str,
        email: str | None,
        created_at: str,
    ) -> None:
        await self._d1.post(
            "/execute",
            {
                "sql": (
                    "INSERT INTO USERS"
                    " (id, name, email, password_hash, avatar_url, created_at)"
                    " VALUES (?, ?, ?, ?, NULL, ?)"
                ),
                "params": [user_id, name, email, password_hash, created_at],
            },
        )
