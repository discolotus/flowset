from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import secrets
import threading
import time
import unicodedata
from collections.abc import Callable, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any
from urllib.parse import urlencode

import httpx

from playlist_optimizer.config import Settings, get_settings
from playlist_optimizer.models import Track
from playlist_optimizer.spotify_models import (
    SpotifyAuthorizationStartResponse,
    SpotifyCandidateConfidence,
    SpotifyMatchCandidate,
    SpotifyMatchResponse,
    SpotifyMatchSignals,
    SpotifyPlaylistCreateItem,
    SpotifyPlaylistCreateResult,
    SpotifyPlaylistsCreateRequest,
    SpotifyPlaylistsCreateResponse,
    SpotifyPlaylistTrackResult,
    SpotifyStatus,
    SpotifyTrackMatchResult,
)

SPOTIFY_SCOPES = (
    "playlist-modify-private",
    "playlist-modify-public",
    "playlist-read-private",
)
_SPOTIFY_TRACK_URI = re.compile(r"^spotify:track:([A-Za-z0-9]{22})$")
_AUTHORIZATION_LIFETIME = timedelta(minutes=10)
_TOKEN_EXPIRY_MARGIN = timedelta(seconds=30)
_SEARCH_RESULT_LIMIT = 10
_PLAYLIST_WRITE_CHUNK_SIZE = 100
_PLAYLIST_READ_PAGE_SIZE = 50
_CREATE_OPERATION_TTL = timedelta(hours=24)
_MAX_CREATE_OPERATIONS = 128
_VERSION_KEYWORD = re.compile(
    r"\b(?:live|remix(?:ed)?|remaster(?:ed)?|radio(?: edit| mix| version)?|"
    r"extended(?: edit| mix| version)?|original mix|club mix|dub(?: mix| version)?|"
    r"edit|mix|version|acoustic|instrumental|demo|karaoke|mono|stereo|sped up|"
    r"slowed(?: down)?|rework|vip)\b",
    re.IGNORECASE,
)


class SpotifyBridgeError(RuntimeError):
    """An error safe to return to the local UI without exposing Spotify credentials."""

    def __init__(self, detail: str, *, status_code: int = 502) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


class SpotifyNotConfiguredError(SpotifyBridgeError):
    def __init__(self) -> None:
        super().__init__(
            "A Spotify client ID must be configured before connecting.", status_code=409
        )


class SpotifyNotAuthenticatedError(SpotifyBridgeError):
    def __init__(self, detail: str = "Connect Spotify before using this feature.") -> None:
        super().__init__(detail, status_code=401)


@dataclass(frozen=True)
class _PendingAuthorization:
    state: str = field(repr=False)
    code_verifier: str = field(repr=False)
    expires_at: datetime


@dataclass(frozen=True)
class _TokenState:
    access_token: str = field(repr=False)
    refresh_token: str | None = field(repr=False)
    expires_at: datetime
    scopes: tuple[str, ...]


@dataclass
class _CreationOperation:
    digest: str
    condition: threading.Condition = field(repr=False)
    response: SpotifyPlaylistsCreateResponse | None = None
    error: tuple[str, int] | None = None
    completed_at: datetime | None = None


