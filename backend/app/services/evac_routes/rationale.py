"""「なぜこの経路なのか」の根拠。

最短経路（baseline）と選ばれた経路の統計を比べ、**4条件のどれに当たるか**を
判定して、そのまま画面に出せる短文と詳細4行まで組み立てる。

    回避成功   avoided       最短には危険区間があり、選んだ経路では無くなった
    最短が安全 already_safe  そもそも最短に危険区間が無い
    部分回避   partial       減らせたが残っている
    回避不可   unavoidable   減らせなかった

⚠️ **文言はここが単一の出所。** フロントにテンプレートを持たせない。
UI改修中でも文言がぶれず、種別が増えてもフロントが無変更で済むため
（どこに置くかは2026-08-21にユーザーと確認済み）。
フロントで数値を強調したい場合のために、組み立て前の数値も併せて返す。

⚠️ **種別ごとの差はラベルだけ。** 危険区間の呼び名・参照する統計キー・閾値の
説明は `prep.hazard_sources.registry` の `risk` ブロックにあり、このモジュールは
種別IDを1つもハードコードしない。**種別追加＝registry に1ブロック足すだけ。**

⚠️ **未評価区間を必ず併記する。** `out_of_coverage_ratio` が大きいとき、
危険区間が0mなのは「安全」ではなく「判断材料が無い」。この区別を落とすと
`hazard_sources/base.py` が禁じている読み違えをそのまま画面に出すことになる。

⚠️ **どの種別も「全域整備」ではない。** 浸水は想定区域図の整備対象流域の中だけ、
地震は地域危険度測定調査の対象区域（市街化区域）の中だけが評価済みで、
島嶼部・非市街化区域は調査対象外。整備範囲の名前は registry の `scope` にあり、
「この種別は全域だから未評価は起きない」と決め打ちしてはいけない。
現行bbox（北千住〜上野）で地震の未評価が0%なのは、たまたま全域が
市街化区域だからであって、範囲を広げれば対象外が現れる。
"""

from __future__ import annotations

import math

from prep.hazard_sources import registry

# 危険区間の距離を比べるときの許容差(m)。
# `length_over_03_m` は0.1m丸めだが、統計にキーが無い古いデータでは
# ratio×distance で代用する（ratio は4桁丸め＝5kmの経路で0.5m級の誤差）。
# サブメートルの差を「改善した」と読ませないため、1mを下限にする。
EPS_M = 1.0

# これを超えたら、短文と並べて「安全という意味ではない」と警告する。
# 実測で経路上の範囲外率が45〜75%になったODが存在する（神田川シナリオ）。
# 詳細を開かなくても未評価が見えるようにするための閾値
UNEVALUATED_WARN = 0.2

# これ未満を「全区間評価済み」とみなす。表示は小数1桁なので、
# 0.05%未満は「0.0%が範囲外」と出てしまい文と数字が食い違う
UNEVALUATED_ZERO = 0.0005

VERDICTS = ("avoided", "already_safe", "partial", "unavoidable")

# 未評価区間の伝え方。**3段階だけ。** 4条件の判定（VERDICTS）とは独立で、
# こちらを増やしても分岐は増えない。
#   none … 全区間が整備範囲の中。数値をそのまま信じてよい
#   some … 一部が外。事実として述べるだけ
#   warn … 閾値超。「危険が無い」ではなく「判断材料が無い」ことを明示する
UNEVALUATED_STAGES = ("none", "some", "warn")

UNEVALUATED_NOTES = {
    "none": "この経路は全区間が{scope}の中です",
    "some": "この経路の{ratio}は{scope}の外です",
    "warn": "この経路の{ratio}は{scope}の外です。安全という意味ではありません",
}

# 4条件の短文。**種別ごとに変わるのは {label} だけ。**
TEMPLATES = {
    "avoided": "+{delta} の遠回りで、{label}を {before} → {after} に",
    "already_safe": "最短経路が最も安全でした（{label}なし）",
    "partial": "{label}を {before} → {after}。残り{after}は迂回路がありません",
    # 「最短」は最短経路のことなので baseline 側の値を出す（2026-08-21 確認済み）
    "unavoidable": "どの経路も{label}を通ります（最短 {before}）",
}


def _m(v: float) -> str:
    """メートル。桁区切りあり。

    round() は偶数丸めなので 108.5 が 108 になる。表示は素直な四捨五入にする。
    """
    return f"{math.floor(abs(v) + 0.5) * (1 if v >= 0 else -1):,}m"


def _pct(v: float) -> str:
    return f"{v * 100:.1f}%"


def _km(v: float) -> str:
    return f"{v / 1000:.2f}km"


def _risk_m(stats: dict, spec: dict) -> float | None:
    """危険区間の距離(m)。

    実距離のキーが無い古い統計（`quake_r4plus_m` を持たない静的プリセット等）
    では ratio×distance で代用する。誤差はm級なので EPS_M で吸収する。
    """
    v = stats.get(spec["length_key"])
    if v is not None:
        return float(v)
    ratio = stats.get(spec["ratio_key"])
    if ratio is None:
        return None
    return float(ratio) * float(stats.get("distance_m") or 0.0)


def _unevaluated_stage(ratio: float) -> str:
    """未評価割合 → 3段階。**ここに種別の分岐を持ち込まないこと。**

    種別ごとの差は `scope`（整備範囲の名前）だけで、判定は共通にする。
    """
    if ratio < UNEVALUATED_ZERO:
        return "none"
    if ratio < UNEVALUATED_WARN:
        return "some"
    return "warn"


