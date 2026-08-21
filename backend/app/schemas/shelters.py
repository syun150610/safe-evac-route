"""避難所APIのスキーマ（ドキュメント用）。

レスポンスは GeoJSON FeatureCollection をそのまま返す。
"""

from typing import Any, Literal

from pydantic import BaseModel


class ShelterProperties(BaseModel):
    id: str
    name: str
    type: Literal["urgent", "designated"]
    type_label: str
    address: str
    municipality: str
    hazard_types: list[str]


class ShelterFeature(BaseModel):
    type: Literal["Feature"]
    geometry: dict[str, Any]
    properties: ShelterProperties


class ShelterCollection(BaseModel):
    """GET /api/shelters"""

    type: Literal["FeatureCollection"]
    features: list[ShelterFeature]
    meta: dict[str, int]
