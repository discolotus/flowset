import os
from ipaddress import ip_address
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from playlist_optimizer.analysis_progress import (
    AnalysisProgressRegistry,
    get_analysis_progress_registry,
)
from playlist_optimizer.config import Settings, get_settings
from playlist_optimizer.data.demo_playlist import DEMO_TRACKS
from playlist_optimizer.local_library import (
    AUDIO_MEDIA_TYPES,
    LocalLibraryBrowser,
    LocalPlaylistImporter,
    resolve_local_audio_file,
)
from playlist_optimizer.models import (
    AudioFeatureProgressSnapshot,
    AudioFeatureProvidersResponse,
    AudioFeatureResolutionRequest,
    AudioFeatureResolutionResponse,
    Capabilities,
    DemoPlaylist,
    LocalLibraryBrowseResponse,
    LocalLibraryRootRequest,
    LocalPlaylistImportRequest,
    LocalPlaylistImportResponse,
    OptimizationRequest,
    OptimizationResponse,
    ProgressToken,
    RecipePreviewRequest,
    RecipePreviewResponse,
)
from playlist_optimizer.optimization import optimize_tracks, preview_recipe, summarize_tracks
from playlist_optimizer.providers import (
    AudioFeatureProviderRegistry,
    get_audio_feature_provider_registry,
)
from playlist_optimizer.spotify import SpotifyService, get_spotify_service

router = APIRouter(prefix="/api/v1")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "playlist-optimizer-api"}


@router.get("/capabilities", response_model=Capabilities)
def capabilities(
    spotify: Annotated[SpotifyService, Depends(get_spotify_service)],
) -> Capabilities:
    spotify_status = spotify.status()
    return Capabilities(
        demo_mode=True,
        spotify_oauth_configured=spotify_status.configured,
        spotify_metadata=(
            "pkce_playlist_matching_and_export_available"
            if spotify_status.configured
            else "requires_client_id"
        ),
        audio_features="provider_selection_available",
        export="local_and_spotify_export_available",
    )


@router.get("/audio-features/providers", response_model=AudioFeatureProvidersResponse)
def audio_feature_providers(
    registry: Annotated[AudioFeatureProviderRegistry, Depends(get_audio_feature_provider_registry)],
) -> AudioFeatureProvidersResponse:
    return AudioFeatureProvidersResponse(providers=registry.infos())


@router.post("/audio-features/resolve", response_model=AudioFeatureResolutionResponse)
def resolve_audio_features(
    payload: AudioFeatureResolutionRequest,
    http_request: Request,
    registry: Annotated[AudioFeatureProviderRegistry, Depends(get_audio_feature_provider_registry)],
) -> AudioFeatureResolutionResponse:
    if payload.provider == "essentia":
        _require_loopback(http_request)
    return registry.resolve(payload)


@router.get(
    "/audio-features/progress/{progress_token}",
    response_model=AudioFeatureProgressSnapshot,
)
def audio_feature_progress(
    progress_token: ProgressToken,
    http_request: Request,
    registry: Annotated[AnalysisProgressRegistry, Depends(get_analysis_progress_registry)],
) -> AudioFeatureProgressSnapshot:
    _require_loopback(http_request)
    snapshot = registry.get(progress_token)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Analysis progress was not found or expired.")
    return snapshot


@router.post("/local-library/root", response_model=LocalLibraryBrowseResponse)
def select_local_library_root(
    payload: LocalLibraryRootRequest,
    http_request: Request,
) -> LocalLibraryBrowseResponse:
    _require_loopback(http_request)
    try:
        selected_root = Path(payload.path).expanduser().resolve(strict=True)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(
            status_code=400, detail="Selected music folder is unavailable."
        ) from exc
    if not selected_root.is_dir():
        raise HTTPException(status_code=400, detail="Selected music library must be a folder.")

    os.environ["ESSENTIA_AUDIO_ROOT"] = str(selected_root)
    get_settings.cache_clear()
    get_audio_feature_provider_registry.cache_clear()
    try:
        return LocalLibraryBrowser(music_root=selected_root).browse()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/local-library/import", response_model=LocalPlaylistImportResponse)
def import_local_playlist(
    payload: LocalPlaylistImportRequest,
    http_request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> LocalPlaylistImportResponse:
    _require_loopback(http_request)
    music_root = settings.essentia_audio_root
    if music_root is None or not music_root.is_dir():
        raise HTTPException(
            status_code=503,
            detail="ESSENTIA_AUDIO_ROOT must point to an available local music directory.",
        )
    try:
        return LocalPlaylistImporter(music_root=music_root).import_playlist(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/local-library/folders", response_model=LocalLibraryBrowseResponse)
def browse_local_library(
    http_request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    path: str = "",
) -> LocalLibraryBrowseResponse:
    _require_loopback(http_request)
    music_root = settings.essentia_audio_root
    if music_root is None or not music_root.is_dir():
        raise HTTPException(
            status_code=503,
            detail="ESSENTIA_AUDIO_ROOT must point to an available local music directory.",
        )
    try:
        return LocalLibraryBrowser(music_root=music_root).browse(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/local-library/audio", response_class=FileResponse)
def preview_local_audio(
    http_request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    path: str,
) -> FileResponse:
    _require_loopback(http_request)
    music_root = settings.essentia_audio_root
    if music_root is None or not music_root.is_dir():
        raise HTTPException(
            status_code=503,
            detail="ESSENTIA_AUDIO_ROOT must point to an available local music directory.",
        )
    try:
        audio_path = resolve_local_audio_file(music_root, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(
        audio_path,
        media_type=AUDIO_MEDIA_TYPES[audio_path.suffix.casefold()],
        headers={
            "Cache-Control": "private, no-cache",
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
        detail="Local-library access and Essentia analysis are restricted to loopback clients.",
    )


def _is_loopback_host(host: str) -> bool:
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


@router.get("/demo", response_model=DemoPlaylist)
def demo_playlist() -> DemoPlaylist:
    return DemoPlaylist(
        id="demo-night-drive",
        name="Night Drive — Demo Set",
        description="Fictional fixture data for developing the optimization experience.",
        tracks=DEMO_TRACKS,
        summary=summarize_tracks(DEMO_TRACKS),
    )


@router.get("/demo/playlists", response_model=list[DemoPlaylist])
def demo_playlists() -> list[DemoPlaylist]:
    fixtures = (
        (
            "demo-sunset-warmup",
            "Sunset Warmup",
            "A low-to-medium energy source playlist.",
            DEMO_TRACKS[:6],
        ),
        (
            "demo-neon-peak",
            "Neon Peak",
            "A higher-energy source with two tracks shared with Sunset Warmup.",
            DEMO_TRACKS[4:10],
        ),
        (
            "demo-afterhours",
            "Afterhours",
            "A non-overlapping late-night source playlist.",
            DEMO_TRACKS[10:],
        ),
    )
    return [
        DemoPlaylist(
            id=playlist_id,
            name=name,
            description=description,
            tracks=tracks,
            summary=summarize_tracks(tracks),
        )
        for playlist_id, name, description, tracks in fixtures
    ]


@router.post("/optimize", response_model=OptimizationResponse)
def optimize(request: OptimizationRequest) -> OptimizationResponse:
    return optimize_tracks(request)


@router.post("/recipes/preview", response_model=RecipePreviewResponse)
def recipe_preview(request: RecipePreviewRequest) -> RecipePreviewResponse:
    return preview_recipe(request)
