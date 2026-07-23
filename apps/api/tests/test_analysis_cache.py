import json
import threading
import time
from pathlib import Path

from playlist_optimizer.analysis_cache import AnalysisCacheStore
from playlist_optimizer.local_library import LocalPlaylistImporter, LocalTrackMetadata
from playlist_optimizer.models import (
    AudioFeatureProvenance,
    AudioFeatureResolutionRequest,
    AudioFeatures,
    LocalPlaylistImportRequest,
)
from playlist_optimizer.providers.essentia import EssentiaAnalysis, EssentiaProvider


def _metadata(path: Path) -> LocalTrackMetadata:
    return LocalTrackMetadata(
        name=path.stem,
        artist="Local Artist",
        album=path.parent.name,
        duration_ms=180_000,
    )


class _Analyzer:
    is_available = True
    unavailable_reason = None

    def analyze(self, path: Path) -> EssentiaAnalysis:
        return EssentiaAnalysis(
            features=AudioFeatures(
                tempo=124.0,
                energy=0.72,
                danceability=0.66,
                arousal=0.61,
                valence=0.58,
                aggressiveness=0.22,
                party=0.67,
                relaxed=0.31,
            ),
            analyzer_version="test-essentia",
            notes=(f"Analyzed {path.name}.",),
        )


class _MutatingAnalyzer(_Analyzer):
    def analyze(self, path: Path) -> EssentiaAnalysis:
        analysis = super().analyze(path)
        path.write_bytes(path.read_bytes() + b" changed during analysis")
        return analysis


class _NativeOnlyAnalyzer(_Analyzer):
    def analyze(self, path: Path) -> EssentiaAnalysis:
        return EssentiaAnalysis(
            features=AudioFeatures(tempo=124.0, danceability=0.66),
            analyzer_version="test-essentia",
            notes=("TensorFlow mood analysis was unavailable.",),
        )


def test_essentia_analysis_is_restored_when_a_playlist_is_reimported(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)

    initial = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = initial.playlist.tracks[0]
    provider = EssentiaProvider(audio_root=music_root, analyzer=_Analyzer())
    resolved = provider.resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=initial.local_audio_paths,
            analysis_cache_directories={track.id: [initial.analysis_cache_directory]},
        )
    )

    assert resolved.status == "complete"
    cache_path = playlist_dir / ".sequence" / "analysis-cache.json"
    assert cache_path.is_file()
    cache_text = cache_path.read_text(encoding="utf-8")
    cache_payload = json.loads(cache_text)
    assert str(music_root) not in cache_text
    assert list(cache_payload["entries"]) == ["June 26/track.wav"]
    assert cache_payload["entries"]["June 26/track.wav"]["analyzer_version"] == ("test-essentia")
    assert cache_payload["entries"]["June 26/track.wav"]["analysis_profile_version"]
    content_sha256 = cache_payload["entries"]["June 26/track.wav"]["content_sha256"]
    assert len(content_sha256) == 64
    assert all(character in "0123456789abcdef" for character in content_sha256)

    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert restored.cached_track_count == 1
    assert restored.playlist.tracks[0].audio_features == AudioFeatures(
        tempo=124.0,
        energy=0.72,
        danceability=0.66,
        arousal=0.61,
        valence=0.58,
        aggressiveness=0.22,
        party=0.67,
        relaxed=0.31,
    )
    assert restored.playlist.tracks[0].audio_feature_provenance is not None
    assert restored.playlist.tracks[0].audio_feature_provenance.provider == "essentia"


def test_unchanged_metadata_uses_the_fast_path_without_hashing(
    tmp_path: Path,
    monkeypatch,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = imported.playlist.tracks[0]
    EssentiaProvider(audio_root=music_root, analyzer=_Analyzer()).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )

    def fail_if_hashed(_store: AnalysisCacheStore, _audio_path: str) -> str:
        raise AssertionError("metadata matches must not hash audio")

    monkeypatch.setattr(AnalysisCacheStore, "_content_sha256", fail_if_hashed)
    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert restored.cached_track_count == 1
    assert restored.playlist.tracks[0].audio_features is not None


def test_renamed_audio_file_reuses_cached_analysis_by_content(
    tmp_path: Path,
    monkeypatch,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    original_path = playlist_dir / "original.wav"
    original_path.write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = imported.playlist.tracks[0]
    EssentiaProvider(audio_root=music_root, analyzer=_Analyzer()).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )
    original_path.rename(playlist_dir / "renamed.wav")

    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert restored.cached_track_count == 1
    assert restored.playlist.tracks[0].name == "renamed"
    assert restored.playlist.tracks[0].audio_features == AudioFeatures(
        tempo=124.0,
        energy=0.72,
        danceability=0.66,
        arousal=0.61,
        valence=0.58,
        aggressiveness=0.22,
        party=0.67,
        relaxed=0.31,
    )
    assert restored.playlist.tracks[0].audio_feature_provenance is not None
    assert restored.playlist.tracks[0].audio_feature_provenance.source_id == ("June 26/renamed.wav")

    migrated_payload = json.loads(
        (playlist_dir / ".sequence" / "analysis-cache.json").read_text(encoding="utf-8")
    )
    assert "June 26/renamed.wav" in migrated_payload["entries"]

    def fail_if_hashed(_store: AnalysisCacheStore, _audio_path: str) -> str:
        raise AssertionError("a migrated rename should use the metadata fast path")

    monkeypatch.setattr(AnalysisCacheStore, "_content_sha256", fail_if_hashed)
    restored_again = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    assert restored_again.cached_track_count == 1


