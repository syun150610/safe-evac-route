"""避難所・避難場所。

  GET /api/shelters   GeoJSON FeatureCollection を返す

クエリパラメータ:
  bbox  left,bottom,right,top（省略時は全件）
  type  urgent | designated | all（省略時は全件）
"""

from fastapi import APIRouter, HTTPException, Query

from app.services.shelters import loader

router = APIRouter(prefix="/api/shelters", tags=["shelters"])


def _parse_bbox(raw: str) -> tuple[float, float, float, float]:
    parts = raw.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request", "message": "bbox は left,bottom,right,top の形式で指定してください"},
        )
    try:
        left, bottom, right, top = (float(p) for p in parts)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request", "message": "bbox の値が数値ではありません"},
        )
    return left, bottom, right, top


@router.get("")
def shelters(
    bbox: str | None = Query(None, description="left,bottom,right,top"),
    type: str | None = Query(None, description="urgent | designated | all"),
):
    """避難所・避難場所の一覧（GeoJSON）。

    - **urgent** = 指定緊急避難場所（緑ピン）
    - **designated** = 指定避難所（黄色ピン）
    """
    parsed_bbox = _parse_bbox(bbox) if bbox else None

    if type and type not in ("urgent", "designated", "all"):
        raise HTTPException(
            status_code=400,
            detail={"error": "bad_request", "message": "type は urgent / designated / all のいずれかです"},
        )

    return loader.get(bbox=parsed_bbox, type_filter=type)
