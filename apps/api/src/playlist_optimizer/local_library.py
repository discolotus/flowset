import math
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

from mutagen import File as MutagenFile

from playlist_optimizer.analysis_cache import AnalysisCacheStore
from playlist_optimizer.models import (
    InputPlaylist,
    LocalImportProblem,
    LocalLibraryBrowseResponse,
    LocalLibraryFolder,
    LocalPlaylistImportRequest,
    LocalPlaylistImportResponse,
    LocalPlaylistSourceKind,
    Track,
)

AUDIO_MEDIA_TYPES = {
    ".aac": "audio/aac",
    ".ac3": "audio/ac3",
    ".adts": "audio/aac",
    ".aif": "audio/aiff",
    ".aifc": "audio/aiff",
    ".aiff": "audio/aiff",
    ".ape": "audio/ape",
    ".dff": "audio/x-dff",
    ".dsf": "audio/dsf",
    ".eac3": "audio/eac3",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".m4b": "audio/mp4",
    ".mp+": "audio/x-musepack",
    ".mp2": "audio/mpeg",
    ".mp3": "audio/mpeg",
    ".mpc": "audio/x-musepack",
    ".mpp": "audio/x-musepack",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
    ".spx": "audio/ogg",
    ".tak": "audio/x-tak",
    ".tta": "audio/x-tta",
    ".wav": "audio/wav",
    ".wave": "audio/wav",
    ".wma": "audio/x-ms-wma",
    ".wv": "audio/x-wavpack",
}
SUPPORTED_AUDIO_EXTENSIONS = frozenset(AUDIO_MEDIA_TYPES)
KNOWN_UNSUPPORTED_AUDIO_EXTENSIONS = frozenset(
    {".amr", ".au", ".caf", ".mka", ".ra", ".w64", ".webm"}
)
SUPPORTED_PLAYLIST_EXTENSIONS = frozenset({".m3u", ".m3u8"})
_YEAR = re.compile(r"(?:^|\D)((?:19|20)\d{2})(?:\D|$)")
_ISRC = re.compile(r"^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$")
_INCOMPLETE_SUFFIXES = frozenset({".incomplete", ".part", ".tmp"})
_MAX_PLAYLIST_ENTRIES = 5000
_MAX_DIRECTORY_ENTRIES_SCANNED = 20_000
_MAX_M3U_BYTES = 5 * 1024 * 1024
_MAX_BROWSE_ENTRIES = 20_000


def resolve_local_audio_file(music_root: Path, value: str) -> Path:
    """Resolve one browser-previewable audio file without allowing root escapes."""

    root = music_root.resolve()
    requested = Path(value)
    if requested.is_absolute():
        raise ValueError("Local audio paths must be relative to the configured music root")
    try:
        resolved = (root / requested).resolve(strict=True)
    except FileNotFoundError as exc:
        raise ValueError("Local audio file does not exist") from exc
    except OSError as exc:
        raise ValueError("Local audio file could not be accessed") from exc
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError("Local audio path escapes the configured music root") from exc
    if not resolved.is_file() or resolved.suffix.casefold() not in SUPPORTED_AUDIO_EXTENSIONS:
        raise ValueError("Local audio path must identify a supported audio file")
    return resolved


@dataclass(frozen=True)
class LocalTrackMetadata:
    name: str
    artist: str
    album: str
    duration_ms: int
    isrc: str | None = None
    release_year: int | None = None


MetadataReader = Callable[[Path], LocalTrackMetadata]


