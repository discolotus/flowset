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


def test_demo_source_playlists_include_overlap_for_deduplication() -> None:
    response = client.get("/api/v1/demo/playlists")

    assert response.status_code == 200
    playlists = response.json()
    assert len(playlists) == 3
    all_ids = [track["id"] for playlist in playlists for track in playlist["tracks"]]
    assert len(all_ids) == 14
    assert len(set(all_ids)) == 12


def test_recipe_preview_route_returns_track_lists_and_group_ranges() -> None:
    playlists = client.get("/api/v1/demo/playlists").json()[:2]
    payload = {
        "name": "Demo levels",
        "input_playlists": playlists,
        "distribution_parameter": "energy",
        "distribution_bin_count": 3,
        "split": {"parameter": "energy", "bin_count": 2},
        "subgroup": {"parameter": "danceability", "bin_count": 2},
        "sort": {"parameter": "tempo", "direction": "asc"},
    }

    response = client.post("/api/v1/recipes/preview", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["input_track_count"] == 12
    assert body["deduplicated_track_count"] == 10
    assert sum(output["track_count"] for output in body["outputs"]) == 10
    assert all("tracks" in output for output in body["outputs"])
    assert all(
        group["range"] is not None for output in body["outputs"] for group in output["groups"]
    )
