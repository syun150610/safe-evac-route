"""本番同梱NPZが読み込め、任意地点探索に使えることを確認する。

⚠️ 2026-08-21に探索範囲を 23区+多摩（市街化区域）へ切り替えたので、
形の期待値もその実測値（652,828ノード / 1,905,380エッジ）にしてある。
北千住→上野の統計値は現行スコープ時代と同じ（同じ道・同じデータのため）。

⚠️ profile は `kensetsu` だけを見る。`gesuido` には新スコープの成果物が無く、
旧世代へのロールバック手段が現状ない（`docs/dev/07_課題と作業計画.md` の負債）。
"""

import os

import numpy as np
import pytest

from app.core.config import get_settings
from app.services.evac_routes import search as route_search
from prep.route_search.npz_graph import load_graph_npz

GRAPH_NAMES = (
    "kitasenju_ueno_envelope",
    "kitasenju_ueno",
    "kitasenju_ueno_kandagawa",
)
PROFILES = ("kensetsu",)  # gesuido は新スコープの成果物が無い（上の注記）


def graph_path(name: str) -> str:
    return os.path.join(get_settings().active_graph_dir, f"{name}.npz")


@pytest.mark.parametrize("profile", PROFILES)
@pytest.mark.parametrize("name", GRAPH_NAMES)
def test_committed_npz_has_expected_shape_and_no_pickle(monkeypatch, profile, name):
    monkeypatch.setenv("HAZARD_DATA_PROFILE", profile)
    get_settings.cache_clear()
    path = graph_path(name)
    assert os.path.exists(path)
    with np.load(path, allow_pickle=False) as data:
        assert int(data["schema_version"][0]) == 1
        assert data["node_id"].shape == (652_828,)
        assert data["edge_u"].shape == (1_905_380,)
        assert all(array.dtype.kind != "O" for array in data.values())


@pytest.mark.parametrize(
    ("profile", "combined_distance_m"),
    [("kensetsu", 5791.5)],
)
def test_npz_rebuilds_graph_and_searches_route(
    monkeypatch, profile, combined_distance_m
):
    monkeypatch.setenv("HAZARD_DATA_PROFILE", profile)
    get_settings.cache_clear()
    graph = load_graph_npz(graph_path("kitasenju_ueno_envelope"))
    assert graph.number_of_nodes() == 652_828
    assert graph.number_of_edges() == 1_905_380

    route_search._graphs.clear()
    result = route_search.search(
        {"lat": 35.7497, "lon": 139.8050, "label": "北千住駅"},
        {"lat": 35.7141, "lon": 139.7774, "label": "上野駅"},
        hazards={"flood": "envelope", "quake": "total"},
        with_segments=False,
    )
    assert result["data_profile"] == profile
    assert result["selected_route"] == "combined"
    assert [route["id"] for route in result["routes"]] == ["baseline", "combined"]
    assert result["routes"][0]["stats"] == {
        "distance_m": 5445.9,
        "duration_min_80": 68.1,
        "duration_min_60": 90.8,
        "max_depth_m": 1.34,
        "ratio_over_03": 0.2162,
        "mean_depth_m": 0.269,
        "out_of_coverage_ratio": 0.0,
        "length_over_03_m": 1177.5,
        "n_edges": 170,
        "n_impassable_edges": 6,
        "quake_max_rank": 5,
        "quake_r4plus_ratio": 0.302,
        # 経路選択の根拠が「危険区間を{前}m → {後}m」と書くのに要る実距離。
        # ratio×distance（0.302 × 5445.9 = 1644.7m）と丸めの範囲で一致する
        "quake_r4plus_m": 1644.5,
        "quake_weighted_avg_rank": 2.765,
        "quake_out_of_coverage_ratio": 0.0,
    }
    assert result["routes"][1]["stats"]["distance_m"] == combined_distance_m
