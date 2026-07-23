"""Explicitly download the official Essentia MusiCNN mood model bundle.

The application never downloads model artifacts at runtime. This setup helper is deliberately
separate so model licensing and provisioning remain an operator decision.
"""

from __future__ import annotations

import argparse
import shutil
import urllib.request
from pathlib import Path

_BASE_URL = "https://essentia.upf.edu/models"
_ARTIFACTS = {
    "msd-musicnn-1.pb": "feature-extractors/musicnn/msd-musicnn-1.pb",
    "deam-msd-musicnn-2.pb": "classification-heads/deam/deam-msd-musicnn-2.pb",
    "deam-msd-musicnn-2.json": "classification-heads/deam/deam-msd-musicnn-2.json",
    "mood_aggressive-msd-musicnn-1.pb": (
        "classification-heads/mood_aggressive/mood_aggressive-msd-musicnn-1.pb"
    ),
    "mood_aggressive-msd-musicnn-1.json": (
        "classification-heads/mood_aggressive/mood_aggressive-msd-musicnn-1.json"
    ),
    "mood_party-msd-musicnn-1.pb": ("classification-heads/mood_party/mood_party-msd-musicnn-1.pb"),
    "mood_party-msd-musicnn-1.json": (
        "classification-heads/mood_party/mood_party-msd-musicnn-1.json"
    ),
    "mood_relaxed-msd-musicnn-1.pb": (
        "classification-heads/mood_relaxed/mood_relaxed-msd-musicnn-1.pb"
    ),
    "mood_relaxed-msd-musicnn-1.json": (
        "classification-heads/mood_relaxed/mood_relaxed-msd-musicnn-1.json"
    ),
}


def download_bundle(output_dir: Path, *, overwrite: bool = False) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for filename, relative_url in _ARTIFACTS.items():
        destination = output_dir / filename
        if destination.is_file() and not overwrite:
            print(f"Using existing {destination}")
            continue
        temporary = destination.with_suffix(destination.suffix + ".download")
        url = f"{_BASE_URL}/{relative_url}"
        print(f"Downloading {url}")
        try:
            with (
                urllib.request.urlopen(url, timeout=60) as response,  # noqa: S310
                temporary.open("wb") as target,
            ):
                shutil.copyfileobj(response, target)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(".models/essentia"),
        help="Destination directory (default: .models/essentia)",
    )
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    download_bundle(args.output, overwrite=args.overwrite)
    print(
        "Model bundle ready. Review Essentia's model license before use and set "
        f"ESSENTIA_MODEL_DIR={args.output.resolve()}"
    )


if __name__ == "__main__":
    main()
