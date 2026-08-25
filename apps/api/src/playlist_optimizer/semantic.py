from __future__ import annotations

import json
import math
import os
from functools import cached_property, lru_cache
from hashlib import sha256
from importlib.util import find_spec
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel

from playlist_optimizer.config import get_settings
from playlist_optimizer.models import SemanticBackendCapabilities, SemanticRepresentationIdentity


class SemanticRankResult(BaseModel):
    relative_path: str
    scores: dict[str, float]
    error: str | None = None


class SemanticBackend(Protocol):
    def capabilities(self) -> SemanticBackendCapabilities: ...
    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]: ...
    def embed(self, audio_paths: list[Path]) -> list[list[float]]: ...


class _ConfiguredBackend:
    backend_id: str
    display_name: str
    capability_names: list[str]
    license_note: str
    checkpoint_setting: str
    runtime_modules: tuple[str, ...]
    embedding_representation: str | None = None
    default_representation: SemanticRepresentationIdentity | None = None

    def __init__(
        self,
        checkpoint: Path | None,
        max_tracks: int = 100,
        max_labels: int = 20,
        max_embedding_batch: int = 20,
    ):
        self.checkpoint = checkpoint
        self.max_tracks = max_tracks
        self.max_labels = max_labels
        self.max_embedding_batch = max_embedding_batch

    def capabilities(self) -> SemanticBackendCapabilities:
        checkpoint_exists = bool(self.checkpoint and self.checkpoint.exists())
        checkpoint_ready = checkpoint_exists and self._provisioning_manifest().is_file()
        missing_runtime = [module for module in self.runtime_modules if find_spec(module) is None]
        available = checkpoint_ready and not missing_runtime
        if missing_runtime:
            detail = f"Install the optional runtime ({', '.join(missing_runtime)} missing)."
        elif checkpoint_ready:
            detail = "Explicit local checkpoint and runtime configured."
        elif checkpoint_exists:
            detail = "Semantic model provisioning is incomplete; its verified manifest is absent."
        else:
            detail = f"Set {self.checkpoint_setting} to an existing local checkpoint."
        return SemanticBackendCapabilities(
            id=self.backend_id,
            display_name=self.display_name,
            model=self._model_identity() if available else "unconfigured",
            available=available,
            detail=detail,
            max_tracks=self.max_tracks,
            max_labels=self.max_labels,
            capabilities=self.capability_names,
            license_note=self.license_note,
            embedding_representation=self.embedding_representation,
            max_embedding_batch=self.max_embedding_batch,
            default_representation=self.default_representation,
        )

    def _provisioning_manifest(self) -> Path:
        assert self.checkpoint is not None
        directory = self.checkpoint if self.checkpoint.is_dir() else self.checkpoint.parent
        return directory / "manifest.json"

    def _require_checkpoint(self) -> Path:
        if not self.checkpoint or not self.checkpoint.exists():
            raise RuntimeError(f"{self.display_name} is not configured with a local checkpoint")
        return self.checkpoint

    def _model_identity(self) -> str:
        assert self.checkpoint is not None
        resolved = self.checkpoint.resolve()
        manifest = resolved / "manifest.json" if resolved.is_dir() else None
        if manifest and manifest.is_file():
            fingerprint_source = manifest.read_bytes()
        else:
            stat = resolved.stat()
            fingerprint_source = f"{resolved}:{stat.st_size}:{stat.st_mtime_ns}".encode()
        fingerprint = sha256(fingerprint_source).hexdigest()[:12]
        return f"{resolved.name}@{fingerprint}"


def _enable_huggingface_offline(cache_dir: Path | None = None) -> None:
    """Keep optional local backends from resolving nested Hub model IDs over the network."""

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    if cache_dir is not None:
        resolved_cache = str(cache_dir.resolve())
        os.environ["HF_HUB_CACHE"] = resolved_cache
    # The libraries cache these switches at import time. Update already-imported modules too so
    # backend call order cannot accidentally re-enable downloads.
    try:
        import huggingface_hub  # type: ignore[import-not-found]
        import huggingface_hub.constants as hub_constants  # type: ignore[import-not-found]

        hub_constants.HF_HUB_OFFLINE = True
        huggingface_hub.HF_HUB_OFFLINE = True
        if cache_dir is not None:
            hub_constants.HF_HUB_CACHE = str(cache_dir.resolve())
    except (ImportError, ValueError):
        pass
    try:
        import transformers.utils.hub as transformers_hub  # type: ignore[import-not-found]

        transformers_hub.HF_HUB_OFFLINE = True
        if cache_dir is not None and hasattr(transformers_hub, "TRANSFORMERS_CACHE"):
            transformers_hub.TRANSFORMERS_CACHE = str(cache_dir.resolve())
        if hasattr(transformers_hub, "_is_offline_mode"):
            transformers_hub._is_offline_mode = True
    except (ImportError, ValueError):
        pass


