import { describe, expect, it, vi } from "vitest";

import type { RecipeOutput } from "./types";
import {
  buildM3u8,
  exportFilename,
  saveNativeM3u8,
  saveNativeM3u8Batch,
} from "./playlistExport";

const output: RecipeOutput = {
  id: "night-drive",
  name: "Night Drive / Levels",
  split_parameter: null,
  bin_index: null,
  range: null,
  split_assignments: [],
  track_count: 2,
  tracks: [
    {
      id: "track-1",
      name: "First\nTrack",
      artist: "Artist One",
      album: "Album One",
      duration_ms: 180_400,
      explicit: false,
      genres: [],
    },
    {
      id: "track-2",
      name: "Second Track",
      artist: "Artist Two",
      album: "Album Two",
      duration_ms: 240_000,
      explicit: false,
      genres: [],
    },
  ],
  groups: [
    {
      id: "low",
      label: "Low BPM",
      parameter: "tempo",
      bin_index: 0,
      range: { minimum: 100, maximum: 120 },
      start_index: 0,
      end_index_exclusive: 1,
      track_count: 1,
      tracks: [],
    },
    {
      id: "high",
      label: "High BPM",
      parameter: "tempo",
      bin_index: 1,
      range: { minimum: 120, maximum: 140 },
      start_index: 1,
      end_index_exclusive: 2,
      track_count: 1,
      tracks: [],
    },
  ],
  summary: {
    song_count: 2,
    duration_ms: 420_400,
    average_energy: null,
    average_bpm: null,
    average_danceability: null,
    energy_range: null,
  },
};

