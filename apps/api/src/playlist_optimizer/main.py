from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from playlist_optimizer import __version__
from playlist_optimizer.api.router import router
from playlist_optimizer.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Spotify Playlist Optimizer API",
    summary="Provider-neutral playlist analysis and optimization service.",
    version=__version__,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.app_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"name": app.title, "docs": "/docs"}
