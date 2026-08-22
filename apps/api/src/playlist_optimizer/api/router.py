import math
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
    LocalPlaylistDiscoveryResponse,
    LocalPlaylistImportRequest,
    LocalPlaylistImportResponse,
    OptimizationRequest,
    OptimizationResponse,
    ProgressToken,
    RecipePreviewRequest,
    RecipePreviewResponse,
    SemanticBackendCapabilities,
    SemanticEmbedding,
    SemanticEmbeddingRequest,
    SemanticEmbeddingResponse,
    SemanticRankedScore,
    SemanticRankRequest,
    SemanticRankResponse,
    SemanticReferenceRankRequest,
    SemanticScoreProvenance,
    SemanticTrackResult,
)
from playlist_optimizer.optimization import optimize_tracks, preview_recipe, summarize_tracks
from playlist_optimizer.providers import (
    AudioFeatureProviderRegistry,
    get_audio_feature_provider_registry,
)
from playlist_optimizer.semantic import (
    SemanticBackend,
    SemanticBackendRegistry,
    cosine_similarity,
    get_semantic_backend,
    get_semantic_registry,
    normalize_semantic_label,
    semantic_score_key,
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


@router.get("/semantic/capabilities", response_model=SemanticBackendCapabilities)
def semantic_capabilities(
    backend: Annotated[SemanticBackend, Depends(get_semantic_backend)],
) -> SemanticBackendCapabilities:
    return backend.capabilities()


@router.get("/semantic/backends", response_model=list[SemanticBackendCapabilities])
def semantic_backends(
    registry: Annotated[SemanticBackendRegistry, Depends(get_semantic_registry)],
) -> list[SemanticBackendCapabilities]:
    return registry.infos()


@router.post("/semantic/rank", response_model=SemanticRankResponse)
def rank_semantic_audio(
    payload: SemanticRankRequest,
    http_request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    backend: Annotated[SemanticBackend, Depends(get_semantic_backend)],
    registry: Annotated[SemanticBackendRegistry, Depends(get_semantic_registry)],
) -> SemanticRankResponse:
    _require_loopback(http_request)
    if payload.backend_id != "local-clap":
        selected = registry.get(payload.backend_id)
        if selected is None:
            raise HTTPException(status_code=404, detail="Semantic backend was not found")
        backend = selected
    capabilities = backend.capabilities()
    if "text_similarity" not in capabilities.capabilities:
        raise HTTPException(
            status_code=422, detail="Selected backend does not support text similarity"
        )
    if not capabilities.available:
        raise HTTPException(
            status_code=503, detail=capabilities.detail or "Semantic backend unavailable"
        )
    if (
        len(payload.audio_paths) > capabilities.max_tracks
        or len(payload.labels) > capabilities.max_labels
    ):
        raise HTTPException(
            status_code=422, detail="Semantic ranking request exceeds backend bounds"
        )
    root = settings.semantic_audio_root or settings.clap_audio_root or settings.essentia_audio_root
    if root is None or not root.is_dir():
        raise HTTPException(status_code=503, detail="No authorized local audio root is configured")
    ordered = list(payload.audio_paths.items())
    paths: list[Path] = []
    try:
        for _, relative in ordered:
            requested = Path(relative)
            if requested.is_absolute():
                raise ValueError("Semantic audio paths must be relative")
            resolved = (root / requested).resolve(strict=True)
            resolved.relative_to(root.resolve())
            if not resolved.is_file():
                raise ValueError("Semantic audio path must be a file")
            paths.append(resolved)
    except (ValueError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Invalid authorized audio path") from exc
    labels = [" ".join(label.split()) for label in payload.labels]
    requested_labels = {normalize_semantic_label(label): label for label in labels}
    score_keys_by_normalized_label = {
        normalized: semantic_score_key(capabilities.id, capabilities.model, label)
        for normalized, label in requested_labels.items()
    }
    try:
        ranked = backend.rank(paths, labels)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="Semantic backend returned malformed output"
        ) from exc
    if len(ranked) > len(paths) or any(
        not item.relative_path
        or any(
            not isinstance(score, (int, float)) or not math.isfinite(score)
            for score in item.scores.values()
        )
        or len({normalize_semantic_label(label) for label in item.scores}) != len(item.scores)
        or any(normalize_semantic_label(label) not in requested_labels for label in item.scores)
        for item in ranked
    ):
        raise HTTPException(status_code=502, detail="Semantic backend returned malformed output")
    by_path = {item.relative_path: item for item in ranked}
    provenance = SemanticScoreProvenance(backend=capabilities.id, model=capabilities.model)
    results: list[SemanticTrackResult] = []
    missing: list[str] = []
    for (track_id, _), path in zip(ordered, paths, strict=True):
        item = by_path.get(str(path)) or by_path.get(path.name)
        scores = (
            []
            if item is None
            else [
                SemanticRankedScore(
                    key=semantic_score_key(capabilities.id, capabilities.model, label),
                    label=label,
                    normalized_label=normalize_semantic_label(label),
                    score=score,
                    provenance=provenance,
                )
                for returned_label, score in item.scores.items()
                for normalized_label in [normalize_semantic_label(returned_label)]
                for label in [requested_labels[normalized_label]]
            ]
        )
        if not scores:
            missing.append(track_id)
        results.append(
            SemanticTrackResult(
                track_id=track_id,
                status="complete" if scores else "unavailable",
                scores=scores,
                error=item.error if item else "Backend returned no result",
            )
        )
    return SemanticRankResponse(
        backend=capabilities.model_dump(),
        score_key=semantic_score_key(capabilities.id, capabilities.model, labels[0]),
        score_keys_by_normalized_label=score_keys_by_normalized_label,
        results=results,
        missing_track_ids=missing,
    )


@router.post("/semantic/reference-rank", response_model=SemanticRankResponse)
def rank_semantic_reference(
    payload: SemanticReferenceRankRequest,
    http_request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[SemanticBackendRegistry, Depends(get_semantic_registry)],
) -> SemanticRankResponse:
    _require_loopback(http_request)
    backend = registry.get(payload.backend_id)
    if backend is None:
        raise HTTPException(status_code=404, detail="Semantic backend was not found")
    capabilities = backend.capabilities()
    if not capabilities.available:
        raise HTTPException(
            status_code=503, detail=capabilities.detail or "Semantic backend unavailable"
        )
    if "reference_similarity" not in capabilities.capabilities:
        raise HTTPException(
            status_code=422, detail="Selected backend does not support reference similarity"
        )
    if len(payload.audio_paths) > capabilities.max_tracks:
        raise HTTPException(status_code=422, detail="Reference ranking exceeds backend bounds")
    if payload.reference_track_id not in payload.audio_paths:
        raise HTTPException(
            status_code=422, detail="Reference track must be included in audio_paths"
        )
    paths = _resolve_semantic_paths(payload.audio_paths, settings)
    try:
        embeddings = backend.embed(paths)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if len(embeddings) != len(paths):
        raise HTTPException(status_code=502, detail="Semantic backend returned an invalid batch")
    reference_index = list(payload.audio_paths).index(payload.reference_track_id)
    label = f"similar to {payload.reference_track_id}"
    try:
        _validate_embeddings(embeddings, settings.semantic_max_embedding_dimension)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    key = semantic_score_key(capabilities.id, capabilities.model, label)
    provenance = SemanticScoreProvenance(backend=capabilities.id, model=capabilities.model)
    results = [
        SemanticTrackResult(
            track_id=track_id,
            status="complete",
            scores=[
                SemanticRankedScore(
                    key=key,
                    label=label,
                    normalized_label=normalize_semantic_label(label),
                    score=_finite_similarity(row, embeddings[reference_index]),
                    provenance=provenance,
                )
            ],
        )
        for track_id, row in zip(payload.audio_paths, embeddings, strict=True)
    ]
    return SemanticRankResponse(
        backend=capabilities,
        score_key=key,
        score_keys_by_normalized_label={normalize_semantic_label(label): key},
        results=results,
    )


@router.post("/semantic/embeddings", response_model=SemanticEmbeddingResponse)
def extract_semantic_embeddings(
    payload: SemanticEmbeddingRequest,
    http_request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    registry: Annotated[SemanticBackendRegistry, Depends(get_semantic_registry)],
) -> SemanticEmbeddingResponse:
    _require_loopback(http_request)
    backend = registry.get(payload.backend_id)
    if backend is None:
        raise HTTPException(status_code=404, detail="Semantic backend was not found")
    capabilities = backend.capabilities()
    if not capabilities.available:
        raise HTTPException(
            status_code=503, detail=capabilities.detail or "Semantic backend unavailable"
        )
    if "embedding_extraction" not in capabilities.capabilities:
        raise HTTPException(status_code=422, detail="Selected backend does not expose embeddings")
    if len(payload.audio_paths) > settings.semantic_max_embeddings:
        raise HTTPException(status_code=422, detail="Embedding request exceeds batch limit")
    paths = _resolve_semantic_paths(payload.audio_paths, settings)
    try:
        rows = backend.embed(paths)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if len(rows) != len(paths):
        raise HTTPException(status_code=502, detail="Semantic backend returned an invalid batch")
    try:
        dimension = _validate_embeddings(rows, settings.semantic_max_embedding_dimension)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return SemanticEmbeddingResponse(
        backend=capabilities,
        dimension=dimension,
        embeddings=[
            SemanticEmbedding(track_id=track_id, values=row)
            for track_id, row in zip(payload.audio_paths, rows, strict=True)
        ],
    )


def _resolve_semantic_paths(audio_paths: dict[str, str], settings: Settings) -> list[Path]:
    root = settings.semantic_audio_root or settings.clap_audio_root or settings.essentia_audio_root
    if root is None or not root.is_dir():
        raise HTTPException(status_code=503, detail="No authorized local audio root is configured")
    resolved_paths: list[Path] = []
    try:
        authorized_root = root.resolve()
        for relative in audio_paths.values():
            requested = Path(relative)
            if requested.is_absolute():
                raise ValueError
            resolved = (authorized_root / requested).resolve(strict=True)
            resolved.relative_to(authorized_root)
            if not resolved.is_file():
                raise ValueError
            resolved_paths.append(resolved)
    except (ValueError, FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Invalid authorized audio path") from exc
    return resolved_paths


def _validate_embeddings(rows: list[list[float]], max_dimension: int) -> int:
    dimension = len(rows[0]) if rows else 0
    if not dimension or dimension > max_dimension or any(len(row) != dimension for row in rows):
        raise ValueError("Semantic backend returned invalid embedding dimensions")
    if any(
        not isinstance(value, (int, float)) or not math.isfinite(value)
        for row in rows
        for value in row
    ):
        raise ValueError("Semantic backend returned non-finite embeddings")
    return dimension


def _finite_similarity(left: list[float], right: list[float]) -> float:
    try:
        score = cosine_similarity(left, right)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="Semantic backend returned invalid embeddings"
        ) from exc
    if not math.isfinite(score):
        raise HTTPException(
            status_code=502, detail="Semantic backend returned non-finite embeddings"
        )
    return score


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


@router.get("/local-library/playlists", response_model=LocalPlaylistDiscoveryResponse)
def discover_local_playlists(
    http_request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    path: str = "",
) -> LocalPlaylistDiscoveryResponse:
    _require_loopback(http_request)
    music_root = settings.essentia_audio_root
    if music_root is None or not music_root.is_dir():
        raise HTTPException(
            status_code=503,
            detail="ESSENTIA_AUDIO_ROOT must point to an available local music directory.",
        )
    try:
        return LocalLibraryBrowser(music_root=music_root).discover_playlists(path)
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
