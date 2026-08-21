"""経路選択の根拠（app.services.evac_routes.rationale）。

判定は純関数なので、グラフを読まずに統計dictだけで4条件を全部踏む。
最後に本物の探索を1回だけ通し、実レスポンスに `rationale` が乗ることを見る。
"""

from __future__ import annotations

import pytest

from app.services.evac_routes import rationale as R
from prep.hazard_sources import registry
from prep.route_search.search import DEPTH_THRESHOLD

SCENARIO = "全河川（想定最大）"


def _stats(distance_m, flood_m, quake_m, cov=0.0, qcov=0.0):
    """route_stats() が返す形のうち、根拠が見るキーだけを作る"""
    return {
        "distance_m": distance_m,
        "duration_min_80": round(distance_m / 80.0, 1),
        "duration_min_60": round(distance_m / 60.0, 1),
        "length_over_03_m": flood_m,
        "ratio_over_03": round(flood_m / distance_m, 4),
        "out_of_coverage_ratio": cov,
        "quake_r4plus_m": quake_m,
        "quake_r4plus_ratio": round(quake_m / distance_m, 4),
        "quake_out_of_coverage_ratio": qcov,
    }


def _routes(base_stats, sel_stats, sel_id="combined"):
    return [
        {"id": "baseline", "stats": base_stats},
        {"id": sel_id, "stats": sel_stats},
    ]


def _build(base_stats, sel_stats, hazards=None, sel_id="combined"):
    return R.build(
        _routes(base_stats, sel_stats, sel_id),
        sel_id,
        hazards if hazards is not None else {"flood": "envelope", "quake": "total"},
        SCENARIO,
    )


def _flood(rationale):
    return next(h for h in rationale["hazards"] if h["id"] == "flood")


# ---------------- 4条件 ----------------


def test_回避成功():
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 0.0, 90))
    f = _flood(r)
    assert f["verdict"] == "avoided"
    assert f["text"] == "+346m の遠回りで、浸水30cm超を 1,178m → 0m に"


def test_最短が既に安全():
    r = _build(_stats(5000, 0.0, 100), _stats(5000, 0.0, 100))
    f = _flood(r)
    assert f["verdict"] == "already_safe"
    assert f["text"] == "最短経路が最も安全でした（浸水30cm超なし）"


def test_部分回避():
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 108.5, 90))
    f = _flood(r)
    assert f["verdict"] == "partial"
    assert f["text"] == "浸水30cm超の区間が 1,178m → 109m。残り109mは迂回路がありません"


def test_回避不可():
    """減らせなかった。『最短』は最短経路のことなので baseline 側の値を出す"""
    r = _build(_stats(5000, 1177.5, 100), _stats(5400, 1177.5, 90))
    f = _flood(r)
    assert f["verdict"] == "unavoidable"
    assert f["text"] == "どの経路も浸水30cm超を通ります（最短 1,178m）"


def test_サブメートルの差を改善と読ませない():
    """0.1m丸めと ratio 代用の誤差を『部分回避』にしない"""
    r = _build(_stats(5000, 1177.5, 100), _stats(5000, 1177.0, 100))
    assert _flood(r)["verdict"] == "unavoidable"


# ---------------- 未評価区間 ----------------


def test_未評価区間を必ず返す():
    r = _build(_stats(5000, 1177.5, 100, cov=0.0), _stats(5346, 0.0, 90, cov=0.45))
    f = _flood(r)
    assert f["unevaluated_ratio"] == 0.45
    assert f["baseline_unevaluated_ratio"] == 0.0
    # カバー外を黙って「安全」に混ぜない。条件行に必ず出す
    assert "この経路 45.0%" in f["detail"]["condition"]
    assert "最短経路 0.0%" in f["detail"]["condition"]
    assert "未評価区間 45.0%" in f["detail"]["risk"]


def test_危険0mでも未評価が読める():
    """危険区間なしでも『判断材料が無い』割合が消えないこと"""
    r = _build(_stats(5000, 0.0, 0.0, cov=0.52), _stats(5000, 0.0, 0.0, cov=0.52))
    assert "未評価区間 52.0%" in _flood(r)["detail"]["risk"]


