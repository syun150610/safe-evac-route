"""下水道局・建設局のruntime成果物を設定1つで揃えて選べることを確認する。"""

import json
import os

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import PROFILE_DIRS, RUNTIME_SCOPE_DIR, Settings, get_settings
from app.main import app
from app.services.evac_routes import search as route_search

client = TestClient(app)


@pytest.mark.parametrize("profile", ["gesuido", "kensetsu"])
def test_profile_selects_matching_bundles_graphs_and_tiles(monkeypatch, profile):
    monkeypatch.setenv("HAZARD_DATA_PROFILE", profile)
    get_settings.cache_clear()
    route_search._graphs.clear()

    settings = get_settings()
    expected_suffix = os.path.join(PROFILE_DIRS[profile], RUNTIME_SCOPE_DIR)
    assert settings.active_bundles_dir.endswith(expected_suffix)
    assert settings.active_graph_dir.endswith(expected_suffix)

    with open(os.path.join(settings.active_bundles_dir, "index.json"), "rb") as f:
        expected_index = f.read()
    presets = client.get("/api/evac-routes/presets")
    assert presets.content == expected_index
    assert presets.headers["x-hazard-data-profile"] == profile

    hazards = client.get("/api/hazards").json()
    assert hazards["data_profile"] == profile
    assert hazards["data_profile_id"] == PROFILE_DIRS[profile]
    flood = next(h for h in hazards["hazards"] if h["id"] == "flood")
    assert all(f"/tiles/flood/{profile}/" in s["tile_url"] for s in flood["scenarios"])

    area = client.get("/api/evac-routes/area").json()
    assert area["data_profile"] == profile
    assert f"graph/{PROFILE_DIRS[profile]}/{RUNTIME_SCOPE_DIR}/" in area["graph"]


def test_unknown_profile_is_rejected():
    with pytest.raises(ValidationError):
        Settings(hazard_data_profile="unknown")


def test_profiles_have_distinct_envelope_bundles():
    bundles = {}
    for profile in PROFILE_DIRS:
        settings = Settings(hazard_data_profile=profile)
        with open(
            os.path.join(settings.active_bundles_dir, "envelope", "od01.json"),
            encoding="utf-8",
        ) as f:
            bundles[profile] = json.load(f)

    assert bundles["gesuido"]["routes"] != bundles["kensetsu"]["routes"]
