"""経路APIのスキーマ。

⚠️ **JSONの形は prep.route_search.bundles の出力そのまま。**
フロントの表示・指標・判定文がこの形に直結しているので、API化に伴って変えない
（05_チーム移行案 §3-1「守るもの」）。だからレスポンスは dict をそのまま返し、
Pydanticで作り直さない。ここでは**説明のための型**だけ置く。
"""

from typing import Any

from pydantic import BaseModel, Field


class ODInfo(BaseModel):
    slug: str
    display: str
    role: str | None = None


class PresetIndex(BaseModel):
    """GET /api/evac-routes/presets"""

    default_scenario: str
    default_od: str
    scenarios: list[dict[str, Any]]
    od: list[dict[str, Any]]


class Bundle(BaseModel):
    """GET /api/evac-routes/presets/{od}?scenario=...

    中身は bundles.py の出力（routes[] / geojson / minimax_floor_m …）。
    形を固定したくないので dict のまま扱う。
    """

    model_config = {"extra": "allow"}


class Point(BaseModel):
    """緯度経度。`label` は表示名（住所検索の結果や「現在地」）"""

    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    label: str | None = Field(None, max_length=120)


class SearchRequest(BaseModel):
    """POST /api/evac-routes/search

    ⚠️ **レスポンスの形はプリセットと同じ**（routes[] / geojson / …）。
    フロントの表示コードを1本化するため（06_次セッションへの指示.md §2）。

        {
          "origin": {"lat": 35.7497, "lon": 139.8050},
          "dest":   {"lat": 35.7141, "lon": 139.7774},
          "hazards": {"flood": "envelope", "quake": "total"},
          "include": ["baseline", "selected"]
        }
    """

    origin: Point
    dest: Point
    # 種別ID -> variant。flood は浸水シナリオID、quake はいまのところ "total" のみ。
    # **空なら単純最短**（掛け合わせなし）
    hazards: dict[str, str] = Field(default_factory=dict)
    # baseline=単純最短 / selected=選んだ種別を掛けた経路 / minimax=最大浸水深の下限
    # minimax は二分探索でおよそ1秒かかるので既定では計算しない
    include: list[str] = Field(default_factory=lambda: ["baseline", "selected"])
    # 浸水を選ばなかったときに、指標をどの想定図で測るか（既定は包絡）
    scenario: str | None = None