describe("playlist export", () => {
  it("builds an ordered UTF-8 M3U playlist with section metadata", () => {
    const result = buildM3u8(
      output,
      {
        "track-1": "First Track.flac",
        "track-2": "Second Track.mp3",
      },
      "/Music",
    );

    expect(result.missingTrackIds).toEqual([]);
    expect(result.trackCount).toBe(2);
    expect(result.contents).toBe([
      "#EXTM3U",
      "#PLAYLIST:Night Drive / Levels",
      "#EXTGRP:Low BPM",
      "#EXTINF:180,Artist One - First Track",
      "/Music/First Track.flac",
      "#EXTGRP:High BPM",
      "#EXTINF:240,Artist Two - Second Track",
      "/Music/Second Track.mp3",
      "",
    ].join("\n"));
  });

  it("refuses to silently omit tracks without an exportable location", async () => {
    const save = vi.fn();
    const invoke = vi.fn();

    await expect(saveNativeM3u8({
      output,
      localAudioPaths: { "track-1": "First Track.flac" },
      libraryRootPath: "/Music",
      save,
      invoke,
    })).rejects.toThrow("1 track has no usable local file path or Spotify URI");
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("opens a save dialog and writes the selected playlist through Tauri", async () => {
    const save = vi.fn().mockResolvedValue("/tmp/Night Drive Levels");
    const invoke = vi.fn().mockResolvedValue("/tmp/Night Drive Levels.m3u8");

    const result = await saveNativeM3u8({
      output,
      localAudioPaths: {
        "track-1": "First Track.flac",
        "track-2": "Second Track.mp3",
      },
      libraryRootPath: "/Music",
      save,
      invoke,
    });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "Night Drive - Levels.m3u8",
      title: "Export Night Drive / Levels",
    }));
    expect(invoke).toHaveBeenCalledWith("write_playlist_export", expect.objectContaining({
      path: "/tmp/Night Drive Levels.m3u8",
      contents: expect.stringContaining("/Music/Second Track.mp3"),
    }));
    expect(result).toEqual({
      cancelled: false,
      path: "/tmp/Night Drive Levels.m3u8",
      trackCount: 2,
    });
  });

  it("exports every playlist after choosing one destination folder", async () => {
    const secondOutput: RecipeOutput = {
      ...output,
      id: "sunrise-drive",
      name: "Sunrise Drive",
    };
    const selectDirectory = vi.fn().mockResolvedValue("/tmp/exports");
    const invoke = vi.fn().mockResolvedValue([
      "/tmp/exports/Night Drive - Levels.m3u8",
      "/tmp/exports/Sunrise Drive.m3u8",
    ]);

    const result = await saveNativeM3u8Batch({
      outputs: [output, secondOutput],
      localAudioPaths: {
        "track-1": "First Track.flac",
        "track-2": "Second Track.mp3",
      },
      libraryRootPath: "/Music",
      selectDirectory,
      invoke,
    });

    expect(selectDirectory).toHaveBeenCalledTimes(1);
    expect(selectDirectory).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Export 2 playlists",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("write_playlist_exports", {
      directory: "/tmp/exports",
      exports: [
        expect.objectContaining({
          filename: "Night Drive - Levels.m3u8",
          contents: expect.stringContaining("/Music/First Track.flac"),
        }),
        expect.objectContaining({
          filename: "Sunrise Drive.m3u8",
          contents: expect.stringContaining("/Music/Second Track.mp3"),
        }),
      ],
    });
    expect(result).toEqual({
      cancelled: false,
      directory: "/tmp/exports",
      paths: [
        "/tmp/exports/Night Drive - Levels.m3u8",
        "/tmp/exports/Sunrise Drive.m3u8",
      ],
      playlistCount: 2,
      trackCount: 4,
    });
  });

  it("does not open a destination picker when there are no playlists", async () => {
    const selectDirectory = vi.fn();
    const invoke = vi.fn();

    await expect(saveNativeM3u8Batch({
      outputs: [],
      localAudioPaths: {},
      libraryRootPath: "/Music",
      selectDirectory,
      invoke,
    })).rejects.toThrow("There are no playlists to export");
    expect(selectDirectory).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not report success when the native writer returns an incomplete batch", async () => {
    const secondOutput: RecipeOutput = {
      ...output,
      id: "sunrise-drive",
      name: "Sunrise Drive",
    };
    const selectDirectory = vi.fn().mockResolvedValue("/tmp/exports");
    const invoke = vi.fn().mockResolvedValue([
      "/tmp/exports/Night Drive - Levels.m3u8",
    ]);

    await expect(saveNativeM3u8Batch({
      outputs: [output, secondOutput],
      localAudioPaths: {
        "track-1": "First Track.flac",
        "track-2": "Second Track.mp3",
      },
      libraryRootPath: "/Music",
      selectDirectory,
      invoke,
    })).rejects.toThrow("The native app did not confirm all 2 playlist exports");
  });

  it("does not write when the native save dialog is cancelled", async () => {
    const save = vi.fn().mockResolvedValue(null);
    const invoke = vi.fn();

    const result = await saveNativeM3u8({
      output,
      localAudioPaths: {
        "track-1": "First Track.flac",
        "track-2": "Second Track.mp3",
      },
      libraryRootPath: "/Music",
      save,
      invoke,
    });

    expect(result).toEqual({ cancelled: true, trackCount: 0 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requires a library root before exporting root-relative local paths", () => {
    const result = buildM3u8(output, {
      "track-1": "First Track.flac",
      "track-2": "Second Track.mp3",
    });

    expect(result.trackCount).toBe(0);
    expect(result.missingTrackIds).toEqual(["track-1", "track-2"]);
  });

  it("rejects control characters in audio paths before opening the save dialog", async () => {
    const save = vi.fn();
    const invoke = vi.fn();

    await expect(saveNativeM3u8({
      output,
      localAudioPaths: {
        "track-1": "/Music/First\nTrack.flac",
        "track-2": "/Music/Second Track.mp3",
      },
      save,
      invoke,
    })).rejects.toThrow("1 track has no usable local file path or Spotify URI");
    expect(save).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("creates filesystem-safe M3U8 filenames", () => {
    expect(exportFilename("  Night: Drive / Levels  ")).toBe("Night- Drive - Levels.m3u8");
  });

  it("does not let incomplete group ranges omit tracks or repeated entries", () => {
    const repeated: RecipeOutput = {
      ...output,
      track_count: 3,
      tracks: [output.tracks[1], output.tracks[0], output.tracks[1]],
      groups: [{ ...output.groups[0], start_index: 0, end_index_exclusive: 1 }],
    };
    const result = buildM3u8(
      repeated,
      { "track-1": "First.mp3", "track-2": "Second.flac" },
      "/Music",
    );

    expect(result.trackCount).toBe(3);
    expect(result.contents.match(/\/Music\/Second\.flac/g)).toHaveLength(2);
    expect(result.contents).toMatch(
      /\/Music\/Second\.flac[\s\S]*\/Music\/First\.mp3[\s\S]*\/Music\/Second\.flac/,
    );
  });
});