# ---------------- 未評価の3段階 ----------------
#
# ⚠️ **ここは3段階だけ。** 4条件の判定（VERDICTS）とは独立で、増やさない


def test_段階は3つだけ():
    assert R.UNEVALUATED_STAGES == ("none", "some", "warn")
    assert set(R.UNEVALUATED_NOTES) == set(R.UNEVALUATED_STAGES)
    # 未評価の段階を増やしても、経路の判定は4条件のまま
    assert len(R.VERDICTS) == 4


def test_全区間評価済みなら整備範囲の中だと述べる():
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 0.0, 90))
    f = _flood(r)
    assert f["unevaluated_stage"] == "none"
    assert f["unevaluated_note"] == "この経路は全区間が想定区域図の整備対象流域の中です"


def test_閾値未満なら事実だけ述べる():
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 0.0, 90, cov=0.08))
    f = _flood(r)
    assert f["unevaluated_stage"] == "some"
    assert f["unevaluated_note"] == "この経路の8.0%は想定区域図の整備対象流域の外です"


def test_閾値超なら安全ではないと明示する():
    """『最短経路が最も安全でした』だけを見せると、判断材料が無いことが隠れる"""
    r = _build(_stats(5000, 0.0, 0.0, cov=0.749), _stats(5100, 0.0, 0.0, cov=0.749))
    f = _flood(r)
    assert f["verdict"] == "already_safe"
    assert f["unevaluated_stage"] == "warn"
    assert f["unevaluated_note"] == (
        "この経路の74.9%は想定区域図の整備対象流域の外です。安全という意味ではありません"
    )


def test_地震の整備範囲は市街化区域だと述べる():
    """⚠️ 地震も全域整備ではない。島嶼部・非市街化区域は調査対象外"""
    r = _build(_stats(5000, 100, 1177.5), _stats(5346, 100, 108.5, qcov=0.3))
    q = next(h for h in r["hazards"] if h["id"] == "quake")
    assert q["unevaluated_stage"] == "warn"
    assert q["unevaluated_note"] == (
        "この経路の30.0%は地域危険度測定調査の対象区域（市街化区域）の外です。"
        "安全という意味ではありません"
    )


def test_表示が0_0パーセントになる端数は全区間評価済み扱い():
    """『0.0%が範囲外です』という、文と数字が食い違う表示を作らない"""
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 0.0, 90, cov=0.0001))
    assert _flood(r)["unevaluated_stage"] == "none"


# ---------------- 述べる順 ----------------


def test_全区間評価済みの種別を先に述べる():
    """確かなことから先に言う。未評価のある種別は後ろへ回す"""
    # 浸水に未評価があり、地震は全区間評価済み → 地震が先
    r = _build(
        _stats(5000, 1177.5, 100, cov=0.45), _stats(5346, 0.0, 90, cov=0.45, qcov=0.0)
    )
    assert [h["id"] for h in r["hazards"]] == ["quake", "flood"]


def test_同じ段階なら登録順を保つ():
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 0.0, 90))
    assert [h["id"] for h in r["hazards"]] == ["flood", "quake"]


def test_両方に未評価があれば登録順を保つ():
    r = _build(
        _stats(5000, 1177.5, 100, cov=0.45, qcov=0.3),
        _stats(5346, 0.0, 90, cov=0.45, qcov=0.3),
    )
    assert [h["id"] for h in r["hazards"]] == ["flood", "quake"]


# ---------------- 種別の扱い ----------------


def test_登録済み種別を全部返し_掛けたかを区別する():
    """単一種別の経路を誤読させないため、選ばなかった種別の数値も併記する"""
    r = _build(
        _stats(5000, 1177.5, 1500),
        _stats(5346, 0.0, 1600),
        hazards={"flood": "envelope"},
    )
    got = {h["id"]: h["considered"] for h in r["hazards"]}
    assert got == {"flood": True, "quake": False}
    # 地震は掛けていないが、悪化したことは読める
    q = next(h for h in r["hazards"] if h["id"] == "quake")
    assert q["verdict"] == "unavoidable"
    assert q["risk_label"] == "危険度4以上"