class SpotifyService:
    """Local PKCE session plus a narrow wrapper around current Spotify Web API endpoints."""

    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._client_id = settings.spotify_client_id
        self._redirect_uri = settings.spotify_redirect_uri
        self._accounts_base_url = settings.spotify_accounts_base_url.rstrip("/")
        self._api_base_url = settings.spotify_api_base_url.rstrip("/")
        self._rate_limit_retries = settings.spotify_max_rate_limit_retries
        self._maximum_retry_after = settings.spotify_max_retry_after_seconds
        self._client = client or httpx.Client(timeout=settings.spotify_timeout_seconds)
        self._sleep = sleep
        self._now = now
        self._pending: _PendingAuthorization | None = None
        self._tokens: _TokenState | None = None
        self._reauthorization_required = False
        self._connection_detail: str | None = None
        self._creation_operations: dict[str, _CreationOperation] = {}
        self._lock = threading.RLock()

    def status(self) -> SpotifyStatus:
        with self._lock:
            self._discard_expired_pending_locked()
            if self._tokens is not None and self._tokens.expires_at <= self._now():
                with suppress(SpotifyNotAuthenticatedError):
                    self._refresh_access_token_locked()
            tokens = self._tokens
            return SpotifyStatus(
                configured=bool(self._client_id),
                authenticated=tokens is not None,
                client_id=self._client_id,
                redirect_uri=self._redirect_uri,
                scopes=list(SPOTIFY_SCOPES),
                token_expires_at=tokens.expires_at if tokens is not None else None,
                pending_authorization=self._pending is not None,
                reauthorization_required=self._reauthorization_required,
                detail=self._connection_detail,
            )

    def configure(self, client_id: str) -> SpotifyStatus:
        with self._lock:
            if client_id != self._client_id:
                self._tokens = None
                self._pending = None
                self._reauthorization_required = False
                self._connection_detail = None
            self._client_id = client_id
        return self.status()

    def disconnect(self) -> SpotifyStatus:
        with self._lock:
            self._tokens = None
            self._pending = None
            self._reauthorization_required = False
            self._connection_detail = None
        return self.status()

    def start_authorization(self) -> SpotifyAuthorizationStartResponse:
        with self._lock:
            client_id = self._require_client_id_locked()
            code_verifier = secrets.token_urlsafe(64)
            state = secrets.token_urlsafe(32)
            expires_at = self._now() + _AUTHORIZATION_LIFETIME
            self._pending = _PendingAuthorization(
                state=state,
                code_verifier=code_verifier,
                expires_at=expires_at,
            )
            challenge = _pkce_challenge(code_verifier)
            query = urlencode(
                {
                    "client_id": client_id,
                    "response_type": "code",
                    "redirect_uri": self._redirect_uri,
                    "state": state,
                    "scope": " ".join(SPOTIFY_SCOPES),
                    "code_challenge_method": "S256",
                    "code_challenge": challenge,
                }
            )
            return SpotifyAuthorizationStartResponse(
                authorization_url=f"{self._accounts_base_url}/authorize?{query}",
                expires_at=expires_at,
            )

    def complete_authorization(
        self,
        *,
        code: str | None,
        state: str | None,
        error: str | None,
    ) -> None:
        with self._lock:
            self._discard_expired_pending_locked()
            pending = self._pending
            client_id = self._require_client_id_locked()
            if pending is None:
                raise SpotifyBridgeError(
                    "This Spotify authorization request expired. Start a new connection.",
                    status_code=400,
                )
            if state is None or not secrets.compare_digest(state, pending.state):
                raise SpotifyBridgeError(
                    "Spotify returned an invalid authorization state. Start a new connection.",
                    status_code=400,
                )
            self._pending = None
            if error is not None:
                detail = (
                    "Spotify connection was cancelled."
                    if error == "access_denied"
                    else "Spotify could not authorize this connection."
                )
                raise SpotifyBridgeError(detail, status_code=400)
            if not code:
                raise SpotifyBridgeError(
                    "Spotify did not return an authorization code. Start a new connection.",
                    status_code=400,
                )

            response = self._send_with_rate_limit_retry(
                "POST",
                f"{self._accounts_base_url}/api/token",
                data={
                    "client_id": client_id,
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": self._redirect_uri,
                    "code_verifier": pending.code_verifier,
                },
                operation="complete Spotify authorization",
            )
            if not response.is_success:
                raise SpotifyBridgeError(
                    "Spotify rejected the authorization response. Start a new connection.",
                    status_code=400 if response.status_code < 500 else 502,
                )
            self._tokens = self._token_state_from_response(response, refresh_fallback=None)
            self._reauthorization_required = False
            self._connection_detail = None

    def match_tracks(self, tracks: Sequence[Track]) -> SpotifyMatchResponse:
        self._ensure_access_token()
        results: list[SpotifyTrackMatchResult] = []
        for track in tracks:
            existing = _candidate_from_existing_uri(track)
            if existing is not None:
                results.append(
                    SpotifyTrackMatchResult(
                        local_track_id=track.id,
                        status="matched",
                        confidence=1.0,
                        query="Existing Spotify track identity",
                        candidates=[existing],
                    )
                )
                continue

            queries = _search_queries(track)
            candidates_by_uri: dict[str, SpotifyMatchCandidate] = {}
            completed_queries: list[str] = []
            attempted_queries: list[str] = []
            errors: list[str] = []
            for query in queries:
                attempted_queries.append(query)
                try:
                    response = self._api_request(
                        "GET",
                        "/search",
                        params={"q": query, "type": "track", "limit": _SEARCH_RESULT_LIMIT},
                        operation="search for a local track",
                    )
                    query_candidates = _parse_search_candidates(track, response)
                except SpotifyNotAuthenticatedError:
                    raise
                except SpotifyBridgeError as exc:
                    errors.append(exc.detail)
                    break
                completed_queries.append(query)
                for candidate in query_candidates:
                    existing_candidate = candidates_by_uri.get(candidate.uri)
                    if existing_candidate is None or candidate.score > existing_candidate.score:
                        candidates_by_uri[candidate.uri] = candidate
                ranked_so_far = sorted(
                    candidates_by_uri.values(), key=lambda item: (-item.score, item.uri)
                )[:_SEARCH_RESULT_LIMIT]
                if _match_status(ranked_so_far) == "matched":
                    break

            candidates = sorted(
                candidates_by_uri.values(), key=lambda item: (-item.score, item.uri)
            )[:_SEARCH_RESULT_LIMIT]
            query_description = " ; ".join(attempted_queries or queries)
            if completed_queries:
                status = _match_status(candidates)
                results.append(
                    SpotifyTrackMatchResult(
                        local_track_id=track.id,
                        status=status,
                        confidence=candidates[0].score if candidates else 0,
                        query=query_description,
                        candidates=candidates,
                        error=errors[0] if errors else None,
                    )
                )
            else:
                results.append(
                    SpotifyTrackMatchResult(
                        local_track_id=track.id,
                        status="error",
                        confidence=0,
                        query=query_description,
                        error=errors[0] if errors else "Spotify could not search this local track.",
                    )
                )

        counts = {status: 0 for status in ("matched", "ambiguous", "not_found", "error")}
        for result in results:
            counts[result.status] += 1
        issue_count = sum(result.error is not None for result in results)
        warnings = (
            [f"Spotify could not fully search {issue_count} track(s); review those rows and retry."]
            if issue_count
            else []
        )
        return SpotifyMatchResponse(
            results=results,
            matched_count=counts["matched"],
            ambiguous_count=counts["ambiguous"],
            not_found_count=counts["not_found"],
            error_count=counts["error"],
            warnings=warnings,
        )

    def create_playlists(
        self, request: SpotifyPlaylistsCreateRequest
    ) -> SpotifyPlaylistsCreateResponse:
        operation_key = str(request.idempotency_key)
        digest = _canonical_create_digest(request)
        with self._lock:
            self._prune_creation_operations_locked(protected_key=operation_key)
            operation = self._creation_operations.get(operation_key)
            if operation is not None:
                return self._replay_creation_operation_locked(operation, digest=digest)

        self._ensure_access_token()
        with self._lock:
            operation = self._creation_operations.get(operation_key)
            if operation is not None:
                return self._replay_creation_operation_locked(operation, digest=digest)
            operation = _CreationOperation(
                digest=digest,
                condition=threading.Condition(self._lock),
            )
            self._creation_operations[operation_key] = operation

        try:
            response = self._create_playlists_once(request)
        except BaseException as exc:
            with self._lock:
                if isinstance(exc, SpotifyBridgeError):
                    operation.error = (exc.detail, exc.status_code)
                else:
                    operation.error = ("The Spotify export did not complete.", 502)
                operation.completed_at = self._now()
                operation.condition.notify_all()
            raise

        with self._lock:
            operation.response = response.model_copy(deep=True)
            operation.completed_at = self._now()
            operation.condition.notify_all()
        return response

    def _replay_creation_operation_locked(
        self, operation: _CreationOperation, *, digest: str
    ) -> SpotifyPlaylistsCreateResponse:
        if operation.digest != digest:
            raise SpotifyBridgeError(
                "This Spotify export key was already used for a different playlist plan.",
                status_code=409,
            )
        while operation.response is None and operation.error is None:
            operation.condition.wait()
        if operation.response is not None:
            return operation.response.model_copy(update={"replayed": True}, deep=True)
        detail, status_code = operation.error or (
            "The earlier Spotify export did not complete.",
            502,
        )
        raise SpotifyBridgeError(detail, status_code=status_code)

    def _create_playlists_once(
        self, request: SpotifyPlaylistsCreateRequest
    ) -> SpotifyPlaylistsCreateResponse:
        ordered_playlists = sorted(request.playlists, key=lambda item: item.position)
        number_width = max(2, len(str(len(ordered_playlists))))
        results: list[SpotifyPlaylistCreateResult] = []
        warnings: list[str] = []

        for playlist in ordered_playlists:
            numbered_name = _numbered_playlist_name(
                playlist.name, position=playlist.position, width=number_width
            )
            try:
                result = self._create_playlist(
                    playlist,
                    numbered_name=numbered_name,
                    public=request.public,
                )
            except SpotifyBridgeError as exc:
                result = _failed_playlist_result(playlist, numbered_name, exc.detail)
            results.append(result)
            if result.status != "created":
                warnings.append(
                    f"{result.name} was {result.status}; inspect its track results before retrying."
                )

        created_count = sum(result.status == "created" for result in results)
        partial_count = sum(result.status == "partial" for result in results)
        failed_count = sum(result.status == "failed" for result in results)
        return SpotifyPlaylistsCreateResponse(
            idempotency_key=request.idempotency_key,
            replayed=False,
            results=results,
            created_count=created_count,
            partial_count=partial_count,
            failed_count=failed_count,
            all_orders_verified=bool(results)
            and all(result.status == "created" and result.order_verified for result in results),
            warnings=warnings,
        )

    def _prune_creation_operations_locked(self, *, protected_key: str) -> None:
        expiry = self._now() - _CREATE_OPERATION_TTL
        expired_keys = [
            key
            for key, operation in self._creation_operations.items()
            if operation.completed_at is not None and operation.completed_at < expiry
        ]
        for key in expired_keys:
            self._creation_operations.pop(key, None)

        completed = sorted(
            (
                (operation.completed_at, key)
                for key, operation in self._creation_operations.items()
                if operation.completed_at is not None and key != protected_key
            ),
            key=lambda item: item[0],
        )
        while len(self._creation_operations) >= _MAX_CREATE_OPERATIONS and completed:
            _, oldest_key = completed.pop(0)
            self._creation_operations.pop(oldest_key, None)

    def _create_playlist(
        self,
        playlist: SpotifyPlaylistCreateItem,
        *,
        numbered_name: str,
        public: bool,
    ) -> SpotifyPlaylistCreateResult:
        create_response = self._api_request(
            "POST",
            "/me/playlists",
            json={
                "name": numbered_name,
                "public": public,
                "collaborative": False,
                "description": playlist.description,
            },
            operation=f"create playlist {playlist.position}",
        )
        create_payload = _response_json(create_response, "create a Spotify playlist")
        playlist_id = create_payload.get("id")
        if not isinstance(playlist_id, str) or not playlist_id:
            raise SpotifyBridgeError("Spotify created a playlist without returning its identity.")
        external_urls = create_payload.get("external_urls")
        spotify_url = (
            external_urls.get("spotify")
            if isinstance(external_urls, dict) and isinstance(external_urls.get("spotify"), str)
            else None
        )

        ordered_tracks = sorted(playlist.tracks, key=lambda item: item.position)
        track_results: list[SpotifyPlaylistTrackResult] = []
        successful_uris: list[str] = []
        for start in range(0, len(ordered_tracks), _PLAYLIST_WRITE_CHUNK_SIZE):
            chunk = ordered_tracks[start : start + _PLAYLIST_WRITE_CHUNK_SIZE]
            try:
                self._api_request(
                    "POST",
                    f"/playlists/{playlist_id}/items",
                    json={
                        "uris": [track.spotify_uri for track in chunk],
                        "position": len(successful_uris),
                    },
                    operation=f"add tracks to playlist {playlist.position}",
                )
            except SpotifyBridgeError as exc:
                remaining = ordered_tracks[start:]
                track_results.extend(
                    SpotifyPlaylistTrackResult(
                        position=track.position,
                        local_track_id=track.local_track_id,
                        spotify_uri=track.spotify_uri,
                        status="failed",
                        error=exc.detail,
                    )
                    for track in remaining
                )
                break
            else:
                successful_uris.extend(track.spotify_uri for track in chunk)
                track_results.extend(
                    SpotifyPlaylistTrackResult(
                        position=track.position,
                        local_track_id=track.local_track_id,
                        spotify_uri=track.spotify_uri,
                        status="added",
                    )
                    for track in chunk
                )

        verification_error: str | None = None
        try:
            readback_uris = self._read_playlist_uris(playlist_id)
            order_verified = readback_uris == successful_uris
            if not order_verified:
                verification_error = "Spotify playlist order did not match the submitted order."
        except SpotifyBridgeError:
            order_verified = False
            verification_error = "Spotify playlist order could not be verified."

        added_count = len(successful_uris)
        failed_count = len(ordered_tracks) - added_count
        status = "created" if failed_count == 0 and order_verified else "partial"
        error_parts: list[str] = []
        if failed_count:
            error_parts.append(f"{failed_count} track(s) could not be added.")
        if verification_error:
            error_parts.append(verification_error)
        return SpotifyPlaylistCreateResult(
            position=playlist.position,
            name=numbered_name,
            status=status,
            spotify_playlist_id=playlist_id,
            spotify_url=spotify_url,
            requested_track_count=len(ordered_tracks),
            added_track_count=added_count,
            order_verified=order_verified,
            track_results=sorted(track_results, key=lambda item: item.position),
            error=" ".join(error_parts) or None,
        )

    def _read_playlist_uris(self, playlist_id: str) -> list[str]:
        uris: list[str] = []
        offset = 0
        while True:
            response = self._api_request(
                "GET",
                f"/playlists/{playlist_id}/items",
                params={"limit": _PLAYLIST_READ_PAGE_SIZE, "offset": offset},
                operation="verify Spotify playlist order",
            )
            payload = _response_json(response, "verify Spotify playlist order")
            items = payload.get("items")
            if not isinstance(items, list):
                raise SpotifyBridgeError(
                    "Spotify returned an invalid playlist verification result."
                )
            for wrapper in items:
                item = wrapper.get("item") if isinstance(wrapper, dict) else None
                if item is None and isinstance(wrapper, dict):
                    item = wrapper.get("track")
                uri = item.get("uri") if isinstance(item, dict) else None
                uris.append(uri if isinstance(uri, str) else "")

            next_page = payload.get("next")
            if not next_page:
                break
            if not items:
                raise SpotifyBridgeError("Spotify returned an invalid playlist verification page.")
            offset += len(items)
            if offset > 5000:
                raise SpotifyBridgeError("Spotify playlist verification exceeded its safe limit.")
        return uris

    def _api_request(
        self, method: str, path: str, *, operation: str, **kwargs: Any
    ) -> httpx.Response:
        token = self._ensure_access_token()
        response = self._send_with_rate_limit_retry(
            method,
            f"{self._api_base_url}{path}",
            headers={"Authorization": f"Bearer {token}"},
            operation=operation,
            **kwargs,
        )
        if response.status_code == 401:
            token = self._force_refresh_access_token()
            response = self._send_with_rate_limit_retry(
                method,
                f"{self._api_base_url}{path}",
                headers={"Authorization": f"Bearer {token}"},
                operation=operation,
                **kwargs,
            )
        if not response.is_success:
            raise _remote_error(response.status_code, operation)
        return response

    def _ensure_access_token(self) -> str:
        with self._lock:
            tokens = self._tokens
            if tokens is None:
                raise SpotifyNotAuthenticatedError(
                    self._connection_detail or "Connect Spotify before using this feature."
                )
            if tokens.expires_at <= self._now() + _TOKEN_EXPIRY_MARGIN:
                return self._refresh_access_token_locked()
            return tokens.access_token

    def _force_refresh_access_token(self) -> str:
        with self._lock:
            return self._refresh_access_token_locked()

    def _refresh_access_token_locked(self) -> str:
        tokens = self._tokens
        client_id = self._client_id
        if tokens is None or not tokens.refresh_token or not client_id:
            self._mark_reauthorization_required_locked()
            raise SpotifyNotAuthenticatedError(self._connection_detail or "")
        try:
            response = self._send_with_rate_limit_retry(
                "POST",
                f"{self._accounts_base_url}/api/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": tokens.refresh_token,
                    "client_id": client_id,
                },
                operation="refresh Spotify authorization",
            )
        except SpotifyBridgeError as exc:
            self._mark_reauthorization_required_locked()
            raise SpotifyNotAuthenticatedError(self._connection_detail or "") from exc
        if not response.is_success:
            self._mark_reauthorization_required_locked()
            raise SpotifyNotAuthenticatedError(self._connection_detail or "")
        try:
            self._tokens = self._token_state_from_response(
                response, refresh_fallback=tokens.refresh_token
            )
        except SpotifyBridgeError as exc:
            self._mark_reauthorization_required_locked()
            raise SpotifyNotAuthenticatedError(self._connection_detail or "") from exc
        self._reauthorization_required = False
        self._connection_detail = None
        return self._tokens.access_token

    def _token_state_from_response(
        self, response: httpx.Response, *, refresh_fallback: str | None
    ) -> _TokenState:
        payload = _response_json(response, "read Spotify authorization")
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token", refresh_fallback)
        expires_in = payload.get("expires_in")
        if (
            not isinstance(access_token, str)
            or not access_token
            or refresh_token is not None
            and (not isinstance(refresh_token, str) or not refresh_token)
            or not isinstance(expires_in, int | float)
            or isinstance(expires_in, bool)
            or not math.isfinite(float(expires_in))
            or expires_in <= 0
        ):
            raise SpotifyBridgeError("Spotify returned an invalid authorization result.")
        scope_value = payload.get("scope")
        scopes = tuple(scope_value.split()) if isinstance(scope_value, str) else SPOTIFY_SCOPES
        return _TokenState(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=self._now() + timedelta(seconds=float(expires_in)),
            scopes=scopes,
        )

    def _send_with_rate_limit_retry(
        self, method: str, url: str, *, operation: str, **kwargs: Any
    ) -> httpx.Response:
        for attempt in range(self._rate_limit_retries + 1):
            try:
                response = self._client.request(method, url, **kwargs)
            except httpx.HTTPError as exc:
                raise SpotifyBridgeError(
                    f"Spotify was unavailable while trying to {operation}."
                ) from exc
            if response.status_code != 429:
                return response
            if attempt >= self._rate_limit_retries:
                raise SpotifyBridgeError(
                    f"Spotify rate-limited the request to {operation}. Please retry shortly.",
                    status_code=503,
                )
            retry_after = _bounded_retry_after(
                response.headers.get("Retry-After"),
                fallback=2**attempt,
                maximum=self._maximum_retry_after,
            )
            self._sleep(retry_after)
        raise AssertionError("rate-limit retry loop did not return")

    def _require_client_id_locked(self) -> str:
        if not self._client_id:
            raise SpotifyNotConfiguredError()
        return self._client_id

    def _discard_expired_pending_locked(self) -> None:
        if self._pending is not None and self._pending.expires_at <= self._now():
            self._pending = None

    def _mark_reauthorization_required_locked(self) -> None:
        self._tokens = None
        self._reauthorization_required = True
        self._connection_detail = "Spotify authorization expired. Connect Spotify again."


