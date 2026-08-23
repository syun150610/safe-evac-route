"""近隣の避難先を、目的地を指定せずに探す（POST /api/evac-routes/search/shelter）。

2点探索（`search.py`）が「出発地と目的地」を受け取るのに対し、こちらは
**出発地と災害種別だけ**を受け取り、行き先そのものを決める。

## やっていること

    出発地 → 直線距離で近い避難場所を絞る（CANDIDATE_POOL 件）
          → 歩行グラフのノードへスナップ（MAX_SNAP_M 超は捨てる）
          → 目的地を1つに決めないダイクストラを2回
              ① length      … 近い順。**迂回上限の基準**と各候補の実距離
              ② ハザード重み … 危険が小さい順。実際に描く経路
          → 上限の内側でハザードコスト最小のものを推奨に決める
          → **既存の `search.search()` をその避難所を目的地にして呼ぶ**

最後の一手が肝で、`routes[]` / `geojson` / `rationale` は2点探索と
**同じコードが組み立てる**。文言も判定もここには置かない（決定 D-2xx、
根拠の文言はAPIが単一の出所）。

## なぜ2回引くのか

「一番安全な避難先」をハザードコスト最小だけで選ぶと、実測（江戸川区平井・
洪水envelope）で **区外6.1km先**が選ばれた。最短は1.6kmで、30cm超が30.3%。
徒歩避難としてどちらを推すかは距離を見ないと決められないので、
①で「最短で行ける避難所までの距離」を測り、その倍率で②を足切りする。

⚠️ **足切りで落とした候補も一覧には残す。** 「もっと安全だが遠い先がある」
ことを隠すと、平井のような場所で「近所に安全な避難先がある」と誤読される。

## 性能（新スコープ 652,828ノード / 1,905,380エッジ、実測）

  避難場所60件のスナップ   4ms（`snap_many`。総当たりなら180ms）
  ダイクストラ ①②        3〜91ms（早期打ち切りが効くため2点探索より軽い）
  推奨1件の本探索         既存 `search.search()` と同じ

"""

from __future__ import annotations

import math

from app.services.evac_routes import search as S
from app.services.shelters import loader
from prep.hazard_sources import registry
from prep.route_search import csr_search as CS
from prep.route_search.search import resolve_path_edges, route_stats
from prep.route_search.snap import graph_bbox
from prep.route_search.weights import edge_cost

# 直線距離で先に絞る件数。避難場所は都内2,251件あり、全部をスナップしても
# 0.26秒だが、遠い候補を目的地集合に入れても打ち切りが遅くなるだけで
# 結果は変わらない。実測では出発地から3km以内に131件、5km以内に330件ある
CANDIDATE_POOL = 60
# それでも遠すぎる候補は入れない。徒歩避難の想定を超える
MAX_POOL_RADIUS_M = 10_000.0

DEFAULT_LIMIT = 5

# 迂回の上限。「最短で行ける避難所までの距離 × RATIO ＋ SLACK」を超える
# 避難先は推奨しない（一覧には残す）。
# ⚠️ **これは仮の値。** 徒歩避難として何倍までの迂回が許容されるかに
# 裏付けは無い。ハザード係数（flood/cost.py）と同じ扱いで、変えるときは
# 変更前後の値と理由をここに残すこと。
DETOUR_RATIO = 1.5
DETOUR_SLACK_M = 500.0

# 経路のうち危険区間がこの割合を超える避難先は推奨しない（一覧には残す）。
# ⚠️ **これも仮の値。** 実測（グラフ上の無作為30地点）では、推奨経路の
# 危険区間割合の中央値は洪水・地震とも0.0%で、30%を超えるのは
# 洪水で17%・地震で3%の地点だった。「例外的に危ない経路だけ弾く」高さ。
# ⚠️ **全部が超えるときは弾かない。** 江戸川区のように周囲一帯が想定区域内の
# 場所では候補が空になる。そのときは従来どおり選び、`all_candidates_dangerous`
# で「どれも危ない」ことを伝える
DANGER_RATIO_LIMIT = 0.3

# 種別が一致する避難先が1件も入らなかったときに、追加で引く件数。
# ⚠️ **推奨にはしない。** 「自治体がこの災害向けに指定した先はここ」という
# 情報を一覧から消さないためだけのもの
MATCHED_EXTRA = 2


