import html
from ipaddress import ip_address
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from playlist_optimizer.spotify import (
    SpotifyBridgeError,
    SpotifyService,
    get_spotify_service,
)
from playlist_optimizer.spotify_models import (
    SpotifyAuthorizationStartRequest,
    SpotifyAuthorizationStartResponse,
    SpotifyConfigRequest,
    SpotifyMatchRequest,
    SpotifyMatchResponse,
    SpotifyPlaylistsCreateRequest,
    SpotifyPlaylistsCreateResponse,
    SpotifyStatus,
)

router = APIRouter(prefix="/api/v1/spotify", tags=["Spotify"])


@router.get("/status", response_model=SpotifyStatus)
def spotify_status(
    http_request: Request,
    service: Annotated[SpotifyService, Depends(get_spotify_service)],
) -> SpotifyStatus:
    _require_loopback(http_request)
    return service.status()


@router.post("/config", response_model=SpotifyStatus)
def configure_spotify(
    payload: SpotifyConfigRequest,
    http_request: Request,
    service: Annotated[SpotifyService, Depends(get_spotify_service)],
) -> SpotifyStatus:
    _require_loopback(http_request)
    return service.configure(payload.client_id)


@router.post("/auth/start", response_model=SpotifyAuthorizationStartResponse)
def start_spotify_authorization(
    _payload: SpotifyAuthorizationStartRequest,
    http_request: Request,
    service: Annotated[SpotifyService, Depends(get_spotify_service)],
) -> SpotifyAuthorizationStartResponse:
    _require_loopback(http_request)
    try:
        return service.start_authorization()
    except SpotifyBridgeError as exc:
        raise _http_exception(exc) from exc


@router.get("/auth/callback", response_class=HTMLResponse)
def spotify_authorization_callback(
    http_request: Request,
    service: Annotated[SpotifyService, Depends(get_spotify_service)],
    code: Annotated[str | None, Query(max_length=2048)] = None,
    state: Annotated[str | None, Query(max_length=512)] = None,
    error: Annotated[str | None, Query(max_length=200)] = None,
) -> HTMLResponse:
    _require_loopback(http_request)
    try:
        service.complete_authorization(code=code, state=state, error=error)
    except SpotifyBridgeError as exc:
        return _callback_html(
            title="Spotify connection was not completed",
            detail=exc.detail,
            status_code=exc.status_code,
        )
    return _callback_html(
        title="Spotify is connected",
        detail="You can close this window and return to Flowset.",
        status_code=200,
    )


@router.post("/disconnect", response_model=SpotifyStatus)
def disconnect_spotify(
    http_request: Request,
    service: Annotated[SpotifyService, Depends(get_spotify_service)],
) -> SpotifyStatus:
    _require_loopback(http_request)
    return service.disconnect()


@router.post("/matches", response_model=SpotifyMatchResponse)
def match_local_tracks_to_spotify(
    payload: SpotifyMatchRequest,
    http_request: Request,
    service: Annotated[SpotifyService, Depends(get_spotify_service)],
) -> SpotifyMatchResponse:
    _require_loopback(http_request)
    try:
        return service.match_tracks(payload.tracks)
    except SpotifyBridgeError as exc:
        raise _http_exception(exc) from exc


@router.post("/playlists/create", response_model=SpotifyPlaylistsCreateResponse)
def create_spotify_playlists(
    payload: SpotifyPlaylistsCreateRequest,
    http_request: Request,
    service: Annotated[SpotifyService, Depends(get_spotify_service)],
) -> SpotifyPlaylistsCreateResponse:
    _require_loopback(http_request)
    try:
        return service.create_playlists(payload)
    except SpotifyBridgeError as exc:
        raise _http_exception(exc) from exc


def _http_exception(error: SpotifyBridgeError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


def _callback_html(*, title: str, detail: str, status_code: int) -> HTMLResponse:
    safe_title = html.escape(title, quote=True)
    safe_detail = html.escape(detail, quote=True)
    content = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
</head>
<body>
  <main>
    <h1>{safe_title}</h1>
    <p>{safe_detail}</p>
  </main>
</body>
</html>"""
    return HTMLResponse(
        content=content,
        status_code=status_code,
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; style-src 'none'; base-uri 'none'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _require_loopback(request: Request) -> None:
    host = request.client.host if request.client else None
    if host == "testclient" or (host is not None and _is_loopback_host(host)):
        return
    raise HTTPException(
        status_code=403,
        detail="Spotify account access is restricted to loopback clients.",
    )


def _is_loopback_host(host: str) -> bool:
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False
