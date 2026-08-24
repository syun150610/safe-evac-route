"""探索範囲を環境変数 `RUNTIME_SCOPE` で切り替えられることを確認する。

⚠️ **グラフのキャッシュキーに範囲が入っていることが要点。** 入っていないと、
範囲を切り替えても前の範囲のグラフが返る。しかも bbox（対象エリア判定）は
新しい範囲のものを見るので、「エリア内と言われたのに引けない」が起きる。
名前だけでは守れないので、実際に往復させてノード数で確かめる。

⚠️ 旧スコープのNPZは `kensetsu` profile ぶんだけリポジトリにある。
`gesuido` には新スコープの成果物が無い（`docs/dev/07_課題と作業計画.md` の P0-5）。
"""

import os

import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings, runtime_scope
from app.services.evac_routes import search as route_search
from prep.route_search import scopes

# 実測値。範囲が本当に切り替わったことは、名前ではなくこの形で判定する
SHAPES = {
    "tokyo-23ku-tama-shigaika": (652_828, 1_905_380),
    "kitasenju-ueno": (27_144, 82_586),
}


@pytest.fixture(autouse=True)
def _clean_settings():
    """設定のキャッシュだけ戻す。`_graphs` は**わざと残す**（キーの検証のため）。"""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_default_is_the_production_scope():
    assert scopes.DEFAULT_SCOPE_ID == "tokyo-23ku-tama-shigaika"
    assert runtime_scope().id == scopes.DEFAULT_SCOPE_ID


@pytest.mark.parametrize("scope_id", sorted(SHAPES))
def test_env_selects_directories_and_label(monkeypatch, scope_id):
    monkeypatch.setenv("RUNTIME_SCOPE", scope_id)
    get_settings.cache_clear()

    settings = get_settings()
    scope = scopes.get(scope_id)
    assert settings.runtime_scope == scope_id
    assert settings.scope is scope
    assert os.path.basename(settings.active_graph_dir) == scope.dir_name
    assert os.path.basename(settings.active_bundles_dir) == scope.dir_name
    # 利用者向けの呼び名も同じ出所から来る
    area = route_search.area("envelope")
    assert area["label"] == scope.label
    assert area["note"].count(scope.label) == 1


def test_unknown_scope_fails_at_startup(monkeypatch):
    """未知のIDは**設定を組み立てた時点で**落ちる。503まで持ち越さない。"""
    monkeypatch.setenv("RUNTIME_SCOPE", "no-such-scope")
    with pytest.raises((ValidationError, KeyError)):
        Settings()


def test_graph_cache_is_keyed_by_scope(monkeypatch):
    """範囲を往復させても、それぞれの範囲のグラフが返ること。

    ⚠️ `_graphs` を clear せずに往復する。キーに範囲が入っていなければ、
    2回目に1回目のグラフが返って落ちる。
    """
    route_search._graphs.clear()

    monkeypatch.delenv("RUNTIME_SCOPE", raising=False)
    get_settings.cache_clear()
    new_scope = route_search._graph("envelope")
    assert (new_scope.csr.n_nodes, new_scope.csr.n_edges) == SHAPES[
        "tokyo-23ku-tama-shigaika"
    ]

    monkeypatch.setenv("RUNTIME_SCOPE", "kitasenju-ueno")
    get_settings.cache_clear()
    old_scope = route_search._graph("envelope")
    assert (old_scope.csr.n_nodes, old_scope.csr.n_edges) == SHAPES["kitasenju-ueno"]
    assert old_scope is not new_scope

    # 戻したら、作り直さずに最初のグラフを再利用する
    monkeypatch.delenv("RUNTIME_SCOPE", raising=False)
    get_settings.cache_clear()
    assert route_search._graph("envelope") is new_scope

    assert set(route_search._graphs) == {
        ("kensetsu", "tokyo-23ku-tama-shigaika", "envelope"),
        ("kensetsu", "kitasenju-ueno", "envelope"),
    }
    route_search._graphs.clear()