class LocalClapBackend(_ConfiguredBackend):
    backend_id = "local-clap"
    display_name = "Local CLAP"
    capability_names = ["text_similarity"]
    checkpoint_setting = "CLAP_CHECKPOINT"
    runtime_modules = ("laion_clap",)
    license_note = (
        "CLAP software and checkpoint licenses are operator-supplied and must be reviewed."
    )

    @cached_property
    def _model(self):
        checkpoint = self._require_checkpoint()
        # laion-clap constructs a RoBERTa tokenizer and encoder while loading a local .pt
        # checkpoint. The explicit setup command provisions both into this backend-owned cache.
        _enable_huggingface_offline(checkpoint.parent / "hf-cache")
        try:
            import laion_clap  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("Install Flowset's optional CLAP dependencies") from exc
        try:
            model = laion_clap.CLAP_Module(enable_fusion=False, amodel="HTSAT-tiny", device="cpu")
            model.load_ckpt(str(checkpoint), verbose=False)
            model.model.eval()
        except (OSError, RuntimeError, ValueError) as exc:
            raise RuntimeError(
                "CLAP's local checkpoint is invalid, or its required RoBERTa tokenizer/encoder "
                "is absent; run `make setup-clap-models` before starting Flowset"
            ) from exc
        return model

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        model = self._model
        text_rows = _tolist(model.get_text_embedding(labels, use_tensor=True))
        audio_rows = _tolist(
            model.get_audio_embedding_from_filelist([str(path) for path in audio_paths])
        )
        rows = [
            [cosine_similarity(audio_row, text_row) for text_row in text_rows]
            for audio_row in audio_rows
        ]
        _require_finite_rows(rows, "CLAP similarity")
        return [
            SemanticRankResult(
                relative_path=str(path), scores=dict(zip(labels, map(float, row), strict=True))
            )
            for path, row in zip(audio_paths, rows, strict=True)
        ]

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        raise RuntimeError("CLAP embedding extraction is not exposed")


class LocalMuqMulanBackend(_ConfiguredBackend):
    backend_id = "local-muq-mulan"
    display_name = "Local MuQ-MuLan"
    capability_names = ["text_similarity", "embedding_extraction"]
    checkpoint_setting = "MUQ_MULAN_CHECKPOINT"
    runtime_modules = ("librosa", "muq", "torch")
    license_note = "Published MuQ-MuLan weights are CC-BY-NC-4.0 and are not bundled by Flowset."
    embedding_representation = "muq-mulan-audio-30s-24khz-v1"

    @cached_property
    def _model(self):
        checkpoint = self._require_checkpoint()
        # MuQ recursively resolves its configured audio and text foundation models. The explicit
        # setup command provisions all three pinned repositories into this backend-owned cache.
        cache_dir = checkpoint / "hf-cache"
        _enable_huggingface_offline(cache_dir)
        try:
            import torch  # type: ignore[import-not-found]
            from muq import MuQMuLan  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("Install the optional MuQ-MuLan runtime") from exc
        try:
            config = json.loads((checkpoint / "config.json").read_text())
            model = MuQMuLan(config, hf_hub_cache_dir=str(cache_dir))
            state = torch.load(
                checkpoint / "pytorch_model.bin", map_location="cpu", weights_only=True
            )
            model.load_state_dict(state, strict=True)
            return model.eval()
        except (OSError, RuntimeError, TypeError, ValueError) as exc:
            raise RuntimeError(
                "MuQ-MuLan or one of its configured foundation models is absent or invalid; "
                "run `make setup-muq-mulan-models` before starting Flowset"
            ) from exc

    def _embed_with_model(self, model, audio_paths: list[Path]) -> list[list[float]]:
        try:
            import librosa  # type: ignore[import-not-found]
            import torch  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("Install the optional MuQ-MuLan audio runtime") from exc
        rows: list[list[float]] = []
        for path in audio_paths:
            waveform, _ = librosa.load(path, sr=24000, mono=True, duration=30)
            if len(waveform) == 0:
                raise RuntimeError(f"MuQ-MuLan could not decode audio from {path.name}")
            tensor = torch.from_numpy(waveform).float().unsqueeze(0)
            with torch.inference_mode():
                embedding = model(wavs=tensor, texts=None)[0]
            rows.append([float(value) for value in _tolist(embedding)])
        _require_finite_rows(rows, "MuQ-MuLan embedding")
        return rows

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        return self._embed_with_model(self._model, audio_paths)

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        model = self._model
        audio = self._embed_with_model(model, audio_paths)
        try:
            import torch  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("Install the optional MuQ-MuLan runtime") from exc
        with torch.inference_mode():
            text_embeddings = model(wavs=None, texts=labels)
        if callable(getattr(model, "calc_similarity", None)):
            rows = _tolist(model.calc_similarity(torch.as_tensor(audio), text_embeddings))
        else:
            text = _tolist(text_embeddings)
            rows = [
                [cosine_similarity(audio_row, text_row) for text_row in text] for audio_row in audio
            ]
        _require_finite_rows(rows, "MuQ-MuLan similarity")
        return [
            SemanticRankResult(
                relative_path=str(path), scores=dict(zip(labels, map(float, row), strict=True))
            )
            for path, row in zip(audio_paths, rows, strict=True)
        ]


