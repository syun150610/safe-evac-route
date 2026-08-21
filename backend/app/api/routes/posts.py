"""ユーザー投稿とタイムラインのAPI。"""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.repositories.posts import PostsRepository, get_posts_repository
from app.schemas.posts import CreatePostRequest, HelpfulRequest, Post, PostList

# 投稿関連APIのルーター。
# "/api/posts" を共通のプレフィックスとして付与する。
router = APIRouter(
    prefix="/api/posts",
    tags=["posts"],
)


@router.get("", response_model=PostList)
async def list_posts(
    repository: Annotated[
        PostsRepository,
        Depends(get_posts_repository),
    ],
    # 1ページあたりに取得する投稿数。
    # 過剰なデータ取得を防ぐため、1〜10件に制限する。
    limit: int = Query(
        default=10,
        ge=1,
        le=10,
    ),
    # 何件目から取得するかを指定する。
    # ページングに使用する。
    offset: int = Query(
        default=0,
        ge=0,
    ),

    # 投稿の並び順。
    # recent: 新しい順
    # helpful: 役立った数が多い順
    # nearby: 現在地に近い順
    sort: str = Query(
        default="recent",
        pattern="^(recent|helpful|nearby)$",
    ),

    # "nearby" ソート時に使用する現在地。
    latitude: float | None = Query(
        default=None,
        ge=-90,
        le=90,
    ),
    longitude: float | None = Query(
        default=None,
        ge=-180,
        le=180,
    ),

    # ユーザーごとの評価状態を判定するために使用する。
    user_id: str = Query(
        default="anonymous",
        min_length=1,
        max_length=100,
    ),
) -> PostList:
    """投稿一覧を取得する。"""

    try:
        # 投稿の取得処理はRepositoryに委譲する。
        # RouterではHTTPリクエストの受け付けと入力値の検証に集中する。
        return await repository.list_posts(
            limit=limit,
            offset=offset,
            sort=sort,
            latitude=latitude,
            longitude=longitude,
            user_id=user_id,
        )

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.json().get("detail", "投稿を取得できません"),
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        # Repositoryで外部API通信やデータ変換に失敗した場合、
        # API利用者には503 Service Unavailableとして返す。
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投稿を取得できません",
        ) from exc


@router.post(
    "",
    response_model=Post,
    status_code=status.HTTP_201_CREATED,
)
async def create_post(
    request: CreatePostRequest,
    repository: Annotated[
        PostsRepository,
        Depends(get_posts_repository),
    ],
) -> Post:
    """新しい投稿を作成する。"""

    try:
        # 投稿の保存処理はRepositoryに委譲する。
        return await repository.create_post(request)

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.json().get("detail", "投稿を保存できません"),
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        # 保存先への通信失敗やデータ変換エラーを503として返す。
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投稿を保存できません",
        ) from exc


@router.post(
    "/{post_id}/helpful",
    response_model=Post,
)
async def mark_helpful(
    post_id: str,
    request: HelpfulRequest,
    repository: Annotated[
        PostsRepository,
        Depends(get_posts_repository),
    ],
) -> Post:
    """指定された投稿に評価を登録する。"""

    try:
        # 評価の保存処理はRepositoryに委譲する。
        return await repository.mark_helpful(
            post_id=post_id,
            request=request,
        )

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.json().get("detail", "評価を保存できません"),
        ) from exc
    except (httpx.HTTPError, ValueError) as exc:
        # 評価の保存に失敗した場合は503として返す。
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="評価を保存できません",
        ) from exc