@lru_cache
def get_spotify_service() -> SpotifyService:
    return SpotifyService(get_settings())


def _pkce_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _candidate_from_existing_uri(track: Track) -> SpotifyMatchCandidate | None:
    match = _SPOTIFY_TRACK_URI.fullmatch(track.uri or "")
    if match is None:
        return None
    return SpotifyMatchCandidate(
        spotify_id=match.group(1),
        uri=track.uri or "",
        name=track.name,
        artist=track.artist,
        album=track.album,
        duration_ms=track.duration_ms,
        isrc=track.isrc,
        external_url=track.external_url or f"https://open.spotify.com/track/{match.group(1)}",
        score=1,
        confidence="high",
        signals=SpotifyMatchSignals(
            isrc=1 if track.isrc else None,
            name=1,
            artist=1,
            album=1,
            duration=1,
            version=1,
        ),
    )


def _search_queries(track: Track) -> list[str]:
    title_filter = f'track:"{_search_term(track.name)}"'
    queries: list[str] = []
    if track.isrc and re.fullmatch(r"[A-Za-z0-9]{8,15}", track.isrc):
        queries.append(f"isrc:{track.isrc.upper()}")
    if _credible_artist(track.artist):
        artist_filter = f'artist:"{_search_term(track.artist)}"'
        if _credible_album(track.album):
            queries.append(f'{title_filter} {artist_filter} album:"{_search_term(track.album)}"')
        queries.append(f"{title_filter} {artist_filter}")
    queries.append(title_filter)
    return list(dict.fromkeys(queries))[:4]


