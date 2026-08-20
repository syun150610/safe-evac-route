"""GET /api/shelters のテスト。"""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services.shelters.loader import _all_features  # noqa: E402

client = TestClient(app)


@pytest.fixture(autouse=True)
def clear_cache():
    """lru_cache をテスト間でリセットする。"""
    _all_features.cache_clear()
    yield
    _all_features.cache_clear()


def test_shelters_returns_geojson():
    r = client.get("/api/shelters")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    assert isinstance(body["features"], list)
    assert len(body["features"]) > 0
    assert "meta" in body
    assert body["meta"]["total"] == len(body["features"])


def test_shelters_bbox_filter():
    # 北千住↔上野エリアで絞り込む
    bbox = "139.766,35.705,139.816,35.759"
    r = client.get(f"/api/shelters?bbox={bbox}")
    assert r.status_code == 200
    body = r.json()
    # 全件より少ない
    total_r = client.get("/api/shelters")
    assert body["meta"]["total"] < total_r.json()["meta"]["total"]
    # bbox 内に収まっている
    for f in body["features"]:
        lon, lat = f["geometry"]["coordinates"]
        assert 139.766 <= lon <= 139.816
        assert 35.705 <= lat <= 35.759


def test_shelters_type_filter_urgent():
    r = client.get("/api/shelters?type=urgent")
    assert r.status_code == 200
    for f in r.json()["features"]:
        assert f["properties"]["type"] == "urgent"


def test_shelters_type_filter_designated():
    r = client.get("/api/shelters?type=designated")
    assert r.status_code == 200
    for f in r.json()["features"]:
        assert f["properties"]["type"] == "designated"


def test_shelters_invalid_bbox():
    r = client.get("/api/shelters?bbox=invalid")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad_request"


def test_shelters_invalid_type():
    r = client.get("/api/shelters?type=unknown")
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "bad_request"
