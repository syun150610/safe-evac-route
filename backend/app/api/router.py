"""FastAPIの各ルートモジュールをまとめる。"""

from fastapi import APIRouter

from app.api.routes import auth, evac_routes, hazards, health, posts, shelters

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
# 地図まわり。経路（evac_routes）とハザード表示（hazards）はルータを分けてある。
# 変わる頻度・キャッシュ戦略・担当が違うので、同じファイルを触らないようにするため
api_router.include_router(evac_routes.router)
api_router.include_router(hazards.router)
api_router.include_router(posts.router)
api_router.include_router(shelters.router)
