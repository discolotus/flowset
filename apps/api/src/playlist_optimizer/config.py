from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_ROOT = Path(__file__).resolve().parents[2]
_SEMANTIC_MODEL_ROOT = _API_ROOT / ".models" / "semantic"


class Settings(BaseSettings):
    app_env: str = "development"
    app_origin: str = "http://localhost:5173"
    spotify_client_id: str | None = None
    spotify_redirect_uri: str = "http://127.0.0.1:8000/api/v1/spotify/auth/callback"
    spotify_accounts_base_url: str = "https://accounts.spotify.com"
    spotify_api_base_url: str = "https://api.spotify.com/v1"
    spotify_timeout_seconds: float = Field(default=15.0, gt=0, le=120)
    spotify_max_rate_limit_retries: int = Field(default=2, ge=0, le=5)
    spotify_max_retry_after_seconds: float = Field(default=5.0, ge=0, le=30)
    database_url: str | None = None
    reccobeats_base_url: str = "https://api.reccobeats.com"
    reccobeats_timeout_seconds: float = 15.0
    reccobeats_max_rate_limit_retries: int = 1
    essentia_audio_root: Path | None = None
    essentia_model_dir: Path | None = None
    essentia_mood_worker_timeout_seconds: float = 180.0
    clap_checkpoint: Path | None = _SEMANTIC_MODEL_ROOT / "clap" / "630k-audioset-best.pt"
    clap_audio_root: Path | None = None
    clap_max_tracks: int = Field(default=100, ge=1, le=500)
    clap_max_labels: int = Field(default=20, ge=1, le=50)
    muq_mulan_checkpoint: Path | None = _SEMANTIC_MODEL_ROOT / "muq-mulan"
    mert_checkpoint: Path | None = _SEMANTIC_MODEL_ROOT / "mert" / "MERT-v1-95M"
    semantic_audio_root: Path | None = None
    semantic_max_embeddings: int = Field(default=20, ge=1, le=20)
    semantic_max_embedding_dimension: int = Field(default=4096, ge=1, le=8192)

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def spotify_oauth_configured(self) -> bool:
        return bool(self.spotify_client_id)


@lru_cache
def get_settings() -> Settings:
    return Settings()
