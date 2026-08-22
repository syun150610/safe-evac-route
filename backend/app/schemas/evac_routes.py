"""経路APIのスキーマ。

⚠️ **JSONの形は prep.route_search.bundles の出力そのまま。**
フロントの表示・指標・判定文がこの形に直結しているので、API化に伴って変えない
方針である。レスポンスはdictをそのまま返し、Pydanticで作り直さない。
ここでは**説明のための型**だけ置く。
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


class RationaleDetail(BaseModel):
    """詳細表示（タップ後）の4行。**行数も順番も固定。**"""

    route: str  # 距離と所要時間
    risk: str  # 危険区間の長さと未評価区間
    compare: str  # 最短経路との差
    condition: str  # 閾値・想定図・未評価区間


class RationaleHazard(BaseModel):
    """種別1つぶんの根拠。

    ⚠️ **種別ごとに変わるのは `risk_label` だけ。** 判定も文言テンプレも共通で、
    定義は `prep.hazard_sources.registry` の `risk` ブロックにある。
    """

    id: str  # "flood" / "quake" / …
    label: str  # 種別名（"浸水"）
    risk_label: str  # 危険区間の呼び名（"浸水30cm超"）
    # 経路の重みに掛けた種別か。False でも数値は出す
    # （registry.py「他種別での評価値も併記する」）
    considered: bool
    # avoided=回避成功 / already_safe=最短が既に安全 / partial=部分回避
    # / unavoidable=回避不可
    verdict: str
    before_m: float  # 最短経路の危険区間(m)
    after_m: float  # 選ばれた経路の危険区間(m)
    before_ratio: float
    after_ratio: float
    # ⚠️ **大きいほど「安全」ではなく「評価できていない」。** 必ず併記する
    unevaluated_ratio: float
    baseline_unevaluated_ratio: float
    # none=全区間が整備範囲の中 / some=一部が外 / warn=閾値超。
    # フロントが閾値を持たずに強調を出し分けられるようにするためのもの
    unevaluated_stage: str
    # 未評価の伝え方。**3段階とも必ず入る（nullにならない）。**
    # 整備範囲の名前（registry の `scope`）を差し込んである。
    # ⚠️ 危険区間0mでも出る。「危険が無い」と「判断材料が無い」は別物
    unevaluated_note: str
    text: str  # そのまま出せる短文
    detail: RationaleDetail


class RationaleDistance(BaseModel):
    baseline_m: float
    selected_m: float
    delta_m: float  # 遠回りぶん。baseline は距離最小なので 0 以上
    delta_ratio: float
    baseline_min_80: float
    selected_min_80: float
    baseline_min_60: float
    selected_min_60: float


class Rationale(BaseModel):
    """POST /search の `rationale`。「なぜこの経路なのか」。

    ⚠️ **文言はAPIが単一の出所。** フロントにテンプレートを持たせない
    （2026-08-21にユーザーと確認）。数値も併せて返すので、強調表示は
    フロント側で自由にできる。

    ⚠️ 種別を1つも選んでいない（＝最短しか引いていない）ときは **null**。
    比較対象が無いのに判定文を出すと誤読になる。

    ⚠️ **プリセットAPIには付かない。** あちらは静的JSONをバイト列のまま返す
    契約で、`tests/test_api.py` がバイト一致を検証している（決定 D-301）。
    """

    baseline_route: str
    selected_route: str
    distance: RationaleDistance
    # 登録済み種別ぶん。`considered` で経路に掛けたかを区別する。
    # ⚠️ 並びは「全区間評価済みの種別が先、未評価のある種別が後」。
    # 確かなことから先に述べるため、registry の並びより優先する
    hazards: list[RationaleHazard]


class Point(BaseModel):
    """緯度経度。`label` は表示名（住所検索の結果や「現在地」）"""

    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    label: str | None = Field(None, max_length=120)


class ShelterSearchRequest(BaseModel):
    """POST /api/evac-routes/search/shelter — **目的地を指定しない探索。**

    出発地と災害種別だけを受け取り、近隣の避難場所の中から
    「一番安全にたどり着ける先」を決めて、そこまでの経路を返す。

        {
          "origin": {"lat": 35.7497, "lon": 139.8050},
          "hazards": {"flood": "envelope"},
          "include": ["baseline", "selected"]
        }

    ⚠️ **`SearchRequest` はこれを継承して `dest` を足したもの。** フロントも
    `Omit<SearchRequest, 'dest'>` で型を作っており、片方だけ増えると
    黙って食い違う（`frontend/src/map/types.ts`）。
    """

    origin: Point
    # 種別ID -> variant。flood は浸水シナリオID、quake はいまのところ "total" のみ。
    # **空なら単純最短**（掛け合わせなし）
    hazards: dict[str, str] = Field(default_factory=dict)
    # baseline=単純最短 / selected=選んだ種別を掛けた経路 / minimax=最大浸水深の下限
    # minimax は二分探索でおよそ1秒かかるので既定では計算しない
    include: list[str] = Field(default_factory=lambda: ["baseline", "selected"])
    # 浸水を選ばなかったときに、指標をどの想定図で測るか（既定は包絡）
    scenario: str | None = None
    # 返す避難先候補の数。推奨1件のほかに比較材料を出すためのもの
    limit: int = Field(5, ge=1, le=10)


class SearchRequest(ShelterSearchRequest):
    """POST /api/evac-routes/search

    ⚠️ **レスポンスの形はプリセットと同じ**（routes[] / geojson / …）。
    フロントの表示コードを1本化するため。
    唯一の差が `rationale`（→ `Rationale`）で、プリセットには付かない。

        {
          "origin": {"lat": 35.7497, "lon": 139.8050},
          "dest":   {"lat": 35.7141, "lon": 139.7774},
          "hazards": {"flood": "envelope", "quake": "total"},
          "include": ["baseline", "selected"]
        }

    ⚠️ `limit` は継承の都合で受け取るが、**2点探索では使わない**
    （行き先は利用者が指定しているので、候補を並べる余地がない）。
    """

    dest: Point
