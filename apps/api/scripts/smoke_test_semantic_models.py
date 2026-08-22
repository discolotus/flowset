"""Run real-weight semantic backend inference against deterministic generated audio."""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
import tempfile
import wave
from pathlib import Path

from playlist_optimizer.config import Settings
from playlist_optimizer.semantic import (
    LocalClapBackend,
    LocalMertBackend,
    LocalMuqMulanBackend,
    cosine_similarity,
)


def _write_fixture(path: Path, *, noise: bool) -> None:
    random_source = random.Random(7)
    sample_rate = 24_000
    frames: list[bytes] = []
    for index in range(sample_rate * 2):
        value = random_source.uniform(-0.35, 0.35) if noise else 0.35 * math.sin(
            2 * math.pi * 440 * index / sample_rate
        )
        frames.append(struct.pack("<h", int(value * 32767)))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(b"".join(frames))


def _check_rows(rows: list[list[float]]) -> None:
    assert rows and rows[0]
    assert all(math.isfinite(value) for row in rows for value in row)
    assert len({len(row) for row in rows}) == 1


def smoke_clap(settings: Settings, paths: list[Path]) -> dict[str, object]:
    backend = LocalClapBackend(settings.clap_checkpoint)
    assert backend.capabilities().available, backend.capabilities().detail
    results = backend.rank(paths, ["a pure musical tone", "broadband white noise"])
    scores = [result.scores for result in results]
    assert all(math.isfinite(value) for row in scores for value in row.values())
    return {"model": backend.capabilities().model, "scores": scores}


def smoke_muq(settings: Settings, paths: list[Path]) -> dict[str, object]:
    backend = LocalMuqMulanBackend(settings.muq_mulan_checkpoint)
    assert backend.capabilities().available, backend.capabilities().detail
    embeddings = backend.embed(paths)
    _check_rows(embeddings)
    results = backend.rank(paths, ["a sustained musical tone", "noise texture"])
    scores = [result.scores for result in results]
    assert all(math.isfinite(value) for row in scores for value in row.values())
    return {
        "model": backend.capabilities().model,
        "embedding_shape": [len(embeddings), len(embeddings[0])],
        "scores": scores,
    }


def smoke_mert(settings: Settings, paths: list[Path]) -> dict[str, object]:
    backend = LocalMertBackend(settings.mert_checkpoint)
    assert backend.capabilities().available, backend.capabilities().detail
    embeddings = backend.embed(paths)
    _check_rows(embeddings)
    return {
        "model": backend.capabilities().model,
        "embedding_shape": [len(embeddings), len(embeddings[0])],
        "reference_similarities": [
            cosine_similarity(embeddings[0], embedding) for embedding in embeddings
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("backend", choices=("clap", "muq-mulan", "mert"))
    args = parser.parse_args()
    settings = Settings(_env_file=None)
    with tempfile.TemporaryDirectory(prefix="flowset-semantic-smoke-") as temporary:
        root = Path(temporary)
        paths = [root / "tone.wav", root / "noise.wav"]
        _write_fixture(paths[0], noise=False)
        _write_fixture(paths[1], noise=True)
        if args.backend == "clap":
            result = smoke_clap(settings, paths)
        elif args.backend == "muq-mulan":
            result = smoke_muq(settings, paths)
        else:
            result = smoke_mert(settings, paths)
    print(json.dumps({"backend": args.backend, "status": "passed", **result}, indent=2))


if __name__ == "__main__":
    main()
