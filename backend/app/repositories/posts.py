"""投稿に関するD1操作。"""

from typing import Annotated, Protocol

import httpx
from fastapi import Depends

from app.clients.d1 import D1Client, get_d1_client
from app.schemas.posts import CreatePostRequest, HelpfulRequest, Post, PostList


class D1Writer(Protocol):
    """投稿Repositoryが利用するD1クライアントのインターフェース。"""

    # GETとPOSTだけを利用するため、Repositoryから必要な操作のみ定義する。
    async def get(self, path: str) -> httpx.Response: ...

    async def post(self, path: str, payload: dict) -> httpx.Response: ...


class PostsRepository:
    """投稿に関するデータアクセスを担当するRepository。"""

    def __init__(self, d1_client: D1Writer) -> None:
        # 実際のHTTP通信はD1Clientに委譲し、
        # Repositoryでは投稿データの取得・保存に必要な処理に集中する。
        self._d1_client = d1_client

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

        # D1 APIに渡すクエリパラメータを組み立てる。
        # limit / offset / sort / user_id は常に指定する。
        params = f"limit={limit}&offset={offset}&sort={sort}&user_id={user_id}"

        # nearby検索では現在地が必要なため、
        # 緯度・経度の両方が指定されている場合のみ追加する。
        if latitude is not None and longitude is not None:
            params += f"&latitude={latitude}&longitude={longitude}"

        # D1 APIから投稿データを取得する。
        response = await self._d1_client.get(f"/posts?{params}")

        # D1から返されたJSONをPostListに変換し、
        # アプリケーション内では型付きのデータとして扱えるようにする。
        return PostList.model_validate(response.json())

    async def create_post(self, request: CreatePostRequest) -> Post:
        """新しい投稿をD1に保存する。"""

        # Pydanticモデルを辞書に変換してD1 APIへ送信する。
        response = await self._d1_client.post(
            "/posts",
            request.model_dump(),
        )

        # D1から返されたJSONをPostモデルに変換する。
        return Post.model_validate(response.json())

    async def mark_helpful(
        self,
        post_id: str,
        request: HelpfulRequest,
    ) -> Post:
        """指定された投稿に「役立った」評価を登録する。"""

        # 指定された投稿の評価APIへリクエストを送信する。
        response = await self._d1_client.post(
            f"/posts/{post_id}/helpful",
            request.model_dump(),
        )

        # D1から返されたJSONをPostモデルに変換する。
        return Post.model_validate(response.json())


async def get_posts_repository(
    d1_client: Annotated[
        D1Client,
        Depends(get_d1_client),
    ],
) -> PostsRepository:
    """PostsRepositoryを生成するためのDependency。"""

    # D1ClientをRepositoryへ注入し、
    # FastAPIからRepositoryを利用できるようにする。
    return PostsRepository(d1_client)