class LocalLibraryBrowser:
    """List safe subdirectories beneath the configured music root without exposing host paths."""

    def __init__(self, *, music_root: Path) -> None:
        self._music_root = music_root.resolve()
        if not self._music_root.is_dir():
            raise ValueError("The configured local music root does not exist or is not a directory")

    def browse(self, path: str = "") -> LocalLibraryBrowseResponse:
        current = self._resolve_directory(path)
        folders: list[LocalLibraryFolder] = []
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    if entry.name.startswith("."):
                        continue
                    try:
                        is_directory = entry.is_dir(follow_symlinks=False)
                    except OSError:
                        continue
                    if not is_directory:
                        continue
                    if len(folders) >= _MAX_BROWSE_ENTRIES:
                        raise ValueError("A local folder listing can return at most 20000 folders")
                    directory = current / entry.name
                    folders.append(
                        LocalLibraryFolder(
                            path=self._relative_path(directory),
                            name=entry.name,
                        )
                    )
        except OSError as exc:
            raise ValueError("Local music directory could not be read") from exc
        folders.sort(key=lambda folder: folder.name.casefold())

        current_path = self._relative_path(current)
        parent_path = None
        if current != self._music_root:
            parent_path = self._relative_path(current.parent)
        return LocalLibraryBrowseResponse(
            root_name=self._music_root.name,
            current_path=current_path,
            current_name=current.name,
            parent_path=parent_path,
            folders=folders,
        )

    def _resolve_directory(self, value: str) -> Path:
        requested = Path(value)
        if requested.is_absolute():
            raise ValueError("Local library paths must be relative to the configured music root")
        try:
            resolved = (self._music_root / requested).resolve(strict=True)
        except FileNotFoundError as exc:
            raise ValueError("Local library directory does not exist") from exc
        except OSError as exc:
            raise ValueError("Local library directory could not be accessed") from exc
        try:
            resolved.relative_to(self._music_root)
        except ValueError as exc:
            raise ValueError("Local library path escapes the configured music root") from exc
        if not resolved.is_dir():
            raise ValueError("Local library path must be a directory")
        return resolved

    def _relative_path(self, path: Path) -> str:
        relative = path.relative_to(self._music_root)
        return "" if relative == Path(".") else relative.as_posix()


