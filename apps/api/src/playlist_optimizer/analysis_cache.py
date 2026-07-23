import fcntl
import hashlib
import json
import os
import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from playlist_optimizer.models import AudioFeatureProvenance, AudioFeatures, Track

CACHE_SCHEMA_VERSION = 1
ANALYSIS_PROFILE_VERSION = "essentia-tensorflow-2.1b6.dev1389-musicextractor-musicnn-v1"
CACHE_SUBDIRECTORY = ".sequence"
CACHE_FILENAME = "analysis-cache.json"
_CACHE_LOCK_FILENAME = ".analysis-cache.lock"
_MAX_CACHE_BYTES = 16 * 1024 * 1024
_HASH_CHUNK_BYTES = 1024 * 1024
_REQUIRED_TENSORFLOW_FEATURES = (
    "arousal",
    "valence",
    "aggressiveness",
    "party",
    "relaxed",
)


@dataclass(frozen=True)
class AudioFileFingerprint:
    size_bytes: int
    modified_time_ns: int


@dataclass(frozen=True)
class CacheRestoreResult:
    tracks: list[Track]
    restored_count: int
    warnings: list[str]


@dataclass(frozen=True)
class CacheWriteResult:
    written_count: int
    warnings: list[str]


class AnalysisCacheStore:
    """Persist provider measurements beside a playlist without exposing absolute paths.

    Exact path, size, and modification-time matches intentionally use a zero-hash fast path.
    SHA-256 is the fallback for path or metadata changes, including rename recovery.
    """

    def __init__(self, *, music_root: Path) -> None:
        self._music_root = music_root.resolve()
        self._write_lock = threading.Lock()

    def fingerprint(self, audio_path: str) -> AudioFileFingerprint:
        resolved = self._resolve_audio_path(audio_path)
        stat = resolved.stat()
        return AudioFileFingerprint(
            size_bytes=stat.st_size,
            modified_time_ns=stat.st_mtime_ns,
        )

    def restore(
        self,
        *,
        cache_directory: str,
        tracks: list[Track],
        local_audio_paths: dict[str, str],
    ) -> CacheRestoreResult:
        try:
            cache_path = self._cache_path(cache_directory, create=False)
        except (OSError, ValueError) as exc:
            return CacheRestoreResult(
                tracks=tracks,
                restored_count=0,
                warnings=[self._safe_warning("read", exc)],
            )
        if cache_path is None or not cache_path.exists():
            return CacheRestoreResult(tracks=tracks, restored_count=0, warnings=[])

        entries, warnings = self._read_entries(cache_path)
        if entries is None:
            return CacheRestoreResult(tracks=tracks, restored_count=0, warnings=warnings)

        digest_candidates_by_size: dict[int, list[dict[str, Any]]] = {}
        for candidate in entries.values():
            if not isinstance(candidate, dict):
                continue
            if candidate.get("analysis_profile_version") != ANALYSIS_PROFILE_VERSION:
                continue
            size_bytes = candidate.get("size_bytes")
            content_sha256 = candidate.get("content_sha256")
            if (
                not isinstance(size_bytes, int)
                or isinstance(size_bytes, bool)
                or not self._is_sha256(content_sha256)
            ):
                continue
            digest_candidates_by_size.setdefault(size_bytes, []).append(candidate)

        restored_tracks: list[Track] = []
        restored_count = 0
        invalid_entries = 0
        migration_entries: dict[str, dict[str, Any]] = {}
        for track in tracks:
            audio_path = local_audio_paths.get(track.id)
            entry = entries.get(audio_path) if audio_path is not None else None
            if audio_path is None:
                restored_tracks.append(track)
                continue
            try:
                fingerprint = self.fingerprint(audio_path)
            except (OSError, TypeError, ValueError, ValidationError):
                if isinstance(entry, dict):
                    invalid_entries += 1
                restored_tracks.append(track)
                continue

            matched_entry: dict[str, Any] | None = None
            matched_content_sha256: str | None = None
            matched_by_content = False
            if (
                isinstance(entry, dict)
                and entry.get("analysis_profile_version") == ANALYSIS_PROFILE_VERSION
                and entry.get("size_bytes") == fingerprint.size_bytes
                and entry.get("modified_time_ns") == fingerprint.modified_time_ns
            ):
                # The original path + size + mtime lookup remains the common zero-hash path.
                matched_entry = entry
            else:
                candidates = digest_candidates_by_size.get(fingerprint.size_bytes, [])
                if candidates:
                    try:
                        content_sha256 = self._content_sha256(audio_path)
                    except (OSError, TypeError, ValueError):
                        if isinstance(entry, dict):
                            invalid_entries += 1
                        restored_tracks.append(track)
                        continue
                    matched_entry = next(
                        (
                            candidate
                            for candidate in candidates
                            if candidate.get("content_sha256") == content_sha256
                        ),
                        None,
                    )
                    matched_content_sha256 = content_sha256
                    matched_by_content = matched_entry is not None

            if matched_entry is None:
                restored_tracks.append(track)
                continue

            try:
                features, provenance = self._validated_measurements(matched_entry)
            except (TypeError, ValueError, ValidationError):
                invalid_entries += 1
                restored_tracks.append(track)
                continue
            provenance = provenance.model_copy(update={"source_id": audio_path})
            restored_tracks.append(
                track.model_copy(
                    update={
                        "audio_features": features,
                        "audio_feature_provenance": provenance,
                    }
                )
            )
            restored_count += 1
            if matched_by_content and matched_content_sha256 is not None:
                migration_entries[audio_path] = {
                    **matched_entry,
                    "size_bytes": fingerprint.size_bytes,
                    "modified_time_ns": fingerprint.modified_time_ns,
                    "content_sha256": matched_content_sha256,
                    "analysis_profile_version": ANALYSIS_PROFILE_VERSION,
                    "audio_features": features.model_dump(mode="json", exclude_none=True),
                    "audio_feature_provenance": provenance.model_dump(
                        mode="json", exclude_none=True
                    ),
                }

        if migration_entries:
            try:
                warnings.extend(self._merge_entries(cache_path, migration_entries))
            except (OSError, TypeError, ValueError) as exc:
                warnings.append(self._safe_warning("write", exc))

        if invalid_entries:
            warnings.append(
                f"Ignored {invalid_entries} invalid analysis cache entr"
                f"{'y' if invalid_entries == 1 else 'ies'}."
            )
        return CacheRestoreResult(
            tracks=restored_tracks,
            restored_count=restored_count,
            warnings=warnings,
        )

    def store(
        self,
        *,
        cache_directories: dict[str, list[str]],
        tracks: list[Track],
        local_audio_paths: dict[str, str],
        expected_fingerprints: dict[str, AudioFileFingerprint],
    ) -> CacheWriteResult:
        tracks_by_directory: dict[str, list[Track]] = {}
        for track in tracks:
            if (
                track.audio_features is None
                or track.audio_feature_provenance is None
                or track.audio_feature_provenance.provider != "essentia"
            ):
                continue
            for directory in cache_directories.get(track.id, []):
                tracks_by_directory.setdefault(directory, []).append(track)

        written_count = 0
        warnings: list[str] = []
        content_digests: dict[str, str] = {}
        incomplete_tensorflow_track_ids: set[str] = set()
        with self._write_lock:
            for directory, directory_tracks in tracks_by_directory.items():
                try:
                    cache_path = self._cache_path(directory, create=True)
                    if cache_path is None:  # pragma: no cover - create=True always returns a path
                        raise OSError("Analysis cache directory could not be created")
                    pending_entries: dict[str, dict[str, Any]] = {}
                    for track in directory_tracks:
                        audio_path = local_audio_paths.get(track.id)
                        expected = expected_fingerprints.get(track.id)
                        if audio_path is None or expected is None:
                            continue
                        if not self._has_complete_tensorflow_features(track.audio_features):
                            incomplete_tensorflow_track_ids.add(track.id)
                            continue
                        if self.fingerprint(audio_path) != expected:
                            warnings.append(
                                f"Did not cache track {track.id} because its audio file changed "
                                "during analysis."
                            )
                            continue
                        content_sha256 = content_digests.get(track.id)
                        if content_sha256 is None:
                            content_sha256 = self._content_sha256(audio_path)
                            if self.fingerprint(audio_path) != expected:
                                warnings.append(
                                    f"Did not cache track {track.id} because its audio file "
                                    "changed during analysis."
                                )
                                continue
                            content_digests[track.id] = content_sha256
                        pending_entries[audio_path] = {
                            "size_bytes": expected.size_bytes,
                            "modified_time_ns": expected.modified_time_ns,
                            "content_sha256": content_sha256,
                            "analysis_profile_version": ANALYSIS_PROFILE_VERSION,
                            "analyzer_version": track.audio_feature_provenance.analyzer_version,
                            "audio_features": track.audio_features.model_dump(
                                mode="json", exclude_none=True
                            ),
                            "audio_feature_provenance": (
                                track.audio_feature_provenance.model_dump(
                                    mode="json", exclude_none=True
                                )
                            ),
                        }
                    if pending_entries:
                        warnings.extend(self._merge_entries(cache_path, pending_entries))
                        written_count += len(pending_entries)
                except (OSError, TypeError, ValueError) as exc:
                    warnings.append(self._safe_warning("write", exc))
        if incomplete_tensorflow_track_ids:
            warnings.append(
                "Did not cache "
                f"{len(incomplete_tensorflow_track_ids)} track(s) because complete TensorFlow mood "
                "measurements were unavailable; those tracks will be retried."
            )
        return CacheWriteResult(written_count=written_count, warnings=warnings)

    def _content_sha256(self, audio_path: str) -> str:
        resolved = self._resolve_audio_path(audio_path)
        digest = hashlib.sha256()
        with resolved.open("rb") as audio_file:
            while chunk := audio_file.read(_HASH_CHUNK_BYTES):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _is_sha256(value: Any) -> bool:
        if not isinstance(value, str) or len(value) != 64:
            return False
        try:
            bytes.fromhex(value)
        except ValueError:
            return False
        return True

    @staticmethod
    def _validated_measurements(
        entry: dict[str, Any],
    ) -> tuple[AudioFeatures, AudioFeatureProvenance]:
        features = AudioFeatures.model_validate(entry.get("audio_features"))
        provenance = AudioFeatureProvenance.model_validate(entry.get("audio_feature_provenance"))
        if provenance.provider != "essentia":
            raise ValueError("Cached provider is not Essentia")
        if not AnalysisCacheStore._has_complete_tensorflow_features(features):
            raise ValueError("Cached Essentia analysis has incomplete TensorFlow mood features")
        return features, provenance

    @staticmethod
    def _has_complete_tensorflow_features(features: AudioFeatures | None) -> bool:
        if features is None:
            return False
        return all(getattr(features, name) is not None for name in _REQUIRED_TENSORFLOW_FEATURES)

    def _resolve_audio_path(self, value: str) -> Path:
        requested = Path(value)
        if requested.is_absolute():
            raise ValueError("Local audio paths must be relative to the music root")
        resolved = (self._music_root / requested).resolve(strict=True)
        try:
            resolved.relative_to(self._music_root)
        except ValueError as exc:
            raise ValueError("Local audio path escapes the music root") from exc
        if not resolved.is_file():
            raise ValueError("Local audio path must reference a file")
        return resolved

    def _cache_path(self, cache_directory: str, *, create: bool) -> Path | None:
        requested = Path(cache_directory)
        if requested.is_absolute():
            raise ValueError("Analysis cache directories must be relative to the music root")
        playlist_directory = (self._music_root / requested).resolve(strict=True)
        try:
            playlist_directory.relative_to(self._music_root)
        except ValueError as exc:
            raise ValueError("Analysis cache directory escapes the music root") from exc
        if not playlist_directory.is_dir():
            raise ValueError("Analysis cache location must be a playlist directory")

        sequence_directory = playlist_directory / CACHE_SUBDIRECTORY
        if create:
            sequence_directory.mkdir(mode=0o700, exist_ok=True)
        elif not sequence_directory.exists():
            return None
        resolved_sequence = sequence_directory.resolve(strict=True)
        try:
            resolved_sequence.relative_to(self._music_root)
        except ValueError as exc:
            raise ValueError("Analysis cache subdirectory escapes the music root") from exc
        if sequence_directory.is_symlink() or not resolved_sequence.is_dir():
            raise ValueError("Analysis cache subdirectory must be a regular directory")

        cache_path = resolved_sequence / CACHE_FILENAME
        if cache_path.is_symlink():
            raise ValueError("Analysis cache file cannot be a symbolic link")
        return cache_path

    def _read_entries(self, cache_path: Path) -> tuple[dict[str, Any] | None, list[str]]:
        if not cache_path.exists():
            return {}, []
        try:
            if cache_path.stat().st_size > _MAX_CACHE_BYTES:
                raise ValueError("Analysis cache is larger than 16 MiB")
            payload = json.loads(cache_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Analysis cache root must be an object")
            if payload.get("schema_version") != CACHE_SCHEMA_VERSION:
                raise ValueError("Analysis cache schema version is unsupported")
            entries = payload.get("entries")
            if not isinstance(entries, dict):
                raise ValueError("Analysis cache entries must be an object")
            return entries, []
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
            return None, [self._safe_warning("read", exc)]

    def _merge_entries(self, cache_path: Path, updates: dict[str, dict[str, Any]]) -> list[str]:
        with self._exclusive_cache_lock(cache_path):
            existing_entries, warnings = self._read_entries(cache_path)
            entries = existing_entries or {}
            entries.update(updates)
            self._write_entries(cache_path, entries)
        return warnings

    @staticmethod
    @contextmanager
    def _exclusive_cache_lock(cache_path: Path) -> Iterator[None]:
        lock_path = cache_path.parent / _CACHE_LOCK_FILENAME
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        lock_fd = os.open(lock_path, flags, 0o600)
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)

    def _write_entries(self, cache_path: Path, entries: dict[str, Any]) -> None:
        document = {
            "schema_version": CACHE_SCHEMA_VERSION,
            "entries": entries,
        }
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=cache_path.parent,
                prefix=f".{CACHE_FILENAME}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                json.dump(document, handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, cache_path)
            temporary_path = None
            try:
                directory_fd = os.open(cache_path.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            except OSError:
                pass
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _safe_warning(operation: str, exc: Exception) -> str:
        return (
            f"Could not {operation} the playlist analysis cache; analysis results remain "
            f"available for this session ({type(exc).__name__})."
        )
