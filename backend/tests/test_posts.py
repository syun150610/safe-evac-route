import httpx
import pytest

from app.repositories.posts import PostsRepository


class RecordingD1Client:
    def __init__(self) -> None:
        self.requests: list[tuple[str, dict]] = []

    async def post(self, path: str, body: dict) -> httpx.Response:
        self.requests.append((path, body))
        return httpx.Response(200, json={"results": []})


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
async def test_nearby_sort_places_posts_without_location_last() -> None:
    d1_client = RecordingD1Client()
    repository = PostsRepository(d1_client)

    await repository.list_posts(
        limit=10,
        offset=0,
        sort="nearby",
        latitude=35.68,
        longitude=139.76,
        user_id="user-1",
    )

    _, request = d1_client.requests[0]
    null_location_last = (
        "CASE WHEN p.latitude IS NULL OR p.longitude IS NULL THEN 1 ELSE 0 END ASC"
    )
    assert null_location_last in request["sql"]
