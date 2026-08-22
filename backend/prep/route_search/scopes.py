"""探索範囲（スコープ）の定義。**範囲に関する事実はここが単一の出所。**

グラフ・NPZ・プリセットは「成果物の種類 → 入力profile → **探索範囲**」で分ける。
この文書が持つのは最後の「探索範囲」で、次を1箇所にまとめる。

  * スコープID（配布ディレクトリ名も表示名もここから導く）
  * 利用者向けの呼び名（APIの案内文・範囲外エラーが読む）
  * 成果物のファイル名（シナリオごと）
  * 範囲の決め方（旧＝矩形bbox、新＝ポリゴン融合。**作り方は揃えない**）

⚠️ **標準ライブラリだけで動かすこと。** `app/core/config.py` がここを読むので、
   重い依存（osmnx / geopandas / scipy / pandas / PIL）を持ち込むと API が
   前処理の依存を抱え込む。`tests/test_layering.py` の検査2が機械で落とす。
   ポリゴンは**読まない**。「どこから・どう作るか」だけを持ち、実際に融合するのは
   前処理側（`prep.route_search.area_graph`）。

⚠️ **範囲の名前を他所へ書き写さないこと。** 探索範囲は変わる
   （2026-08-21に 北千住↔上野 26.7km² → 23区＋多摩の市街化区域 1,324.85km²）。
   書き写すと、片方だけ古い名前が残る。実際にフロントとAPIの3箇所で残っていた。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field


@dataclass(frozen=True)
class BboxArea:
    """2地点＋片側マージンの矩形。**旧スコープの作り方。**

    `prep/route_search/graph.py` がこの矩形でOSM歩行者ネットワークを取得する。
    """

    points: tuple[tuple[float, float], ...]  # (lat, lon)
    margin_km: float


@dataclass(frozen=True)
class PolygonArea:
    """ポリゴンを融合した範囲。**新スコープの作り方。**

    ⚠️ ここではポリゴンを読まない（geopandasを引き込まないため）。
    出所と、融合したあとの簡略化パラメータだけを持つ。
    """

    # `prep.paths` の解決関数名。実際に開くのは前処理側
    source_key: str
    # 融合後に落とす頂点の許容差（度）
    simplify_deg: float
    # 何を融合した範囲か。生成物のmetaにもこの説明を入れる
    note: str


@dataclass(frozen=True)
class Scope:
    """1つの探索範囲。"""

    id: str
    # 利用者へ見せる呼び名。APIの案内文と範囲外エラー(422)がこれを出す
    label: str
    # 成果物ファイル名の共通部分
    stem: str
    area: BboxArea | PolygonArea
    # 成果物が無いときに「何を実行すれば作れるか」を添えるための案内
    builder: str
    # ⚠️ **暫定。段階5で消す。** 既存の配布物は隅田川だけ接尾辞が無い
    #    （`kitasenju_ueno.npz`）。名前を規則的にすると本番配布物の
    #    リネームになるので、参照経路の切り替え（段階2）とは分ける。
    stem_overrides: Mapping[str, str] = field(default_factory=dict)

    @property
    def dir_name(self) -> str:
        """配布ディレクトリ名。**IDから導出し、二重に持たない。**

        文字列で別に持つと、片方だけ直したときに黙って別の場所を見に行く。
        """
        return f"scope-{self.id}"

    def graph_stem(self, scenario: str) -> str:
        """シナリオ1件ぶんのファイル名の幹。"""
        return self.stem_overrides.get(scenario, f"{self.stem}_{scenario}")

    def npz_name(self, scenario: str) -> str:
        """本番配布用の圧縮NPZ。"""
        return f"{self.graph_stem(scenario)}.npz"

    def pickle_name(self, scenario: str) -> str:
        """前処理の焼き上がりpickle。"""
        return f"{self.graph_stem(scenario)}.pkl"

    def meta_name(self, scenario: str) -> str:
        """NPZ・pickleに対応する `*_meta.json`。bboxやcoverageが入る。"""
        return f"{self.graph_stem(scenario)}_meta.json"


# ⚠️ 現在の配布物の名前をそのまま返す設定にしてある（段階2）。
#    ファイル名を規則的にするのは段階5。そこで
#      * `stem_overrides` を消す（隅田川に接尾辞を付ける）
#      * 新スコープの `stem` を `tokyo23ku_tama` にする
#    2つの範囲でファイル名が同じ状態は、本番の39MBを旧スコープの1.6MBで
#    静かに上書きできるということなので、段階5まで残る既知の危険である。
SCOPES: dict[str, Scope] = {
    "kitasenju-ueno": Scope(
        id="kitasenju-ueno",
        label="北千住↔上野の範囲（+1km）",
        stem="kitasenju_ueno",
        area=BboxArea(
            # SPEC 1「対象エリア」より。北千住駅 / 上野駅
            points=((35.7497, 139.8050), (35.7141, 139.7774)),
            margin_km=1.0,  # SPEC 5 タスクA-1
        ),
        builder="cd backend && python3 -m prep.route_search.graph --scenario <シナリオ>",
        stem_overrides={"sumidagawa": "kitasenju_ueno"},
    ),
    "tokyo-23ku-tama-shigaika": Scope(
        id="tokyo-23ku-tama-shigaika",
        label="23区＋多摩の市街化区域",
        # ⚠️ 段階5で `tokyo23ku_tama` にする。いまは旧スコープ時代の名前のまま
        stem="kitasenju_ueno",
        area=PolygonArea(
            source_key="quake_gpkg",
            simplify_deg=0.0002,  # 約20m
            note="地域危険度の町丁目5,192件 / 51市区町村を融合した範囲",
        ),
        builder=(
            "cd backend && python3 -m studies.graph_array.area_build.bake_area_graph"
            " --scenario <シナリオ>（新スコープの構築手順は docs/prep/flood-data.md）"
        ),
        stem_overrides={"sumidagawa": "kitasenju_ueno"},
    ),
}

# 本番が使う範囲。段階6で環境変数 `RUNTIME_SCOPE` から選べるようにする。
DEFAULT_SCOPE_ID = "tokyo-23ku-tama-shigaika"


def ids() -> list[str]:
    return list(SCOPES)


def get(scope_id: str) -> Scope:
    """IDから取り出す。未知のIDは既知の一覧を添えて落とす。"""
    if scope_id not in SCOPES:
        raise KeyError(f"未知のスコープ: {scope_id!r} / 既知={sorted(SCOPES)}")
    return SCOPES[scope_id]
