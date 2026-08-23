"""避難先探索（POST /api/evac-routes/search/shelter）のテスト。

⚠️ **本番と同じNPZを読む。** 避難先の選び方は「どのグラフか」で変わるので、
小さいダミーグラフで代用すると、確かめたいこと（実距離とハザードコストの
兼ね合い）が確かめられない。

期待値は実測から取った固定値ではなく、**満たすべき性質**で書く。
係数（`flood/cost.py`）も迂回上限（`shelter_search.DETOUR_RATIO`）も仮の値で、
調整が入るたびに固定値は落ちるが、性質は落ちてはいけない。
"""

import math
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services.evac_routes import search as route_search  # noqa: E402
from app.services.evac_routes import shelter_search as SS  # noqa: E402
from app.services.shelters import loader  # noqa: E402
from prep.route_search import csr_search as CS  # noqa: E402

client = TestClient(app)

# 出発地。**どれも23区＋多摩の市街化区域の中**（対象エリア外は別のテスト）
KITASENJU = {"lat": 35.7497, "lon": 139.8050, "label": "北千住"}
UENO = {"lat": 35.7141, "lon": 139.7774, "label": "上野"}
# 荒川と中川に挟まれ、近くの避難場所がどれも浸水想定内にある。
# 「近所では回避できない」が正しい答えになる場所
HIRAI = {"lat": 35.7069, "lon": 139.8455, "label": "江戸川区平井"}

# 指定緊急避難場所が河川敷・公園に集中し、近いのは指定避難所ばかりの市
CHOFU = {"lat": 35.6521, "lon": 139.5446, "label": "調布駅"}

FLOOD = {"flood": "envelope"}
QUAKE = {"quake": "total"}


@pytest.fixture(scope="module")
def graph():
    return route_search._graph("envelope")


# ---------------- まとめてスナップする側 ----------------


def test_snap_many_matches_nearest_node(graph):
    """⚠️ 緯度の帯で絞っても**総当たりと同じノード**を返すこと。

    ここがずれると、候補一覧に出した避難所と実際に経路を引く先が
    静かに食い違う。
    """
    g = graph.csr
    features = loader.eligible(("flood",), "urgent")[:120]
    lats = [f["geometry"]["coordinates"][1] for f in features]
    lons = [f["geometry"]["coordinates"][0] for f in features]

    for (node_id, snap_m), lat, lon in zip(
        CS.snap_many(g, lats, lons), lats, lons, strict=True
    ):
        assert node_id == CS.nearest_node(g, lat, lon)
        assert snap_m == pytest.approx(CS.snap_m(g, node_id, lat, lon), abs=1e-6)


# ---------------- 目的地を決めないダイクストラ ----------------


def test_nearest_targets_agrees_with_point_to_point(graph):
    """打ち切って返した経路が、その1点だけを目的地にした探索と一致すること。

    ダイクストラは確定した順がコスト昇順なので、途中で止めても
    確定済みノードの前任者は変わらない。**その前提を機械で押さえる。**
    """
    g = graph.csr
    o = CS.nearest_node(g, KITASENJU["lat"], KITASENJU["lon"])
    features = loader.eligible(("flood",), "urgent")[:200]
    snapped = CS.snap_many(
        g,
        [f["geometry"]["coordinates"][1] for f in features],
        [f["geometry"]["coordinates"][0] for f in features],
    )
    targets = {n for n, _ in snapped if n is not None and n != o}

    found = CS.nearest_targets(g, o, targets, ("flood",), k=5)
    assert found, "北千住の近くに到達できる避難場所が1件も無いのはおかしい"

    costs = [c for _n, c, _p in found]
    assert costs == sorted(costs)
    for node_id, _cost, path in found:
        assert path == CS.shortest_path(g, o, node_id, ("flood",))


def test_nearest_targets_returns_empty_when_unreachable(graph):
    """到達できない目的地しか無ければ空。**例外にはしない。**"""
    g = graph.csr
    o = CS.nearest_node(g, KITASENJU["lat"], KITASENJU["lon"])
    # 八王子のノードを北千住から探す。徒歩グラフでは繋がっているが、
    # settled の上限で必ず打ち切られる距離にある
    far = CS.nearest_node(g, 35.6558, 139.3389)
    assert CS.nearest_targets(g, o, [far], ("flood",), k=1, max_settled=500) == []


# ---------------- 避難先の絞り込み ----------------


