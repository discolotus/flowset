import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from playlist_optimizer.analysis_cache import AnalysisCacheStore, AudioFileFingerprint
from playlist_optimizer.analysis_progress import (
    AnalysisProgressRegistry,
    AnalysisProgressReporter,
    get_analysis_progress_registry,
)
from playlist_optimizer.models import (
    AudioFeatureProvenance,
    AudioFeatureProviderInfo,
    AudioFeatureProviderName,
    AudioFeatureResolutionRequest,
    AudioFeatureResolutionResponse,
    AudioFeatures,
    Track,
)

_KEY_TO_PITCH_CLASS = {
    "C": 0,
    "C#": 1,
    "DB": 1,
    "D": 2,
    "D#": 3,
    "EB": 3,
    "E": 4,
    "F": 5,
    "F#": 6,
    "GB": 6,
    "G": 7,
    "G#": 8,
    "AB": 8,
    "A": 9,
    "A#": 10,
    "BB": 10,
    "B": 11,
}
_MAX_SYNCHRONOUS_TRACKS = 5
_MUSICNN_GRAPH = "msd-musicnn-1.pb"
_MUSICNN_EMBEDDING_OUTPUT = "model/dense/BiasAdd"
_MODEL_HEADS = {
    "deam": ("deam-msd-musicnn-2.pb", "deam-msd-musicnn-2.json"),
    "aggressiveness": (
        "mood_aggressive-msd-musicnn-1.pb",
        "mood_aggressive-msd-musicnn-1.json",
    ),
    "party": ("mood_party-msd-musicnn-1.pb", "mood_party-msd-musicnn-1.json"),
    "relaxed": (
        "mood_relaxed-msd-musicnn-1.pb",
        "mood_relaxed-msd-musicnn-1.json",
    ),
}
_REQUIRED_MODEL_FILES = (_MUSICNN_GRAPH,) + tuple(
    filename for files in _MODEL_HEADS.values() for filename in files
)
_MODEL_FEATURE_NAMES = ("arousal", "valence", "aggressiveness", "party", "relaxed")
_TENSORFLOW_WORKER_LOCK = threading.Lock()


@dataclass(frozen=True)
class EssentiaAnalysis:
    features: AudioFeatures
    analyzer_version: str | None = None
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class _EssentiaTensorflowRuntime:
    embedder: Any
    heads: dict[str, Any]
    metadata: dict[str, dict[str, Any]]


@dataclass(frozen=True)
class TensorflowMoodAnalysis:
    features: dict[str, float]
    notes: tuple[str, ...]
    worker_pid: int


class TensorflowMoodRunner(Protocol):
    def analyze(self, path: Path, model_dir: Path) -> TensorflowMoodAnalysis: ...


