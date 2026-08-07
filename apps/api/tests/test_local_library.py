from pathlib import Path

import pytest

import playlist_optimizer.local_library as local_library_module
from playlist_optimizer.local_library import (
    SUPPORTED_AUDIO_EXTENSIONS,
    LocalLibraryBrowser,
    LocalPlaylistImporter,
    LocalTrackMetadata,
    read_local_track_metadata,
    resolve_local_audio_file,
)
from playlist_optimizer.models import LocalPlaylistImportRequest


def _metadata(path: Path) -> LocalTrackMetadata:
    return LocalTrackMetadata(
        name=path.stem,
        artist="Local Artist",
        album=path.parent.name,
        duration_ms=180_000,
    )


def _dff_chunk(chunk_id: bytes, data: bytes) -> bytes:
    padding = b"\x00" if len(data) % 2 else b""
    return chunk_id + len(data).to_bytes(8, "big") + data + padding


def _minimal_dff() -> bytes:
    sample_rate = 2_822_400
    channel_count = 2
    properties = b"SND "
    properties += _dff_chunk(b"FS  ", sample_rate.to_bytes(4, "big"))
    properties += _dff_chunk(
        b"CHNL", channel_count.to_bytes(2, "big") + b"SLFTSRGT"
    )
    compression_name = b"not compressed"
    properties += _dff_chunk(
        b"CMPR", b"DSD " + bytes((len(compression_name),)) + compression_name
    )

    channel_bytes = sample_rate // 8 // 4
    dsd = bytes((0x69, 0x96, 0x96, 0x69)) * (channel_bytes // 2)
    form = b"DSD "
    form += _dff_chunk(b"FVER", bytes((1, 5, 0, 0)))
    form += _dff_chunk(b"PROP", properties)
    form += _dff_chunk(b"DSD ", dsd)
    return _dff_chunk(b"FRM8", form)


def test_supports_common_ffmpeg_audio_sources_for_mp3_delivery() -> None:
    assert {
        ".aac",
        ".ac3",
        ".adts",
        ".aif",
        ".aifc",
        ".aiff",
        ".ape",
        ".dff",
        ".dsf",
        ".eac3",
        ".flac",
        ".m4a",
        ".m4b",
        ".mp+",
        ".mp2",
        ".mp3",
        ".mpc",
        ".mpp",
        ".oga",
        ".ogg",
        ".opus",
        ".spx",
        ".tak",
        ".tta",
        ".wav",
        ".wave",
        ".wma",
        ".wv",
    }.issubset(SUPPORTED_AUDIO_EXTENSIONS)


def test_reads_real_dff_metadata_and_duration(tmp_path: Path) -> None:
    source = tmp_path / "minimal.dff"
    source.write_bytes(_minimal_dff())

    metadata = read_local_track_metadata(source)

    assert metadata.name == "minimal"
    assert metadata.artist == "Unknown artist"
    assert metadata.album == tmp_path.name
    assert metadata.duration_ms == 250


def test_recovers_artist_and_clean_title_from_numbered_untagged_filename(
    tmp_path: Path,
) -> None:
    source = tmp_path / "010 - Bailey Ibbs - Unsociable Hours [NSR003].dff"
    source.write_bytes(_minimal_dff())

    metadata = read_local_track_metadata(source)

    assert metadata.name == "Unsociable Hours [NSR003]"
    assert metadata.artist == "Bailey Ibbs"


def test_imports_m3u_in_order_and_reports_unsafe_entries(tmp_path: Path) -> None:
    music_root = tmp_path / "music"
    album = music_root / "album"
    album.mkdir(parents=True)
    first = album / "first.mp3"
    second = album / "second.flac"
    outside = tmp_path / "outside.mp3"
    first.write_bytes(b"first")
    second.write_bytes(b"second")
    outside.write_bytes(b"outside")
    playlist = album / "set.m3u"
    playlist.write_text(
        f"second.flac\nfirst.mp3\n../../outside.mp3\n{outside}\n",
        encoding="utf-8",
    )

    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)
    result = importer.import_playlist(LocalPlaylistImportRequest(source_path="album/set.m3u"))

    assert result.source_kind == "m3u"
    assert result.playlist.name == "set"
    assert result.analysis_cache_directory == "album"
    assert result.cached_track_count == 0
    assert [track.name for track in result.playlist.tracks] == ["second", "first"]
    assert list(result.local_audio_paths.values()) == ["album/second.flac", "album/first.mp3"]
    assert len(result.skipped_files) == 2
    assert "escapes" in result.skipped_files[0].reason
    assert result.skipped_files[1].path == "outside.mp3"
    assert result.warnings == [
        "Skipped 2 unreadable, unsupported, duplicate, or unsafe playlist entries."
    ]