def test_eligible_keeps_designated_shelters():
    """⚠️ **指定避難所を災害種別で落とさない**（2026-08-23に変更）。

    元データに種別の欄が無いので、絞ると1件も残らない。落としていた頃は、
    調布駅のように近い9件がすべて指定避難所の場所で、1.4km先の河川敷まで
    案内していた。無作為400地点の65%で指定避難所の方が近い。
    """
    both = loader.eligible(("flood",))
    kinds = {f["properties"]["type"] for f in both}
    assert kinds == {"urgent", "designated"}

    # 指定緊急避難場所は種別が一致するものだけ
    urgent = [f for f in both if f["properties"]["type"] == "urgent"]
    assert urgent
    assert all("flood" in f["properties"]["hazard_types"] for f in urgent)

    # 指定避難所は絞らずに全部残る
    designated = [f for f in both if f["properties"]["type"] == "designated"]
    assert len(designated) == len(loader.eligible((), "designated"))


def test_hazard_match_says_registered_not_safe():
    """⚠️ False は「対応していない」ではなく「登録が無い」。"""
    urgent = next(
        f["properties"]
        for f in loader.eligible(("flood",))
        if f["properties"]["type"] == "urgent"
    )
    designated = next(
        f["properties"]
        for f in loader.eligible(("flood",))
        if f["properties"]["type"] == "designated"
    )
    assert loader.hazard_match(urgent, ("flood",)) is True
    assert loader.hazard_match(designated, ("flood",)) is False
    # 災害を選んでいなければ、そもそも問わない
    assert loader.hazard_match(designated, ()) is True


# ---------------- 推奨の決め方 ----------------


def test_recommends_a_calm_route_over_a_nearer_dangerous_one():
    """⚠️ **危険区間だらけの経路は、近くても推奨しない。**

    北千住には308mの避難先があるが、そこへの経路は7割超が浸水30cm超になる。
    掛け合わせのコストが最小でも「そこへ向かえ」とは言えない。
    """
    r = SS.search(KITASENJU, hazards=FLOOD, shelter_type="designated")
    q = r["shelter_query"]
    chosen = r["shelter_candidates"][0]

    assert chosen["id"] == r["shelter"]["id"]
    assert chosen["within_limit"]
    assert chosen["danger_ratio"] <= q["danger_ratio_limit"]
    assert q["all_candidates_dangerous"] is False

    # 足切りされた側が一覧に残っていること（隠さない）
    dangerous = [
        c
        for c in r["shelter_candidates"]
        if c["danger_ratio"] > q["danger_ratio_limit"]
    ]
    assert dangerous, "危険な候補が1件も無いと、この地点では検証にならない"
    # そのうち少なくとも1件は、推奨より近い（＝近さでは勝っている）
    assert any(
        c["stats"]["distance_m"] < chosen["stats"]["distance_m"] for c in dangerous
    )


def test_recommends_a_near_designated_shelter():
    """指定避難所を選べば、近い学校が推奨される。

    調布市は指定緊急避難場所を河川敷・公園など10件しか登録しておらず、
    学校32件は指定避難所。指定緊急避難場所だけだと1.4km先の多摩川河川敷になる。
    """
    r = SS.search(CHOFU, hazards=QUAKE, shelter_type="designated")
    chosen = r["shelter_candidates"][0]
    assert chosen["id"] == r["shelter"]["id"]
    assert chosen["stats"]["distance_m"] < 1000
    # 種別の登録が無い施設を推しているので、それが応答から分かること
    assert chosen["hazard_match"] is False
    assert r["shelter_query"]["without_hazard_match"] > 0


def test_keeps_hazard_matched_shelters_in_the_list():
    """⚠️ **両方を混ぜたとき**、自治体がその災害向けに指定した避難場所を消さない。

    指定避難所は数が多く近いので、放っておくと上位を占めてしまう。
    推奨にはしなくても、「この災害向けの指定はここ」は見せ続ける。
    """
    r = SS.search(CHOFU, hazards=QUAKE, shelter_type="all")
    matched = [c for c in r["shelter_candidates"] if c["hazard_match"]]
    assert matched, "種別が一致する避難先が一覧から消えている"
    assert all(c["type"] == "urgent" for c in matched)