class NoShelter(Exception):
    """条件に合う避難先が近くに無い / どれにも到達できない"""


def _distance_m(lat0, lon0, lat, lon):
    kx = math.cos(math.radians(lat0))
    return math.hypot((lon - lon0) * kx * 111_320.0, (lat - lat0) * 111_320.0)


def _pool(o_lat, o_lon, hazard_ids, shelter_type):
    """直線距離で近い順に候補を絞る。(Feature, 直線距離m) のリスト。"""
    out = []
    for f in loader.eligible(hazard_ids, shelter_type):
        lon, lat = f["geometry"]["coordinates"]
        d = _distance_m(o_lat, o_lon, lat, lon)
        if d <= MAX_POOL_RADIUS_M:
            out.append((f, d))
    out.sort(key=lambda x: x[1])
    return out[:CANDIDATE_POOL]


def _danger_ratio(stats, hazard_ids) -> float:
    """選んだ災害の危険区間割合。複数選んでいれば**大きい方**を取る。

    ⚠️ **キー名をここに書かない。** 種別ごとの `ratio_key` は
    `prep.hazard_sources.registry` の `risk` ブロックが持つ。種別が増えても
    このファイルは無変更（`rationale.py` と同じ規則）。
    """
    out = 0.0
    for hid in hazard_ids or ():
        risk = registry.risk(hid)
        if risk:
            out = max(out, float(stats.get(risk["ratio_key"], 0.0) or 0.0))
    return out


def _shelter_info(feature, straight_m, node_id, snap_m, hazard_ids=()):
    p = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]
    return {
        "id": p["id"],
        "name": p["name"],
        "type": p["type"],
        "type_label": p["type_label"],
        "address": p["address"],
        "municipality": p["municipality"],
        # ⚠️ 空でも「対応していない」ではない。指定避難所は元データが
        #    災害種別を持たない（loader.eligible の注意書き）
        "hazard_types": p.get("hazard_types") or [],
        # この災害への対応が**データ上言えるか**。False は「対応していない」
        # ではなく「登録が無い」。画面で言い分けること
        "hazard_match": loader.hazard_match(p, hazard_ids),
        "latlon": [lat, lon],
        "straight_m": round(straight_m, 1),
        "node": int(node_id),
        "snap_m": round(snap_m, 1),
    }