def test_imports_directory_nonrecursively_or_recursively(tmp_path: Path) -> None:
    music_root = tmp_path / "music"
    crate = music_root / "crate"
    nested = crate / "nested"
    nested.mkdir(parents=True)
    (crate / "top.mp3").write_bytes(b"top")
    (crate / "partial.mp3.incomplete").write_bytes(b"partial")
    (crate / "legacy.webm").write_bytes(b"legacy")
    (nested / "deep.wav").write_bytes(b"deep")
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)

    shallow = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="crate", recursive=False)
    )
    recursive = importer.import_playlist(
        LocalPlaylistImportRequest(source_path="crate", recursive=True)
    )

    assert [track.name for track in shallow.playlist.tracks] == ["top"]
    assert [track.name for track in recursive.playlist.tracks] == ["deep", "top"]
    assert shallow.analysis_cache_directory == "crate"
    assert recursive.analysis_cache_directory == "crate"
    assert len(shallow.skipped_files) == 2
    assert all("unsupported" in problem.reason for problem in shallow.skipped_files)
    assert shallow.playlist.id != recursive.playlist.id


def test_rejects_a_source_path_outside_the_music_root(tmp_path: Path) -> None:
    music_root = tmp_path / "music"
    music_root.mkdir()
    (tmp_path / "outside").mkdir()
    importer = LocalPlaylistImporter(music_root=music_root, metadata_reader=_metadata)

    with pytest.raises(ValueError, match="escapes"):
        importer.import_playlist(LocalPlaylistImportRequest(source_path="../outside"))