def test_says_so_when_every_candidate_is_dangerous():
    """⚠️ **「近所に安全な避難先がある」と言わせない。**

    平井は周囲一帯が浸水想定区域内で、どの避難先への経路も危険区間だらけ。
    そのときは候補を空にせず（＝行き先は示す）、「どれも危ない」ことを
    応答で伝える。
    """
    r = SS.search(HIRAI, hazards=FLOOD, shelter_type="designated")
    q = r["shelter_query"]

    assert q["all_candidates_dangerous"] is True
    chosen = r["shelter_candidates"][0]
    assert chosen["id"] == r["shelter"]["id"]
    # 全部超えているので、推奨も閾値を超えたまま。**それを隠さない**
    assert chosen["danger_ratio"] > q["danger_ratio_limit"]
    # それでも、より危険な候補よりはましなものを選んでいる
    assert chosen["danger_ratio"] < max(
        c["danger_ratio"] for c in r["shelter_candidates"]
    )


def test_no_hazard_returns_the_nearest_shelter():
    """種別を選んでいなければ、単純に一番近い避難先。

    比較対象が無いので `rationale` は付かない（2点探索と同じ規則）。
    """
    r = SS.search(UENO, hazards={})
    rows = r["shelter_candidates"]
    assert r["rationale"] is None
    assert r["shelter_query"]["fell_back_to_nearest"] is False
    assert all(c["basis"] == "length" for c in rows)
    assert rows[0]["stats"]["distance_m"] == min(c["stats"]["distance_m"] for c in rows)


def test_candidates_carry_unevaluated_ratio():
    """⚠️ 危険区間0mでも未評価区間は別途示す。「安全」と「判断材料が無い」は別物。

    平井を神田川シナリオで測ると、経路の全区間がその想定図の整備対象流域の
    外になる。**危険区間0%で「安全」と見せてはいけない**のがまさにこの形。
    """
    r = SS.search(HIRAI, hazards={"flood": "kandagawa"}, shelter_type="designated")
    for c in r["shelter_candidates"]:
        assert "out_of_coverage_ratio" in c["stats"]
    assert max(c["stats"]["out_of_coverage_ratio"] for c in r["shelter_candidates"]) > 0


def test_limit_bounds_the_number_of_candidates():
    small = SS.search(UENO, hazards=FLOOD, limit=2)
    # ①と②で最大 limit 件ずつ見つかるので、上限は 2 × limit
    assert 1 <= len(small["shelter_candidates"]) <= 4


# ---------------- 2点探索と同じ形であること ----------------


def test_response_has_the_same_shape_as_two_point_search():
    """⚠️ **フロントの表示コードを1本化するための契約。**

    `routes[]` / `geojson` / `rationale` は2点探索と同じ組み立てで、
    増えるのは `shelter*` の3キーだけ。
    """
    shelter = SS.search(KITASENJU, hazards=FLOOD)
    dest = shelter["shelter"]["latlon"]
    two_point = route_search.search(
        KITASENJU, {"lat": dest[0], "lon": dest[1]}, hazards=FLOOD
    )

    added = set(shelter) - set(two_point)
    assert added == {"shelter", "shelter_candidates", "shelter_query"}
    # 同じ目的地なので経路そのものも一致する
    assert shelter["routes"] == two_point["routes"]
    assert shelter["od"]["dest"]["node"] == shelter["shelter"]["node"]
    # 目的地の表示名は避難所の名前になっている（「35.7…, 139.8…」ではない）
    assert shelter["od"]["dest"]["display"] == shelter["shelter"]["name"]


# ---------------- API ----------------


def test_api_returns_a_route_to_a_shelter():
    r = client.post(
        "/api/evac-routes/search/shelter",
        json={"origin": KITASENJU, "hazards": FLOOD},
    )
    assert r.status_code == 200
    body = r.json()
    # ⚠️ 種別は絞らない（指定避難所も候補）。代わりに「その災害への登録が
    #    あるか」を必ず載せる
    assert body["shelter"]["type"] in ("urgent", "designated")
    assert isinstance(body["shelter"]["hazard_match"], bool)
    assert body["geojson"]["features"]
    assert body["shelter_candidates"][0]["id"] == body["shelter"]["id"]


def test_api_rejects_a_point_outside_the_area():
    """⚠️ 出発地しか受け取らないので、"dest" が範囲外だとは言わないこと。"""
    r = client.post(
        "/api/evac-routes/search/shelter",
        json={"origin": {"lat": 34.6937, "lon": 135.5023}, "hazards": FLOOD},
    )
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["error"] == "out_of_area"
    assert detail["which"] == ["origin"]


