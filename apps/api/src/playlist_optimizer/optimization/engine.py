from collections.abc import Iterable

from playlist_optimizer.models import (
    ConstraintViolation,
    GeneratedPlaylist,
    OptimizationRequest,
    OptimizationResponse,
    PlaylistSummary,
    Track,
)
from playlist_optimizer.optimization.camelot import camelot_key

_BUCKETS = (
    ("Very Chill", 0.0, 0.2),
    ("Relaxed", 0.2, 0.4),
    ("Medium", 0.4, 0.6),
    ("High", 0.6, 0.8),
    ("Peak", 0.8, 1.01),
)


def _energy(track: Track) -> float:
    if track.audio_features is None or track.audio_features.energy is None:
        return 2.0
    return track.audio_features.energy


def _tempo(track: Track) -> float:
    if track.audio_features is None or track.audio_features.tempo is None:
        return 999.0
    return track.audio_features.tempo


def summarize_tracks(tracks: Iterable[Track]) -> PlaylistSummary:
    track_list = list(tracks)
    featured = [track.audio_features for track in track_list if track.audio_features]
    energies = [features.energy for features in featured if features.energy is not None]

    def mean(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 3) if values else None

    return PlaylistSummary(
        song_count=len(track_list),
        duration_ms=sum(track.duration_ms for track in track_list),
        average_energy=mean(energies),
        average_bpm=mean([features.tempo for features in featured if features.tempo is not None]),
        average_danceability=mean(
            [features.danceability for features in featured if features.danceability is not None]
        ),
        energy_range=(round(min(energies), 3), round(max(energies), 3)) if energies else None,
    )


def _energy_pyramid(tracks: list[Track]) -> list[Track]:
    ordered = sorted(tracks, key=lambda track: (_energy(track), _tempo(track)))
    return ordered[::2] + list(reversed(ordered[1::2]))


def _single_order(request: OptimizationRequest, tracks: list[Track]) -> list[Track]:
    if request.strategy == "energy_progression":
        return sorted(tracks, key=lambda track: (_energy(track), _tempo(track), camelot_key(track)))
    if request.strategy == "energy_pyramid":
        return _energy_pyramid(tracks)
    if request.strategy == "bpm_first":
        return sorted(
            tracks,
            key=lambda track: (int(_tempo(track) // 10), camelot_key(track), _tempo(track)),
        )
    if request.strategy == "key_first":
        return sorted(tracks, key=lambda track: (camelot_key(track), _tempo(track)))
    return sorted(
        tracks,
        key=lambda track: (round(_energy(track), 1), int(_tempo(track) // 5), camelot_key(track)),
    )


def _constraint_violations(
    tracks: list[Track], request: OptimizationRequest
) -> list[ConstraintViolation]:
    violations: list[ConstraintViolation] = []
    constraints = request.constraints
    recent_artists: list[str] = []

    for index, track in enumerate(tracks):
        features = track.audio_features
        if constraints.minimum_artist_spacing and track.artist in recent_artists:
            violations.append(
                ConstraintViolation(
                    kind="artist_spacing",
                    position=index,
                    message=f"{track.artist} repeats within the requested spacing.",
                )
            )
        if constraints.minimum_artist_spacing:
            recent_artists.append(track.artist)
            recent_artists = recent_artists[-constraints.minimum_artist_spacing :]

        if index == 0 or features is None:
            continue
        previous = tracks[index - 1].audio_features
        if previous is None:
            continue
        bpm_jump = (
            abs(features.tempo - previous.tempo)
            if features.tempo is not None and previous.tempo is not None
            else None
        )
        energy_jump = (
            abs(features.energy - previous.energy)
            if features.energy is not None and previous.energy is not None
            else None
        )
        if (
            constraints.maximum_bpm_jump
            and bpm_jump is not None
            and bpm_jump > constraints.maximum_bpm_jump
        ):
            violations.append(
                ConstraintViolation(
                    kind="bpm_jump",
                    position=index,
                    message=f"BPM changes by {bpm_jump:.1f}.",
                )
            )
        if (
            constraints.maximum_energy_jump
            and energy_jump is not None
            and energy_jump > constraints.maximum_energy_jump
        ):
            violations.append(
                ConstraintViolation(
                    kind="energy_jump",
                    position=index,
                    message=f"Energy changes by {energy_jump:.2f}.",
                )
            )
        if constraints.avoid_duplicate_artists and track.artist == tracks[index - 1].artist:
            violations.append(
                ConstraintViolation(
                    kind="duplicate_artist",
                    position=index,
                    message=f"{track.artist} appears on consecutive tracks.",
                )
            )
    return violations


def _generated(name: str, tracks: list[Track], request: OptimizationRequest) -> GeneratedPlaylist:
    return GeneratedPlaylist(
        name=name,
        tracks=tracks,
        summary=summarize_tracks(tracks),
        violations=_constraint_violations(tracks, request),
    )


def optimize_tracks(request: OptimizationRequest) -> OptimizationResponse:
    warnings: list[str] = []
    tracks = request.tracks
    if request.constraints.exclude_explicit:
        tracks = [track for track in tracks if not track.explicit]
    missing_count = sum(track.audio_features is None for track in tracks)
    if missing_count:
        warnings.append(
            f"{missing_count} track(s) have no audio features and were placed after "
            "analyzed tracks."
        )

    if request.strategy == "energy_buckets":
        playlists = []
        for label, lower, upper in _BUCKETS:
            bucket = [
                track
                for track in tracks
                if track.audio_features
                and track.audio_features.energy is not None
                and lower <= track.audio_features.energy < upper
            ]
            if bucket:
                ordered = sorted(bucket, key=lambda track: (_tempo(track), camelot_key(track)))
                playlists.append(_generated(f"{request.name} — {label}", ordered, request))
        missing = [
            track
            for track in tracks
            if track.audio_features is None or track.audio_features.energy is None
        ]
        if missing:
            playlists.append(_generated(f"{request.name} — Unanalyzed", missing, request))
    else:
        playlists = [_generated(request.name, _single_order(request, tracks), request)]

    if any(playlist.violations for playlist in playlists):
        warnings.append(
            "The deterministic V1 strategies report constraint violations but do not yet run a "
            "global constraint solver."
        )
    return OptimizationResponse(
        strategy=request.strategy,
        generated_playlists=playlists,
        warnings=warnings,
    )
