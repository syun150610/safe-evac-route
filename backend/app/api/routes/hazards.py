"""ハザード種別・シナリオ・凡例（タイル表示担当の面）。

経路（evac_routes）とは別ルータにしてある。変わる頻度・キャッシュ戦略・
担当が違うため、経路APIと同じファイルへ混在させない。
"""

from fastapi import APIRouter

from app.services.hazards.catalog import catalog

router = APIRouter(prefix="/api", tags=["hazards"])


@router.get("/hazards")
def get_hazards():
    return catalog()
