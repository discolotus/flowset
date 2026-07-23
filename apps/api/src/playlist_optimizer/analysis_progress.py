import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from functools import lru_cache

from playlist_optimizer.models import (
    AnalysisProgressCurrentTrack,
    AnalysisProgressPhase,
    AnalysisProgressStageSnapshot,
    AnalysisProgressTrackSnapshot,
    AnalysisProgressTrackStages,
    AnalysisStageState,
    AnalysisTrackStatus,
    AudioFeatureProgressSnapshot,
    AudioFeatureProviderName,
    ProgressToken,
    Track,
)

ProgressStage = str
_TERMINAL_TRACK_STATES = {"complete", "error", "unavailable"}
_TERMINAL_PHASES = {"complete", "error"}


@dataclass
class _StageProgress:
    state: AnalysisStageState = "pending"
    started_at: datetime | None = None
    started_monotonic: float | None = None
    completed_at: datetime | None = None
    elapsed_seconds: float | None = None
    error: str | None = None


@dataclass
class _TrackProgress:
    track_id: str
    track_name: str
    duration_ms: int
    status: AnalysisTrackStatus = "pending"
    started_at: datetime | None = None
    started_monotonic: float | None = None
    completed_at: datetime | None = None
    elapsed_seconds: float | None = None
    error: str | None = None
    native_dsp: _StageProgress = field(default_factory=_StageProgress)
    tensorflow: _StageProgress = field(default_factory=_StageProgress)


@dataclass
class _RunProgress:
    progress_token: str
    provider: AudioFeatureProviderName
    phase: AnalysisProgressPhase
    tracks: list[_TrackProgress]
    started_at: datetime
    started_monotonic: float
    updated_at: datetime
    updated_monotonic: float
    current_track_id: str | None = None
    completed_at: datetime | None = None
    elapsed_seconds: float | None = None
    error: str | None = None


class AnalysisProgressReporter:
    """A token-bound, thread-safe observer used by synchronous provider work."""

    def __init__(self, registry: "AnalysisProgressRegistry", progress_token: str) -> None:
        self._registry = registry
        self._progress_token = progress_token

    def track_started(self, track: Track) -> None:
        self._registry.track_started(self._progress_token, track.id)

    def stage_started(self, stage: ProgressStage) -> None:
        self._registry.stage_started(self._progress_token, stage)

    def stage_completed(self, stage: ProgressStage) -> None:
        self._registry.stage_completed(self._progress_token, stage)

    def stage_skipped(self, stage: ProgressStage, reason: str) -> None:
        self._registry.stage_skipped(self._progress_token, stage, reason)

    def stage_error(self, stage: ProgressStage, error: str) -> None:
        self._registry.stage_error(self._progress_token, stage, error)

    def track_completed(self) -> None:
        self._registry.track_completed(self._progress_token)

    def track_error(self, error: str) -> None:
        self._registry.track_error(self._progress_token, error)

    def track_unavailable(self, reason: str) -> None:
        self._registry.track_unavailable(self._progress_token, reason)

    def finalizing(self) -> None:
        self._registry.finalizing(self._progress_token)

    def completed(self) -> None:
        self._registry.completed(self._progress_token)

    def failed(self, error: str) -> None:
        self._registry.failed(self._progress_token, error)


