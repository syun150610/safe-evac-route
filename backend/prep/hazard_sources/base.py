"""ハザード種別の契約。

新しい災害（土砂・高潮・津波…）を足すときは、ここを実装して
`registry.py` に1行足す。タイル生成側も経路探索側も、この契約しか知らない。

浸水は「点群CSV → 数値の格子」、地震は「ポリゴン → 町丁目のランク」で
**データ構造がまったく違う**。共通にするのは入口と出口だけにしてある。

    scenarios()      選べるシナリオ（種別の中だけで一意。global に一意にしない）
    sample()         座標列 → (値, 被覆フラグ)
    edge_cost()      値 → 距離に掛ける係数
    display_kind()   "raster"（連続値の格子）/ "vector"（離散のポリゴン）
    legend()         凡例。UIがそのまま描く

## coverage（被覆）を必ず実装すること

**「値が小さい」と「評価されていない」は違う。** これを区別しないと、
探索器は「安全な道」ではなく「評価されていない道」へ逃げ込む
（docs/findings/検証記録.md 6-2 で実際に起きた: 範囲外率45〜52%）。

`sample()` は値と一緒に「その点が評価対象に載っているか」を返し、
`edge_cost()` は載っていない分に**中程度のペナルティ**を掛ける。
未評価を最安値にしないこと。

## 表示形式はデータ構造に従う

連続値の格子はラスタタイル、離散のポリゴンはベクタで描く。
ポリゴンをラスタに焼くと境界がぼやけ、クリックもできず、サイズも100MB級になる
（docs/dev/05_チーム移行案.md §3-2）。
"""
from __future__ import annotations

import numpy as np


class HazardSource:
    """種別ごとの実装が満たす契約。継承は必須ではない（duck typing でよい）。"""

    id: str = ""          # "flood" / "quake" / … API・タイルパス・ディレクトリ名と同じ文字列
    label: str = ""       # 画面に出す名前

    def scenarios(self) -> list[dict]:
        """[{"id","label","kind","note"}, …]。種別の中だけで一意なID"""
        raise NotImplementedError

    def sample(self, coords: np.ndarray, scenario: str):
        """座標(N,2 lon/lat) → (値 (N,), 被覆 (N,) bool)

        評価対象に載っていない点は covered=False。値は NaN でも 0 でもよいが、
        **covered=False の点の値をコストに使ってはいけない。**
        """
        raise NotImplementedError

    def edge_cost(self, value: np.ndarray, coverage: np.ndarray) -> np.ndarray:
        """エッジ代表値と被覆率 → 距離に掛ける係数

        `coverage` は 0〜1（そのエッジのサンプル点のうち評価対象に載っていた割合）。
        未評価分には中程度のペナルティを掛けること（上の説明）。
        """
        raise NotImplementedError

    def display_kind(self) -> str:
        """"raster" or "vector\""""
        raise NotImplementedError

    def legend(self, scenario: str) -> list[dict]:
        """[{"color"/"hatch", "label"}, …]。UIがそのまま描く"""
        raise NotImplementedError
