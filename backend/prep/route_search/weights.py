"""選ばれたハザード種別から探索用の重みを組み立てる。

## なぜ探索時に掛け合わせるのか

種別が N 個あると、事前に焼ける組み合わせは 2^N 通り。これは持たない。
エッジには**種別ごとの係数だけ**を焼き（`cost_flood` / `cost_quake` / …）、
掛け合わせは探索のたびに行う（docs/dev/05_チーム移行案.md §3-3）。

    weight(u, v, d) = d["length"] × Π cost_h        （h = 選ばれた種別）

こうすると、**組み合わせを増やしてもグラフを焼き直さなくてよい**。
焼き直しが要るのは種別そのものを増やすときだけ。

## 速度

networkx の callable weight は、事前計算したスカラより関数呼び出しのぶん遅い
（体感2〜3倍）。実測で1経路 0.1〜0.3秒なので、オンデマンド探索でも成立する。
プリセット（発表用デモ）は従来どおり事前計算した重みを使ってよい。

## inf の扱い

浸水コストは 1.0m 超で inf（通行不可）になる。inf のまま Dijkstra に渡すと
経路が出せなくなるので、有限のフォールバック値に潰す。
**既存の `weight_combined` と同じ規則**にしてあり、下の `equals_baked()` で
一致することを機械的に確認できる。
"""
import math

from prep.hazard_sources.flood.cost import IMPASSABLE_FINITE

# 事前計算した重み。プリセット生成と既存の検証スクリプトはこちらを使う
BAKED = {
    (): "length",
    ("flood",): "weight_hazard",
    ("quake",): "weight_quake",
    ("flood", "quake"): "weight_combined",
}


def cost_key(hazard_id):
    return f"cost_{hazard_id}"


def edge_cost(hazards):
    """種別のリスト → **エッジ1本ぶんの属性dict** を受け取って重みを返す関数。

    `edge_weight` はこれを平行エッジで min したもの。探索後に「実際に使われた
    平行エッジ」を復元する側（`search.resolve_path_edges`）も同じ関数が要るので、
    ここだけを単独で取り出せるようにしてある。

    ⚠️ **掛ける順序を事前計算と揃えること**（`length × cost_a × cost_b`）。
    浮動小数の乗算は結合則が成り立たないので、`length × (cost_a × cost_b)` にすると
    最下位ビットがズレる（実際に 8,038 エッジでズレた）。
    """
    keys = [cost_key(h) for h in tuple(hazards or ())]

    def one(attrs):
        x = attrs["length"]
        for k in keys:
            c = attrs.get(k)
            if c is None:
                # その種別が焼かれていないエッジ。1.0（影響なし）とは違うので
                # 黙って通さない。グラフの焼き直し漏れを早く見つけるため
                raise KeyError(f"エッジに {k} が無い。--hazards を付けて焼き直すこと")
            if math.isinf(c):
                return attrs["length"] * IMPASSABLE_FINITE
            x = x * c
        return x

    return one


def edge_weight(G, hazards):
    """種別のリスト → networkx に渡す重み。

    空なら "length"（単純最短）。事前計算済みの組み合わせでも
    **意図的に callable を返す**（事前計算に依存しないことを確かめるため）。
    速い方が要る場面では `baked_weight()` を使う。

    ⚠️ **MultiDiGraph では networkx が渡す `d` は「平行エッジの辞書」**
    （`{key: 属性dict}`）で、属性dictそのものではない。文字列の重みを渡したときに
    networkx が内部でやっているのと同じく、平行エッジの最小値を採る。
    ここを間違えると `d["length"]` が KeyError になる（実際になった）。
    """
    hs = tuple(hazards or ())
    if not hs:
        return "length"
    one = edge_cost(hs)
    multi = G.is_multigraph()

    def w(u, v, d):
        return min(one(a) for a in d.values()) if multi else one(d)

    return w


def baked_weight(hazards):
    """事前計算済みの重み名。無ければ None（callable を使うこと）"""
    return BAKED.get(tuple(hazards or ()))


def equals_baked(G, hazards, tol=0.0):
    """callable が事前計算値と一致するかを全エッジで確認する（移行の検証用）。

    戻り値: (不一致数, 最初の不一致の説明)
    """
    name = baked_weight(hazards)
    if name is None:
        raise ValueError(f"{hazards} は事前計算されていない")
    w = edge_weight(G, hazards)
    bad, first = 0, None
    for u, v, k, d in G.edges(keys=True, data=True):
        got, exp = w(u, v, {k: d}), d[name]   # 1本ぶんを平行エッジの形で渡す
        if not (got == exp or (tol and abs(got - exp) <= tol * max(1.0, abs(exp)))):
            bad += 1
            if first is None:
                first = f"{(u, v, k)}: callable={got!r} baked={exp!r} " \
                        f"(length={d['length']}, " \
                        f"{', '.join(f'{cost_key(h)}={d.get(cost_key(h))!r}' for h in hazards)})"
    return bad, first