class AnalysisProgressRegistry:
    """Thread-safe, process-local progress snapshots retained briefly after completion."""

    def __init__(
        self,
        *,
        ttl_seconds: float = 3_600,
        monotonic: Callable[[], float] = time.monotonic,
        utcnow: Callable[[], datetime] | None = None,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("Analysis progress TTL must be greater than zero.")
        self._ttl_seconds = ttl_seconds
        self._monotonic = monotonic
        self._utcnow = utcnow or (lambda: datetime.now(UTC))
        self._lock = threading.RLock()
        self._runs: dict[str, _RunProgress] = {}

    def begin(
        self,
        progress_token: ProgressToken,
        provider: AudioFeatureProviderName,
        tracks: list[Track],
    ) -> AnalysisProgressReporter:
        now_monotonic = self._monotonic()
        now = self._utcnow()
        with self._lock:
            self._purge_expired(now_monotonic)
            self._runs[progress_token] = _RunProgress(
                progress_token=progress_token,
                provider=provider,
                phase="queued",
                tracks=[
                    _TrackProgress(
                        track_id=track.id,
                        track_name=track.name,
                        duration_ms=track.duration_ms,
                    )
                    for track in tracks
                ],
                started_at=now,
                started_monotonic=now_monotonic,
                updated_at=now,
                updated_monotonic=now_monotonic,
            )
        return AnalysisProgressReporter(self, progress_token)

    def get(self, progress_token: ProgressToken) -> AudioFeatureProgressSnapshot | None:
        now_monotonic = self._monotonic()
        with self._lock:
            self._purge_expired(now_monotonic)
            run = self._runs.get(progress_token)
            return self._snapshot(run, now_monotonic) if run is not None else None

    def clear(self) -> None:
        with self._lock:
            self._runs.clear()

    def track_started(self, progress_token: str, track_id: str) -> None:
        with self._lock:
            run = self._required_run(progress_token)
            track = self._track(run, track_id)
            now, now_monotonic = self._now()
            run.current_track_id = track_id
            run.phase = "preparing"
            track.status = "running"
            track.started_at = now
            track.started_monotonic = now_monotonic
            track.completed_at = None
            track.elapsed_seconds = None
            track.error = None
            self._touch(run, now, now_monotonic)

    def stage_started(self, progress_token: str, stage: ProgressStage) -> None:
        with self._lock:
            run, track = self._current_track(progress_token)
            stage_progress = self._stage(track, stage)
            now, now_monotonic = self._now()
            stage_progress.state = "active"
            stage_progress.started_at = now
            stage_progress.started_monotonic = now_monotonic
            stage_progress.completed_at = None
            stage_progress.elapsed_seconds = None
            stage_progress.error = None
            run.phase = self._phase_for_stage(stage)
            self._touch(run, now, now_monotonic)

    def stage_completed(self, progress_token: str, stage: ProgressStage) -> None:
        self._finish_stage(progress_token, stage, "complete", None)

    def stage_skipped(self, progress_token: str, stage: ProgressStage, reason: str) -> None:
        self._finish_stage(progress_token, stage, "skipped", reason)

    def stage_error(self, progress_token: str, stage: ProgressStage, error: str) -> None:
        self._finish_stage(progress_token, stage, "error", error)

    def track_completed(self, progress_token: str) -> None:
        self._finish_track(progress_token, "complete", None)

    def track_error(self, progress_token: str, error: str) -> None:
        self._finish_track(progress_token, "error", error)

    def track_unavailable(self, progress_token: str, reason: str) -> None:
        self._finish_track(progress_token, "unavailable", reason)

    def finalizing(self, progress_token: str) -> None:
        with self._lock:
            run = self._required_run(progress_token)
            now, now_monotonic = self._now()
            run.current_track_id = None
            run.phase = "finalizing"
            self._touch(run, now, now_monotonic)

    def completed(self, progress_token: str) -> None:
        with self._lock:
            run = self._required_run(progress_token)
            now, now_monotonic = self._now()
            run.current_track_id = None
            run.phase = "complete"
            run.completed_at = now
            run.elapsed_seconds = max(0.0, now_monotonic - run.started_monotonic)
            self._touch(run, now, now_monotonic)

    def failed(self, progress_token: str, error: str) -> None:
        with self._lock:
            run = self._required_run(progress_token)
            now, now_monotonic = self._now()
            for track in run.tracks:
                if track.status not in _TERMINAL_TRACK_STATES:
                    self._finish_track_value(track, "error", error, now, now_monotonic)
            run.current_track_id = None
            run.phase = "error"
            run.completed_at = now
            run.elapsed_seconds = max(0.0, now_monotonic - run.started_monotonic)
            run.error = error
            self._touch(run, now, now_monotonic)

    def _finish_stage(
        self,
        progress_token: str,
        stage: ProgressStage,
        state: AnalysisStageState,
        error: str | None,
    ) -> None:
        with self._lock:
            run, track = self._current_track(progress_token)
            stage_progress = self._stage(track, stage)
            now, now_monotonic = self._now()
            self._finish_stage_value(stage_progress, state, error, now, now_monotonic)
            self._touch(run, now, now_monotonic)

    def _finish_track(
        self,
        progress_token: str,
        status: AnalysisTrackStatus,
        error: str | None,
    ) -> None:
        with self._lock:
            run, track = self._current_track(progress_token)
            now, now_monotonic = self._now()
            self._finish_track_value(track, status, error, now, now_monotonic)
            run.current_track_id = None
            run.phase = "preparing"
            self._touch(run, now, now_monotonic)

    def _finish_track_value(
        self,
        track: _TrackProgress,
        status: AnalysisTrackStatus,
        error: str | None,
        now: datetime,
        now_monotonic: float,
    ) -> None:
        for stage_name in ("native_dsp", "tensorflow"):
            stage = self._stage(track, stage_name)
            if stage.state == "active":
                self._finish_stage_value(stage, "error", error, now, now_monotonic)
            elif stage.state == "pending":
                self._finish_stage_value(
                    stage,
                    "skipped",
                    "Track did not reach this analysis stage.",
                    now,
                    now_monotonic,
                )
        track.status = status
        track.completed_at = now
        track.elapsed_seconds = (
            max(0.0, now_monotonic - track.started_monotonic)
            if track.started_monotonic is not None
            else 0.0
        )
        track.error = error

    @staticmethod
    def _finish_stage_value(
        stage: _StageProgress,
        state: AnalysisStageState,
        error: str | None,
        now: datetime,
        now_monotonic: float,
    ) -> None:
        stage.state = state
        stage.completed_at = now
        stage.elapsed_seconds = (
            max(0.0, now_monotonic - stage.started_monotonic)
            if stage.started_monotonic is not None
            else 0.0
        )
        stage.error = error

    def _snapshot(self, run: _RunProgress, now_monotonic: float) -> AudioFeatureProgressSnapshot:
        tracks = [self._track_snapshot(track, now_monotonic) for track in run.tracks]
        completed_count = sum(track.status in _TERMINAL_TRACK_STATES for track in run.tracks)
        successful_count = sum(track.status == "complete" for track in run.tracks)
        failed_count = sum(track.status in {"error", "unavailable"} for track in run.tracks)
        total_count = len(run.tracks)
        current = next(
            (track for track in run.tracks if track.track_id == run.current_track_id),
            None,
        )
        elapsed = (
            run.elapsed_seconds
            if run.elapsed_seconds is not None
            else max(0.0, now_monotonic - run.started_monotonic)
        )
        return AudioFeatureProgressSnapshot(
            progress_token=run.progress_token,
            provider=run.provider,
            phase=run.phase,
            completed_track_count=completed_count,
            total_track_count=total_count,
            successful_track_count=successful_count,
            failed_track_count=failed_count,
            progress_fraction=self._progress_fraction(run, completed_count),
            current_track=(
                AnalysisProgressCurrentTrack(
                    track_id=current.track_id,
                    track_name=current.track_name,
                    duration_ms=current.duration_ms,
                )
                if current is not None
                else None
            ),
            started_at=run.started_at,
            updated_at=run.updated_at,
            completed_at=run.completed_at,
            elapsed_seconds=elapsed,
            estimated_remaining_seconds=self._estimated_remaining_seconds(
                run, completed_count, now_monotonic
            ),
            tracks=tracks,
            error=run.error,
        )

    def _track_snapshot(
        self, track: _TrackProgress, now_monotonic: float
    ) -> AnalysisProgressTrackSnapshot:
        elapsed = track.elapsed_seconds
        if elapsed is None and track.started_monotonic is not None:
            elapsed = max(0.0, now_monotonic - track.started_monotonic)
        return AnalysisProgressTrackSnapshot(
            track_id=track.track_id,
            track_name=track.track_name,
            duration_ms=track.duration_ms,
            status=track.status,
            started_at=track.started_at,
            completed_at=track.completed_at,
            elapsed_seconds=elapsed,
            error=track.error,
            stages=AnalysisProgressTrackStages(
                native_dsp=self._stage_snapshot(track.native_dsp, now_monotonic),
                tensorflow=self._stage_snapshot(track.tensorflow, now_monotonic),
            ),
        )

    @staticmethod
    def _stage_snapshot(
        stage: _StageProgress, now_monotonic: float
    ) -> AnalysisProgressStageSnapshot:
        elapsed = stage.elapsed_seconds
        if elapsed is None and stage.started_monotonic is not None:
            elapsed = max(0.0, now_monotonic - stage.started_monotonic)
        return AnalysisProgressStageSnapshot(
            state=stage.state,
            started_at=stage.started_at,
            completed_at=stage.completed_at,
            elapsed_seconds=elapsed,
            error=stage.error,
        )

    @staticmethod
    def _estimated_remaining_seconds(
        run: _RunProgress, completed_count: int, now_monotonic: float
    ) -> float | None:
        if run.phase == "finalizing":
            return None
        remaining_count = len(run.tracks) - completed_count
        if remaining_count == 0:
            return 0.0
        completed_timings = [
            track.elapsed_seconds
            for track in run.tracks
            if track.status == "complete" and track.elapsed_seconds is not None
        ]
        if not completed_timings:
            return None
        average = sum(completed_timings) / len(completed_timings)
        estimate = average * remaining_count
        if run.current_track_id is not None:
            current = next(track for track in run.tracks if track.track_id == run.current_track_id)
            if current.started_monotonic is not None:
                current_elapsed = max(0.0, now_monotonic - current.started_monotonic)
                if current_elapsed >= average:
                    # Once a track exceeds the observed mean there is no evidence-backed way to
                    # estimate its remaining work. Unknown is more honest than displaying zero.
                    return None
                estimate -= current_elapsed
        return max(0.0, estimate)

    @staticmethod
    def _progress_fraction(run: _RunProgress, completed_count: int) -> float:
        fraction = completed_count / len(run.tracks)
        if run.phase == "finalizing":
            # Cache hashing and persistence still have to finish after the track analyses do.
            # Reserve the final percentage point so clients do not show a completed progress bar.
            return min(fraction, 0.99)
        return fraction

    def _purge_expired(self, now_monotonic: float) -> None:
        expired = [
            token
            for token, run in self._runs.items()
            if run.phase in _TERMINAL_PHASES
            and now_monotonic - run.updated_monotonic >= self._ttl_seconds
        ]
        for token in expired:
            del self._runs[token]

    def _required_run(self, progress_token: str) -> _RunProgress:
        try:
            return self._runs[progress_token]
        except KeyError as exc:  # pragma: no cover - reporters are created by begin
            raise RuntimeError("Analysis progress run is unavailable.") from exc

    def _current_track(self, progress_token: str) -> tuple[_RunProgress, _TrackProgress]:
        run = self._required_run(progress_token)
        if run.current_track_id is None:
            raise RuntimeError("Analysis progress has no active track.")
        return run, self._track(run, run.current_track_id)

    @staticmethod
    def _track(run: _RunProgress, track_id: str) -> _TrackProgress:
        try:
            return next(track for track in run.tracks if track.track_id == track_id)
        except StopIteration as exc:  # pragma: no cover - provider tracks originate in begin
            raise RuntimeError("Analysis progress track is unavailable.") from exc

    @staticmethod
    def _stage(track: _TrackProgress, stage: ProgressStage) -> _StageProgress:
        if stage == "native_dsp":
            return track.native_dsp
        if stage == "tensorflow":
            return track.tensorflow
        raise ValueError(f"Unknown analysis progress stage: {stage}")

    @staticmethod
    def _phase_for_stage(stage: ProgressStage) -> AnalysisProgressPhase:
        if stage == "native_dsp":
            return "native_dsp"
        if stage == "tensorflow":
            return "tensorflow"
        raise ValueError(f"Unknown analysis progress stage: {stage}")

    def _now(self) -> tuple[datetime, float]:
        return self._utcnow(), self._monotonic()

    @staticmethod
    def _touch(run: _RunProgress, now: datetime, now_monotonic: float) -> None:
        run.updated_at = now
        run.updated_monotonic = now_monotonic


@lru_cache
def get_analysis_progress_registry() -> AnalysisProgressRegistry:
    return AnalysisProgressRegistry()
