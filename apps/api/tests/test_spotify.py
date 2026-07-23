import json
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from playlist_optimizer.config import Settings
from playlist_optimizer.main import app
from playlist_optimizer.models import Track
from playlist_optimizer.spotify import (
    SpotifyBridgeError,
    SpotifyService,
    _numbered_playlist_name,
    get_spotify_service,
)
from playlist_optimizer.spotify_models import (
    SpotifyPlaylistCreateItem,
    SpotifyPlaylistsCreateRequest,
    SpotifyPlaylistTrackRequest,
)

CLIENT_ID = "A" * 32
IDEMPOTENCY_KEY = "11111111-1111-4111-8111-111111111111"


def _track(
    local_id: str,
    *,
    name: str = "Midnight Drive",
    artist: str = "Night Artist",
    album: str = "Neon Roads",
    duration_ms: int = 240_000,
    isrc: str | None = None,
    uri: str | None = None,
) -> Track:
    return Track(
        id=local_id,
        uri=uri,
        name=name,
        artist=artist,
        album=album,
        duration_ms=duration_ms,
        isrc=isrc,
    )


def _settings(**updates: object) -> Settings:
    values: dict[str, object] = {
        "spotify_client_id": CLIENT_ID,
        "spotify_max_retry_after_seconds": 2,
    }
    values.update(updates)
    return Settings(_env_file=None, **values)


def _spotify_track(
    spotify_id: str,
    *,
    name: str = "Midnight Drive",
    artist: str = "Night Artist",
    album: str = "Neon Roads",
    duration_ms: int = 240_000,
    isrc: str | None = None,
) -> dict[str, object]:
    return {
        "id": spotify_id,
        "uri": f"spotify:track:{spotify_id}",
        "name": name,
        "artists": [{"name": artist}],
        "album": {"name": album},
        "duration_ms": duration_ms,
        "external_ids": {"isrc": isrc} if isrc else {},
        "external_urls": {"spotify": f"https://open.spotify.com/track/{spotify_id}"},
    }


def _service(
    handler: Callable[[httpx.Request], httpx.Response], **settings: object
) -> SpotifyService:
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return SpotifyService(_settings(**settings), client=client, sleep=lambda _seconds: None)


def _authorize(service: SpotifyService) -> None:
    authorization = service.start_authorization()
    state = parse_qs(urlparse(authorization.authorization_url).query)["state"][0]
    service.complete_authorization(code="authorization-code", state=state, error=None)


def _empty_create_request(
    *, idempotency_key: str = IDEMPOTENCY_KEY, name: str = "Replay-safe"
) -> SpotifyPlaylistsCreateRequest:
    return SpotifyPlaylistsCreateRequest(
        idempotency_key=idempotency_key,
        playlists=[SpotifyPlaylistCreateItem(position=1, name=name, tracks=[])],
    )


def _token_response(
    request: httpx.Request, *, access_token: str = "access-token"
) -> httpx.Response:
    assert request.url.path == "/api/token"
    form = parse_qs(request.content.decode())
    assert "client_secret" not in form
    return httpx.Response(
        200,
        json={
            "access_token": access_token,
            "refresh_token": "refresh-token",
            "expires_in": 3600,
            "scope": ("playlist-modify-private playlist-modify-public playlist-read-private"),
        },
    )


