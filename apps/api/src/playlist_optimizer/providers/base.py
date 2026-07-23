from collections.abc import Iterable
from typing import Protocol

from playlist_optimizer.models import (
    AudioFeatureProviderInfo,
    AudioFeatureProviderName,
    AudioFeatureResolutionRequest,
    AudioFeatureResolutionResponse,
)


class AudioFeatureProvider(Protocol):
    @property
    def name(self) -> AudioFeatureProviderName: ...

    def info(self) -> AudioFeatureProviderInfo: ...

    def resolve(self, request: AudioFeatureResolutionRequest) -> AudioFeatureResolutionResponse: ...


class AudioFeatureProviderRegistry:
    """Small injectable registry that keeps API routes independent of provider implementations."""

    def __init__(self, providers: Iterable[AudioFeatureProvider]) -> None:
        self._providers = {provider.name: provider for provider in providers}

    def infos(self) -> list[AudioFeatureProviderInfo]:
        return [self._providers[name].info() for name in sorted(self._providers)]

    def resolve(self, request: AudioFeatureResolutionRequest) -> AudioFeatureResolutionResponse:
        return self._providers[request.provider].resolve(request)