def test_browses_safe_subfolders_without_reading_their_contents(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    music_root = tmp_path / "Music Library"
    album = music_root / "Artist" / "Album"
    empty = music_root / "Empty"
    hidden = music_root / ".metadata"
    album.mkdir(parents=True)
    empty.mkdir(parents=True)
    hidden.mkdir(parents=True)
    (album / "first.mp3").write_bytes(b"first")
    (album / "second.flac").write_bytes(b"second")
    (album / "cover.jpg").write_bytes(b"cover")

    def forbidden_iterdir(path: Path):
        raise AssertionError(f"folder browsing used a file-oriented listing: {path.name}")

    monkeypatch.setattr(Path, "iterdir", forbidden_iterdir)
    browser = LocalLibraryBrowser(music_root=music_root)
    root = browser.browse()

    assert root.root_name == "Music Library"
    assert root.current_path == ""
    assert root.parent_path is None
    assert [folder.name for folder in root.folders] == ["Artist", "Empty"]


def test_folder_browser_rejects_escape_and_hides_external_symlinks(tmp_path: Path) -> None:
    music_root = tmp_path / "music"
    outside = tmp_path / "outside"
    music_root.mkdir()
    outside.mkdir()
    external_audio = outside / "outside.mp3"
    external_audio.write_bytes(b"outside")
    (music_root / "external-link").symlink_to(outside, target_is_directory=True)
    safe_folder = music_root / "safe"
    safe_folder.mkdir()
    (safe_folder / "external-track.mp3").symlink_to(external_audio)
    browser = LocalLibraryBrowser(music_root=music_root)

    assert [folder.name for folder in browser.browse().folders] == ["safe"]
    with pytest.raises(ValueError, match="escapes"):
        browser.browse("../outside")


def test_discovers_m3u_playlists_recursively_in_stable_path_order(tmp_path: Path) -> None:
    music_root = tmp_path / "music"
    sets = music_root / "Sets"
    nested = sets / "2026" / "August"
    hidden = sets / ".sequence"
    nested.mkdir(parents=True)
    hidden.mkdir()
    (sets / "Warmup.M3U").write_text("track.mp3\n", encoding="utf-8")
    (nested / "Main Set.m3u8").write_text("#EXTM3U\n", encoding="utf-8")
    (nested / "notes.txt").write_text("not a playlist", encoding="utf-8")
    (hidden / "cache.m3u8").write_text("#EXTM3U\n", encoding="utf-8")

    result = LocalLibraryBrowser(music_root=music_root).discover_playlists("Sets")

    assert result.root_name == "music"
    assert result.search_path == "Sets"
    assert result.search_name == "Sets"
    assert [playlist.model_dump() for playlist in result.playlists] == [
        {
            "path": "Sets/2026/August/Main Set.m3u8",
            "name": "Main Set",
            "source_kind": "m3u8",
        },
        {
            "path": "Sets/Warmup.M3U",
            "name": "Warmup",
            "source_kind": "m3u",
        },
    ]


def test_discovers_and_imports_a_deep_m3u8_with_sibling_audio(tmp_path: Path) -> None:
    music_root = tmp_path / "music"
    audio_folder = music_root / "Audio" / "House"
    playlist_folder = music_root / "Playlists" / "2026" / "August"
    audio_folder.mkdir(parents=True)
    playlist_folder.mkdir(parents=True)
    (audio_folder / "First.mp3").write_bytes(b"first")
    (audio_folder / "Second.flac").write_bytes(b"second")
    playlist_path = playlist_folder / "Main Set.m3u8"
    playlist_path.write_text(
        "#EXTM3U\n../../../Audio/House/Second.flac\n../../../Audio/House/First.mp3\n",
        encoding="utf-8",
    )

    discovery = LocalLibraryBrowser(music_root=music_root).discover_playlists("Playlists")
    assert [playlist.path for playlist in discovery.playlists] == [
        "Playlists/2026/August/Main Set.m3u8"
    ]

    discovered = discovery.playlists[0]
    result = LocalPlaylistImporter(
        music_root=music_root,
        metadata_reader=_metadata,
    ).import_playlist(
        LocalPlaylistImportRequest(source_path=discovered.path, recursive=False)
    )

    assert result.source_kind == "m3u8"
    assert result.playlist.name == "Main Set"
    assert [track.name for track in result.playlist.tracks] == ["Second", "First"]
    assert list(result.local_audio_paths.values()) == [
        "Audio/House/Second.flac",
        "Audio/House/First.mp3",
    ]
    assert result.analysis_cache_directory == "Playlists/2026/August"


def test_playlist_discovery_skips_symlinks_and_rejects_an_unsafe_start_path(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "music"
    outside = tmp_path / "outside"
    music_root.mkdir()
    outside.mkdir()
    external_playlist = outside / "external.m3u8"
    external_playlist.write_text("#EXTM3U\n", encoding="utf-8")
    (music_root / "external-file.m3u8").symlink_to(external_playlist)
    (music_root / "external-folder").symlink_to(outside, target_is_directory=True)
    browser = LocalLibraryBrowser(music_root=music_root)

    assert browser.discover_playlists().playlists == []
    with pytest.raises(ValueError, match="escapes"):
        browser.discover_playlists("../outside")


def test_playlist_discovery_keeps_same_named_files_in_different_folders(
    tmp_path: Path,
) -> None:
    music_root = tmp_path / "music"
    house = music_root / "Playlists" / "House"
    techno = music_root / "Playlists" / "Techno"
    house.mkdir(parents=True)
    techno.mkdir(parents=True)
    (house / "Favorites.m3u8").write_text("#EXTM3U\n", encoding="utf-8")
    (techno / "Favorites.m3u8").write_text("#EXTM3U\n", encoding="utf-8")

    result = LocalLibraryBrowser(music_root=music_root).discover_playlists("Playlists")

    assert [playlist.path for playlist in result.playlists] == [
        "Playlists/House/Favorites.m3u8",
        "Playlists/Techno/Favorites.m3u8",
    ]
    assert [playlist.name for playlist in result.playlists] == ["Favorites", "Favorites"]


def test_playlist_discovery_fails_instead_of_returning_a_truncated_scan(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    music_root = tmp_path / "music"
    music_root.mkdir()
    for index in range(3):
        (music_root / f"set-{index}.m3u8").write_text("#EXTM3U\n", encoding="utf-8")
    monkeypatch.setattr(local_library_module, "_MAX_DIRECTORY_ENTRIES_SCANNED", 2)

    with pytest.raises(ValueError, match="at most 2 entries; choose a narrower parent folder"):
        LocalLibraryBrowser(music_root=music_root).discover_playlists()


def test_resolves_only_supported_audio_files_inside_the_music_root(tmp_path: Path) -> None:
    music_root = tmp_path / "music"
    crate = music_root / "crate"
    crate.mkdir(parents=True)
    track = crate / "preview.flac"
    track.write_bytes(b"preview audio")
    outside = tmp_path / "outside.mp3"
    outside.write_bytes(b"outside")

    assert resolve_local_audio_file(music_root, "crate/preview.flac") == track

    with pytest.raises(ValueError, match="relative"):
        resolve_local_audio_file(music_root, str(track))
    with pytest.raises(ValueError, match="escapes"):
        resolve_local_audio_file(music_root, "../outside.mp3")
    with pytest.raises(ValueError, match="supported audio"):
        resolve_local_audio_file(music_root, "crate")