def test_種別ごとに変わるのはラベルだけ():
    """同じ数値なら、種別が違っても文の骨格が一致する"""
    r = _build(_stats(5000, 1177.5, 1177.5), _stats(5346, 0.0, 0.0))
    texts = {h["id"]: h["text"] for h in r["hazards"]}
    assert texts["flood"] == "+346m の遠回りで、浸水30cm超を 1,178m → 0m に"
    assert texts["quake"] == "+346m の遠回りで、危険度4以上を 1,178m → 0m に"


def test_registryだけで種別を足せる(monkeypatch):
    """判定ロジックを触らずに新種別が根拠へ出ること（種別IDをハードコードしない）"""
    monkeypatch.setitem(
        registry.HAZARDS,
        "landslide",
        {
            "label": "土砂",
            "display_kind": "vector",
            "module": "prep.hazard_sources.landslide",
            "note": "テスト用",
            "risk": {
                "label": "急傾斜地",
                "length_key": "landslide_m",
                "ratio_key": "landslide_ratio",
                "coverage_key": "landslide_out_of_coverage_ratio",
                "threshold_label": "土砂災害警戒区域",
                "condition_note": "区域指定は都の公表値",
                "scope": "急傾斜地崩壊危険箇所の調査対象区域",
            },
        },
    )
    base = _stats(5000, 0.0, 0.0) | {
        "landslide_m": 800.0,
        "landslide_ratio": 0.16,
        "landslide_out_of_coverage_ratio": 0.0,
    }
    sel = _stats(5346, 0.0, 0.0) | {
        "landslide_m": 0.0,
        "landslide_ratio": 0.0,
        "landslide_out_of_coverage_ratio": 0.4,
    }
    r = _build(base, sel)
    got = next(h for h in r["hazards"] if h["id"] == "landslide")
    assert got["verdict"] == "avoided"
    assert got["text"] == "+346m の遠回りで、急傾斜地を 800m → 0m に"
    # 整備範囲の名前も registry から来る。判定側は種別を知らない
    assert got["unevaluated_note"] == (
        "この経路の40.0%は急傾斜地崩壊危険箇所の調査対象区域の外です。"
        "安全という意味ではありません"
    )
    # 未評価のある種別は後ろへ回る
    assert [h["id"] for h in r["hazards"]][-1] == "landslide"


def test_統計が無い種別は黙って外れる():
    """0mとして出すと『安全』に見えてしまうので、根拠に載せない"""
    base = {
        k: v for k, v in _stats(5000, 1177.5, 0).items() if not k.startswith("quake")
    }
    sel = {k: v for k, v in _stats(5346, 0.0, 0).items() if not k.startswith("quake")}
    r = _build(base, sel)
    assert [h["id"] for h in r["hazards"]] == ["flood"]


def test_実距離キーが無ければ割合から代用する():
    """`quake_r4plus_m` を持たない古い統計でも判定できる"""
    base = _stats(5000, 0.0, 1500)
    sel = _stats(5346, 0.0, 0.0)
    del base["quake_r4plus_m"], sel["quake_r4plus_m"]
    q = next(h for h in _build(base, sel)["hazards"] if h["id"] == "quake")
    assert q["verdict"] == "avoided"
    assert q["before_m"] == pytest.approx(1500, abs=1.0)


# ---------------- 比較対象が無いとき ----------------


def test_最短しか無ければNone():
    """種別を選んでいないのに4条件のどれかを当てはめない"""
    st = _stats(5000, 1177.5, 100)
    assert R.build([{"id": "baseline", "stats": st}], "baseline", {}, SCENARIO) is None


def test_baselineが無ければNone():
    st = _stats(5000, 1177.5, 100)
    assert R.build([{"id": "combined", "stats": st}], "combined", {}, SCENARIO) is None


# ---------------- 距離と詳細4行 ----------------


def test_距離の差():
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 0.0, 90))
    assert r["distance"] == {
        "baseline_m": 5000.0,
        "selected_m": 5346.0,
        "delta_m": 346.0,
        "delta_ratio": 0.0692,
        "baseline_min_80": 62.5,
        "selected_min_80": 66.8,
        "baseline_min_60": 83.3,
        "selected_min_60": 89.1,
    }


