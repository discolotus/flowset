"""Single-use process entry point for the complete Essentia TensorFlow mood model set."""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from playlist_optimizer.providers.essentia import InProcessTensorflowMoodRunner


def run_worker(request_path: Path, result_path: Path) -> int:
    try:
        request = _read_request(request_path)
        analysis = InProcessTensorflowMoodRunner().analyze(
            Path(request["audio_path"]),
            Path(request["model_dir"]),
        )
        payload: dict[str, Any] = {
            "status": "complete",
            "features": analysis.features,
            "notes": list(analysis.notes),
            "worker_pid": analysis.worker_pid,
        }
        exit_code = 0
    except BaseException as exc:  # contain native/model failures inside this disposable process
        payload = {
            "status": "failed",
            "error": f"{type(exc).__name__}: {str(exc)[:220]}",
            "worker_pid": os.getpid(),
        }
        exit_code = 1
    _write_result(result_path, payload)
    return exit_code


def _read_request(path: Path) -> dict[str, str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Could not read the TensorFlow mood worker request.") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("TensorFlow mood worker request must be a JSON object.")
    audio_path = payload.get("audio_path")
    model_dir = payload.get("model_dir")
    if not isinstance(audio_path, str) or not audio_path:
        raise RuntimeError("TensorFlow mood worker request has no audio path.")
    if not isinstance(model_dir, str) or not model_dir:
        raise RuntimeError("TensorFlow mood worker request has no model directory.")
    return {"audio_path": audio_path, "model_dir": model_dir}


def _write_result(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args(argv)
    return run_worker(args.request, args.result)


if __name__ == "__main__":
    raise SystemExit(main())