def test_rename_fallback_rejects_same_size_different_content(tmp_path: Path) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    original_path = playlist_dir / "original.wav"
    original_path.write_bytes(b"first fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = imported.playlist.tracks[0]
    EssentiaProvider(audio_root=music_root, analyzer=_Analyzer()).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )
    renamed_path = playlist_dir / "renamed.wav"
    original_path.rename(renamed_path)
    replacement = b"other fixture"
    assert len(replacement) == renamed_path.stat().st_size
    renamed_path.write_bytes(replacement)

    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert restored.cached_track_count == 0
    assert restored.playlist.tracks[0].audio_features is None


def test_schema_one_cache_entry_without_a_hash_still_restores(tmp_path: Path) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = imported.playlist.tracks[0]
    EssentiaProvider(audio_root=music_root, analyzer=_Analyzer()).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )
    cache_path = playlist_dir / ".sequence" / "analysis-cache.json"
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
    payload["entries"]["June 26/track.wav"].pop("content_sha256")
    cache_path.write_text(json.dumps(payload), encoding="utf-8")

    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert restored.cached_track_count == 1
    assert restored.playlist.tracks[0].audio_features is not None


def test_existing_full_profile_entry_without_tensorflow_moods_is_ignored(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = imported.playlist.tracks[0]
    EssentiaProvider(audio_root=music_root, analyzer=_Analyzer()).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )
    cache_path = playlist_dir / ".sequence" / "analysis-cache.json"
    payload = json.loads(cache_path.read_text(encoding="utf-8"))
    cached_features = payload["entries"]["June 26/track.wav"]["audio_features"]
    for feature_name in ("arousal", "valence", "aggressiveness", "party", "relaxed"):
        cached_features.pop(feature_name)
    cache_path.write_text(json.dumps(payload), encoding="utf-8")

    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert restored.cached_track_count == 0
    assert restored.playlist.tracks[0].audio_features is None
    assert any("invalid analysis cache entry" in warning for warning in restored.warnings)


def test_incomplete_tensorflow_analysis_is_returned_but_not_cached(tmp_path: Path) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = imported.playlist.tracks[0]

    resolved = EssentiaProvider(
        audio_root=music_root,
        analyzer=_NativeOnlyAnalyzer(),
    ).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )
    reimported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert resolved.tracks[0].audio_features is not None
    assert resolved.tracks[0].audio_features.arousal is None
    assert any("complete TensorFlow mood measurements" in warning for warning in resolved.warnings)
    assert reimported.cached_track_count == 0
    assert reimported.playlist.tracks[0].audio_features is None


