"""ユーザー投稿APIのスキーマ。"""

from datetime import datetime

from pydantic import BaseModel, Field


class CreatePostRequest(BaseModel):
    """投稿作成時にクライアントから受け取るデータ。"""

    user_id: str = Field(..., min_length=1, max_length=100)
    content: str = Field(..., min_length=1, max_length=1000)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    image_url: str | None = Field(None, max_length=1_500_000)


class HelpfulRequest(BaseModel):
    """投稿への評価時に受け取るデータ。"""

    user_id: str = Field(..., min_length=1, max_length=100)


class Post(BaseModel):
    """APIで返却する投稿データ。"""

    id: str
    user_name: str
    content: str
    latitude: float | None = None
    longitude: float | None = None
    image_url: str | None = None
    helpful_count: int = 0
    created_at: datetime
    helpful: bool = False


class PostList(BaseModel):
    """投稿一覧とページング情報。"""

    items: list[Post]
    has_more: bool = False