class LocalMertBackend(_ConfiguredBackend):
    backend_id = "local-mert"
    display_name = "Local MERT"
    capability_names = ["reference_similarity", "embedding_extraction"]
    checkpoint_setting = "MERT_CHECKPOINT"
    runtime_modules = ("librosa", "torch", "transformers")
    default_representation = SemanticRepresentationIdentity(
        layer="last_hidden_state",
        pooling="mean",
        segment="whole_track",
    )
    license_note = (
        "Published MERT weights are CC-BY-NC-4.0 and are not bundled by Flowset; trusted local "
        "checkpoint code may execute. MERT is not used for text scoring."
    )
    embedding_representation = "mert-last-hidden-mean-30s-v1"

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        raise RuntimeError("MERT does not support text similarity")

    @cached_property
    def _runtime(self):
        checkpoint = self._require_checkpoint()
        _enable_huggingface_offline()
        try:
            import librosa  # type: ignore[import-not-found]
            import torch  # type: ignore[import-not-found]
            from transformers import (  # type: ignore[import-not-found]
                AutoFeatureExtractor,
                AutoModel,
            )
        except ImportError as exc:
            raise RuntimeError("Install the optional MERT runtime") from exc
        local_options = {"local_files_only": True}
        try:
            extractor = AutoFeatureExtractor.from_pretrained(str(checkpoint), **local_options)
            model, loading_info = AutoModel.from_pretrained(
                str(checkpoint),
                trust_remote_code=True,
                output_loading_info=True,
                **local_options,
            )
            incomplete = {
                key: value
                for key, value in loading_info.items()
                if key in {"missing_keys", "unexpected_keys", "mismatched_keys"} and value
            }
            if incomplete:
                raise RuntimeError(f"MERT checkpoint loaded incompletely: {incomplete}")
            model = model.eval()
        except (OSError, RuntimeError, ValueError) as exc:
            raise RuntimeError(
                "MERT could not load the trusted local checkpoint; run `make setup-mert-models`"
            ) from exc
        return extractor, model, librosa, torch

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        extractor, model, librosa, torch = self._runtime
        sample_rate = extractor.sampling_rate
        result: list[list[float]] = []
        for path in audio_paths:
            audio, _ = librosa.load(path, sr=sample_rate, mono=True, duration=30)
            inputs = extractor(audio, sampling_rate=sample_rate, return_tensors="pt")
            with torch.inference_mode():
                hidden = model(**inputs).last_hidden_state.mean(dim=1)[0]
            result.append([float(value) for value in hidden.detach().cpu().tolist()])
        _require_finite_rows(result, "MERT embedding")
        return result


class SemanticBackendRegistry:
    def __init__(self, backends: list[SemanticBackend]):
        self.backends = {backend.capabilities().id: backend for backend in backends}

    def infos(self) -> list[SemanticBackendCapabilities]:
        return [backend.capabilities() for backend in self.backends.values()]

    def get(self, backend_id: str) -> SemanticBackend | None:
        return self.backends.get(backend_id)


@lru_cache
def get_semantic_registry() -> SemanticBackendRegistry:
    settings = get_settings()
    return SemanticBackendRegistry(
        [
            LocalClapBackend(
                settings.clap_checkpoint,
                settings.clap_max_tracks,
                settings.clap_max_labels,
                settings.semantic_max_embeddings,
            ),
            LocalMuqMulanBackend(
                settings.muq_mulan_checkpoint,
                settings.clap_max_tracks,
                settings.clap_max_labels,
                settings.semantic_max_embeddings,
            ),
            LocalMertBackend(
                settings.mert_checkpoint,
                settings.clap_max_tracks,
                1,
                settings.semantic_max_embeddings,
            ),
        ]
    )


@lru_cache
def get_semantic_backend() -> SemanticBackend:
    backend = get_semantic_registry().get("local-clap")
    assert backend is not None
    return backend


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("Embedding dimensions do not match")
    denominator = math.sqrt(sum(v * v for v in left)) * math.sqrt(sum(v * v for v in right))
    return (
        0.0
        if denominator == 0
        else sum(a * b for a, b in zip(left, right, strict=True)) / denominator
    )


def _tolist(value):
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    return value.tolist() if hasattr(value, "tolist") else value


def _require_finite_rows(rows, source: str) -> None:
    if not all(math.isfinite(float(value)) for row in rows for value in row):
        raise RuntimeError(f"{source} returned a non-finite value")


def normalize_semantic_label(label: str) -> str:
    return " ".join(label.split()).casefold()


def semantic_score_key(
    backend_id: str,
    model: str,
    label: str,
    representation: SemanticRepresentationIdentity | None = None,
) -> str:
    representation_key = ""
    if representation is not None:
        representation_key = (
            f":{representation.layer}:{representation.pooling}:{representation.segment}"
        )
    return f"semantic:{backend_id}:{model}{representation_key}:{normalize_semantic_label(label)}"
