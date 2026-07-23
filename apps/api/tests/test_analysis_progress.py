from datetime import UTC, datetime, timedelta

from playlist_optimizer.analysis_progress import AnalysisProgressRegistry
from playlist_optimizer.models import Track


class _Clock:
    def __init__(self) -> None:
        self.monotonic_value = 100.0
        self.wall_value = datetime(2026, 7, 19, 12, 0, tzinfo=UTC)

    def monotonic(self) -> float:
        return self.monotonic_value

    def utcnow(self) -> datetime:
        return self.wall_value

    def advance(self, seconds: float) -> None:
        self.monotonic_value += seconds
        self.wall_value += timedelta(seconds=seconds)


def _track(track_id: str, name: str, duration_ms: int) -> Track:
    return Track(
        id=track_id,
        name=name,
        artist="Test artist",
        album="Test album",
        duration_ms=duration_ms,
    )


def test_progress_snapshot_reports_real_stage_timings_current_track_and_eta() -> None:
    clock = _Clock()
    registry = AnalysisProgressRegistry(
        ttl_seconds=60,
        monotonic=clock.monotonic,
        utcnow=clock.utcnow,
    )
    tracks = [
        _track("first", "First track", 180_000),
        _track("second", "Second track", 240_000),
    ]
    reporter = registry.begin("progress-token-1234", "essentia", tracks)

    reporter.track_started(tracks[0])
    reporter.stage_started("native_dsp")
    clock.advance(2)
    active = registry.get("progress-token-1234")

    assert active is not None
    assert active.phase == "native_dsp"
    assert active.completed_track_count == 0
    assert active.current_track is not None
    assert active.current_track.track_id == "first"
    assert active.current_track.track_name == "First track"
    assert active.current_track.duration_ms == 180_000
    assert active.tracks[0].stages.native_dsp.state == "active"
    assert active.tracks[0].stages.native_dsp.elapsed_seconds == 2

    reporter.stage_completed("native_dsp")
    reporter.stage_started("tensorflow")
    clock.advance(3)
    reporter.stage_completed("tensorflow")
    reporter.track_completed()
    reporter.track_started(tracks[1])
    clock.advance(1)
    second = registry.get("progress-token-1234")

    assert second is not None
    assert second.completed_track_count == 1
    assert second.successful_track_count == 1
    assert second.progress_fraction == 0.5
    assert second.estimated_remaining_seconds == 4
    assert second.tracks[0].elapsed_seconds == 5
    assert second.tracks[0].stages.native_dsp.elapsed_seconds == 2
    assert second.tracks[0].stages.tensorflow.elapsed_seconds == 3

    reporter.track_unavailable("No local audio path was supplied.")
    reporter.finalizing()
    finalizing = registry.get("progress-token-1234")

    assert finalizing is not None
    assert finalizing.phase == "finalizing"
    assert finalizing.completed_track_count == 2
    assert finalizing.progress_fraction == 0.99
    assert finalizing.estimated_remaining_seconds is None

    reporter.completed()
    completed = registry.get("progress-token-1234")

    assert completed is not None
    assert completed.phase == "complete"
    assert completed.completed_track_count == 2
    assert completed.successful_track_count == 1
    assert completed.failed_track_count == 1
    assert completed.progress_fraction == 1
    assert completed.estimated_remaining_seconds == 0
    assert completed.current_track is None
    assert completed.tracks[1].status == "unavailable"
    assert completed.tracks[1].stages.native_dsp.state == "skipped"
    assert completed.tracks[1].stages.tensorflow.state == "skipped"


def test_eta_becomes_unknown_when_the_current_track_exceeds_the_observed_average() -> None:
    clock = _Clock()
    registry = AnalysisProgressRegistry(
        ttl_seconds=60,
        monotonic=clock.monotonic,
        utcnow=clock.utcnow,
    )
    tracks = [
        _track("first", "First track", 180_000),
        _track("slow", "Slow track", 600_000),
    ]
    reporter = registry.begin("progress-token-slow", "essentia", tracks)
    reporter.track_started(tracks[0])
    reporter.stage_started("native_dsp")
    clock.advance(5)
    reporter.stage_completed("native_dsp")
    reporter.stage_skipped("tensorflow", "Not needed for this timing fixture.")
    reporter.track_completed()
    reporter.track_started(tracks[1])
    reporter.stage_started("native_dsp")
    clock.advance(6)

    snapshot = registry.get("progress-token-slow")

    assert snapshot is not None
    assert snapshot.current_track is not None
    assert snapshot.current_track.track_id == "slow"
    assert snapshot.estimated_remaining_seconds is None


def test_completed_progress_expires_after_the_registry_ttl() -> None:
    clock = _Clock()
    registry = AnalysisProgressRegistry(
        ttl_seconds=10,
        monotonic=clock.monotonic,
        utcnow=clock.utcnow,
    )
    track = _track("track", "Track", 180_000)
    reporter = registry.begin("progress-token-5678", "essentia", [track])
    reporter.track_started(track)
    reporter.track_unavailable("Missing audio.")
    reporter.completed()

    clock.advance(9.9)
    assert registry.get("progress-token-5678") is not None

    clock.advance(0.1)
    assert registry.get("progress-token-5678") is None
