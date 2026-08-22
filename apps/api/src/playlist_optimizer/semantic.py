from __future__ import annotations

import math
import os
from functools import lru_cache
from hashlib import sha256
from importlib.util import find_spec
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel

from playlist_optimizer.config import get_settings
from playlist_optimizer.models import SemanticBackendCapabilities


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

    def __init__(self, checkpoint: Path | None, max_tracks: int = 100, max_labels: int = 20):
        self.checkpoint = checkpoint
        self.max_tracks = max_tracks
        self.max_labels = max_labels

    def capabilities(self) -> SemanticBackendCapabilities:
        checkpoint_ready = bool(self.checkpoint and self.checkpoint.exists())
        missing_runtime = [module for module in self.runtime_modules if find_spec(module) is None]
        available = checkpoint_ready and not missing_runtime
        if missing_runtime:
            detail = f"Install the optional runtime ({', '.join(missing_runtime)} missing)."
        elif checkpoint_ready:
            detail = "Explicit local checkpoint and runtime configured."
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
        )

    def _require_checkpoint(self) -> Path:
        if not self.checkpoint or not self.checkpoint.exists():
            raise RuntimeError(f"{self.display_name} is not configured with a local checkpoint")
        return self.checkpoint

    def _model_identity(self) -> str:
        assert self.checkpoint is not None
        resolved = self.checkpoint.resolve()
        stat = resolved.stat()
        fingerprint = sha256(f"{resolved}:{stat.st_size}:{stat.st_mtime_ns}".encode()).hexdigest()[
            :12
        ]
        return f"{resolved.name}@{fingerprint}"


def _enable_huggingface_offline() -> None:
    """Keep optional local backends from resolving nested Hub model IDs over the network."""

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    # The libraries cache these switches at import time. Update already-imported modules too so
    # backend call order cannot accidentally re-enable downloads.
    try:
        import huggingface_hub  # type: ignore[import-not-found]
        import huggingface_hub.constants as hub_constants  # type: ignore[import-not-found]

        hub_constants.HF_HUB_OFFLINE = True
        huggingface_hub.HF_HUB_OFFLINE = True
    except (ImportError, ValueError):
        pass
    try:
        import transformers.utils.hub as transformers_hub  # type: ignore[import-not-found]

        transformers_hub.HF_HUB_OFFLINE = True
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

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        checkpoint = self._require_checkpoint()
        # laion-clap constructs a RoBERTa tokenizer while loading a local .pt checkpoint. Force
        # that nested lookup to use the local Hugging Face cache instead of downloading silently.
        _enable_huggingface_offline()
        try:
            import laion_clap  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("Install Flowset's optional CLAP dependencies") from exc
        try:
            model = laion_clap.CLAP_Module(enable_fusion=False)
            model.load_ckpt(str(checkpoint))
        except (OSError, RuntimeError, ValueError) as exc:
            raise RuntimeError(
                "CLAP's local checkpoint is invalid, or its required RoBERTa tokenizer is absent; "
                "offline mode forbids downloading it"
            ) from exc
        text = model.get_text_embedding(labels, use_tensor=True)
        audio = model.get_audio_embedding_from_filelist([str(path) for path in audio_paths])
        rows = (audio @ text.T).detach().cpu().tolist()
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
    runtime_modules = ("muq", "torch", "torchaudio")
    license_note = "Published MuQ-MuLan weights are CC-BY-NC-4.0 and are not bundled by Flowset."

    def _model(self):
        checkpoint = self._require_checkpoint()
        # MuQ recursively resolves its configured audio and text foundation models without
        # forwarding local_files_only. Set both supported offline switches before importing MuQ
        # so Transformers and huggingface_hub cannot turn nested model IDs into network requests.
        _enable_huggingface_offline()
        try:
            from muq import MuQMuLan  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("Install the optional MuQ-MuLan runtime") from exc
        try:
            return MuQMuLan.from_pretrained(str(checkpoint), local_files_only=True).eval()
        except TypeError as exc:
            raise RuntimeError(
                "Installed MuQ runtime cannot guarantee local-only checkpoint loading"
            ) from exc
        except OSError as exc:
            raise RuntimeError(
                "MuQ-MuLan or one of its configured foundation models is absent from the local "
                "Hugging Face cache; offline mode forbids downloading it"
            ) from exc

    def _embed_with_model(self, model, audio_paths: list[Path]) -> list[list[float]]:
        try:
            import torch  # type: ignore[import-not-found]
            import torchaudio  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError("Install the optional MuQ-MuLan audio runtime") from exc
        waveforms = []
        for path in audio_paths:
            waveform, sample_rate = torchaudio.load(str(path))
            waveform = waveform.mean(dim=0)
            if sample_rate != 24000:
                waveform = torchaudio.functional.resample(waveform, sample_rate, 24000)
            waveforms.append(waveform[: 24000 * 30])
        padded = torch.nn.utils.rnn.pad_sequence(waveforms, batch_first=True)
        with torch.inference_mode():
            rows = model(wavs=padded, texts=None)
        return [[float(value) for value in row] for row in _tolist(rows)]

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        return self._embed_with_model(self._model(), audio_paths)

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        model = self._model()
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
    license_note = (
        "Published MERT weights are CC-BY-NC-4.0 and are not bundled by Flowset; trusted local "
        "checkpoint code may execute. MERT is not used for text scoring."
    )

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        raise RuntimeError("MERT does not support text similarity")

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        checkpoint = self._require_checkpoint()
        try:
            import librosa  # type: ignore[import-not-found]
            import torch  # type: ignore[import-not-found]
            from transformers import (  # type: ignore[import-not-found]
                AutoFeatureExtractor,
                AutoModel,
            )
        except ImportError as exc:
            raise RuntimeError("Install the optional MERT runtime") from exc
        load_options = {"local_files_only": True, "trust_remote_code": True}
        try:
            extractor = AutoFeatureExtractor.from_pretrained(str(checkpoint), **load_options)
            model = AutoModel.from_pretrained(str(checkpoint), **load_options).eval()
        except (OSError, RuntimeError, ValueError) as exc:
            raise RuntimeError("MERT could not load the trusted local checkpoint") from exc
        sample_rate = extractor.sampling_rate
        result: list[list[float]] = []
        for path in audio_paths:
            audio, _ = librosa.load(path, sr=sample_rate, mono=True, duration=30)
            inputs = extractor(audio, sampling_rate=sample_rate, return_tensors="pt")
            with torch.inference_mode():
                hidden = model(**inputs).last_hidden_state.mean(dim=1)[0]
            result.append([float(value) for value in hidden.detach().cpu().tolist()])
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
                settings.clap_checkpoint, settings.clap_max_tracks, settings.clap_max_labels
            ),
            LocalMuqMulanBackend(
                settings.muq_mulan_checkpoint, settings.clap_max_tracks, settings.clap_max_labels
            ),
            LocalMertBackend(settings.mert_checkpoint, settings.clap_max_tracks, 1),
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


def semantic_score_key(backend_id: str, model: str, label: str) -> str:
    return f"semantic:{backend_id}:{model}:{normalize_semantic_label(label)}"
