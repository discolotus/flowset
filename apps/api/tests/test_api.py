from fastapi.testclient import TestClient

from playlist_optimizer.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_demo_playlist_has_analyzed_tracks() -> None:
    response = client.get("/api/v1/demo")

    assert response.status_code == 200
    body = response.json()
    assert len(body["tracks"]) == 12
    assert body["summary"]["average_energy"] is not None
