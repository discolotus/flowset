"""Explicitly provision pinned semantic-audio models for offline Flowset inference.

Runtime requests never download artifacts. This operator-invoked helper records exact upstream
revisions and places every nested Hugging Face dependency in a backend-owned cache.
"""

from __future__ import annotations

import argparse
import json
from hashlib import sha256
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

_CLAP_REPO = "lukewys/laion_clap"
_CLAP_REVISION = "b3708341862f581175dba5c356a4ebf74a9b6651"
_CLAP_FILENAME = "630k-audioset-best.pt"
_CLAP_SIZE = 1_863_587_645
_CLAP_SHA256 = "8053c9775516af2f4902e1e8281e356cc1bf7a85e8b761908170767b77c3f037"
_ROBERTA_REPO = "roberta-base"
_ROBERTA_REVISION = "e2da8e2f811d1448a5b465c236feacd80ffbac7b"
_BERT_REPO = "bert-base-uncased"
_BERT_REVISION = "86b5e0934494bd15c9632b12f734a8a67f723594"
_BART_REPO = "facebook/bart-base"
_BART_REVISION = "aadd2ab0ae0c8268c7c9693540e9904811f36177"

_MUQ_MULAN_REPO = "OpenMuQ/MuQ-MuLan-large"
_MUQ_MULAN_REVISION = "2e01c796b71dca71b45251384c04cd7b237c9020"
_MUQ_AUDIO_REPO = "OpenMuQ/MuQ-large-msd-iter"
_MUQ_AUDIO_REVISION = "0562a57814f6f8bbd9fdea0a25921a2fce1a841a"
_XLM_ROBERTA_REPO = "xlm-roberta-base"
_XLM_ROBERTA_REVISION = "e73636d4f797dec63c3081bb6ed5c7b0bb3f2089"

_MERT_REPO = "m-a-p/MERT-v1-95M"
_MERT_REVISION = "12af15fef9d0ac838c3f475bfbbf26d2060dd4f5"

_MUQ_FILES = {
    "config.json": (847, "8fefc545ef87ecd9bcde7417dd03464370c48c321f36dcff20266a752079e468"),
    "pytorch_model.bin": (
        2_653_954_401,
        "d42ae3f7cb9b66759ee0089ddc70e2f28b130c2d8ba621457358272d32dd0444",
    ),
}
_MERT_FILES = {
    "config.json": (1_817, "ea2627c4c7825cd66f3c944b6b966331604c35928174e0100cd4a82829424e32"),
    "preprocessor_config.json": (
        211,
        "cc5a5e4a5d3b1a758a5ed984b2eaa15bb0522d811d44a9eed82bfca4baa0dc8f",
    ),
    "configuration_MERT.py": (
        5_340,
        "ae0ec2bab8f59c724ba9878a7c20b67210189536ea62d34a56775968e9decb03",
    ),
    "modeling_MERT.py": (
        18_033,
        "6c3ee73cef6f0c30ef494f88d96f891fa6925ffe663fa391b512f4b57abecc6c",
    ),
    "pytorch_model.bin": (
        377_552_987,
        "a2b8b747f72c06e0595aeae41ae5473f4364938c6b39b2c58be38c48e6bd3fcd",
    ),
}
_ROBERTA_FILES = {
    "config.json": (481, "ef0185e2aae6e06c5f105a285006952c340e20c7dbf43c86ec82601b13fc45e9"),
    "model.safetensors": (
        498_818_054,
        "5bde1d28afb363d0103324efeb5afc8b2b397fe5e04beabb9b1ef355255ade81",
    ),
}
_MUQ_AUDIO_FILES = {
    "config.json": (
        3_133,
        "237335ee27d8fb951ce778701a12a79e06c51ae636dd786f97e45f51ce532543",
    ),
    "model.safetensors": (
        1_333_825_096,
        "273febab2be02872c37d2c37e48a9d6c52c1c9392f3eeeabd498efa281ccb7a6",
    ),
}
_XLM_ROBERTA_FILES = {
    "config.json": (615, "d66ed8cd4f2a93b358c245e50736fa389ed4f35c0bae7aad0b32abb20c62b579"),
    "model.safetensors": (
        1_115_567_652,
        "6fd4797bc397c3b8b55d6bb5740366b57e6a3ce91c04c77f22aafc0c128e6feb",
    ),
}

_TRANSFORMER_PATTERNS = [
    "config.json",
    "merges.txt",
    "model.safetensors",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "vocab.txt",
]
_TOKENIZER_PATTERNS = [
    "config.json",
    "merges.txt",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "vocab.txt",
]


