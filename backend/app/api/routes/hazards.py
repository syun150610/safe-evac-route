"""ハザード種別・シナリオ・凡例（タイル表示担当の面）。

経路（evac_routes）とは別ルータにしてある。変わる頻度・キャッシュ戦略・
担当が違うので、同じファイルを触らないようにする（05_チーム移行案 §4-1）。
"""

from fastapi import APIRouter

from app.services.hazards.catalog import catalog

router = APIRouter(prefix="/api", tags=["hazards"])


@router.get("/hazards")
def get_hazards():
    return catalog()