def test_api_rejects_an_unknown_hazard():
    r = client.post(
        "/api/evac-routes/search/shelter",
        json={"origin": KITASENJU, "hazards": {"tsunami": "total"}},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad_request"


def test_api_reports_no_shelter_separately_from_out_of_area(monkeypatch):
    """該当する避難先が無いことは、エリア外とは別のコードで返す。"""
    monkeypatch.setattr(SS, "_pool", lambda *a, **kw: [])
    r = client.post(
        "/api/evac-routes/search/shelter",
        json={"origin": KITASENJU, "hazards": FLOOD},
    )
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "no_shelter"


def test_api_validates_limit():
    r = client.post(
        "/api/evac-routes/search/shelter",
        json={"origin": KITASENJU, "hazards": FLOOD, "limit": 99},
    )
    # FastAPI のバリデーションエラー。**detail は配列**（`detail.error` は無い）
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)


def test_two_point_search_still_requires_dest():
    """`SearchRequest` は `ShelterSearchRequest` を継承しても dest 必須のまま。"""
    r = client.post(
        "/api/evac-routes/search", json={"origin": KITASENJU, "hazards": FLOOD}
    )
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)


def test_distance_helper_is_symmetric():
    a = SS._distance_m(35.7, 139.8, 35.71, 139.81)
    b = SS._distance_m(35.71, 139.81, 35.7, 139.8)
    assert a == pytest.approx(b, rel=1e-3)
    assert math.isclose(SS._distance_m(35.7, 139.8, 35.7, 139.8), 0.0)


def test_recommended_stats_match_the_route_that_is_returned():
    """⚠️ **おすすめの数字と、実際に返す経路の数字を食い違わせない。**

    候補の `stats` は候補選びに使った探索のものなので、最短へ戻したときは
    最短側の数字が残る。そのまま見せると、画面の「おすすめ」と経路比較・根拠が
    別の数字を出すことになる（実測で 1.94km/11.8% と 1.95km/9.2%）。
    """
    for origin in (KITASENJU, HIRAI, UENO):
        r = SS.search(origin, hazards=FLOOD)
        selected = next(x for x in r["routes"] if x["id"] == r["selected_route"])
        chosen = next(
            c for c in r["shelter_candidates"] if c["id"] == r["shelter"]["id"]
        )
        assert chosen["stats"] == selected["stats"], origin["label"]


def test_searches_one_type_at_a_time():
    """⚠️ **役割が違うので、既定では混ぜない。**

    まず逃げ込むのが指定緊急避難場所、そのあと生活するのが指定避難所。
    混ぜて探すと、逃げ込む先を探しているのに滞在用の施設が推奨されうる。
    """
    urgent = SS.search(CHOFU, hazards=QUAKE, shelter_type="urgent")
    assert {c["type"] for c in urgent["shelter_candidates"]} == {"urgent"}
    assert urgent["shelter"]["type"] == "urgent"

    designated = SS.search(CHOFU, hazards=QUAKE, shelter_type="designated")
    assert {c["type"] for c in designated["shelter_candidates"]} == {"designated"}

    # 既定は「まず逃げ込む先」
    assert SS.search(CHOFU, hazards=QUAKE)["shelter"]["type"] == "urgent"


def test_does_not_mix_in_other_type_when_one_is_chosen():
    """⚠️ 片方を選んでいるのに、もう片方を混ぜ返さないこと。

    「両方」のときだけ、種別が一致する避難先を一覧へ足す。
    """
    r = SS.search(CHOFU, hazards=QUAKE, shelter_type="designated")
    assert all(c["type"] == "designated" for c in r["shelter_candidates"])
    # 指定避難所は災害種別の登録が無いので、一致は必ず False
    assert all(c["hazard_match"] is False for c in r["shelter_candidates"])


def test_api_accepts_shelter_type():
    for kind in ("urgent", "designated", "all"):
        r = client.post(
            "/api/evac-routes/search/shelter",
            json={"origin": CHOFU, "hazards": QUAKE, "shelter_type": kind},
        )
        assert r.status_code == 200, kind
        assert r.json()["shelter_query"]["type"] == kind


def test_api_rejects_an_unknown_shelter_type():
    r = client.post(
        "/api/evac-routes/search/shelter",
        json={"origin": CHOFU, "hazards": QUAKE, "shelter_type": "school"},
    )
    # FastAPI のバリデーションエラー。**detail は配列**
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)
