from functools import lru_cache

import httpx

from playlist_optimizer.config import Settings, get_settings
from playlist_optimizer.providers.base import AudioFeatureProviderRegistry
from playlist_optimizer.providers.essentia import EssentiaProvider
from playlist_optimizer.providers.reccobeats import ReccoBeatsProvider


def create_audio_feature_provider_registry(settings: Settings) -> AudioFeatureProviderRegistry:
    reccobeats_client = httpx.Client(
        base_url=settings.reccobeats_base_url.rstrip("/"),
        timeout=settings.reccobeats_timeout_seconds,
        headers={"Accept": "application/json"},
    )
    return AudioFeatureProviderRegistry(
        [
            ReccoBeatsProvider(
                client=reccobeats_client,
                max_rate_limit_retries=settings.reccobeats_max_rate_limit_retries,
            ),
            EssentiaProvider(
                audio_root=settings.essentia_audio_root,
                model_dir=settings.essentia_model_dir,
                mood_worker_timeout_seconds=settings.essentia_mood_worker_timeout_seconds,
            ),
        ]
    )


@lru_cache
def get_audio_feature_provider_registry() -> AudioFeatureProviderRegistry:
    return create_audio_feature_provider_registry(get_settings())
