import { describe, expect, it } from "vitest";

import {
  absoluteFileUrl,
  buildDjExportBundle,
  buildExportCompatibilityManifest,
  buildRekordboxXml,
  formatCompatibilityReport,
} from "./djExport";
import type { RecipeOutput, Track } from "./types";

function makeTrack(
  id: string,
  name: string,
  overrides: Partial<Track> = {},
): Track {
  return {
    id,
    name,
    artist: "DJ & Friends",
    album: 'Album "One"',
    duration_ms: 180_400,
    explicit: false,
    genres: [],
    ...overrides,
  };
}

function makeOutput(id: string, name: string, tracks: Track[]): RecipeOutput {
  return {
    id,
    name,
    split_parameter: null,
    bin_index: null,
    range: null,
    split_assignments: [],
    track_count: tracks.length,
    tracks,
    groups: [],
    summary: {
      song_count: tracks.length,
      duration_ms: tracks.reduce((total, track) => total + track.duration_ms, 0),
      average_energy: null,
      average_bpm: null,
      average_danceability: null,
      energy_range: null,
    },
  };
}

const alpha = makeTrack("alpha", "Alpha");
const beta = makeTrack("beta", "Beta");

describe("Rekordbox XML export", () => {
  it("preserves exact ordering across multiple playlists and conserves repeated entries", () => {
    const outputs = [
      makeOutput("one", "One", [beta, alpha, beta]),
      makeOutput("two", "Two", [alpha, beta]),
    ];
    const result = buildRekordboxXml({
      outputs,
      localAudioPaths: { alpha: "Alpha.mp3", beta: "Beta.flac" },
      libraryRootPath: "/Music",
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(result.blocked).toBe(false);
    expect(result.playlistCount).toBe(2);
    expect(result.playlistTrackCount).toBe(5);
    expect(result.collectionTrackCount).toBe(2);
    expect(result.manifest.playlist_track_count).toBe(5);
    expect(result.manifest.duplicate_local_file_entry_count).toBe(3);
    expect(result.contents).toContain('<COLLECTION Entries="2">');
    expect(result.contents).toContain('<NODE Name="One" Type="1" KeyType="0" Entries="3">\n        <TRACK Key="1"/>\n        <TRACK Key="2"/>\n        <TRACK Key="1"/>');
    expect(result.contents).toContain('<NODE Name="Two" Type="1" KeyType="0" Entries="2">\n        <TRACK Key="2"/>\n        <TRACK Key="1"/>');
  });

  it("escapes XML metadata and emits percent-encoded absolute Unicode file URLs", () => {
    const special = makeTrack("special", 'A&B <Night> "Mix"', {
      artist: "Tanner's > Set",
      album: "A&B",
    });
    const result = buildRekordboxXml({
      outputs: [makeOutput("special", 'Low & "Bright"', [special])],
      localAudioPaths: { special: "Beyoncé & Friends/Été #1.flac" },
      libraryRootPath: "/Volumes/Música",
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(result.contents).toContain('Name="A&amp;B &lt;Night&gt; &quot;Mix&quot;"');
    expect(result.contents).toContain('Artist="Tanner&apos;s &gt; Set"');
    expect(result.contents).toContain('Name="Low &amp; &quot;Bright&quot;"');
    expect(result.contents).toContain(
      'Location="file://localhost/Volumes/M%C3%BAsica/Beyonc%C3%A9%20%26%20Friends/%C3%89t%C3%A9%20%231.flac"',
    );
  });

  it("keeps duplicate titles at different paths and repeated copies of the same path", () => {
    const firstCopy = makeTrack("copy-one", "Same title", { artist: "Same artist" });
    const secondCopy = makeTrack("copy-two", "Same title", { artist: "Same artist" });
    const output = makeOutput("duplicates", "Duplicates", [firstCopy, secondCopy, firstCopy]);
    const result = buildRekordboxXml({
      outputs: [output],
      localAudioPaths: {
        "copy-one": "/Music/Album A/Same title.mp3",
        "copy-two": "/Music/Album B/Same title.mp3",
      },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(result.collectionTrackCount).toBe(2);
    expect(result.playlistTrackCount).toBe(3);
    expect(result.contents?.match(/Name="Same title"/g)).toHaveLength(2);
    expect(result.contents).toContain('<TRACK Key="1"/>\n        <TRACK Key="2"/>\n        <TRACK Key="1"/>');
  });

  it("blocks XML and reports every missing path instead of exporting a partial playlist", () => {
    const missing = makeTrack("missing", "Missing", { uri: "spotify:track:missing" });
    const result = buildRekordboxXml({
      outputs: [makeOutput("blocked", "Blocked", [alpha, missing])],
      localAudioPaths: { alpha: "/Music/Alpha.mp3" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(result.blocked).toBe(true);
    expect(result.contents).toBeNull();
    expect(result.playlistTrackCount).toBe(2);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "non_local_uri",
        position: 2,
        track_id: "missing",
        target: "rekordbox",
      }),
    ]);
  });
});

describe("DJ compatibility manifest", () => {
  it("validates mixed codecs separately for Rekordbox, Apple Music, and djay Pro", () => {
    const mp3 = makeTrack("mp3", "MP3");
    const flac = makeTrack("flac", "FLAC");
    const opus = makeTrack("opus", "Opus");
    const manifest = buildExportCompatibilityManifest({
      outputs: [makeOutput("mixed", "Mixed codecs", [mp3, flac, opus])],
      localAudioPaths: {
        mp3: "/Music/track.mp3",
        flac: "/Music/track.flac",
        opus: "/Music/track.opus",
      },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(manifest.targets.m3u8).toEqual(expect.objectContaining({
      status: "ready",
      compatible_track_entries: 3,
    }));
    expect(manifest.targets.rekordbox).toEqual(expect.objectContaining({
      status: "warning",
      compatible_track_entries: 2,
      incompatible_track_entries: 1,
    }));
    expect(manifest.targets.apple_music).toEqual(expect.objectContaining({
      status: "warning",
      compatible_track_entries: 1,
      incompatible_track_entries: 2,
    }));
    expect(manifest.targets.djay_pro).toEqual(expect.objectContaining({
      status: "warning",
      compatible_track_entries: 2,
      incompatible_track_entries: 1,
    }));
    expect(manifest.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "rekordbox", track_id: "opus", code: "unsupported_extension" }),
      expect.objectContaining({ target: "apple_music", track_id: "flac", code: "unsupported_extension" }),
      expect.objectContaining({ target: "djay_pro", track_id: "opus", code: "unsupported_extension" }),
    ]));
  });

  it("distinguishes a missing path from a relative path with no library root", () => {
    const noLocation = makeTrack("none", "None");
    const relative = makeTrack("relative", "Relative");
    const manifest = buildExportCompatibilityManifest({
      outputs: [makeOutput("paths", "Paths", [noLocation, relative])],
      localAudioPaths: { relative: "Folder/Relative.mp3" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(manifest.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "m3u8", track_id: "none", code: "missing_location" }),
      expect.objectContaining({
        target: "rekordbox",
        track_id: "relative",
        code: "relative_path_without_library_root",
      }),
    ]));
    expect(manifest.playlist_track_count).toBe(2);
    expect(manifest.playlists[0].ordered_tracks).toHaveLength(2);
  });

  it("produces a readable report with per-track positions and target status", () => {
    const manifest = buildExportCompatibilityManifest({
      outputs: [makeOutput("mixed", "Mixed", [makeTrack("opus", "Opus")])],
      localAudioPaths: { opus: "/Music/track.opus" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });
    const report = formatCompatibilityReport(manifest);

    expect(report).toContain("Rekordbox XML: WARNING (0/1 compatible)");
    expect(report).toContain("[Rekordbox XML] Mixed #1: DJ & Friends — Opus.");
    expect(report).toContain("Playlist order and repeated entries are preserved exactly");
  });

  it("keeps unverified codecs in Rekordbox XML while reporting a warning", () => {
    const opus = makeTrack("opus", "Opus");
    const result = buildRekordboxXml({
      outputs: [makeOutput("mixed", "Mixed", [opus])],
      localAudioPaths: { opus: "/Music/track.opus" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(result.blocked).toBe(false);
    expect(result.contents).toContain("track.opus");
    expect(result.manifest.targets.rekordbox.status).toBe("warning");
  });
});

describe("DJ export bundle", () => {
  it("includes ordered M3U8 files, Rekordbox XML, JSON manifest, and text report", () => {
    const output = makeOutput("ready", "Night / Drive", [beta, alpha]);
    const bundle = buildDjExportBundle({
      outputs: [output],
      localAudioPaths: { alpha: "/Music/Alpha.mp3", beta: "/Music/Beta.flac" },
      generatedAt: "2026-07-19T00:00:00.000Z",
      bundleName: "Night Drive",
    });

    expect(bundle.files.map((file) => file.filename)).toEqual([
      "Night - Drive.m3u8",
      "Night Drive - Rekordbox.xml",
      "Night Drive - manifest.json",
      "Night Drive - compatibility.txt",
    ]);
    expect(bundle.files[0].contents).toMatch(
      /\/Music\/Beta\.flac[\s\S]*\/Music\/Alpha\.mp3/,
    );
    expect(JSON.parse(bundle.files[2].contents)).toEqual(bundle.manifest);
  });

  it("keeps unverified codecs in the XML and always includes diagnostics", () => {
    const output = makeOutput("mixed", "Mixed", [
      makeTrack("mp3", "MP3"),
      makeTrack("opus", "Opus"),
    ]);
    const bundle = buildDjExportBundle({
      outputs: [output],
      localAudioPaths: { mp3: "/Music/a.mp3", opus: "/Music/b.opus" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(bundle.files.some((file) => file.target === "rekordbox")).toBe(true);
    expect(bundle.files.filter((file) => file.target === "m3u8")).toHaveLength(1);
    expect(bundle.files.some((file) => file.target === "manifest")).toBe(true);
    expect(bundle.files.some((file) => file.target === "report")).toBe(true);
  });

  it("creates unique filenames for playlists with duplicate titles", () => {
    const outputs = [
      makeOutput("one", "Same title", [alpha]),
      makeOutput("two", "Same title", [beta]),
    ];
    const bundle = buildDjExportBundle({
      outputs,
      localAudioPaths: { alpha: "/Music/Alpha.mp3", beta: "/Music/Beta.mp3" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(bundle.files.filter((file) => file.target === "m3u8").map((file) => file.filename)).toEqual([
      "Same title.m3u8",
      "Same title (2).m3u8",
    ]);
  });

  it("does not collide with an existing numbered playlist filename", () => {
    const outputs = [
      makeOutput("one", "Same title", [alpha]),
      makeOutput("two", "Same title (2)", [beta]),
      makeOutput("three", "SAME TITLE", [alpha]),
    ];
    const bundle = buildDjExportBundle({
      outputs,
      localAudioPaths: { alpha: "/Music/Alpha.mp3", beta: "/Music/Beta.mp3" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(bundle.files.filter((file) => file.target === "m3u8").map((file) => file.filename)).toEqual([
      "Same title.m3u8",
      "Same title (2).m3u8",
      "SAME TITLE (3).m3u8",
    ]);
  });

  it("blocks and reports paths containing playlist control characters", () => {
    const unsafe = makeTrack("unsafe", "Unsafe path");
    const bundle = buildDjExportBundle({
      outputs: [makeOutput("unsafe", "Unsafe", [unsafe])],
      localAudioPaths: { unsafe: "/Music/Line one\nLine two.mp3" },
      generatedAt: "2026-07-19T00:00:00.000Z",
    });

    expect(bundle.manifest.targets.m3u8.status).toBe("blocked");
    expect(bundle.manifest.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "control_characters_in_path",
        position: 1,
        track_id: "unsafe",
      }),
    ]));
    expect(bundle.files.some((file) => file.target === "m3u8")).toBe(false);
    expect(bundle.compatibilityReport).toContain("cannot be represented safely");
  });
});

describe("absoluteFileUrl", () => {
  it("normalizes existing file URLs without double-encoding Unicode", () => {
    expect(absoluteFileUrl("file:///Volumes/M%C3%BAsica/%C3%89t%C3%A9.flac")).toBe(
      "file://localhost/Volumes/M%C3%BAsica/%C3%89t%C3%A9.flac",
    );
  });
});
