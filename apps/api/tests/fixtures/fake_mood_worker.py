"""Tiny subprocess fixture for testing the real mood-worker supervision boundary."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path


def _complete_payload() -> dict[str, object]:
    return {
        "status": "complete",
        "features": {
            "arousal": 0.61,
            "valence": 0.54,
            "aggressiveness": 0.27,
            "party": 0.73,
            "relaxed": 0.19,
        },
        "notes": ["Fake isolated mood worker."],
        "worker_pid": os.getpid(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text(encoding="utf-8"))
    audio_path = Path(request["audio_path"])
    mode = audio_path.stem.split("-")[0]

    if mode == "hang":
        audio_path.write_text(str(os.getpid()), encoding="utf-8")
        while True:
            time.sleep(0.1)
    if mode == "crash":
        os._exit(70)
    if mode == "malformed":
        args.result.write_text("{not-json", encoding="utf-8")
        return 0
    if mode == "incomplete":
        payload = _complete_payload()
        del payload["features"]["party"]  # type: ignore[index]
        args.result.write_text(json.dumps(payload), encoding="utf-8")
        return 0
    if mode == "nonfinite":
        payload = _complete_payload()
        payload["features"]["arousal"] = float("nan")  # type: ignore[index]
        args.result.write_text(json.dumps(payload), encoding="utf-8")
        return 0

    args.result.write_text(json.dumps(_complete_payload()), encoding="utf-8")
    if mode == "result_then_hang":
        while True:
            time.sleep(0.1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