def _search_term(value: str) -> str:
    return " ".join(value.replace('"', " ").split())[:200]


def _credible_artist(value: str) -> bool:
    normalized = _normalize_text(value)
    return normalized not in {"", "unknown", "unknown artist", "various", "various artists"}


def _credible_album(value: str) -> bool:
    normalized = _normalize_text(value)
    if normalized in {"", "unknown", "unknown album", "untitled"}:
        return False
    return (
        re.fullmatch(
            r"(?:january|february|march|april|may|june|july|august|september|"
            r"october|november|december) [0-9]{1,2}(?: [0-9]{2,4})?",
            normalized,
        )
        is None
    )


def _parse_search_candidates(track: Track, response: httpx.Response) -> list[SpotifyMatchCandidate]:
    payload = _response_json(response, "search Spotify")
    tracks_payload = payload.get("tracks")
    items = tracks_payload.get("items") if isinstance(tracks_payload, dict) else None
    if not isinstance(items, list):
        raise SpotifyBridgeError("Spotify returned an invalid track-search result.")

    candidates_by_uri: dict[str, SpotifyMatchCandidate] = {}
    for item in items[:_SEARCH_RESULT_LIMIT]:
        candidate = _candidate_from_search_item(track, item)
        if candidate is None:
            continue
        existing = candidates_by_uri.get(candidate.uri)
        if existing is None or candidate.score > existing.score:
            candidates_by_uri[candidate.uri] = candidate
    return sorted(candidates_by_uri.values(), key=lambda item: (-item.score, item.uri))


