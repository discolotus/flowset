import re
import time
from collections.abc import Callable, Sequence
from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from playlist_optimizer.models import (
    AudioFeatureProvenance,
    AudioFeatureProviderInfo,
    AudioFeatureProviderName,
    AudioFeatureResolutionRequest,
    AudioFeatureResolutionResponse,
    AudioFeatures,
    Track,
)

_SPOTIFY_ID = re.compile(r"^[A-Za-z0-9]{22}$")
_ISRC = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$")
_MAX_BATCH_SIZE = 40


class ReccoBeatsProvider:
    """Resolve ReccoBeats catalog features from Spotify track IDs in batches of at most 40."""

    name: AudioFeatureProviderName = "reccobeats"

    def __init__(
        self,
        *,
        client: httpx.Client,
        sleeper: Callable[[float], None] = time.sleep,
        max_rate_limit_retries: int = 1,
        batch_size: int = _MAX_BATCH_SIZE,
    ) -> None:
        if not 1 <= batch_size <= _MAX_BATCH_SIZE:
            raise ValueError("ReccoBeats batch_size must be between 1 and 40")
        self._client = client
        self._sleeper = sleeper
        self._max_rate_limit_retries = max_rate_limit_retries
        self._batch_size = batch_size

    def info(self) -> AudioFeatureProviderInfo:
        return AudioFeatureProviderInfo(
            id=self.name,
            display_name="ReccoBeats",
            status="available",
            requires_local_audio=False,
            detail=(
                "Matches Spotify track IDs against the ReccoBeats catalog. Coverage varies and "
                "unmatched tracks remain available without audio features."
            ),
        )

    def resolve(self, request: AudioFeatureResolutionRequest) -> AudioFeatureResolutionResponse:
        spotify_ids_by_track = {
            track.id: spotify_id
            for track in request.tracks
            if (spotify_id := _spotify_track_id(track)) is not None
        }
        isrcs_by_track = {
            track.id: isrc
            for track in request.tracks
            if (isrc := _normalized_isrc(track.isrc)) is not None
        }
        identifiers_by_track = {
            track.id: spotify_ids_by_track.get(track.id) or isrcs_by_track.get(track.id)
            for track in request.tracks
        }
        requested_identifiers = list(
            dict.fromkeys(
                identifier for identifier in identifiers_by_track.values() if identifier is not None
            )
        )
        track_ids_by_spotify_id: dict[str, list[str]] = {}
        track_ids_by_isrc: dict[str, list[str]] = {}
        for track in request.tracks:
            spotify_id = spotify_ids_by_track.get(track.id)
            isrc = isrcs_by_track.get(track.id)
            if spotify_id:
                track_ids_by_spotify_id.setdefault(spotify_id, []).append(track.id)
            if isrc:
                track_ids_by_isrc.setdefault(isrc, []).append(track.id)

        features_by_track_id: dict[str, tuple[AudioFeatures, str | None, str | None]] = {}
        warnings: list[str] = []
        failed_batches = 0

        for batch in _chunks(requested_identifiers, self._batch_size):
            try:
                payload = self._get_batch(batch)
            except (httpx.HTTPError, ValueError) as exc:
                failed_batches += 1
                warnings.append(f"ReccoBeats request failed for {len(batch)} track(s): {exc}")
                continue
            for item in payload:
                spotify_id = _spotify_id_from_href(item.get("href"))
                isrc = _normalized_isrc(_optional_string(item.get("isrc")))
                matched_track_ids = list(track_ids_by_spotify_id.get(spotify_id or "", []))
                matched_track_ids.extend(track_ids_by_isrc.get(isrc or "", []))
                matched_track_ids = list(dict.fromkeys(matched_track_ids))
                if not matched_track_ids:
                    continue
                try:
                    audio_features = AudioFeatures.model_validate(item)
                except ValidationError as exc:
                    warnings.append(
                        "ReccoBeats returned invalid features for "
                        f"{spotify_id or isrc or 'an unknown track'}: "
                        f"{exc.errors()[0]['msg']}"
                    )
                    continue
                for track_id in matched_track_ids:
                    features_by_track_id[track_id] = (
                        audio_features,
                        _optional_string(item.get("id")),
                        _optional_string(item.get("href")),
                    )

        enriched_tracks: list[Track] = []
        unavailable_track_ids: list[str] = []
        for track in request.tracks:
            resolved = features_by_track_id.get(track.id)
            if resolved is None:
                unavailable_track_ids.append(track.id)
                enriched_tracks.append(_without_audio_features(track))
                continue
            features, source_id, source_url = resolved
            enriched_tracks.append(
                track.model_copy(
                    update={
                        "audio_features": features,
                        "audio_feature_provenance": AudioFeatureProvenance(
                            provider=self.name,
                            source_id=source_id,
                            source_url=source_url,
                        ),
                    }
                )
            )

        analyzed_count = len(request.tracks) - len(unavailable_track_ids)
        if not requested_identifiers:
            warnings.append("No valid Spotify track IDs or ISRCs were present in the request.")
        if unavailable_track_ids:
            warnings.append(
                f"ReccoBeats had no usable audio features for {len(unavailable_track_ids)} "
                "track(s); those tracks were retained without provider features."
            )
        if analyzed_count == len(request.tracks):
            status = "complete"
        elif analyzed_count:
            status = "partial"
        elif failed_batches and failed_batches == len(
            _chunks(requested_identifiers, self._batch_size)
        ):
            status = "failed"
        else:
            status = "unavailable"
        return AudioFeatureResolutionResponse(
            provider=self.name,
            status=status,
            tracks=enriched_tracks,
            analyzed_track_count=analyzed_count,
            unavailable_track_ids=unavailable_track_ids,
            warnings=warnings,
        )

    def _get_batch(self, spotify_ids: Sequence[str]) -> list[dict[str, object]]:
        attempts = 0
        while True:
            response = self._client.get(
                "/v1/audio-features",
                params={"ids": ",".join(spotify_ids)},
            )
            if response.status_code != 429 or attempts >= self._max_rate_limit_retries:
                response.raise_for_status()
                break
            attempts += 1
            retry_after = _retry_after_seconds(response.headers.get("Retry-After"))
            self._sleeper(retry_after)

        body = response.json()
        if not isinstance(body, dict) or not isinstance(body.get("content"), list):
            raise ValueError("ReccoBeats response did not contain a content list")
        return [item for item in body["content"] if isinstance(item, dict)]


def _chunks(values: Sequence[str], size: int) -> list[Sequence[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _spotify_track_id(track: Track) -> str | None:
    candidates = [track.id]
    if track.uri and track.uri.startswith("spotify:track:"):
        candidates.insert(0, track.uri.removeprefix("spotify:track:"))
    if track.external_url:
        candidates.insert(0, urlparse(track.external_url).path.rstrip("/").split("/")[-1])
    return next((candidate for candidate in candidates if _SPOTIFY_ID.fullmatch(candidate)), None)


def _spotify_id_from_href(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = urlparse(value).path.rstrip("/").split("/")[-1]
    return candidate if _SPOTIFY_ID.fullmatch(candidate) else None


def _retry_after_seconds(value: str | None) -> float:
    try:
        return max(float(value or 1), 0)
    except ValueError:
        return 1


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _normalized_isrc(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip().upper()
    return candidate if _ISRC.fullmatch(candidate) else None


def _without_audio_features(track: Track) -> Track:
    """Prevent a prior provider's values from becoming an undisclosed fallback."""

    return track.model_copy(update={"audio_features": None, "audio_feature_provenance": None})