def _manifest(directory: Path, payload: dict[str, object]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "manifest.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def _verify(path: Path, expected_size: int, expected_sha256: str) -> None:
    if path.stat().st_size != expected_size:
        raise RuntimeError(f"Unexpected size for {path}")
    digest = sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise RuntimeError(f"Checksum mismatch for {path}")


def _verify_files(directory: Path, files: dict[str, tuple[int, str]]) -> None:
    for filename, expected in files.items():
        _verify(directory / filename, *expected)


def _integrity(files: dict[str, tuple[int, str]]) -> dict[str, dict[str, int | str]]:
    return {
        filename: {"size": size, "sha256": digest}
        for filename, (size, digest) in files.items()
    }


def _pin_main_ref(cache: Path, repo_id: str, revision: str) -> None:
    """Resolve a hard-coded upstream ``from_pretrained(repo_id)`` call offline."""
    refs = cache / f"models--{repo_id.replace('/', '--')}" / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text(revision, encoding="utf-8")


def download_clap(root: Path) -> None:
    destination = root / "clap"
    cache = destination / "hf-cache"
    destination.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {_CLAP_REPO}@{_CLAP_REVISION}:{_CLAP_FILENAME}")
    checkpoint = Path(
        hf_hub_download(
            repo_id=_CLAP_REPO,
            filename=_CLAP_FILENAME,
            revision=_CLAP_REVISION,
            local_dir=destination,
        )
    )
    _verify(checkpoint, _CLAP_SIZE, _CLAP_SHA256)
    print(f"Downloading nested {_ROBERTA_REPO}@{_ROBERTA_REVISION}")
    roberta_snapshot = Path(
        snapshot_download(
            repo_id=_ROBERTA_REPO,
            revision=_ROBERTA_REVISION,
            cache_dir=cache,
            allow_patterns=_TRANSFORMER_PATTERNS,
        )
    )
    _verify_files(roberta_snapshot, _ROBERTA_FILES)
    _pin_main_ref(cache, _ROBERTA_REPO, _ROBERTA_REVISION)
    print(f"Downloading import-time {_BERT_REPO}@{_BERT_REVISION}")
    snapshot_download(
        repo_id=_BERT_REPO,
        revision=_BERT_REVISION,
        cache_dir=cache,
        allow_patterns=_TOKENIZER_PATTERNS,
    )
    _pin_main_ref(cache, _BERT_REPO, _BERT_REVISION)
    print(f"Downloading import-time {_BART_REPO}@{_BART_REVISION}")
    snapshot_download(
        repo_id=_BART_REPO,
        revision=_BART_REVISION,
        cache_dir=cache,
        allow_patterns=_TOKENIZER_PATTERNS,
    )
    _pin_main_ref(cache, _BART_REPO, _BART_REVISION)
    _manifest(
        destination,
        {
            "backend": "local-clap",
            "checkpoint": {
                "repo": _CLAP_REPO,
                "revision": _CLAP_REVISION,
                "file": _CLAP_FILENAME,
                "integrity": {"size": _CLAP_SIZE, "sha256": _CLAP_SHA256},
            },
            "nested_models": [
                {
                    "repo": _ROBERTA_REPO,
                    "revision": _ROBERTA_REVISION,
                    "verified_files": _integrity(_ROBERTA_FILES),
                },
                {"repo": _BERT_REPO, "revision": _BERT_REVISION},
                {"repo": _BART_REPO, "revision": _BART_REVISION},
            ],
        },
    )
    print(f"CLAP ready: {destination / _CLAP_FILENAME}")


def download_muq_mulan(root: Path, *, accept_restricted_weights: bool) -> None:
    if not accept_restricted_weights:
        raise SystemExit(
            "MuQ-MuLan weights are CC-BY-NC-4.0. Re-run with --accept-restricted-weights "
            "after confirming that non-commercial use is appropriate."
        )
    destination = root / "muq-mulan"
    cache = destination / "hf-cache"
    destination.mkdir(parents=True, exist_ok=True)
    for filename in _MUQ_FILES:
        print(f"Downloading {_MUQ_MULAN_REPO}@{_MUQ_MULAN_REVISION}:{filename}")
        downloaded = Path(
            hf_hub_download(
                repo_id=_MUQ_MULAN_REPO,
                filename=filename,
                revision=_MUQ_MULAN_REVISION,
                local_dir=destination,
            )
        )
        _verify(downloaded, *_MUQ_FILES[filename])
    print(f"Downloading nested {_MUQ_AUDIO_REPO}@{_MUQ_AUDIO_REVISION}")
    muq_audio_snapshot = Path(
        snapshot_download(
            repo_id=_MUQ_AUDIO_REPO,
            revision=_MUQ_AUDIO_REVISION,
            cache_dir=cache,
            allow_patterns=["config.json", "model.safetensors"],
        )
    )
    _verify_files(muq_audio_snapshot, _MUQ_AUDIO_FILES)
    _pin_main_ref(cache, _MUQ_AUDIO_REPO, _MUQ_AUDIO_REVISION)
    print(f"Downloading nested {_XLM_ROBERTA_REPO}@{_XLM_ROBERTA_REVISION}")
    xlm_roberta_snapshot = Path(
        snapshot_download(
            repo_id=_XLM_ROBERTA_REPO,
            revision=_XLM_ROBERTA_REVISION,
            cache_dir=cache,
            allow_patterns=_TRANSFORMER_PATTERNS,
        )
    )
    _verify_files(xlm_roberta_snapshot, _XLM_ROBERTA_FILES)
    _pin_main_ref(cache, _XLM_ROBERTA_REPO, _XLM_ROBERTA_REVISION)
    _manifest(
        destination,
        {
            "backend": "local-muq-mulan",
            "checkpoint": {
                "repo": _MUQ_MULAN_REPO,
                "revision": _MUQ_MULAN_REVISION,
                "verified_files": _integrity(_MUQ_FILES),
            },
            "nested_models": [
                {
                    "repo": _MUQ_AUDIO_REPO,
                    "revision": _MUQ_AUDIO_REVISION,
                    "verified_files": _integrity(_MUQ_AUDIO_FILES),
                },
                {
                    "repo": _XLM_ROBERTA_REPO,
                    "revision": _XLM_ROBERTA_REVISION,
                    "verified_files": _integrity(_XLM_ROBERTA_FILES),
                },
            ],
            "weights_license": "CC-BY-NC-4.0",
        },
    )
    print(f"MuQ-MuLan ready: {destination}")


def download_mert(
    root: Path, *, accept_restricted_weights: bool, accept_trusted_code: bool
) -> None:
    if not accept_restricted_weights:
        raise SystemExit(
            "MERT weights are CC-BY-NC-4.0. Re-run with --accept-restricted-weights after "
            "confirming that non-commercial use is appropriate."
        )
    if not accept_trusted_code:
        raise SystemExit(
            "MERT requires Python model code from its pinned checkpoint. Re-run with "
            "--accept-trusted-code after reviewing the model repository."
        )
    destination = root / "mert" / "MERT-v1-95M"
    destination.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {_MERT_REPO}@{_MERT_REVISION}")
    snapshot_download(
        repo_id=_MERT_REPO,
        revision=_MERT_REVISION,
        local_dir=destination,
        allow_patterns=[
            "README.md",
            "config.json",
            "configuration_MERT.py",
            "modeling_MERT.py",
            "preprocessor_config.json",
            "pytorch_model.bin",
        ],
    )
    _verify_files(destination, _MERT_FILES)
    _manifest(
        destination,
        {
            "backend": "local-mert",
            "checkpoint": {
                "repo": _MERT_REPO,
                "revision": _MERT_REVISION,
                "verified_files": _integrity(_MERT_FILES),
            },
            "trusted_remote_code": True,
            "weights_license": "CC-BY-NC-4.0",
        },
    )
    print(f"MERT ready: {destination}")


def _require_acceptance(
    backend: str, *, accept_restricted_weights: bool, accept_trusted_code: bool
) -> None:
    if backend in {"all", "muq-mulan", "mert"} and not accept_restricted_weights:
        raise SystemExit(
            "MuQ-MuLan/MERT weights are CC-BY-NC-4.0. Re-run with "
            "--accept-restricted-weights after confirming that non-commercial use is appropriate."
        )
    if backend in {"all", "mert"} and not accept_trusted_code:
        raise SystemExit(
            "MERT requires pinned checkpoint code. Re-run with --accept-trusted-code after "
            "reviewing the model repository."
        )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("backend", choices=("all", "clap", "muq-mulan", "mert"))
    parser.add_argument("--output", type=Path, default=Path(".models/semantic"))
    parser.add_argument("--accept-restricted-weights", action="store_true")
    parser.add_argument("--accept-trusted-code", action="store_true")
    args = parser.parse_args(argv)

    _require_acceptance(
        args.backend,
        accept_restricted_weights=args.accept_restricted_weights,
        accept_trusted_code=args.accept_trusted_code,
    )

    if args.backend in {"all", "clap"}:
        download_clap(args.output)
    if args.backend in {"all", "muq-mulan"}:
        download_muq_mulan(
            args.output, accept_restricted_weights=args.accept_restricted_weights
        )
    if args.backend in {"all", "mert"}:
        download_mert(
            args.output,
            accept_restricted_weights=args.accept_restricted_weights,
            accept_trusted_code=args.accept_trusted_code,
        )


if __name__ == "__main__":
    main()