def test_loopback_routes_configure_pkce_connect_and_disconnect_without_exposing_tokens() -> None:
    token_forms: list[dict[str, list[str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        token_forms.append(parse_qs(request.content.decode()))
        return _token_response(request, access_token="secret-access-token")

    service = SpotifyService(
        _settings(spotify_client_id=None),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _seconds: None,
    )
    app.dependency_overrides[get_spotify_service] = lambda: service
    client = TestClient(app)
    try:
        initial = client.get("/api/v1/spotify/status")
        configured = client.post("/api/v1/spotify/config", json={"client_id": CLIENT_ID})
        capabilities = client.get("/api/v1/capabilities")
        started = client.post("/api/v1/spotify/auth/start", json={})
        authorization_url = started.json()["authorization_url"]
        query = parse_qs(urlparse(authorization_url).query)
        callback = client.get(
            "/api/v1/spotify/auth/callback",
            params={"code": "authorization-code", "state": query["state"][0]},
        )
        connected = client.get("/api/v1/spotify/status")
        disconnected = client.post("/api/v1/spotify/disconnect")
    finally:
        app.dependency_overrides.pop(get_spotify_service, None)

    assert initial.json()["configured"] is False
    assert configured.json()["configured"] is True
    assert capabilities.json()["spotify_oauth_configured"] is True
    assert capabilities.json()["spotify_metadata"] == "pkce_playlist_matching_and_export_available"
    assert capabilities.json()["export"] == "local_and_spotify_export_available"
    assert started.status_code == 200
    assert urlparse(authorization_url).path == "/authorize"
    assert query["response_type"] == ["code"]
    assert query["code_challenge_method"] == ["S256"]
    assert 40 <= len(query["code_challenge"][0]) <= 128
    assert set(query["scope"][0].split()) == {
        "playlist-modify-private",
        "playlist-modify-public",
        "playlist-read-private",
    }
    assert callback.status_code == 200
    assert "Spotify is connected" in callback.text
    assert connected.json()["authenticated"] is True
    assert "secret-access-token" not in connected.text
    assert "refresh-token" not in connected.text
    assert disconnected.json()["authenticated"] is False
    assert token_forms[0]["client_id"] == [CLIENT_ID]
    assert token_forms[0]["grant_type"] == ["authorization_code"]
    assert 43 <= len(token_forms[0]["code_verifier"][0]) <= 128
    assert "client_secret" not in token_forms[0]


def test_callback_rejects_hostile_error_text_without_reflecting_it_into_html() -> None:
    service = _service(_token_response)
    app.dependency_overrides[get_spotify_service] = lambda: service
    client = TestClient(app)
    try:
        started = client.post("/api/v1/spotify/auth/start", json={}).json()
        state = parse_qs(urlparse(started["authorization_url"]).query)["state"][0]
        response = client.get(
            "/api/v1/spotify/auth/callback",
            params={"state": state, "error": '<script>alert("token")</script>'},
        )
    finally:
        app.dependency_overrides.pop(get_spotify_service, None)

    assert response.status_code == 400
    assert "<script>" not in response.text
    assert "token" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-security-policy"].startswith("default-src 'none'")


def test_matching_uses_existing_uri_then_isrc_and_metadata_fallback_without_drops() -> None:
    search_queries: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        query = request.url.params["q"]
        search_queries.append(query)
        assert request.url.path == "/v1/search"
        assert request.url.params["type"] == "track"
        assert request.url.params["limit"] == "10"
        if query.startswith("isrc:"):
            return httpx.Response(
                200,
                json={
                    "tracks": {
                        "items": [
                            _spotify_track(
                                "0000000000000000000002",
                                name="Wrong Song",
                                artist="Wrong Artist",
                                isrc="WRONG0000001",
                            )
                        ]
                    }
                },
            )
        if query.startswith('track:"Midnight Drive"'):
            return httpx.Response(
                200,
                json={
                    "tracks": {
                        "items": [
                            _spotify_track("0000000000000000000001", isrc="RIGHT0000001"),
                            _spotify_track(
                                "0000000000000000000003",
                                name="Midnight",
                                duration_ms=300_000,
                            ),
                        ]
                    }
                },
            )
        if query.startswith('track:"Missing Song"'):
            return httpx.Response(200, json={"tracks": {"items": []}})
        if query == 'track:"Untitled Local"':
            return httpx.Response(200, json={"tracks": {"items": []}})
        return httpx.Response(500, json={"error": {"message": "secret remote detail"}})

    service = _service(handler)
    _authorize(service)
    existing_id = "0000000000000000000009"
    response = service.match_tracks(
        [
            _track(
                "existing",
                uri=f"spotify:track:{existing_id}",
            ),
            _track("fallback", isrc="RIGHT0000001"),
            _track("missing", name="Missing Song"),
            _track(
                "unknown-metadata",
                name="Untitled Local",
                artist="Unknown artist",
                album="June 26",
            ),
            _track("error", name="Remote Error"),
        ]
    )

    assert [result.local_track_id for result in response.results] == [
        "existing",
        "fallback",
        "missing",
        "unknown-metadata",
        "error",
    ]
    assert [result.status for result in response.results] == [
        "matched",
        "matched",
        "not_found",
        "not_found",
        "error",
    ]
    assert response.results[0].candidates[0].spotify_id == existing_id
    assert response.results[1].candidates[0].spotify_id == "0000000000000000000001"
    assert response.results[1].candidates[0].signals.isrc == 1
    assert "isrc:RIGHT0000001" in response.results[1].query
    assert "Midnight Drive" in response.results[1].query
    assert response.results[4].error is not None
    assert "secret remote detail" not in response.results[4].error
    assert response.matched_count == 2
    assert response.not_found_count == 2
    assert response.error_count == 1
    assert search_queries == [
        "isrc:RIGHT0000001",
        'track:"Midnight Drive" artist:"Night Artist" album:"Neon Roads"',
        'track:"Missing Song" artist:"Night Artist" album:"Neon Roads"',
        'track:"Missing Song" artist:"Night Artist"',
        'track:"Missing Song"',
        'track:"Untitled Local"',
        'track:"Remote Error" artist:"Night Artist" album:"Neon Roads"',
    ]


def test_match_candidates_have_deterministic_tie_order_and_remain_ambiguous() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        return httpx.Response(
            200,
            json={
                "tracks": {
                    "items": [
                        _spotify_track("0000000000000000000002"),
                        _spotify_track("0000000000000000000001"),
                    ]
                }
            },
        )

    service = _service(handler)
    _authorize(service)
    result = service.match_tracks([_track("tie")]).results[0]

    assert result.status == "ambiguous"
    assert [candidate.spotify_id for candidate in result.candidates] == [
        "0000000000000000000001",
        "0000000000000000000002",
    ]


@pytest.mark.parametrize(
    ("local_name", "spotify_name"),
    [
        ("Pulse (Alice Remix)", "Pulse (Bob Remix)"),
        ("Pulse (Live)", "Pulse (Radio Edit)"),
        ("Pulse (2011 Remaster)", "Pulse (2015 Remaster)"),
    ],
)
def test_named_version_conflicts_never_auto_match(local_name: str, spotify_name: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        return httpx.Response(
            200,
            json={
                "tracks": {"items": [_spotify_track("0000000000000000000011", name=spotify_name)]}
            },
        )

    service = _service(handler)
    _authorize(service)
    result = service.match_tracks([_track("version", name=local_name)]).results[0]

    assert result.status == "ambiguous"
    assert result.candidates[0].signals.version == 0
    assert result.candidates[0].score <= 0.66
    assert result.candidates[0].confidence == "low"


def test_exact_isrc_can_override_a_version_label_conflict() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        return httpx.Response(
            200,
            json={
                "tracks": {
                    "items": [
                        _spotify_track(
                            "0000000000000000000012",
                            name="Pulse (Bob Remix)",
                            isrc="SAME00000001",
                        )
                    ]
                }
            },
        )

    service = _service(handler)
    _authorize(service)
    result = service.match_tracks(
        [_track("isrc-version", name="Pulse (Alice Remix)", isrc="SAME00000001")]
    ).results[0]

    assert result.status == "matched"
    assert result.candidates[0].signals.isrc == 1
    assert result.candidates[0].signals.version == 0
    assert result.candidates[0].score == 1


def test_api_refreshes_after_401_and_honors_bounded_retry_after() -> None:
    token_requests = 0
    search_requests = 0
    sleep_calls: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal token_requests, search_requests
        if request.url.host == "accounts.spotify.com":
            token_requests += 1
            form = parse_qs(request.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                assert form["client_id"] == [CLIENT_ID]
                assert "client_secret" not in form
                return _token_response(request, access_token="fresh-access-token")
            return _token_response(request, access_token="old-access-token")
        search_requests += 1
        authorization = request.headers["Authorization"]
        if authorization == "Bearer old-access-token":
            return httpx.Response(401, json={"error": {"message": "expired"}})
        if search_requests == 2:
            return httpx.Response(429, headers={"Retry-After": "99"})
        return httpx.Response(200, json={"tracks": {"items": []}})

    service = SpotifyService(
        _settings(),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=sleep_calls.append,
    )
    _authorize(service)
    result = service.match_tracks([_track("refresh")]).results[0]

    assert result.status == "not_found"
    assert token_requests == 2
    # The first structured query is retried after both 401 refresh and 429; the matcher then
    # broadens to track + artist and title-only because the successful response was empty.
    assert search_requests == 5
    assert sleep_calls == [2]
    assert "old-access-token" not in service.status().model_dump_json()
    assert "fresh-access-token" not in service.status().model_dump_json()


def test_rate_limit_retries_are_bounded_and_return_one_explicit_track_error() -> None:
    search_requests = 0
    sleep_calls: list[float] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal search_requests
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        search_requests += 1
        return httpx.Response(429, headers={"Retry-After": "999"})

    service = SpotifyService(
        _settings(spotify_max_rate_limit_retries=1),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=sleep_calls.append,
    )
    _authorize(service)
    response = service.match_tracks([_track("rate-limited")])

    assert search_requests == 2
    assert sleep_calls == [2]
    assert response.error_count == 1
    assert len(response.results) == 1
    assert response.results[0].status == "error"
    assert response.results[0].error is not None
    assert "rate-limited" in response.results[0].error


def test_status_refresh_failure_becomes_truthfully_disconnected_and_recoverable() -> None:
    clock = [datetime(2026, 7, 20, tzinfo=UTC)]
    refresh_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal refresh_requests
        form = parse_qs(request.content.decode())
        if form["grant_type"] == ["refresh_token"]:
            refresh_requests += 1
            return httpx.Response(400, json={"error": "invalid_grant"})
        response = _token_response(request)
        payload = response.json()
        payload["expires_in"] = 60
        return httpx.Response(200, json=payload)

    service = SpotifyService(
        _settings(),
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _seconds: None,
        now=lambda: clock[0],
    )
    _authorize(service)
    assert service.status().authenticated is True

    clock[0] += timedelta(seconds=61)
    expired = service.status()
    repeated = service.status()

    assert refresh_requests == 1
    assert expired.authenticated is False
    assert expired.token_expires_at is None
    assert expired.reauthorization_required is True
    assert expired.detail == "Spotify authorization expired. Connect Spotify again."
    assert repeated.authenticated is False
    assert repeated.reauthorization_required is True


def test_completed_create_request_replays_without_auth_or_duplicate_playlist() -> None:
    create_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal create_requests
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        if request.method == "POST" and request.url.path == "/v1/me/playlists":
            create_requests += 1
            return httpx.Response(201, json={"id": "replay", "external_urls": {}})
        assert request.method == "GET"
        assert request.url.path == "/v1/playlists/replay/items"
        return httpx.Response(200, json={"items": [], "next": None})

    service = _service(handler)
    _authorize(service)
    request = _empty_create_request()
    first = service.create_playlists(request)
    service.disconnect()
    replay = service.create_playlists(request)

    assert create_requests == 1
    assert first.replayed is False
    assert replay.replayed is True
    assert replay.results == first.results
    assert replay.idempotency_key == first.idempotency_key

    changed = _empty_create_request(name="A different plan")
    with pytest.raises(SpotifyBridgeError) as exc_info:
        service.create_playlists(changed)
    assert exc_info.value.status_code == 409
    assert create_requests == 1


def test_concurrent_same_key_create_waits_and_only_runs_one_spotify_batch() -> None:
    create_entered = threading.Event()
    allow_create_response = threading.Event()
    second_started = threading.Event()
    create_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal create_requests
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        if request.method == "POST" and request.url.path == "/v1/me/playlists":
            create_requests += 1
            create_entered.set()
            assert allow_create_response.wait(timeout=2)
            return httpx.Response(201, json={"id": "in-flight", "external_urls": {}})
        assert request.method == "GET"
        return httpx.Response(200, json={"items": [], "next": None})

    service = _service(handler)
    _authorize(service)
    request = _empty_create_request(idempotency_key="22222222-2222-4222-8222-222222222222")

    def second_call() -> object:
        second_started.set()
        return service.create_playlists(request)

    with ThreadPoolExecutor(max_workers=2) as executor:
        first_future = executor.submit(service.create_playlists, request)
        assert create_entered.wait(timeout=2)
        second_future = executor.submit(second_call)
        assert second_started.wait(timeout=2)
        time.sleep(0.05)
        assert second_future.done() is False
        allow_create_response.set()
        first = first_future.result(timeout=2)
        second = second_future.result(timeout=2)

    assert create_requests == 1
    assert {first.replayed, second.replayed} == {False, True}
    assert first.results == second.results


def test_playlist_creation_uses_current_items_endpoint_chunks_and_paginated_order_readback() -> (
    None
):
    added_uris: list[str] = []
    add_payloads: list[dict[str, object]] = []
    create_payloads: list[dict[str, object]] = []
    playlist_item_paths: list[str] = []
    playlist_creations = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal playlist_creations
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        if request.method == "POST" and request.url.path == "/v1/me/playlists":
            playlist_creations += 1
            payload = json.loads(request.content)
            create_payloads.append(payload)
            if playlist_creations == 2:
                return httpx.Response(500, json={"error": {"message": "private"}})
            return httpx.Response(
                201,
                json={
                    "id": "playlist-one",
                    "external_urls": {"spotify": "https://open.spotify.com/playlist/one"},
                },
            )
        if request.method == "POST" and request.url.path == "/v1/playlists/playlist-one/items":
            playlist_item_paths.append(request.url.path)
            payload = json.loads(request.content)
            add_payloads.append(payload)
            added_uris.extend(payload["uris"])
            return httpx.Response(201, json={"snapshot_id": "snapshot"})
        if request.method == "GET" and request.url.path == "/v1/playlists/playlist-one/items":
            offset = int(request.url.params["offset"])
            limit = int(request.url.params["limit"])
            page = added_uris[offset : offset + limit]
            return httpx.Response(
                200,
                json={
                    "items": [{"item": {"uri": uri}} for uri in page],
                    "next": "next" if offset + len(page) < len(added_uris) else None,
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service = _service(handler)
    _authorize(service)
    uris = [f"spotify:track:{index:022d}" for index in range(205)]
    uris[1] = uris[0]
    long_name = "N" * 100
    request = SpotifyPlaylistsCreateRequest(
        idempotency_key=IDEMPOTENCY_KEY,
        playlists=[
            SpotifyPlaylistCreateItem(
                position=1,
                name=long_name,
                tracks=[
                    SpotifyPlaylistTrackRequest(
                        position=index,
                        local_track_id=f"local-{index}",
                        spotify_uri=uri,
                    )
                    for index, uri in enumerate(uris, start=1)
                ],
            ),
            SpotifyPlaylistCreateItem(
                position=2,
                name="Second playlist",
                tracks=[
                    SpotifyPlaylistTrackRequest(
                        position=1,
                        local_track_id="second-local",
                        spotify_uri="spotify:track:9999999999999999999999",
                    )
                ],
            ),
        ],
    )
    response = service.create_playlists(request)

    first, second = response.results
    assert first.status == "created"
    assert first.order_verified is True
    assert first.added_track_count == 205
    assert len(first.name) == 100
    assert first.name.startswith("01 - ")
    assert first.track_results[0].spotify_uri == first.track_results[1].spotify_uri
    assert [len(payload["uris"]) for payload in add_payloads] == [100, 100, 5]
    assert [payload["position"] for payload in add_payloads] == [0, 100, 200]
    assert playlist_item_paths == ["/v1/playlists/playlist-one/items"] * 3
    assert create_payloads[0]["public"] is False
    assert create_payloads[0]["collaborative"] is False
    assert second.status == "failed"
    assert second.name == "02 - Second playlist"
    assert second.track_results[0].status == "failed"
    assert "private" not in (second.error or "")
    assert response.created_count == 1
    assert response.failed_count == 1
    assert response.all_orders_verified is False


def test_failed_add_chunk_stops_later_chunks_but_next_playlist_still_runs() -> None:
    playlists: dict[str, list[str]] = {"first": [], "second": []}
    add_calls: dict[str, int] = {"first": 0, "second": 0}
    create_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal create_count
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        if request.method == "POST" and request.url.path == "/v1/me/playlists":
            create_count += 1
            playlist_id = "first" if create_count == 1 else "second"
            return httpx.Response(201, json={"id": playlist_id, "external_urls": {}})
        match = request.url.path.split("/")
        if len(match) == 5 and match[:3] == ["", "v1", "playlists"] and match[4] == "items":
            playlist_id = match[3]
            if request.method == "POST":
                add_calls[playlist_id] += 1
                payload = json.loads(request.content)
                if playlist_id == "first" and add_calls[playlist_id] == 2:
                    return httpx.Response(500, json={"error": {"message": "uncertain"}})
                playlists[playlist_id].extend(payload["uris"])
                return httpx.Response(201, json={"snapshot_id": "snapshot"})
            offset = int(request.url.params["offset"])
            page = playlists[playlist_id][offset : offset + 50]
            return httpx.Response(
                200,
                json={
                    "items": [{"item": {"uri": uri}} for uri in page],
                    "next": "next" if offset + len(page) < len(playlists[playlist_id]) else None,
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    service = _service(handler)
    _authorize(service)
    first_tracks = [
        SpotifyPlaylistTrackRequest(
            position=index + 1,
            local_track_id=f"first-{index}",
            spotify_uri=f"spotify:track:{index:022d}",
        )
        for index in range(205)
    ]
    response = service.create_playlists(
        SpotifyPlaylistsCreateRequest(
            idempotency_key=IDEMPOTENCY_KEY,
            playlists=[
                SpotifyPlaylistCreateItem(position=1, name="First", tracks=first_tracks),
                SpotifyPlaylistCreateItem(
                    position=2,
                    name="Second",
                    tracks=[
                        SpotifyPlaylistTrackRequest(
                            position=1,
                            local_track_id="second",
                            spotify_uri="spotify:track:9999999999999999999999",
                        )
                    ],
                ),
            ],
        )
    )

    first, second = response.results
    assert add_calls == {"first": 2, "second": 1}
    assert first.status == "partial"
    assert first.added_track_count == 100
    assert first.order_verified is True
    assert [result.status for result in first.track_results[:101]].count("added") == 100
    assert all(result.status == "failed" for result in first.track_results[100:])
    assert second.status == "created"
    assert second.order_verified is True
    assert response.partial_count == 1
    assert response.created_count == 1


def test_playlist_readback_mismatch_is_reported_as_partial_not_success() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "accounts.spotify.com":
            return _token_response(request)
        if request.url.path == "/v1/me/playlists":
            return httpx.Response(201, json={"id": "mismatch", "external_urls": {}})
        if request.method == "POST":
            assert request.url.path == "/v1/playlists/mismatch/items"
            return httpx.Response(201, json={"snapshot_id": "snapshot"})
        assert request.url.path == "/v1/playlists/mismatch/items"
        return httpx.Response(
            200,
            json={
                "items": [{"item": {"uri": "spotify:track:9999999999999999999999"}}],
                "next": None,
            },
        )

    service = _service(handler)
    _authorize(service)
    response = service.create_playlists(
        SpotifyPlaylistsCreateRequest(
            idempotency_key=IDEMPOTENCY_KEY,
            playlists=[
                SpotifyPlaylistCreateItem(
                    position=1,
                    name="Mismatch",
                    tracks=[
                        SpotifyPlaylistTrackRequest(
                            position=1,
                            local_track_id="local",
                            spotify_uri="spotify:track:0000000000000000000001",
                        )
                    ],
                )
            ],
        )
    )

    result = response.results[0]
    assert result.status == "partial"
    assert result.added_track_count == 1
    assert result.track_results[0].status == "added"
    assert result.order_verified is False
    assert "did not match" in (result.error or "")
    assert response.all_orders_verified is False


def test_create_preflight_accepts_216_outputs_and_normalizes_final_names() -> None:
    playlists = [
        SpotifyPlaylistCreateItem(position=position, name=f"  Output {position}  ")
        for position in range(1, 217)
    ]
    request = SpotifyPlaylistsCreateRequest(
        idempotency_key=IDEMPOTENCY_KEY,
        playlists=playlists,
    )

    assert len(request.playlists) == 216
    assert request.playlists[0].name == "Output 1"
    final_name = _numbered_playlist_name("N" * 500, position=1, width=3)
    assert final_name.startswith("001 - ")
    assert len(final_name) == 100
    assert final_name == f"001 - {'N' * 94}"

    with pytest.raises(ValidationError):
        SpotifyPlaylistsCreateRequest(
            idempotency_key=IDEMPOTENCY_KEY,
            playlists=playlists + [SpotifyPlaylistCreateItem(position=217, name="One too many")],
        )
    with pytest.raises(ValidationError):
        SpotifyPlaylistCreateItem(position=1, name=f"  {'N' * 501}  ")


def test_spotify_requests_reject_duplicate_match_ids_and_noncontiguous_positions() -> None:
    service = _service(_token_response)
    app.dependency_overrides[get_spotify_service] = lambda: service
    client = TestClient(app)
    duplicate = _track("same").model_dump(mode="json")
    try:
        duplicate_response = client.post(
            "/api/v1/spotify/matches", json={"tracks": [duplicate, duplicate]}
        )
        create_response = client.post(
            "/api/v1/spotify/playlists/create",
            json={
                "idempotency_key": IDEMPOTENCY_KEY,
                "playlists": [
                    {
                        "position": 2,
                        "name": "Skipped one",
                        "tracks": [],
                    }
                ],
            },
        )
    finally:
        app.dependency_overrides.pop(get_spotify_service, None)

    assert duplicate_response.status_code == 422
    assert create_response.status_code == 422