class InProcessTensorflowMoodRunner:
    """Runs the complete mood graph set once inside a disposable worker process."""

    def __init__(self) -> None:
        self._tensorflow_runtime: _EssentiaTensorflowRuntime | None = None

    def analyze(self, path: Path, model_dir: Path) -> TensorflowMoodAnalysis:
        import essentia.standard as es  # type: ignore[import-not-found]

        required_algorithms = ("MonoLoader", "TensorflowPredictMusiCNN", "TensorflowPredict2D")
        missing_algorithms = [name for name in required_algorithms if not hasattr(es, name)]
        if missing_algorithms:
            raise RuntimeError(
                "The installed Essentia build lacks TensorFlow algorithms: "
                + ", ".join(missing_algorithms)
                + ". Install the essentia-tensorflow optional dependency instead of plain "
                "essentia."
            )

        audio = es.MonoLoader(filename=str(path), sampleRate=16_000)()
        runtime = self._tensorflow_runtime_for(es, model_dir)
        embeddings = runtime.embedder(audio)
        if len(embeddings) == 0:
            raise RuntimeError("The MusiCNN embedding model produced no audio patches.")

        predictions: dict[str, tuple[float, ...]] = {}
        versions: list[str] = []
        for head_name in _MODEL_HEADS:
            metadata = runtime.metadata[head_name]
            head_predictions = runtime.heads[head_name](embeddings)
            predictions[head_name] = _mean_prediction(head_predictions)
            versions.append(f"{metadata.get('name', head_name)} v{metadata.get('version', '?')}")

        deam_metadata = runtime.metadata["deam"]
        valence_index = _class_index(deam_metadata, "valence")
        arousal_index = _class_index(deam_metadata, "arousal")
        aggressive_metadata = runtime.metadata["aggressiveness"]
        party_metadata = runtime.metadata["party"]
        relaxed_metadata = runtime.metadata["relaxed"]

        features = {
            "valence": _normalize_deam(predictions["deam"][valence_index]),
            "arousal": _normalize_deam(predictions["deam"][arousal_index]),
            "aggressiveness": _probability(
                predictions["aggressiveness"][_class_index(aggressive_metadata, "aggressive")]
            ),
            "party": _probability(predictions["party"][_class_index(party_metadata, "party")]),
            "relaxed": _probability(
                predictions["relaxed"][_class_index(relaxed_metadata, "relaxed")]
            ),
        }
        notes = (
            "TensorFlow scores use one shared msd-musicnn-1 embedding pass and mean patch "
            "predictions from " + ", ".join(versions) + ".",
            "DEAM valence and arousal outputs were rescaled from 1-9 to 0-1; mood values are "
            "positive-class probabilities read using each model's metadata class order.",
        )
        return TensorflowMoodAnalysis(features=features, notes=notes, worker_pid=os.getpid())

    def _tensorflow_runtime_for(self, es: Any, model_dir: Path) -> _EssentiaTensorflowRuntime:
        if self._tensorflow_runtime is not None:
            return self._tensorflow_runtime

        metadata = {
            head_name: _load_model_metadata(model_dir / metadata_name)
            for head_name, (_, metadata_name) in _MODEL_HEADS.items()
        }
        runtime = _EssentiaTensorflowRuntime(
            embedder=es.TensorflowPredictMusiCNN(
                graphFilename=str(model_dir / _MUSICNN_GRAPH),
                output=_MUSICNN_EMBEDDING_OUTPUT,
            ),
            heads={
                head_name: es.TensorflowPredict2D(
                    graphFilename=str(model_dir / graph_name),
                    input="model/Placeholder",
                    output=_prediction_output_name(metadata[head_name]),
                )
                for head_name, (graph_name, _) in _MODEL_HEADS.items()
            },
            metadata=metadata,
        )
        self._tensorflow_runtime = runtime
        return runtime