def _candidate_from_search_item(track: Track, item: object) -> SpotifyMatchCandidate | None:
    if not isinstance(item, dict):
        return None
    spotify_id = item.get("id")
    name = item.get("name")
    duration_ms = item.get("duration_ms")
    if (
        not isinstance(spotify_id, str)
        or re.fullmatch(r"[A-Za-z0-9]{22}", spotify_id) is None
        or not isinstance(name, str)
        or not name
        or not isinstance(duration_ms, int)
        or isinstance(duration_ms, bool)
        or duration_ms <= 0
    ):
        return None
    artists_payload = item.get("artists")
    artist_names = (
        [
            artist.get("name")
            for artist in artists_payload
            if isinstance(artist, dict) and isinstance(artist.get("name"), str)
        ]
        if isinstance(artists_payload, list)
        else []
    )
    artist = ", ".join(artist_names)
    album_payload = item.get("album")
    album = album_payload.get("name") if isinstance(album_payload, dict) else ""
    if not isinstance(album, str):
        album = ""
    external_ids = item.get("external_ids")
    isrc = external_ids.get("isrc") if isinstance(external_ids, dict) else None
    if not isinstance(isrc, str):
        isrc = None
    external_urls = item.get("external_urls")
    external_url = external_urls.get("spotify") if isinstance(external_urls, dict) else None
    if not isinstance(external_url, str):
        external_url = None

    signals = _match_signals(
        track,
        name=name,
        artist=artist,
        album=album,
        duration_ms=duration_ms,
        isrc=isrc,
    )
    score = _match_score(signals)
    uri = item.get("uri")
    expected_uri = f"spotify:track:{spotify_id}"
    if not isinstance(uri, str) or _SPOTIFY_TRACK_URI.fullmatch(uri) is None:
        uri = expected_uri
    return SpotifyMatchCandidate(
        spotify_id=spotify_id,
        uri=uri,
        name=name,
        artist=artist,
        album=album,
        duration_ms=duration_ms,
        isrc=isrc,
        external_url=external_url,
        score=score,
        confidence=_confidence_level(score),
        signals=signals,
    )