class LocalPlaylistImporter:
    """Import a directory or M3U as a provider-neutral playlist beneath one safe root."""

    def __init__(
        self,
        *,
        music_root: Path,
        metadata_reader: MetadataReader | None = None,
    ) -> None:
        self._music_root = music_root.resolve()
        self._metadata_reader = metadata_reader or read_local_track_metadata
        if not self._music_root.is_dir():
            raise ValueError("The configured local music root does not exist or is not a directory")
        self._analysis_cache = AnalysisCacheStore(music_root=self._music_root)

    def import_playlist(self, request: LocalPlaylistImportRequest) -> LocalPlaylistImportResponse:
        source = self._resolve_source(request.source_path)
        source_kind, candidates, skipped_files = self._collect_candidates(
            source, recursive=request.recursive
        )
        if len(candidates) > _MAX_PLAYLIST_ENTRIES:
            raise ValueError("A local playlist can contain at most 5000 audio files")

        tracks: list[Track] = []
        local_audio_paths: dict[str, str] = {}
        seen_relative_paths: set[str] = set()
        for candidate in candidates:
            try:
                resolved = candidate.resolve(strict=True)
                relative_path = resolved.relative_to(self._music_root).as_posix()
            except FileNotFoundError:
                skipped_files.append(
                    LocalImportProblem(
                        path=self._safe_problem_path(candidate),
                        reason="Audio file does not exist",
                    )
                )
                continue
            except ValueError:
                skipped_files.append(
                    LocalImportProblem(
                        path=self._safe_problem_path(candidate),
                        reason="Audio file escapes the configured local music root",
                    )
                )
                continue
            if not resolved.is_file():
                skipped_files.append(
                    LocalImportProblem(path=relative_path, reason="Entry is not a file")
                )
                continue
            if resolved.suffix.casefold() not in SUPPORTED_AUDIO_EXTENSIONS:
                skipped_files.append(
                    LocalImportProblem(path=relative_path, reason="Unsupported audio extension")
                )
                continue
            if relative_path in seen_relative_paths:
                skipped_files.append(
                    LocalImportProblem(path=relative_path, reason="Duplicate playlist entry")
                )
                continue
            try:
                metadata = self._metadata_reader(resolved)
            except (OSError, RuntimeError, ValueError) as exc:
                skipped_files.append(
                    LocalImportProblem(
                        path=relative_path,
                        reason=f"Metadata read failed ({type(exc).__name__})",
                    )
                )
                continue

            seen_relative_paths.add(relative_path)
            track_id = _stable_id("local-track", relative_path)
            tracks.append(
                Track(
                    id=track_id,
                    name=metadata.name,
                    artist=metadata.artist,
                    album=metadata.album,
                    duration_ms=metadata.duration_ms,
                    isrc=metadata.isrc,
                    release_year=metadata.release_year,
                )
            )
            local_audio_paths[track_id] = relative_path

        if not tracks:
            raise ValueError("The selected local playlist contains no readable audio files")

        source_relative = source.relative_to(self._music_root).as_posix()
        playlist_name = request.name or (source.name if source.is_dir() else source.stem)
        playlist_identity = source_relative
        if source_kind == "directory":
            playlist_identity = f"{source_relative}|recursive={request.recursive}"
        cache_directory_path = source if source_kind == "directory" else source.parent
        cache_directory_relative = cache_directory_path.relative_to(self._music_root)
        analysis_cache_directory = (
            "" if cache_directory_relative == Path(".") else cache_directory_relative.as_posix()
        )
        warnings = []
        if skipped_files:
            warnings.append(
                f"Skipped {len(skipped_files)} unreadable, unsupported, duplicate, or unsafe "
                "playlist entries."
            )
        cache_result = self._analysis_cache.restore(
            cache_directory=analysis_cache_directory,
            tracks=tracks,
            local_audio_paths=local_audio_paths,
        )
        warnings.extend(cache_result.warnings)
        return LocalPlaylistImportResponse(
            source_kind=source_kind,
            playlist=InputPlaylist(
                id=_stable_id("local-playlist", playlist_identity),
                name=playlist_name,
                tracks=cache_result.tracks,
            ),
            local_audio_paths=local_audio_paths,
            analysis_cache_directory=analysis_cache_directory,
            cached_track_count=cache_result.restored_count,
            skipped_files=skipped_files,
            warnings=warnings,
        )

    def _resolve_source(self, value: str) -> Path:
        requested = Path(value)
        if requested.is_absolute():
            raise ValueError("Local playlist paths must be relative to the configured music root")
        try:
            source = (self._music_root / requested).resolve(strict=True)
        except FileNotFoundError as exc:
            raise ValueError("Local playlist path does not exist") from exc
        except OSError as exc:
            raise ValueError("Local playlist path could not be accessed") from exc
        try:
            source.relative_to(self._music_root)
        except ValueError as exc:
            raise ValueError("Local playlist path escapes the configured music root") from exc
        return source

    def _safe_problem_path(self, candidate: Path) -> str:
        try:
            return candidate.relative_to(self._music_root).as_posix()
        except ValueError:
            return candidate.name

    def _collect_candidates(
        self, source: Path, *, recursive: bool
    ) -> tuple[LocalPlaylistSourceKind, list[Path], list[LocalImportProblem]]:
        if source.is_dir():
            iterator = source.rglob("*") if recursive else source.iterdir()
            candidates: list[Path] = []
            problems: list[LocalImportProblem] = []
            scanned_entries = 0
            try:
                for path in iterator:
                    scanned_entries += 1
                    if scanned_entries > _MAX_DIRECTORY_ENTRIES_SCANNED:
                        raise ValueError("A local directory scan can inspect at most 20000 entries")
                    if not path.is_file():
                        continue
                    suffix = path.suffix.casefold()
                    if suffix in SUPPORTED_AUDIO_EXTENSIONS:
                        candidates.append(path)
                    elif _looks_like_incomplete_audio(path):
                        problems.append(
                            LocalImportProblem(
                                path=self._safe_problem_path(path),
                                reason="Incomplete or unsupported audio file",
                            )
                        )
                    if len(candidates) > _MAX_PLAYLIST_ENTRIES:
                        raise ValueError("A local playlist can contain at most 5000 audio files")
            except OSError as exc:
                raise ValueError("Local playlist directory could not be read") from exc
            candidates.sort(key=lambda path: path.as_posix().casefold())
            return "directory", candidates, problems

        suffix = source.suffix.casefold()
        if suffix not in SUPPORTED_PLAYLIST_EXTENSIONS:
            raise ValueError("Local playlist source must be a directory, .m3u, or .m3u8 file")
        candidates, problems = self._read_m3u(source)
        source_kind: LocalPlaylistSourceKind = "m3u8" if suffix == ".m3u8" else "m3u"
        return source_kind, candidates, problems

    def _read_m3u(self, playlist_path: Path) -> tuple[list[Path], list[LocalImportProblem]]:
        try:
            if playlist_path.stat().st_size > _MAX_M3U_BYTES:
                raise ValueError("M3U files can be at most 5 MiB")
            raw = playlist_path.read_bytes()
        except OSError as exc:
            raise ValueError("M3U file could not be read") from exc
        try:
            content = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            content = raw.decode("latin-1")

        candidates: list[Path] = []
        problems: list[LocalImportProblem] = []
        entry_count = 0
        for raw_line in content.splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            entry_count += 1
            if entry_count > _MAX_PLAYLIST_ENTRIES:
                raise ValueError("An M3U can contain at most 5000 entries")
            entry = Path(line.replace("\\", "/"))
            candidate = entry if entry.is_absolute() else playlist_path.parent / entry
            display_path = entry.name if entry.is_absolute() else line
            try:
                candidate.resolve(strict=True).relative_to(self._music_root)
            except FileNotFoundError:
                problems.append(
                    LocalImportProblem(path=display_path, reason="Playlist entry is missing")
                )
                continue
            except ValueError:
                problems.append(
                    LocalImportProblem(
                        path=display_path,
                        reason="Playlist entry escapes the configured local music root",
                    )
                )
                continue
            candidates.append(candidate)
        return candidates, problems


