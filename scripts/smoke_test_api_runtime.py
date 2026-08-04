#!/usr/bin/env python3
"""Exercise the desktop API through its real loopback HTTP boundary."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path
from typing import Any


def available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def write_wav(path: Path, *, frequency: int) -> None:
    sample_rate = 8_000
    frames = bytearray()
    for index in range(sample_rate // 10):
        sample = 10_000 if (index * frequency // sample_rate) % 2 == 0 else -10_000
        frames.extend(sample.to_bytes(2, byteorder="little", signed=True))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(frames)


def request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    expected_status: int = 200,
) -> tuple[Any, dict[str, str], int]:
    body = None if payload is None else json.dumps(payload).encode()
    request_headers = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    http_request = urllib.request.Request(
        f"{base_url}{path}", data=body, headers=request_headers, method=method
    )
    try:
        response = urllib.request.urlopen(http_request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        status = response.status
        response_headers = {key.casefold(): value for key, value in response.headers.items()}
        response_body = response.read()
    if status != expected_status:
        raise AssertionError(
            f"{method} {path} returned {status}, expected {expected_status}: "
            f"{response_body.decode(errors='replace')}"
        )
    content_type = response_headers.get("content-type", "")
    decoded: Any = response_body
    if content_type.startswith("application/json"):
        decoded = json.loads(response_body)
    return decoded, response_headers, status


def wait_until_ready(base_url: str, process: subprocess.Popen[str]) -> None:
    deadline = time.monotonic() + 30
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            break
        try:
            health, _, _ = request(base_url, "/api/v1/health")
            if health["status"] == "ok":
                return
        except (OSError, AssertionError, ValueError) as error:
            last_error = error
        time.sleep(0.1)
    output = process.stdout.read() if process.stdout is not None else ""
    raise RuntimeError(f"API did not become ready: {last_error}\n{output}")


def exercise_api(base_url: str, music_root: Path) -> None:
    health, _, _ = request(base_url, "/api/v1/health")
    assert health == {"status": "ok", "service": "playlist-optimizer-api"}

    capabilities, _, _ = request(base_url, "/api/v1/capabilities")
    assert capabilities["demo_mode"] is True
    assert "export" in capabilities

    providers, _, _ = request(base_url, "/api/v1/audio-features/providers")
    assert providers["providers"]

    playlists, _, _ = request(base_url, "/api/v1/demo/playlists")
    assert len(playlists) >= 3
    preview, _, _ = request(
        base_url,
        "/api/v1/recipes/preview",
        method="POST",
        payload={
            "name": "Runtime smoke recipe",
            "input_playlists": playlists[:2],
            "distribution_parameter": "energy",
            "distribution_bin_count": 3,
            "split": {"parameter": "energy", "bin_count": 2},
            "subgroup": {"parameter": "danceability", "bin_count": 2},
            "sort": {"parameter": "tempo", "direction": "asc"},
        },
    )
    assert preview["input_track_count"] == 12
    assert preview["deduplicated_track_count"] == 10
    assert sum(output["track_count"] for output in preview["outputs"]) == 10
    assert all("tracks" in output for output in preview["outputs"])

    selected, _, _ = request(
        base_url,
        "/api/v1/local-library/root",
        method="POST",
        payload={"path": str(music_root)},
    )
    assert selected["root_name"] == music_root.name
    assert [folder["name"] for folder in selected["folders"]] == ["crate"]

    folders, _, _ = request(base_url, "/api/v1/local-library/folders?path=crate")
    assert folders["current_path"] == "crate"
    assert [folder["name"] for folder in folders["folders"]] == ["nested"]

    imported, _, _ = request(
        base_url,
        "/api/v1/local-library/import",
        method="POST",
        payload={"source_path": "crate", "name": "Smoke crate", "recursive": True},
    )
    assert imported["playlist"]["name"] == "Smoke crate"
    assert len(imported["playlist"]["tracks"]) == 2
    assert sorted(imported["local_audio_paths"].values()) == [
        "crate/first.wav",
        "crate/nested/second.wav",
    ]

    audio_path = urllib.parse.quote("crate/first.wav")
    audio, audio_headers, status = request(
        base_url,
        f"/api/v1/local-library/audio?path={audio_path}",
        headers={"Range": "bytes=0-15"},
        expected_status=206,
    )
    assert status == 206
    assert len(audio) == 16
    assert audio_headers["content-range"].startswith("bytes 0-15/")
    assert audio_headers["x-content-type-options"] == "nosniff"

    escaped = urllib.parse.quote("../outside.wav")
    error, _, _ = request(
        base_url,
        f"/api/v1/local-library/audio?path={escaped}",
        expected_status=400,
    )
    assert "escapes" in error["detail"]


def command_for(args: argparse.Namespace) -> list[str]:
    if args.sidecar is not None:
        return [str(args.sidecar.resolve())]
    return [
        sys.executable,
        "-m",
        "uvicorn",
        "playlist_optimizer.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(args.port),
        "--log-level",
        "warning",
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sidecar", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--port", type=int, default=0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    args.port = args.port or available_port()
    base_url = f"http://127.0.0.1:{args.port}"
    with tempfile.TemporaryDirectory(prefix="playlist-optimizer-runtime-smoke-") as temp:
        temp_root = Path(temp)
        music_root = temp_root / "Music Library"
        nested = music_root / "crate" / "nested"
        nested.mkdir(parents=True)
        write_wav(music_root / "crate" / "first.wav", frequency=220)
        write_wav(nested / "second.wav", frequency=330)
        write_wav(temp_root / "outside.wav", frequency=440)

        environment = os.environ.copy()
        environment.update(
            {
                "PLAYLIST_OPTIMIZER_PORT": str(args.port),
                "APP_ENV": "desktop",
                "APP_ORIGIN": "tauri://localhost",
                "SPOTIFY_CLIENT_ID": "",
            }
        )
        if args.model_dir is not None:
            environment["ESSENTIA_MODEL_DIR"] = str(args.model_dir.resolve())
        process = subprocess.Popen(
            command_for(args),
            cwd=repo_root / "apps" / "api",
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            wait_until_ready(base_url, process)
            exercise_api(base_url, music_root)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    mode = "packaged sidecar" if args.sidecar is not None else "source runtime"
    print(f"PASS: {mode} API smoke exercised real loopback HTTP behavior")


if __name__ == "__main__":
    main()