def _match_signals(
    track: Track,
    *,
    name: str,
    artist: str,
    album: str,
    duration_ms: int,
    isrc: str | None,
) -> SpotifyMatchSignals:
    isrc_signal: float | None = None
    if track.isrc and isrc:
        isrc_signal = float(track.isrc.casefold() == isrc.casefold())
    duration_delta = abs(track.duration_ms - duration_ms)
    return SpotifyMatchSignals(
        isrc=isrc_signal,
        name=_text_similarity(track.name, name),
        artist=_text_similarity(track.artist, artist),
        album=_text_similarity(track.album, album),
        duration=max(0.0, 1.0 - duration_delta / 30_000),
        version=float(_version_signature(track.name) == _version_signature(name)),
    )


def _match_score(signals: SpotifyMatchSignals) -> float:
    if signals.isrc == 1:
        return 1.0
    if signals.version == 0:
        # Named versions are different recordings. Keep a conflicting candidate visible for
        # manual review, but cap it below every automatic-match confidence threshold.
        return min(0.66, _metadata_match_score(signals))
    return _metadata_match_score(signals)


def _metadata_match_score(signals: SpotifyMatchSignals) -> float:
    score = (
        signals.name * 0.40 + signals.artist * 0.30 + signals.album * 0.10 + signals.duration * 0.20
    )
    if signals.isrc == 0:
        score *= 0.75
    return round(min(1.0, max(0.0, score)), 6)


