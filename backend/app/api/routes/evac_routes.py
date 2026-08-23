"""避難経路。

  GET  /presets            OD・シナリオ一覧
  GET  /presets/{od}       事前計算したバンドル1件
  GET  /area               対象エリア（地図に範囲を描く・入力を弾く）
  POST /search             任意の2点をその場で探索
  POST /search/shelter     目的地を指定せず、近隣で一番安全に着ける避難先を探す

⚠️ プリセットは**静的JSONと同一のバイト列を返す**。加工しないことで、
静的配信からAPI経由に切り替えても表示が変わらないことを保証する。
`/search` の戻り値は**プリセットと同じ形**にしてある（フロントの表示コードを1本化）。
"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.core.config import get_settings
from app.schemas.evac_routes import SearchRequest, ShelterSearchRequest
from app.services.evac_routes import bundle_store
from app.services.evac_routes import search as search_svc
from app.services.evac_routes import shelter_search as shelter_svc

# ⚠️ 向こうの流儀に合わせて **`/api` までを prefix に含める**
#    （health.py が `@router.get("/api/health")` とフルパスで書いているのと
#    同じ位置づけ）。
#    main.py 側で prefix を足さないので、URLはここだけを見れば分かる
router = APIRouter(prefix="/api/evac-routes", tags=["evac-routes"])


def _json(raw: bytes) -> Response:
    # dict に直して返すとキー順や数値表記が変わりうるので、バイト列のまま返す
    return Response(
        content=raw,
        media_type="application/json",
        headers={"X-Hazard-Data-Profile": get_settings().hazard_data_profile},
    )


@router.get("/presets")
def presets():
    """OD一覧・シナリオ一覧・既定値（デモUIが最初に読むもの）"""
    try:
        return _json(bundle_store.index_raw())
    except bundle_store.NotGenerated as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.get("/presets/{od}")
def preset(od: str, scenario: str = Query(..., description="シナリオID")):
    try:
        return _json(bundle_store.bundle_raw(scenario, od))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except bundle_store.NotGenerated as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.get("/area")
def area(scenario: str = Query(search_svc.DEFAULT_SCENARIO, description="シナリオID")):
    """対象エリア（bbox）。**この外の地点では経路を引けない。**

    フロントはこれを使って地図に範囲を描き、送信前に弾く。
    """
    try:
        return search_svc.area(scenario)
    except search_svc.BadRequest as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except search_svc.NotGenerated as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/search")
def search(req: SearchRequest):
    """任意の2点の経路。戻り値の形はプリセットと同じ。

    対象エリア外は **422 + `detail.error == "out_of_area"`** で返す。
    ⚠️ FastAPI のバリデーションエラーも 422 だが、あちらの `detail` は**配列**。
    フロントは `detail?.error` を見て区別すること（`lib/api` の `apiError`）。
    """
    try:
        return search_svc.search(
            req.origin.model_dump(),
            req.dest.model_dump(),
            hazards=req.hazards,
            include=req.include,
            scenario=req.scenario,
        )
    except search_svc.OutOfArea as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "out_of_area",
                "message": str(e),
                "which": e.which,
                "bbox": e.bbox,
            },
        ) from e
    except search_svc.BadRequest as e:
        raise HTTPException(
            status_code=400, detail={"error": "bad_request", "message": str(e)}
        ) from e
    except search_svc.NotGenerated as e:
        raise HTTPException(
            status_code=503, detail={"error": "not_generated", "message": str(e)}
        ) from e


@router.post("/search/shelter")
def search_shelter(req: ShelterSearchRequest):
    """**目的地を指定せず**、近隣で一番安全に着ける避難先までの経路。

    戻り値は `/search` と同じ形に `shelter` / `shelter_candidates` /
    `shelter_query` を足したもの。フロントの表示コードはそのまま使える。

    条件に合う避難先が近くに無い・どれにも到達できない場合は
    **422 + `detail.error == "no_shelter"`** で返す（エリア外の 422 とは
    `detail.error` で区別する）。
    """
    try:
        return shelter_svc.search(
            req.origin.model_dump(),
            hazards=req.hazards,
            include=req.include,
            scenario=req.scenario,
            limit=req.limit,
            shelter_type=req.shelter_type,
        )
    except shelter_svc.NoShelter as e:
        raise HTTPException(
            status_code=422, detail={"error": "no_shelter", "message": str(e)}
        ) from e
    except search_svc.OutOfArea as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "out_of_area",
                "message": str(e),
                "which": e.which,
                "bbox": e.bbox,
            },
        ) from e
    except search_svc.BadRequest as e:
        raise HTTPException(
            status_code=400, detail={"error": "bad_request", "message": str(e)}
        ) from e
    except search_svc.NotGenerated as e:
        raise HTTPException(
            status_code=503, detail={"error": "not_generated", "message": str(e)}
        ) from e
