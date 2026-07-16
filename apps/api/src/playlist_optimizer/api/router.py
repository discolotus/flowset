from typing import Annotated

from fastapi import APIRouter, Depends

from playlist_optimizer.config import Settings, get_settings
from playlist_optimizer.data.demo_playlist import DEMO_TRACKS
from playlist_optimizer.models import (
    Capabilities,
    DemoPlaylist,
    OptimizationRequest,
    OptimizationResponse,
)
from playlist_optimizer.optimization import optimize_tracks, summarize_tracks

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


@router.post("/optimize", response_model=OptimizationResponse)
def optimize(request: OptimizationRequest) -> OptimizationResponse:
    return optimize_tracks(request)