def _version_signature(value: str) -> tuple[str, ...]:
    bracketed = re.findall(r"\(([^()]*)\)|\[([^\[\]]*)\]", value)
    candidates = [part for pair in bracketed for part in pair if part]
    candidates.extend(re.split(r"\s+(?:-|–|—)\s+", value)[1:])
    matching_segments = [segment for segment in candidates if _VERSION_KEYWORD.search(segment)]
    if not matching_segments and _VERSION_KEYWORD.search(value):
        matching_segments = [value]

    normalized: set[str] = set()
    for segment in matching_segments:
        qualifier = _normalize_text(segment)
        qualifier = re.sub(r"\bremastered\b", "remaster", qualifier)
        qualifier = re.sub(r"\bremixed\b", "remix", qualifier)
        qualifier = re.sub(r"\bslowed down\b", "slowed", qualifier)
        if qualifier:
            normalized.add(qualifier)
    return tuple(sorted(normalized))


def _match_status(candidates: Sequence[SpotifyMatchCandidate]) -> str:
    if not candidates:
        return "not_found"
    top = candidates[0]
    runner_up_score = candidates[1].score if len(candidates) > 1 else 0
    decisive = top.signals.isrc == 1 or top.score - runner_up_score >= 0.03
    return "matched" if top.confidence == "high" and decisive else "ambiguous"


