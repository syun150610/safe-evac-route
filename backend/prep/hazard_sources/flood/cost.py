"""浸水深 → 距離に掛ける係数。

route_search/graph.py（旧 build_graph.py）から切り出した。**中身は変えていない。**
値の根拠は docs/dev/01_基本実装.md 5「ハザード重み係数の初期値」。
"""

import numpy as np

# 通行不可(inf)をグラフに載せるときの有限フォールバック値（SPEC 5 タスクA 末尾）
IMPASSABLE_FINITE = 1e6

# シナリオの想定範囲外（＝浸水深が評価されていない）区間に与えるコスト。
#
# 範囲外を 0m 扱い（コスト1.0）にすると、探索器にとって**最も安い道**になり、
# 「安全な道」ではなく「評価されていない道」へ逃げ込む（docs/findings/検証記録.md 6-2）。
# かといって除外すると、想定図が対象エリアを部分的にしか覆わないシナリオで
# 経路自体が出せなくなる。そこで中程度のペナルティを与える。
#
# 1.5 の根拠:
#   0.1〜0.2m相当（1.0〜1.3）よりやや高く、0.3m相当（2.0）よりは低い。
#   = 浅い浸水と同程度には警戒するが、歩行困難ほどではない、という位置づけ。
#   「たぶん安全だが確証がない」を表す値であって、実測値ではない。
COVERAGE_PENALTY = 1.5


def hazard_cost(depth_m: float) -> float:
    """浸水深(m) -> 距離に掛ける重み係数。

    SPEC 5「ハザード重み係数の初期値」のまま。**仮の値**であり、
    タスクCで距離差が10〜30%に収まるか検証してから確定させること。
    変更した場合はここに変更前後の値と理由を残す。
    """
    if depth_m < 0.10:
        return 1.0  # 影響なし
    if depth_m < 0.20:
        return 1.3  # 注意
    if depth_m < 0.30:
        return 2.0  # 歩きにくい
    if depth_m < 0.50:
        return 4.0  # 歩行困難
    if depth_m < 1.00:
        return 12.0  # 移動不能に近い
    return float("inf")  # 通行不可


# hazard_cost をベクトル化したもの（境界値は上の関数と一致させること）
_COST_BINS = np.array([0.10, 0.20, 0.30, 0.50, 1.00], dtype=np.float64)
_COST_VALS = np.array([1.0, 1.3, 2.0, 4.0, 12.0, np.inf], dtype=np.float64)


def hazard_cost_vec(depth: np.ndarray) -> np.ndarray:
    """hazard_cost() のベクトル版。np.searchsorted の side='right' で
    `depth < bin` の半開区間を再現する。"""
    return _COST_VALS[np.searchsorted(_COST_BINS, depth, side="right")]


def _selftest_cost():
    """スカラ版とベクトル版が境界で一致することを確認（境界のズレは静かなバグになる）"""
    probe = [0.0, 0.099, 0.10, 0.199, 0.20, 0.299, 0.30, 0.499, 0.50, 0.999, 1.00, 8.0]
    a = [hazard_cost(d) for d in probe]
    b = list(hazard_cost_vec(np.array(probe, dtype=np.float64)))
    assert a == b, f"hazard_cost mismatch:\n scalar={a}\n vector={b}"