class IsolatedTensorflowMoodRunner:
    """Supervises one single-use TensorFlow worker per track."""

    def __init__(
        self,
        *,
        timeout_seconds: float = 180.0,
        worker_command: Sequence[str] | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("TensorFlow worker timeout must be greater than zero.")
        self._timeout_seconds = timeout_seconds
        self._worker_command = tuple(worker_command) if worker_command is not None else None

    def analyze(self, path: Path, model_dir: Path) -> TensorflowMoodAnalysis:
        with _TENSORFLOW_WORKER_LOCK:
            return self._analyze_serially(path, model_dir)

    def _analyze_serially(self, path: Path, model_dir: Path) -> TensorflowMoodAnalysis:
        with tempfile.TemporaryDirectory(prefix="playlist-optimizer-mood-") as temporary_dir:
            workspace = Path(temporary_dir)
            request_path = workspace / "request.json"
            result_path = workspace / "result.json"
            request_path.write_text(
                json.dumps({"audio_path": str(path), "model_dir": str(model_dir)}),
                encoding="utf-8",
            )
            command = [
                *self._command(),
                "--request",
                str(request_path),
                "--result",
                str(result_path),
            ]
            process = subprocess.Popen(  # noqa: S603
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            payload: object | None = None
            deadline = time.monotonic() + self._timeout_seconds
            try:
                while time.monotonic() < deadline:
                    if result_path.is_file():
                        payload = _read_worker_result(result_path)
                        break
                    if process.poll() is not None:
                        break
                    time.sleep(0.02)
                if payload is None and result_path.is_file():
                    payload = _read_worker_result(result_path)
                if payload is None:
                    if process.poll() is None:
                        raise RuntimeError(
                            "TensorFlow mood worker timed out after "
                            f"{self._timeout_seconds:g} seconds."
                        )
                    raise RuntimeError(
                        "TensorFlow mood worker exited without a result "
                        f"(status {process.returncode})."
                    )
                return _parse_worker_result(payload)
            finally:
                _stop_worker_process(process)

    def _command(self) -> tuple[str, ...]:
        if self._worker_command is not None:
            return self._worker_command
        if getattr(sys, "frozen", False):
            return (sys.executable, "--essentia-mood-worker")
        return (sys.executable, "-m", "playlist_optimizer.providers.essentia_worker")


class EssentiaAnalyzer(Protocol):
    @property
    def is_available(self) -> bool: ...

    @property
    def unavailable_reason(self) -> str | None: ...

    def analyze(self, path: Path) -> EssentiaAnalysis: ...


class LazyEssentiaMusicExtractor:
    """Optional Essentia adapter; importing Essentia is deferred until an audio file is used."""

    def __init__(
        self,
        *,
        model_dir: Path | None = None,
        mood_runner: TensorflowMoodRunner | None = None,
        mood_worker_timeout_seconds: float = 180.0,
    ) -> None:
        self._model_dir = model_dir.resolve() if model_dir is not None else None
        self._mood_runner = mood_runner or IsolatedTensorflowMoodRunner(
            timeout_seconds=mood_worker_timeout_seconds
        )

    @property
    def is_available(self) -> bool:
        return importlib.util.find_spec("essentia") is not None

    @property
    def unavailable_reason(self) -> str | None:
        if self.is_available:
            return None
        return "The optional Essentia Python package is not installed."

    @property
    def model_unavailable_reason(self) -> str | None:
        return _model_unavailable_reason(self._model_dir)

    def analyze(self, path: Path) -> EssentiaAnalysis:
        return self._analyze(path, None)

    def analyze_with_progress(
        self, path: Path, progress: AnalysisProgressReporter
    ) -> EssentiaAnalysis:
        return self._analyze(path, progress)

    def _analyze(self, path: Path, progress: AnalysisProgressReporter | None) -> EssentiaAnalysis:
        if not self.is_available:
            raise RuntimeError(self.unavailable_reason)

        import essentia  # type: ignore[import-not-found]
        import essentia.standard as es  # type: ignore[import-not-found]

        if progress is not None:
            progress.stage_started("native_dsp")
        try:
            pool, _ = es.MusicExtractor(
                lowlevelStats=["mean", "stdev"],
                rhythmStats=["mean", "stdev"],
                tonalStats=["mean", "stdev"],
            )(str(path))
        except Exception:
            if progress is not None:
                progress.stage_error("native_dsp", "Native Essentia analysis failed.")
                progress.stage_skipped(
                    "tensorflow", "TensorFlow was skipped because native analysis failed."
                )
            raise
        else:
            if progress is not None:
                progress.stage_completed("native_dsp")

        raw_danceability = _pool_float(pool, "rhythm.danceability")
        danceability = (
            min(max(raw_danceability / 3.0, 0.0), 1.0) if raw_danceability is not None else None
        )
        key_name = _pool_string(pool, "tonal.key_edma.key")
        scale = _pool_string(pool, "tonal.key_edma.scale")
        key = _KEY_TO_PITCH_CLASS.get(key_name.upper()) if key_name else None
        mode = {"major": 1, "minor": 0}.get(scale.casefold()) if scale else None

        notes: list[str] = []
        if danceability is not None:
            notes.append(
                "Danceability was normalized from Essentia's typical 0-to-3 range to 0-to-1."
            )
        model_features: dict[str, float | None] = {}
        model_reason = self.model_unavailable_reason
        if model_reason is None:
            if self._model_dir is None:  # pragma: no cover - guarded by model_unavailable_reason
                raise RuntimeError("ESSENTIA_MODEL_DIR is not configured.")
            try:
                if progress is not None:
                    progress.stage_started("tensorflow")
                model_analysis = self._mood_runner.analyze(path, self._model_dir)
            except (OSError, RuntimeError, ValueError) as exc:
                if progress is not None:
                    progress.stage_error("tensorflow", "TensorFlow mood analysis failed.")
                safe_error = _sanitize_sensitive_paths(
                    str(exc),
                    (
                        (path, "LOCAL_AUDIO_FILE"),
                        (self._model_dir, "ESSENTIA_MODEL_DIR"),
                    ),
                )
                notes.append(
                    "TensorFlow mood analysis failed in its isolated worker; native Essentia "
                    f"features were retained: {safe_error[:240]}"
                )
            except Exception:
                if progress is not None:
                    progress.stage_error("tensorflow", "TensorFlow mood analysis failed.")
                raise
            else:
                if progress is not None:
                    progress.stage_completed("tensorflow")
                model_features.update(model_analysis.features)
                notes.extend(model_analysis.notes)
                notes.append("TensorFlow mood inference ran in a fresh isolated worker.")
        else:
            if progress is not None:
                progress.stage_skipped("tensorflow", model_reason)
            notes.append(
                "Arousal, aggressiveness, party, relaxed, and valence were not analyzed: "
                f"{model_reason}"
            )
        return EssentiaAnalysis(
            features=AudioFeatures(
                tempo=_pool_float(pool, "rhythm.bpm"),
                key=key,
                mode=mode,
                danceability=danceability,
                loudness=_pool_float(pool, "lowlevel.loudness_ebu128.integrated"),
                loudness_range=_pool_float(pool, "lowlevel.loudness_ebu128.loudness_range"),
                onset_rate=_pool_float(pool, "rhythm.onset_rate"),
                beat_strength=_pool_float(pool, "rhythm.beats_loudness.mean"),
                dynamic_complexity=_pool_float(pool, "lowlevel.dynamic_complexity"),
                brightness=_pool_float(pool, "lowlevel.spectral_centroid.mean"),
                spectral_flux=_pool_float(pool, "lowlevel.spectral_flux.mean"),
                key_strength=_pool_float(pool, "tonal.key_edma.strength"),
                **model_features,
            ),
            analyzer_version=getattr(essentia, "__version__", None),
            notes=tuple(notes),
        )


class EssentiaProvider:
    name: AudioFeatureProviderName = "essentia"

    def __init__(
        self,
        *,
        audio_root: Path | None,
        model_dir: Path | None = None,
        mood_worker_timeout_seconds: float = 180.0,
        analyzer: EssentiaAnalyzer | None = None,
        progress_registry: AnalysisProgressRegistry | None = None,
    ) -> None:
        self._audio_root = audio_root.resolve() if audio_root is not None else None
        self._model_dir = model_dir.resolve() if model_dir is not None else None
        self._analysis_cache = (
            AnalysisCacheStore(music_root=self._audio_root)
            if self._audio_root is not None
            else None
        )
        self._analyzer = analyzer or LazyEssentiaMusicExtractor(
            model_dir=model_dir,
            mood_worker_timeout_seconds=mood_worker_timeout_seconds,
        )
        self._progress_registry = progress_registry or get_analysis_progress_registry()

    def info(self) -> AudioFeatureProviderInfo:
        reason = self._unavailable_reason()
        model_reason = getattr(self._analyzer, "model_unavailable_reason", None)
        model_detail = (
            f" TensorFlow mood inference is inactive: {model_reason}"
            if model_reason
            else (
                " TensorFlow arousal, valence, aggressiveness, party, and relaxed scores "
                "are active."
            )
        )
        return AudioFeatureProviderInfo(
            id=self.name,
            display_name="Essentia",
            status="unavailable" if reason else "available",
            requires_local_audio=True,
            detail=(
                (f"{reason}{model_detail}" if reason else None)
                or (
                    "Analyzes local audio under the configured ESSENTIA_AUDIO_ROOT. Spotify audio "
                    "is never downloaded or analyzed. Native tonal, rhythm, loudness, "
                    "dynamic-range, and spectral descriptors are available." + model_detail
                )
            ),
        )

    def resolve(self, request: AudioFeatureResolutionRequest) -> AudioFeatureResolutionResponse:
        progress = (
            self._progress_registry.begin(request.progress_token, self.name, request.tracks)
            if request.progress_token is not None
            else None
        )
        try:
            return self._resolve(request, progress)
        except Exception as exc:
            if progress is not None:
                progress.failed(_safe_error_message(exc, self._audio_root, self._model_dir))
            raise

    def _resolve(
        self,
        request: AudioFeatureResolutionRequest,
        progress: AnalysisProgressReporter | None,
    ) -> AudioFeatureResolutionResponse:
        reason = self._unavailable_reason()
        if reason:
            if progress is not None:
                progress.failed(reason)
            return AudioFeatureResolutionResponse(
                provider=self.name,
                status="unavailable",
                tracks=[_without_audio_features(track) for track in request.tracks],
                analyzed_track_count=0,
                unavailable_track_ids=[track.id for track in request.tracks],
                warnings=[reason],
            )
        if len(request.tracks) > _MAX_SYNCHRONOUS_TRACKS:
            failure = (
                "Synchronous Essentia analysis accepts at most 5 tracks. Use small batches "
                "until cached background analysis is implemented."
            )
            if progress is not None:
                progress.failed(failure)
            return AudioFeatureResolutionResponse(
                provider=self.name,
                status="failed",
                tracks=[_without_audio_features(track) for track in request.tracks],
                analyzed_track_count=0,
                unavailable_track_ids=[track.id for track in request.tracks],
                warnings=[failure],
            )

        enriched_tracks = []
        unavailable_track_ids: list[str] = []
        warnings: list[str] = []
        expected_fingerprints: dict[str, AudioFileFingerprint] = {}
        for track in request.tracks:
            if progress is not None:
                progress.track_started(track)
            path_value = request.local_audio_paths.get(track.id)
            if path_value is None:
                unavailable_track_ids.append(track.id)
                enriched_tracks.append(_without_audio_features(track))
                if progress is not None:
                    progress.track_unavailable("No local audio path was supplied.")
                continue
            try:
                audio_path = self._resolve_audio_path(path_value)
                if self._analysis_cache is None:  # pragma: no cover - guarded above
                    raise RuntimeError("Analysis cache is unavailable without an audio root")
                expected_fingerprints[track.id] = self._analysis_cache.fingerprint(path_value)
                analysis = self._analyze_track(audio_path, progress)
            except (ImportError, OSError, RuntimeError, ValueError) as exc:
                error = _safe_error_message(exc, self._audio_root, self._model_dir)
                unavailable_track_ids.append(track.id)
                enriched_tracks.append(_without_audio_features(track))
                warnings.append(f"Essentia could not analyze track {track.id}: {error}")
                if progress is not None:
                    progress.track_error(error)
                continue
            enriched_tracks.append(
                track.model_copy(
                    update={
                        "audio_features": analysis.features,
                        "audio_feature_provenance": AudioFeatureProvenance(
                            provider=self.name,
                            source_id=audio_path.relative_to(self._audio_root).as_posix(),
                            analyzer_version=analysis.analyzer_version,
                            notes=[
                                _sanitize_sensitive_paths(
                                    note,
                                    (
                                        (self._audio_root, "ESSENTIA_AUDIO_ROOT"),
                                        (self._model_dir, "ESSENTIA_MODEL_DIR"),
                                    ),
                                )
                                for note in analysis.notes
                            ],
                        ),
                    }
                )
            )
            if progress is not None:
                progress.track_completed()

        analyzed_count = len(request.tracks) - len(unavailable_track_ids)
        missing_audio_count = sum(
            track.id not in request.local_audio_paths for track in request.tracks
        )
        if missing_audio_count:
            warnings.append(
                f"No local audio path was supplied for {missing_audio_count} track(s); those "
                "tracks were retained without provider features."
            )
        if progress is not None:
            progress.finalizing()
        if self._analysis_cache is not None and request.analysis_cache_directories:
            cache_result = self._analysis_cache.store(
                cache_directories=request.analysis_cache_directories,
                tracks=enriched_tracks,
                local_audio_paths=request.local_audio_paths,
                expected_fingerprints=expected_fingerprints,
            )
            warnings.extend(cache_result.warnings)
        status = (
            "complete"
            if analyzed_count == len(request.tracks)
            else "partial"
            if analyzed_count
            else "unavailable"
        )
        if progress is not None:
            progress.completed()
        return AudioFeatureResolutionResponse(
            provider=self.name,
            status=status,
            tracks=enriched_tracks,
            analyzed_track_count=analyzed_count,
            unavailable_track_ids=unavailable_track_ids,
            warnings=warnings,
        )

    def _analyze_track(
        self, audio_path: Path, progress: AnalysisProgressReporter | None
    ) -> EssentiaAnalysis:
        analyze_with_progress = getattr(self._analyzer, "analyze_with_progress", None)
        if progress is not None and callable(analyze_with_progress):
            return analyze_with_progress(audio_path, progress)
        if progress is None:
            return self._analyzer.analyze(audio_path)

        progress.stage_started("native_dsp")
        try:
            analysis = self._analyzer.analyze(audio_path)
        except Exception:
            progress.stage_error("native_dsp", "Native Essentia analysis failed.")
            progress.stage_skipped(
                "tensorflow", "The injected analyzer did not reach a TensorFlow stage."
            )
            raise
        progress.stage_completed("native_dsp")
        progress.stage_skipped(
            "tensorflow", "The injected analyzer does not expose TensorFlow stage telemetry."
        )
        return analysis

    def _unavailable_reason(self) -> str | None:
        if not self._analyzer.is_available:
            return self._analyzer.unavailable_reason or "Essentia is unavailable."
        if self._audio_root is None:
            return "ESSENTIA_AUDIO_ROOT is not configured."
        if not self._audio_root.is_dir():
            return "ESSENTIA_AUDIO_ROOT does not exist or is not a directory."
        return None

    def _resolve_audio_path(self, value: str) -> Path:
        if self._audio_root is None:
            raise RuntimeError("ESSENTIA_AUDIO_ROOT is not configured.")
        requested = Path(value)
        if requested.is_absolute():
            raise ValueError("Local audio paths must be relative to ESSENTIA_AUDIO_ROOT")
        resolved = (self._audio_root / requested).resolve()
        try:
            resolved.relative_to(self._audio_root)
        except ValueError as exc:
            raise ValueError("Local audio path escapes ESSENTIA_AUDIO_ROOT") from exc
        if not resolved.is_file():
            raise ValueError("Local audio file does not exist")
        return resolved


def _pool_float(pool: object, descriptor: str) -> float | None:
    try:
        value = float(pool[descriptor])  # type: ignore[index]
    except (KeyError, TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _pool_string(pool: object, descriptor: str) -> str | None:
    try:
        value = pool[descriptor]  # type: ignore[index]
    except (KeyError, TypeError):
        return None
    return str(value) if value is not None else None


def _model_unavailable_reason(model_dir: Path | None) -> str | None:
    if model_dir is None:
        return "ESSENTIA_MODEL_DIR is not configured."
    if not model_dir.is_dir():
        return "ESSENTIA_MODEL_DIR does not exist or is not a directory."
    missing = [name for name in _REQUIRED_MODEL_FILES if not (model_dir / name).is_file()]
    if missing:
        return "ESSENTIA_MODEL_DIR is missing: " + ", ".join(missing)
    empty = [name for name in _REQUIRED_MODEL_FILES if (model_dir / name).stat().st_size == 0]
    if empty:
        return "ESSENTIA_MODEL_DIR contains empty files: " + ", ".join(empty)
    required_classes = {
        "deam": ("valence", "arousal"),
        "aggressiveness": ("aggressive",),
        "party": ("party",),
        "relaxed": ("relaxed",),
    }
    for head_name, (_, metadata_name) in _MODEL_HEADS.items():
        try:
            metadata = _load_model_metadata(model_dir / metadata_name)
            _prediction_output_name(metadata)
            for class_name in required_classes[head_name]:
                _class_index(metadata, class_name)
        except RuntimeError as exc:
            return str(exc)
    return None


def _read_worker_result(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("TensorFlow mood worker returned invalid JSON.") from exc


def _parse_worker_result(payload: object) -> TensorflowMoodAnalysis:
    if not isinstance(payload, dict):
        raise RuntimeError("TensorFlow mood worker returned an invalid response object.")
    if payload.get("status") != "complete":
        error = payload.get("error")
        message = error if isinstance(error, str) and error else "unknown worker error"
        raise RuntimeError(f"TensorFlow mood worker failed: {message[:240]}")
    raw_features = payload.get("features")
    raw_notes = payload.get("notes")
    worker_pid = payload.get("worker_pid")
    if not isinstance(raw_features, dict) or set(raw_features) != set(_MODEL_FEATURE_NAMES):
        raise RuntimeError("TensorFlow mood worker returned an incomplete feature set.")
    features: dict[str, float] = {}
    for name in _MODEL_FEATURE_NAMES:
        value = raw_features[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise RuntimeError(f"TensorFlow mood worker returned an invalid {name} value.")
        numeric = float(value)
        if not math.isfinite(numeric) or not 0.0 <= numeric <= 1.0:
            raise RuntimeError(f"TensorFlow mood worker returned an out-of-range {name} value.")
        features[name] = numeric
    if not isinstance(raw_notes, list) or not all(isinstance(note, str) for note in raw_notes):
        raise RuntimeError("TensorFlow mood worker returned invalid notes.")
    if isinstance(worker_pid, bool) or not isinstance(worker_pid, int) or worker_pid <= 0:
        raise RuntimeError("TensorFlow mood worker returned an invalid process identifier.")
    return TensorflowMoodAnalysis(
        features=features,
        notes=tuple(raw_notes),
        worker_pid=worker_pid,
    )


def _stop_worker_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=1.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=1.0)


def _load_model_metadata(path: Path) -> dict[str, Any]:
    try:
        metadata = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read Essentia model metadata {path.name}: {exc}") from exc
    if not isinstance(metadata, dict):
        raise RuntimeError(f"Essentia model metadata {path.name} must be a JSON object.")
    return metadata


def _prediction_output_name(metadata: dict[str, Any]) -> str:
    outputs = metadata.get("schema", {}).get("outputs", [])
    if not isinstance(outputs, list):
        raise RuntimeError("Essentia model metadata has no output schema.")
    prediction_outputs = [
        item
        for item in outputs
        if isinstance(item, dict) and item.get("output_purpose") == "predictions"
    ]
    selected = prediction_outputs[0] if prediction_outputs else outputs[0] if outputs else None
    if not isinstance(selected, dict) or not isinstance(selected.get("name"), str):
        raise RuntimeError("Essentia model metadata has no prediction output node.")
    return selected["name"]


def _class_index(metadata: dict[str, Any], class_name: str) -> int:
    classes = metadata.get("classes")
    if not isinstance(classes, list) or class_name not in classes:
        raise RuntimeError(f"Essentia model metadata does not define class {class_name!r}.")
    return classes.index(class_name)


def _mean_prediction(predictions: object) -> tuple[float, ...]:
    try:
        rows = list(predictions)  # type: ignore[arg-type]
    except TypeError as exc:
        raise RuntimeError("Essentia model returned an invalid prediction matrix.") from exc
    if not rows:
        raise RuntimeError("Essentia model produced no predictions.")
    try:
        first_row = [float(value) for value in rows[0]]
    except TypeError:
        first_row = [float(value) for value in rows]
        rows = [first_row]
    width = len(first_row)
    if width == 0:
        raise RuntimeError("Essentia model produced empty predictions.")
    numeric_rows = [[float(value) for value in row] for row in rows]
    if any(len(row) != width for row in numeric_rows):
        raise RuntimeError("Essentia model produced inconsistent prediction dimensions.")
    result = tuple(
        sum(row[index] for row in numeric_rows) / len(numeric_rows) for index in range(width)
    )
    if not all(math.isfinite(value) for value in result):
        raise RuntimeError("Essentia model produced non-finite predictions.")
    return result


def _normalize_deam(value: float) -> float:
    return min(max((value - 1.0) / 8.0, 0.0), 1.0)


def _probability(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def _without_audio_features(track: Track) -> Track:
    """Prevent a prior provider's values from becoming an undisclosed fallback."""

    return track.model_copy(update={"audio_features": None, "audio_feature_provenance": None})


def _sanitize_sensitive_paths(
    message: str,
    replacements: Sequence[tuple[Path | None, str]],
) -> str:
    for path, label in replacements:
        if path is not None:
            message = message.replace(str(path), label)
    return message


def _safe_error_message(
    exc: Exception,
    audio_root: Path | None,
    model_root: Path | None = None,
) -> str:
    message = str(exc) or type(exc).__name__
    return _sanitize_sensitive_paths(
        message,
        (
            (audio_root, "ESSENTIA_AUDIO_ROOT"),
            (model_root, "ESSENTIA_MODEL_DIR"),
        ),
    )[:300]
