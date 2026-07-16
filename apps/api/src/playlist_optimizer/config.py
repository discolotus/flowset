from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    app_origin: str = "http://localhost:5173"
    spotify_client_id: str | None = None
    spotify_client_secret: str | None = None
    spotify_redirect_uri: str = "http://127.0.0.1:8000/api/v1/auth/spotify/callback"
    database_url: str | None = None

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def spotify_oauth_configured(self) -> bool:
        return bool(self.spotify_client_id and self.spotify_client_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()