def test_separate_analysis_batches_merge_without_losing_cached_tracks(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "first.wav").write_bytes(b"first fixture")
    (playlist_dir / "second.wav").write_bytes(b"second fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    provider = EssentiaProvider(audio_root=music_root, analyzer=_Analyzer())

    for track in imported.playlist.tracks:
        provider.resolve(
            AudioFeatureResolutionRequest(
                provider="essentia",
                tracks=[track],
                local_audio_paths={track.id: imported.local_audio_paths[track.id]},
                analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
            )
        )

    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert restored.cached_track_count == 2
    assert all(track.audio_features is not None for track in restored.playlist.tracks)


def test_concurrent_cache_store_instances_merge_without_losing_tracks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "first.wav").write_bytes(b"first fixture")
    (playlist_dir / "second.wav").write_bytes(b"second fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    tracks = imported.playlist.tracks
    stores = [AnalysisCacheStore(music_root=music_root) for _ in tracks]
    enriched_tracks = [
        track.model_copy(
            update={
                "audio_features": _Analyzer().analyze(Path(track.name)).features,
                "audio_feature_provenance": AudioFeatureProvenance(
                    provider="essentia",
                    source_id=imported.local_audio_paths[track.id],
                    analyzer_version="test-essentia",
                ),
            }
        )
        for track in tracks
    ]
    expected_fingerprints = [
        store.fingerprint(imported.local_audio_paths[track.id])
        for store, track in zip(stores, tracks, strict=True)
    ]

    original_read_entries = AnalysisCacheStore._read_entries

    def slow_read_entries(store: AnalysisCacheStore, cache_path: Path):
        result = original_read_entries(store, cache_path)
        time.sleep(0.05)
        return result

    monkeypatch.setattr(AnalysisCacheStore, "_read_entries", slow_read_entries)
    start = threading.Barrier(len(tracks) + 1)
    errors: list[BaseException] = []

    def write_track(index: int) -> None:
        try:
            track = enriched_tracks[index]
            start.wait()
            stores[index].store(
                cache_directories={track.id: [imported.analysis_cache_directory]},
                tracks=[track],
                local_audio_paths={track.id: imported.local_audio_paths[track.id]},
                expected_fingerprints={track.id: expected_fingerprints[index]},
            )
        except BaseException as exc:  # preserve worker failures for the main test thread
            errors.append(exc)

    workers = [threading.Thread(target=write_track, args=(index,)) for index in range(len(tracks))]
    for worker in workers:
        worker.start()
    start.wait()
    for worker in workers:
        worker.join(timeout=5)

    assert all(not worker.is_alive() for worker in workers)
    assert errors == []
    payload = json.loads(
        (playlist_dir / ".sequence" / "analysis-cache.json").read_text(encoding="utf-8")
    )
    assert set(payload["entries"]) == {
        "June 26/first.wav",
        "June 26/second.wav",
    }


def test_changing_one_audio_file_invalidates_only_that_cached_track(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    first_path = playlist_dir / "first.wav"
    second_path = playlist_dir / "second.wav"
    first_path.write_bytes(b"first fixture")
    second_path.write_bytes(b"second fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    provider = EssentiaProvider(audio_root=music_root, analyzer=_Analyzer())
    provider.resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=imported.playlist.tracks,
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={
                track.id: [imported.analysis_cache_directory] for track in imported.playlist.tracks
            },
        )
    )
    first_path.write_bytes(b"first fixture changed")

    restored = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    restored_by_name = {track.name: track for track in restored.playlist.tracks}

    assert restored.cached_track_count == 1
    assert restored_by_name["first"].audio_features is None
    assert restored_by_name["second"].audio_features is not None


def test_a_corrupt_cache_is_ignored_without_blocking_playlist_import(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    cache_dir = playlist_dir / ".sequence"
    cache_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    (cache_dir / "analysis-cache.json").write_text("not json", encoding="utf-8")

    result = LocalPlaylistImporter(
        music_root=music_root,
        metadata_reader=_metadata,
    ).import_playlist(LocalPlaylistImportRequest(source_path="June 26", recursive=True))

    assert result.cached_track_count == 0
    assert result.playlist.tracks[0].audio_features is None
    assert any(
        "Could not read the playlist analysis cache" in warning for warning in result.warnings
    )


def test_cache_write_failure_keeps_successful_analysis_available(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    (playlist_dir / ".sequence").write_text("blocks cache directory", encoding="utf-8")
    track = imported.playlist.tracks[0]

    resolved = EssentiaProvider(audio_root=music_root, analyzer=_Analyzer()).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )

    assert resolved.status == "complete"
    assert resolved.tracks[0].audio_features is not None
    assert any(
        "Could not write the playlist analysis cache" in warning for warning in resolved.warnings
    )


def test_cache_directory_cannot_escape_the_music_root(tmp_path: Path) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    outside = tmp_path / "outside"
    playlist_dir.mkdir(parents=True)
    outside.mkdir()
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    imported = LocalPlaylistImporter(
        music_root=music_root,
        metadata_reader=_metadata,
    ).import_playlist(LocalPlaylistImportRequest(source_path="June 26", recursive=True))
    track = imported.playlist.tracks[0]

    resolved = EssentiaProvider(audio_root=music_root, analyzer=_Analyzer()).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: ["../outside"]},
        )
    )

    assert resolved.status == "complete"
    assert any(
        "Could not write the playlist analysis cache" in warning for warning in resolved.warnings
    )
    assert not (outside / ".sequence").exists()


def test_audio_changed_during_analysis_is_returned_but_not_cached(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "Music"
    playlist_dir = music_root / "June 26"
    playlist_dir.mkdir(parents=True)
    (playlist_dir / "track.wav").write_bytes(b"audio fixture")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    imported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )
    track = imported.playlist.tracks[0]

    resolved = EssentiaProvider(
        audio_root=music_root,
        analyzer=_MutatingAnalyzer(),
    ).resolve(
        AudioFeatureResolutionRequest(
            provider="essentia",
            tracks=[track],
            local_audio_paths=imported.local_audio_paths,
            analysis_cache_directories={track.id: [imported.analysis_cache_directory]},
        )
    )
    reimported = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="June 26", recursive=True)
    )

    assert resolved.status == "complete"
    assert resolved.tracks[0].audio_features is not None
    assert any("changed during analysis" in warning for warning in resolved.warnings)
    assert reimported.cached_track_count == 0