def search(
    origin,
    hazards=None,
    include=None,
    scenario=None,
    limit=DEFAULT_LIMIT,
    shelter_type="all",
) -> dict:
    """出発地の近くで、一番安全に着ける避難先の経路を返す。

    戻り値は2点探索（`search.search()`）と同じ形に、`shelter` /
    `shelter_candidates` / `shelter_query` を足したもの。
    """
    o_lat, o_lon, _o_label = S._point(origin, "出発地")
    # 種別・シナリオの検証は2点探索と同じ経路を通す（メッセージも揃う）
    hs = S._normalize(hazards)
    sc = (hazards or {}).get("flood") or scenario or S.DEFAULT_SCENARIO
    S._check_area(graph_bbox(S._graph_file(sc)), (o_lat, o_lon))

    G = S._graph(sc)
    o = CS.nearest_node(G.csr, o_lat, o_lon)
    snap_o = CS.snap_m(G.csr, o, o_lat, o_lon)
    if snap_o > S.MAX_SNAP_M:
        raise S.BadRequest(
            f"出発地の近くに歩ける道が見つかりません（最寄りの道まで {snap_o:.0f}m）。"
            "道路の上を指してください。"
        )

    pool = _pool(o_lat, o_lon, hs, shelter_type)
    if not pool:
        raise NoShelter(
            f"出発地から{MAX_POOL_RADIUS_M / 1000:.0f}km以内に避難先が見つかりません。"
        )

    # ノード1つに複数の避難場所が乗ることがある（同じ交差点が最寄り）。
    # 目的地はノードで持ち、直線距離が近い方を代表にする
    snapped = CS.snap_many(
        G.csr,
        [f["geometry"]["coordinates"][1] for f, _ in pool],
        [f["geometry"]["coordinates"][0] for f, _ in pool],
    )
    targets: dict[int, dict] = {}
    at_origin: list[str] = []
    for (feature, straight_m), (node_id, snap_m) in zip(pool, snapped, strict=True):
        if node_id is None or snap_m > S.MAX_SNAP_M:
            continue
        if node_id == o:
            # 出発地と同じノード。経路が引けない（2点探索も同じ理由で弾く）ので
            # 目的地からは外すが、「すでに避難場所にいる」ことは伝える
            at_origin.append(feature["properties"]["name"])
            continue
        if node_id not in targets:
            targets[node_id] = _shelter_info(feature, straight_m, node_id, snap_m, hs)
    if not targets:
        raise NoShelter(
            "近くの避難場所から歩ける道へ入れませんでした。"
            + ("すでに避難場所の中にいる可能性があります。" if at_origin else "")
        )

    # ① 近い順（迂回上限の基準）。② ハザード重み（実際に描く経路）。
    # 種別を1つも選んでいなければ②は①と同じ探索なので引かない
    runs = [(CS.nearest_targets(G.csr, o, targets, (), k=limit), "length")]
    if hs:
        runs.append((CS.nearest_targets(G.csr, o, targets, hs, k=limit), "hazard"))

    # 候補ごとに、実際に歩く距離と危険区間を出す。
    # ⚠️ **①と②の `cost` は単位が違う**（片方は距離、もう片方は
    #    `length × Π cost_h`）。**混ぜて大小を比べてはいけない。**
    #    比較は「同じ探索から出たものどうし」でだけ行う
    cands: dict[int, dict] = {}
    for found, basis in runs:
        weight = "length" if basis == "length" else edge_cost(hs)
        for node_id, cost, path in found:
            edges, _amb = resolve_path_edges(G, path, weight)
            st = route_stats(G, edges)
            row = cands.get(node_id)
            if row is None:
                row = dict(targets[node_id], baseline_distance_m=None)
                cands[node_id] = row
            if basis == "length":
                row["baseline_distance_m"] = st["distance_m"]
            # ハザード考慮の経路が取れているならそちらを表に出す。
            # 利用者が実際に歩くのはこちらなので
            if basis == "hazard" or "stats" not in row:
                row["basis"] = basis
                row["cost"] = round(cost, 1)
                row["stats"] = st

    # ⚠️ **災害種別が確認できている避難先を、一覧から消さない。**
    #    指定避難所（種別の登録が無い）は数が多く近いので、放っておくと
    #    上位k件を占めて、自治体がその災害向けに指定した避難場所が
    #    1件も出なくなる（調布駅・地震で実際にそうなった）。
    #    足りなければ、種別が一致する施設だけでもう一度引いて足す
    if hs and not any(r["hazard_match"] for r in cands.values()):
        matched = {n: t for n, t in targets.items() if t["hazard_match"]}
        if matched:
            for node_id, cost, path in CS.nearest_targets(
                G.csr, o, matched, hs, k=MATCHED_EXTRA
            ):
                if node_id in cands:
                    continue
                edges, _amb = resolve_path_edges(G, path, edge_cost(hs))
                cands[node_id] = dict(
                    targets[node_id],
                    baseline_distance_m=None,
                    basis="hazard",
                    cost=round(cost, 1),
                    stats=route_stats(G, edges),
                )

    if not cands:
        raise NoShelter("近くの避難場所へたどり着ける道がありませんでした。")

    # 迂回の上限。基準は「最短で行ける避難所までの距離」。
    # ①が打ち切りで空になった場合だけ、実際に歩く距離の最小で代用する
    nearest_m = min(
        (
            r["baseline_distance_m"]
            for r in cands.values()
            if r["baseline_distance_m"] is not None
        ),
        default=None,
    )
    if nearest_m is None:
        nearest_m = min(r["stats"]["distance_m"] for r in cands.values())
    limit_m = nearest_m * DETOUR_RATIO + DETOUR_SLACK_M

    rows = list(cands.values())
    for r in rows:
        r["within_limit"] = r["stats"]["distance_m"] <= limit_m
        r["danger_ratio"] = round(_danger_ratio(r["stats"], hs), 4)

    # ⚠️ **推奨はハザード重みの探索（②）からしか選ばない。**
    #    ①の候補と `cost` を突き合わせると、距離とハザードコストという
    #    別単位を比べることになる。
    # ⚠️ `rows` の並びは①で先に入ったぶんが前に来るので、**ハザードコスト順とは
    #    限らない**。ここは必ず cost で取り直す（先頭を取ると①で見つかっていた
    #    避難所が混ざる）
    safest = [r for r in rows if r["basis"] == "hazard" and r["within_limit"]]
    safest.sort(key=lambda r: (r["cost"], r["stats"]["distance_m"]))

    # ⚠️ **危険区間だらけの経路は推奨しない。** 掛け合わせのコストが最小でも、
    #    経路の大半が危険区間なら「そこへ向かえ」とは言えない。
    # ⚠️ **全部が超えるときは弾かない。** 周囲一帯が想定区域内の場所
    #    （江戸川区など）で候補が空になる。そのときは従来どおり選び、
    #    `all_candidates_dangerous` で「どれも危ない」ことを伝える
    calm = [r for r in safest if r["danger_ratio"] <= DANGER_RATIO_LIMIT]
    all_dangerous = bool(safest) and not calm

    # 上限の内側が1つも無いのは、危険が小さい候補がどれも遠すぎるとき。
    # そのときは最短で行ける避難所に戻す（遠い候補も一覧には残す）
    chosen = (
        (calm or safest)[0]
        if safest
        else min(rows, key=lambda r: r["stats"]["distance_m"])
    )

    # 並びは 推奨 → 安全な順（②） → 近い順（①だけに出たもの）。
    # 別単位の cost が隣り合って比較されないように、群を分けてから並べる
    rows.sort(key=lambda r: (r is not chosen, r["basis"] != "hazard", r["cost"]))
    for i, r in enumerate(rows, 1):
        r["rank"] = i

    result = S.search(
        {"lat": o_lat, "lon": o_lon, "label": _o_label},
        {
            "lat": chosen["latlon"][0],
            "lon": chosen["latlon"][1],
            "label": chosen["name"],
        },
        hazards=hazards,
        include=include,
        scenario=scenario,
    )
    # ⚠️ **推奨の統計は、実際に返した経路のものへ差し替える。**
    #    候補の `stats` は候補選びに使った探索（①か②）のものなので、
    #    最短へ戻したとき（`fell_back_to_nearest`）は最短側の数字が残る。
    #    そのまま見せると、画面の「おすすめ」と経路比較・根拠が食い違う
    #    （実測: 平井で おすすめ 1.94km/11.8% に対し、描かれる経路は
    #     1.95km/9.2% だった）。利用者が歩くのは後者。
    selected = next(
        (r for r in result["routes"] if r["id"] == result["selected_route"]), None
    )
    if selected is not None:
        chosen["stats"] = selected["stats"]
        chosen["within_limit"] = selected["stats"]["distance_m"] <= limit_m

    result["shelter"] = {k: v for k, v in chosen.items() if k != "stats"}
    result["shelter_candidates"] = rows
    result["shelter_query"] = {
        "limit": limit,
        "type": shelter_type,
        "hazard_types": list(hs),
        "pool": len(pool),
        "reachable": len(cands),
        "radius_m": MAX_POOL_RADIUS_M,
        # 推奨をどこで足切りしたか。フロントが「遠いが安全な候補」を
        # 別扱いで見せられるように、閾値そのものを返す
        "nearest_distance_m": nearest_m,
        "detour_limit_m": round(limit_m, 1),
        "detour_ratio": DETOUR_RATIO,
        "detour_slack_m": DETOUR_SLACK_M,
        # 上限内に安全な候補が無く、最短の避難先へ戻した
        # 種別を選んでいなければ②を引いていないので「戻した」ではない
        "fell_back_to_nearest": bool(hs) and not safest,
        # ⚠️ 上限内の候補がどれも危険区間だらけだった。**推奨を出しつつ、
        #    「ここが安全だ」とは言っていない**ことを画面で伝えること
        "all_candidates_dangerous": all_dangerous,
        "danger_ratio_limit": DANGER_RATIO_LIMIT,
        # 指定避難所は災害種別の登録が無いので、対応の保証ができない。
        # 何件そういう候補が混ざっているか
        "without_hazard_match": sum(1 for r in rows if not r["hazard_match"]),
        # 出発地と同じノードに乗っていた避難場所（＝すでにその場にいる）
        "at_origin": at_origin,
    }
    return result
