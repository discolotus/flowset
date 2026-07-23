from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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
