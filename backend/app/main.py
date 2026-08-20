"""FastAPIアプリケーションのエントリーポイント。"""

import os

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import get_settings

app = FastAPI(title="Safe Evac Route API")
app.include_router(api_router)

# ⚠️ **開発サーバでだけタイルを配る。本番はここを通らない。**
#    Worker は /tiles/* をR2から返すので、デプロイ時に /tiles をここで受けない。
#    ローカルで `uvicorn app.main:app` を直接叩くとき用の便宜。
_tiles = get_settings().tiles_dir
if os.path.isdir(_tiles):
    app.mount("/tiles", StaticFiles(directory=_tiles), name="tiles")