def _verdict(before: float, after: float) -> str:
    if before <= EPS_M:
        return "already_safe"
    if after <= EPS_M:
        return "avoided"
    if after < before - EPS_M:
        return "partial"
    return "unavoidable"


def _hazard_entry(hid, spec, base_st, sel_st, considered, dist, scenario_display):
    before = _risk_m(base_st, spec)
    after = _risk_m(sel_st, spec)
    if before is None or after is None:
        # この種別の統計がグラフに焼かれていない。黙って外す
        # （0mとして出すと「安全」に見えてしまう）
        return None

    verdict = _verdict(before, after)
    label = spec["label"]
    unevaluated = float(sel_st.get(spec["coverage_key"]) or 0.0)
    base_unevaluated = float(base_st.get(spec["coverage_key"]) or 0.0)

    text = TEMPLATES[verdict].format(
        label=label,
        before=_m(before),
        after=_m(after),
        delta=_m(dist["delta_m"]),
    )

    after_ratio = float(sel_st.get(spec["ratio_key"]) or 0.0)
    risk_line = (
        f"{label} なし"
        if after <= EPS_M
        else f"{label} {_m(after)}（経路の{_pct(after_ratio)}）"
    )
    compare_line = (
        f"最短と同じ距離。{label} {_m(before)} → {_m(after)}"
        if abs(dist["delta_m"]) < 0.5
        else f"最短より +{_m(dist['delta_m'])}（+{_pct(dist['delta_ratio'])}）。"
        f"{label} {_m(before)} → {_m(after)}"
    )
    condition_note = spec["condition_note"].format(scenario_display=scenario_display)
    scope = spec["scope"]
    stage = _unevaluated_stage(unevaluated)

    hazard_label = registry.meta(hid)["label"]
    return {
        "id": hid,
        "label": hazard_label,
        "risk_label": label,
        # 経路の重みに掛けた種別か。False でも数値は出す
        # （registry.py「他種別での評価値も併記する」）
        "considered": considered,
        "verdict": verdict,
        "before_m": round(before, 1),
        "after_m": round(after, 1),
        "before_ratio": float(base_st.get(spec["ratio_key"]) or 0.0),
        "after_ratio": after_ratio,
        "unevaluated_ratio": unevaluated,
        "baseline_unevaluated_ratio": base_unevaluated,
        # none / some / warn。フロントが閾値を持たずに強調を出し分けられるようにする
        "unevaluated_stage": stage,
        # 詳細を開かなくても未評価が見えるようにする。
        # ⚠️ 危険区間0mでも出す。「危険が無い」と「判断材料が無い」は別物
        "unevaluated_note": UNEVALUATED_NOTES[stage].format(
            scope=scope, ratio=_pct(unevaluated)
        ),
        "text": text,
        "detail": {
            "route": f"{_km(sel_st['distance_m'])} ・ 徒歩 約"
            f"{sel_st['duration_min_80']:.0f}分（平常時）/ 約"
            f"{sel_st['duration_min_60']:.0f}分（災害時60m/分）",
            "risk": f"{risk_line}・未評価区間 {_pct(unevaluated)}",
            "compare": compare_line,
            # 閾値を必ず出す。危険区間の閾値と、未評価の警告閾値の両方
            "condition": f"{spec['threshold_label']}を危険区間として集計。"
            f"{condition_note}。"
            f"未評価区間＝{scope}の外で、この経路 {_pct(unevaluated)}・"
            f"最短経路 {_pct(base_unevaluated)}（警告閾値 {_pct(UNEVALUATED_WARN)}）",
        },
    }


def build(routes, selected_route_id, hazards, scenario_display) -> dict | None:
    """`routes[]` から根拠を組み立てる純関数。

    比べる相手が無いとき（最短しか引いていない＝種別を1つも選んでいない）は
    **None を返す。** 比較対象が無いのに4条件のどれかを当てはめると誤読になる。
    """
    by_id = {r["id"]: r for r in routes}
    base = by_id.get("baseline")
    sel = by_id.get(selected_route_id)
    if base is None or sel is None or selected_route_id == "baseline":
        return None

    base_st, sel_st = base["stats"], sel["stats"]
    base_d = float(base_st["distance_m"])
    sel_d = float(sel_st["distance_m"])
    dist = {
        "baseline_m": round(base_d, 1),
        "selected_m": round(sel_d, 1),
        "delta_m": round(sel_d - base_d, 1),
        "delta_ratio": round((sel_d - base_d) / base_d, 4) if base_d else 0.0,
        "baseline_min_80": base_st["duration_min_80"],
        "selected_min_80": sel_st["duration_min_80"],
        "baseline_min_60": base_st["duration_min_60"],
        "selected_min_60": sel_st["duration_min_60"],
    }

    chosen = set(hazards or {})
    entries = []
    for hid in registry.ids():
        spec = registry.risk(hid)
        if spec is None:
            continue
        e = _hazard_entry(
            hid, spec, base_st, sel_st, hid in chosen, dist, scenario_display
        )
        if e is not None:
            entries.append(e)

    # 複数種別あるときは、**全区間評価済みの種別を先に述べ、未評価のある種別を
    # 後に述べる。** 「確かなことから先に言う」ため。
    # sort は安定なので、同じ段階の中では registry の並びが保たれる。
    # ⚠️ 種別IDでは並べ替えないこと（種別が増えたときに効かなくなる）
    entries.sort(key=lambda e: 0 if e["unevaluated_stage"] == "none" else 1)

    return {
        "baseline_route": "baseline",
        "selected_route": selected_route_id,
        "distance": dist,
        "hazards": entries,
    }
