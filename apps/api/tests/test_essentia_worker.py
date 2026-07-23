import os
import sys
import time
from pathlib import Path

import pytest

from playlist_optimizer.providers.essentia import IsolatedTensorflowMoodRunner

_FAKE_WORKER = Path(__file__).parent / "fixtures" / "fake_mood_worker.py"


def _runner(*, timeout_seconds: float = 2.0) -> IsolatedTensorflowMoodRunner:
    return IsolatedTensorflowMoodRunner(
        timeout_seconds=timeout_seconds,
        worker_command=(sys.executable, str(_FAKE_WORKER)),
    )


def _process_is_gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def test_isolated_mood_runner_uses_a_fresh_process_for_every_track(tmp_path: Path) -> None:
    runner = _runner()

    analyses = [runner.analyze(tmp_path / f"success-{index}.mp3", tmp_path) for index in range(5)]

    assert len({analysis.worker_pid for analysis in analyses}) == 5
    assert all(analysis.features["party"] == pytest.approx(0.73) for analysis in analyses)


def test_isolated_mood_runner_kills_a_worker_after_receiving_its_result(
    tmp_path: Path,
) -> None:
    analysis = _runner().analyze(tmp_path / "result_then_hang-track.mp3", tmp_path)

    assert analysis.features["arousal"] == pytest.approx(0.61)
    assert _process_is_gone(analysis.worker_pid)


def test_isolated_mood_runner_times_out_kills_and_recovers(tmp_path: Path) -> None:
    pid_path = tmp_path / "hang.pid"
    runner = _runner(timeout_seconds=0.2)

    with pytest.raises(RuntimeError, match="timed out"):
        runner.analyze(pid_path, tmp_path)

    pid = int(pid_path.read_text(encoding="utf-8"))
    deadline = time.monotonic() + 1.0
    while not _process_is_gone(pid) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert _process_is_gone(pid)
    assert runner.analyze(tmp_path / "success-after-timeout.mp3", tmp_path).features["relaxed"]


def test_isolated_mood_runner_contains_a_crash_and_recovers(tmp_path: Path) -> None:
    runner = _runner()

    with pytest.raises(RuntimeError, match="status 70"):
        runner.analyze(tmp_path / "crash-track.mp3", tmp_path)

    assert runner.analyze(tmp_path / "success-after-crash.mp3", tmp_path).features["valence"]


@pytest.mark.parametrize(
    ("filename", "message"),
    [
        ("malformed-track.mp3", "invalid JSON"),
        ("incomplete-track.mp3", "incomplete feature set"),
        ("nonfinite-track.mp3", "out-of-range arousal"),
    ],
)
def test_isolated_mood_runner_rejects_invalid_protocol_results(
    tmp_path: Path,
    filename: str,
    message: str,
) -> None:
    with pytest.raises(RuntimeError, match=message):
        _runner().analyze(tmp_path / filename, tmp_path)
