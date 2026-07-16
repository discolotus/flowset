from playlist_optimizer.data.demo_playlist import DEMO_TRACKS
from playlist_optimizer.models import Constraints, OptimizationRequest
from playlist_optimizer.optimization import optimize_tracks


def test_energy_progression_is_monotonic() -> None:
    result = optimize_tracks(
        OptimizationRequest(
            strategy="energy_progression",
            tracks=list(reversed(DEMO_TRACKS)),
        )
    )

    energies = [
        track.audio_features.energy
        for track in result.generated_playlists[0].tracks
        if track.audio_features
    ]
    assert energies == sorted(energies)


def test_energy_buckets_keep_every_track() -> None:
    result = optimize_tracks(
        OptimizationRequest(strategy="energy_buckets", tracks=DEMO_TRACKS)
    )

    generated_ids = {
        track.id for playlist in result.generated_playlists for track in playlist.tracks
    }
    assert generated_ids == {track.id for track in DEMO_TRACKS}


def test_explicit_filter_is_applied() -> None:
    result = optimize_tracks(
        OptimizationRequest(
            tracks=DEMO_TRACKS,
            constraints=Constraints(exclude_explicit=True),
        )
    )

    assert all(not track.explicit for track in result.generated_playlists[0].tracks)


def test_pyramid_reaches_peak_before_the_end() -> None:
    result = optimize_tracks(
        OptimizationRequest(strategy="energy_pyramid", tracks=DEMO_TRACKS)
    )
    energies = [
        track.audio_features.energy
        for track in result.generated_playlists[0].tracks
        if track.audio_features
    ]
    peak_index = energies.index(max(energies))

    assert 0 < peak_index < len(energies) - 1
    assert energies[: peak_index + 1] == sorted(energies[: peak_index + 1])
    assert energies[peak_index:] == sorted(energies[peak_index:], reverse=True)
