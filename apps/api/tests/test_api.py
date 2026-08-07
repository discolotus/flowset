from pathlib import Path

from fastapi.testclient import TestClient

from playlist_optimizer.analysis_progress import get_analysis_progress_registry
from playlist_optimizer.api.router import _is_loopback_host
from playlist_optimizer.config import Settings, get_settings
from playlist_optimizer.main import app
from playlist_optimizer.models import Track
from playlist_optimizer.providers import get_audio_feature_provider_registry

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


def test_audio_feature_provider_options_are_exposed() -> None:
    response = client.get("/api/v1/audio-features/providers")

    assert response.status_code == 200
    providers = {provider["id"]: provider for provider in response.json()["providers"]}
    assert set(providers) == {"essentia", "reccobeats"}
    assert providers["reccobeats"]["status"] == "available"
    assert providers["reccobeats"]["requires_local_audio"] is False
    assert providers["essentia"]["requires_local_audio"] is True


def test_audio_feature_progress_endpoint_returns_token_scoped_snapshot() -> None:
    track = client.get("/api/v1/demo/playlists").json()[0]["tracks"][0]
    parsed_track = Track.model_validate(track)
    registry = get_analysis_progress_registry()
    registry.clear()
    try:
        reporter = registry.begin(
            "endpoint-progress-token",
            "essentia",
            [parsed_track],
        )
        reporter.track_started(parsed_track)
        reporter.stage_started("native_dsp")

        response = client.get("/api/v1/audio-features/progress/endpoint-progress-token")
    finally:
        registry.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["progress_token"] == "endpoint-progress-token"
    assert body["phase"] == "native_dsp"
    assert body["completed_track_count"] == 0
    assert body["total_track_count"] == 1
    assert body["current_track"] == {
        "track_id": parsed_track.id,
        "track_name": parsed_track.name,
        "duration_ms": parsed_track.duration_ms,
    }
    assert body["tracks"][0]["stages"]["native_dsp"]["state"] == "active"


def test_audio_feature_progress_tokens_are_validated_and_unknown_tokens_are_404() -> None:
    invalid_get = client.get("/api/v1/audio-features/progress/short")
    playlist = client.get("/api/v1/demo/playlists").json()[0]
    invalid_resolve = client.post(
        "/api/v1/audio-features/resolve",
        json={
            "provider": "essentia",
            "tracks": playlist["tracks"][:1],
            "progress_token": "short",
        },
    )
    missing = client.get("/api/v1/audio-features/progress/unknown-progress-token")

    assert invalid_get.status_code == 422
    assert invalid_resolve.status_code == 422
    assert missing.status_code == 404


def test_local_library_access_recognizes_only_loopback_addresses() -> None:
    assert _is_loopback_host("127.0.0.1") is True
    assert _is_loopback_host("::1") is True
    assert _is_loopback_host("192.168.1.20") is False
    assert _is_loopback_host("example.com") is False


def test_local_library_folder_endpoint_lists_subfolders(tmp_path: Path) -> None:
    music_root = tmp_path / "Music"
    playlist_folder = music_root / "Sets" / "Warmup"
    playlist_folder.mkdir(parents=True)
    (playlist_folder / "track.mp3").write_bytes(b"track")
    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=music_root,
        _env_file=None,
    )
    try:
        response = client.get("/api/v1/local-library/folders", params={"path": "Sets"})
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200
    assert response.json() == {
        "root_name": "Music",
        "current_path": "Sets",
        "current_name": "Sets",
        "parent_path": "",
        "folders": [
            {
                "path": "Sets/Warmup",
                "name": "Warmup",
            }
        ],
    }


