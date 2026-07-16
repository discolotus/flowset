from typing import Annotated

from fastapi import APIRouter, Depends

from playlist_optimizer.config import Settings, get_settings
from playlist_optimizer.data.demo_playlist import DEMO_TRACKS
from playlist_optimizer.models import (
    Capabilities,
    DemoPlaylist,
    OptimizationRequest,
    OptimizationResponse,
    RecipePreviewRequest,
    RecipePreviewResponse,
)
from playlist_optimizer.optimization import optimize_tracks, preview_recipe, summarize_tracks

router = APIRouter(prefix="/api/v1")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "playlist-optimizer-api"}


@router.get("/capabilities", response_model=Capabilities)
def capabilities(settings: Annotated[Settings, Depends(get_settings)]) -> Capabilities:
    return Capabilities(
        demo_mode=True,
        spotify_oauth_configured=settings.spotify_oauth_configured,
        spotify_metadata=(
            "ready_for_oauth_implementation"
            if settings.spotify_oauth_configured
            else "requires_credentials"
        ),
        audio_features="provider_required_for_new_spotify_apps",
        export="planned",
    )


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