def test_詳細は4行固定():
    r = _build(_stats(5000, 1177.5, 100), _stats(5346, 108.5, 90))
    d = _flood(r)["detail"]
    assert list(d) == ["route", "risk", "compare", "condition"]
    assert d["route"] == "5.35km ・ 徒歩 約67分（平常時）/ 約89分（災害時60m/分）"
    assert d["risk"] == "浸水30cm超 109m（経路の2.0%）・未評価区間 0.0%"
    assert d["compare"] == "最短より +346m（+6.9%）。浸水30cm超 1,178m → 109m"
    assert d["condition"].startswith(
        "浸水深0.3m超（歩行困難ライン）を危険区間として集計。"
    )
    assert "想定図は全河川（想定最大）" in d["condition"]
    # 条件行には閾値を必ず出す。危険区間の閾値と、未評価の警告閾値の両方
    assert "警告閾値 20.0%" in d["condition"]
    # 「未評価」が何の外側なのかを名乗る
    assert "未評価区間＝想定区域図の整備対象流域の外" in d["condition"]


def test_地震の条件行は想定図を名乗らない():
    """浸水シナリオは地震の条件ではない"""
    r = _build(_stats(5000, 100, 1177.5), _stats(5346, 100, 108.5))
    q = next(h for h in r["hazards"] if h["id"] == "quake")
    assert "想定図" not in q["detail"]["condition"]
    assert "ランクは都内での相対評価" in q["detail"]["condition"]


def test_全種別が整備範囲の名前を持つ():
    """⚠️ 「この種別は全域だから scope は要らない」としないこと。
    地震も島嶼部・非市街化区域は調査対象外で、全域整備ではない"""
    for hid in registry.ids():
        spec = registry.risk(hid)
        if spec is None:
            continue
        assert isinstance(spec["scope"], str) and spec["scope"], hid
    assert (
        registry.risk("quake")["scope"] == "地域危険度測定調査の対象区域（市街化区域）"
    )
    assert registry.risk("flood")["scope"] == "想定区域図の整備対象流域"


def test_閾値ラベルが実際の閾値と揃っている():
    """DEPTH_THRESHOLD を変えたらラベルも直す。文言だけ古くなるのを防ぐ"""
    assert DEPTH_THRESHOLD == 0.30
    spec = registry.risk("flood")
    assert "0.3m" in spec["threshold_label"]
    assert "30cm" in spec["label"]


# ---------------- 実レスポンス ----------------


def test_searchの応答にrationaleが乗る():
    from app.services.evac_routes import search as search_svc

    try:
        got = search_svc.search(
            {"lat": 35.7497, "lon": 139.8050},
            {"lat": 35.7141, "lon": 139.7774},
            hazards={"flood": "envelope", "quake": "total"},
            include=["baseline", "selected"],
            with_segments=False,
        )
    except search_svc.NotGenerated as e:
        pytest.skip(f"グラフNPZが無い: {e}")

    r = got["rationale"]
    assert r["baseline_route"] == "baseline"
    assert r["selected_route"] == got["selected_route"] == "combined"
    # baseline は距離最小なので、遠回りぶんは 0 以上にしかならない
    assert r["distance"]["delta_m"] >= 0
    assert {h["id"] for h in r["hazards"]} == {"flood", "quake"}
    for h in r["hazards"]:
        assert h["verdict"] in R.VERDICTS
        assert h["text"]
        assert list(h["detail"]) == ["route", "risk", "compare", "condition"]


def test_最短だけならrationaleはnull():
    from app.services.evac_routes import search as search_svc

    try:
        got = search_svc.search(
            {"lat": 35.7497, "lon": 139.8050},
            {"lat": 35.7141, "lon": 139.7774},
            hazards={},
            include=["baseline", "selected"],
            with_segments=False,
        )
    except search_svc.NotGenerated as e:
        pytest.skip(f"グラフNPZが無い: {e}")

    assert got["rationale"] is None
