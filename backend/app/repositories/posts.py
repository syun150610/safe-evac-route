"""投稿に関するD1操作。"""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.clients.d1 import D1Client, D1Writer, get_d1_client
from app.schemas.posts import CreatePostRequest, HelpfulRequest, Post, PostList

# 投稿1件を取得するSELECT句。user_idを受け取りhelpful状態を返す。
# パラメータ順: [user_id, post_id] または [user_id, ...order_params, limit, offset]
_SELECT_POST = """
SELECT p.id, COALESCE(u.name, '匿名ユーザー') AS user_name, p.content,
  p.latitude, p.longitude, p.image_url,
  (SELECT COUNT(*) FROM POST_EVALUATIONS e
   WHERE e.post_id = p.id AND e.evaluation_type = 'helpful') AS helpful_count,
  p.created_at,
  EXISTS (SELECT 1 FROM POST_EVALUATIONS e
          WHERE e.post_id = p.id AND e.user_id = ?
            AND e.evaluation_type = 'helpful') AS helpful
FROM POSTS p LEFT JOIN USERS u ON u.id = p.user_id
""".strip()

_SORT_SQL: dict[str, str] = {
    "recent": "p.created_at DESC",
    "helpful": (
        "(SELECT COUNT(*) FROM POST_EVALUATIONS e"
        " WHERE e.post_id = p.id AND e.evaluation_type = 'helpful') DESC,"
        " p.created_at DESC"
    ),
    # nearbyは緯度・経度をパラメータで渡すため別途組み立てる
}


class PostsRepository:
    """投稿に関するデータアクセスを担当するRepository。"""

    def __init__(self, d1_client: D1Writer) -> None:
        self._d1 = d1_client

    async def list_posts(
        self,
        limit: int,
        offset: int,
        sort: str,
        latitude: float | None,
        longitude: float | None,
        user_id: str,
    ) -> PostList:
        """投稿一覧をD1から取得する。"""

        if sort == "nearby":
            if latitude is None or longitude is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="latitude and longitude are required for nearby sort",
                )
            order_sql = (
                "((p.latitude - ?) * (p.latitude - ?)"
                " + (p.longitude - ?) * (p.longitude - ?)) ASC"
            )
            order_params: list = [latitude, latitude, longitude, longitude]
        else:
            order_sql = _SORT_SQL.get(sort, _SORT_SQL["recent"])
            order_params = []

        sql = f"{_SELECT_POST} ORDER BY {order_sql} LIMIT ? OFFSET ?"
        # limit+1件取得してhas_moreを判定する
        params = [user_id, *order_params, limit + 1, offset]

        response = await self._d1.post("/query", {"sql": sql, "params": params})
        rows = response.json()["results"]
        items = [Post.model_validate(r) for r in rows[:limit]]
        return PostList(items=items, has_more=len(rows) > limit)

    async def _fetch_post(self, post_id: str, user_id: str = "") -> Post:
        """投稿を1件取得する。create_post / mark_helpful の返却値に使用する。"""

        sql = f"{_SELECT_POST} WHERE p.id = ?"
        response = await self._d1.post(
            "/query", {"sql": sql, "params": [user_id, post_id]}
        )
        rows = response.json()["results"]
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Post not found",
            )
        return Post.model_validate(rows[0])

    async def create_post(self, request: CreatePostRequest) -> Post:
        """新しい投稿をD1に保存する。"""

        user_resp = await self._d1.post(
            "/query",
            {"sql": "SELECT id FROM USERS WHERE id = ?", "params": [request.user_id]},
        )
        if not user_resp.json()["results"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="ログインユーザーが見つかりません",
            )

        post_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        await self._d1.post(
            "/execute",
            {
                "sql": (
                    "INSERT INTO POSTS"
                    " (id, user_id, content, image_url,"
                    " latitude, longitude, status, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, 'published', ?)"
                ),
                "params": [
                    post_id,
                    request.user_id,
                    request.content.strip(),
                    request.image_url,
                    request.latitude,
                    request.longitude,
                    now,
                ],
            },
        )
        return await self._fetch_post(post_id, request.user_id)

    async def mark_helpful(self, post_id: str, request: HelpfulRequest) -> Post:
        """指定された投稿に「役立った」評価を登録または取り消す。"""

        post_resp = await self._d1.post(
            "/query",
            {"sql": "SELECT id FROM POSTS WHERE id = ?", "params": [post_id]},
        )
        if not post_resp.json()["results"]:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Post not found",
            )

        user_resp = await self._d1.post(
            "/query",
            {"sql": "SELECT id FROM USERS WHERE id = ?", "params": [request.user_id]},
        )
        if not user_resp.json()["results"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="ログインユーザーが見つかりません",
            )

        existing = await self._d1.post(
            "/query",
            {
                "sql": (
                    "SELECT 1 FROM POST_EVALUATIONS"
                    " WHERE post_id = ? AND user_id = ? AND evaluation_type = 'helpful'"
                ),
                "params": [post_id, request.user_id],
            },
        )

        if existing.json()["results"]:
            await self._d1.post(
                "/execute",
                {
                    "sql": (
                        "DELETE FROM POST_EVALUATIONS"
                        " WHERE post_id = ? AND user_id = ?"
                        " AND evaluation_type = 'helpful'"
                    ),
                    "params": [post_id, request.user_id],
                },
            )
        else:
            await self._d1.post(
                "/execute",
                {
                    "sql": (
                        "INSERT INTO POST_EVALUATIONS"
                        " (id, post_id, user_id, evaluation_type, created_at)"
                        " VALUES (?, ?, ?, 'helpful', ?)"
                    ),
                    "params": [
                        str(uuid.uuid4()),
                        post_id,
                        request.user_id,
                        datetime.now(UTC).isoformat(),
                    ],
                },
            )
        return await self._fetch_post(post_id, request.user_id)


async def get_posts_repository(
    d1_client: Annotated[D1Client, Depends(get_d1_client)],
) -> PostsRepository:
    """PostsRepositoryを生成するためのDependency。"""

    return PostsRepository(d1_client)