def read_local_track_metadata(path: Path) -> LocalTrackMetadata:
    try:
        audio = MutagenFile(path, easy=True)
    except Exception as exc:  # Mutagen wraps codec-specific parse errors inconsistently.
        raise ValueError(f"Audio metadata parser failed ({type(exc).__name__})") from exc
    if audio is None or getattr(audio, "info", None) is None:
        raise ValueError("Unsupported or unreadable audio metadata")
    duration_seconds = float(getattr(audio.info, "length", 0))
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("Audio duration is unavailable")

    tags = getattr(audio, "tags", None) or {}
    tagged_title = _first_tag(tags, "title")
    tagged_artist = _first_tag(tags, "artist", "albumartist")
    fallback_artist, fallback_title = _metadata_from_filename(path.stem)
    date = _first_tag(tags, "date", "originaldate")
    year_match = _YEAR.search(date) if date else None
    return LocalTrackMetadata(
        name=tagged_title or fallback_title,
        artist=tagged_artist or fallback_artist,
        album=_first_tag(tags, "album") or path.parent.name,
        duration_ms=max(round(duration_seconds * 1000), 1),
        isrc=_normalized_isrc(_first_tag(tags, "isrc")),
        release_year=int(year_match.group(1)) if year_match else None,
    )


def _metadata_from_filename(stem: str) -> tuple[str, str]:
    """Recover common DJ-pool `NNN - Artist - Title` filenames without guessing broadly."""

    parts = [part.strip() for part in stem.split(" - ")]
    if len(parts) >= 2 and parts[0].isdigit():
        parts = parts[1:]
    if len(parts) >= 2 and parts[0] and any(parts[1:]):
        return parts[0], " - ".join(part for part in parts[1:] if part)
    title = " - ".join(part for part in parts if part).strip() or stem.strip()
    return "Unknown artist", title


def _first_tag(tags: object, *keys: str) -> str | None:
    for key in keys:
        try:
            value = tags.get(key)  # type: ignore[attr-defined]
        except (AttributeError, KeyError):
            continue
        if isinstance(value, (list, tuple)):
            value = value[0] if value else None
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def _stable_id(prefix: str, value: str) -> str:
    digest = sha256(value.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}-{digest}"


def _normalized_isrc(value: str | None) -> str | None:
    if value is None:
        return None
    candidate = value.strip().upper()
    return candidate if _ISRC.fullmatch(candidate) else None


def _looks_like_incomplete_audio(path: Path) -> bool:
    suffixes = {suffix.casefold() for suffix in path.suffixes}
    is_incomplete = bool(suffixes & SUPPORTED_AUDIO_EXTENSIONS and suffixes & _INCOMPLETE_SUFFIXES)
    is_known_unsupported = path.suffix.casefold() in KNOWN_UNSUPPORTED_AUDIO_EXTENSIONS
    return is_incomplete or is_known_unsupported