def test_local_playlist_discovery_endpoint_finds_nested_m3u_files(tmp_path: Path) -> None:
    music_root = tmp_path / "Music"
    playlist_folder = music_root / "Playlists" / "Archived" / "2025"
    playlist_folder.mkdir(parents=True)
    (music_root / "Playlists" / "Current.m3u").write_text("track.mp3\n", encoding="utf-8")
    (playlist_folder / "Closing Set.m3u8").write_text("#EXTM3U\n", encoding="utf-8")
    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=music_root,
        _env_file=None,
    )
    try:
        response = client.get(
            "/api/v1/local-library/playlists",
            params={"path": "Playlists"},
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 200
    assert response.json() == {
        "root_name": "Music",
        "search_path": "Playlists",
        "search_name": "Playlists",
        "playlists": [
            {
                "path": "Playlists/Archived/2025/Closing Set.m3u8",
                "name": "Closing Set",
                "source_kind": "m3u8",
            },
            {
                "path": "Playlists/Current.m3u",
                "name": "Current",
                "source_kind": "m3u",
            },
        ],
    }


def test_selecting_a_local_library_root_updates_subsequent_requests(
    tmp_path: Path, monkeypatch
) -> None:
    selected_root = tmp_path / "Selected Music"
    (selected_root / "Warmup").mkdir(parents=True)
    monkeypatch.delenv("ESSENTIA_AUDIO_ROOT", raising=False)
    get_settings.cache_clear()
    get_audio_feature_provider_registry.cache_clear()
    try:
        response = client.post(
            "/api/v1/local-library/root",
            json={"path": str(selected_root)},
        )
        subsequent = client.get("/api/v1/local-library/folders")
    finally:
        get_settings.cache_clear()
        get_audio_feature_provider_registry.cache_clear()

    assert response.status_code == 200
    assert response.json()["current_name"] == "Selected Music"
    assert [folder["name"] for folder in response.json()["folders"]] == ["Warmup"]
    assert subsequent.status_code == 200
    assert subsequent.json()["root_name"] == "Selected Music"


def test_local_audio_preview_streams_byte_ranges_from_the_selected_root(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    track = music_root / "Sets" / "preview.mp3"
    track.parent.mkdir(parents=True)
    track.write_bytes(b"0123456789")
    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=music_root,
        _env_file=None,
    )
    try:
        response = client.get(
            "/api/v1/local-library/audio",
            params={"path": "Sets/preview.mp3"},
            headers={"Range": "bytes=2-5"},
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 206
    assert response.content == b"2345"
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-type"].startswith("audio/mpeg")
    assert response.headers["cache-control"] == "private, no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_local_audio_preview_uses_media_types_for_extended_export_formats(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    music_root.mkdir()
    expected = {
        "source.dff": "audio/x-dff",
        "source.opus": "audio/ogg",
        "source.wma": "audio/x-ms-wma",
        "source.wv": "audio/x-wavpack",
    }
    for filename in expected:
        (music_root / filename).write_bytes(b"audio")
    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=music_root,
        _env_file=None,
    )
    try:
        responses = {
            filename: client.get("/api/v1/local-library/audio", params={"path": filename})
            for filename in expected
        }
    finally:
        app.dependency_overrides.pop(get_settings, None)

    for filename, media_type in expected.items():
        assert responses[filename].status_code == 200
        assert responses[filename].headers["content-type"].startswith(media_type)


def test_local_audio_preview_rejects_paths_outside_the_selected_root(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    music_root.mkdir()
    outside = tmp_path / "outside.mp3"
    outside.write_bytes(b"outside")
    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=music_root,
        _env_file=None,
    )
    try:
        response = client.get(
            "/api/v1/local-library/audio",
            params={"path": "../outside.mp3"},
        )
    finally:
        app.dependency_overrides.pop(get_settings, None)

    assert response.status_code == 400
    assert "escapes" in response.json()["detail"]


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


def test_recipe_preview_route_accepts_a_factorial_split_grid() -> None:
    playlist = client.get("/api/v1/demo/playlists").json()[0]
    payload = {
        "name": "Demo factor grid",
        "input_playlists": [playlist],
        "split_factors": [
            {"parameter": "energy", "bin_count": 2},
            {"parameter": "danceability", "bin_count": 2},
        ],
    }

    response = client.post("/api/v1/recipes/preview", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["factorial_combination_count"] == 4
    assert body["populated_combination_count"] + body["empty_combination_count"] == 4
    assert body["factor_unavailable_track_count"] == 0
    assert [item["parameter"] for item in body["split_distributions"]] == [
        "energy",
        "danceability",
    ]
    assert all(len(output["split_assignments"]) == 2 for output in body["outputs"])
    assert all(output["split_parameter"] is None for output in body["outputs"])
    assert sum(output["track_count"] for output in body["outputs"]) == len(playlist["tracks"])


def test_recipe_preview_route_rejects_more_than_three_split_factors() -> None:
    playlist = client.get("/api/v1/demo/playlists").json()[0]
    payload = {
        "input_playlists": [playlist],
        "split_factors": [
            {"parameter": "energy", "bin_count": 2},
            {"parameter": "danceability", "bin_count": 2},
            {"parameter": "tempo", "bin_count": 2},
            {"parameter": "valence", "bin_count": 2},
        ],
    }

    response = client.post("/api/v1/recipes/preview", json=payload)

    assert response.status_code == 422