def _confidence_level(score: float) -> SpotifyCandidateConfidence:
    if score >= 0.88:
        return "high"
    if score >= 0.67:
        return "medium"
    return "low"


def _text_similarity(left: str, right: str) -> float:
    normalized_left = _normalize_text(left)
    normalized_right = _normalize_text(right)
    if not normalized_left or not normalized_right:
        return 0
    return round(SequenceMatcher(None, normalized_left, normalized_right).ratio(), 6)


def _normalize_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_marks = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    return " ".join(re.findall(r"[a-z0-9]+", without_marks))


def _numbered_playlist_name(name: str, *, position: int, width: int) -> str:
    prefix = f"{position:0{width}d} - "
    return f"{prefix}{name[: 100 - len(prefix)].rstrip()}"


def _canonical_create_digest(request: SpotifyPlaylistsCreateRequest) -> str:
    playlists = []
    for playlist in sorted(request.playlists, key=lambda item: item.position):
        payload = playlist.model_dump(mode="json", exclude={"tracks"})
        payload["tracks"] = [
            track.model_dump(mode="json")
            for track in sorted(playlist.tracks, key=lambda item: item.position)
        ]
        playlists.append(payload)
    canonical = json.dumps(
        {"public": request.public, "playlists": playlists},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _failed_playlist_result(
    playlist: SpotifyPlaylistCreateItem, numbered_name: str, detail: str
) -> SpotifyPlaylistCreateResult:
    return SpotifyPlaylistCreateResult(
        position=playlist.position,
        name=numbered_name,
        status="failed",
        requested_track_count=len(playlist.tracks),
        added_track_count=0,
        order_verified=None,
        track_results=[
            SpotifyPlaylistTrackResult(
                position=track.position,
                local_track_id=track.local_track_id,
                spotify_uri=track.spotify_uri,
                status="failed",
                error=detail,
            )
            for track in sorted(playlist.tracks, key=lambda item: item.position)
        ],
        error=detail,
    )


def _response_json(response: httpx.Response, operation: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise SpotifyBridgeError(
            f"Spotify returned an invalid response while trying to {operation}."
        ) from exc
    if not isinstance(payload, dict):
        raise SpotifyBridgeError(
            f"Spotify returned an invalid response while trying to {operation}."
        )
    return payload


def _remote_error(status_code: int, operation: str) -> SpotifyBridgeError:
    if status_code == 401:
        return SpotifyNotAuthenticatedError("Spotify authorization expired. Connect Spotify again.")
    if status_code == 403:
        return SpotifyBridgeError(
            f"Spotify did not grant permission to {operation}.", status_code=403
        )
    if status_code == 404:
        return SpotifyBridgeError(
            f"Spotify could not find the resource needed to {operation}.", status_code=404
        )
    if status_code >= 500:
        return SpotifyBridgeError(f"Spotify was unavailable while trying to {operation}.")
    return SpotifyBridgeError(f"Spotify could not {operation}.", status_code=400)


def _bounded_retry_after(value: str | None, *, fallback: float, maximum: float) -> float:
    try:
        parsed = float(value) if value is not None else fallback
    except ValueError:
        parsed = fallback
    if not math.isfinite(parsed):
        parsed = fallback
    return min(max(0.0, parsed), maximum)
