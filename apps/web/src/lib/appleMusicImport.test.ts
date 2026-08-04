import { describe, expect, it, vi } from "vitest";

import {
  buildAppleMusicImportRequest,
  planAppleMusicImportWith,
  runAppleMusicImportWith,
} from "./appleMusicImport";
import type { RecipeOutput, Track } from "./types";

const track = (id: string, name: string): Track => ({
  id,
  uri: "",
  name,
  artist: "Artist",
  album: "Album",
  album_art_url: "",
  duration_ms: 180_000,
  explicit: false,
  release_year: null,
  genres: [],
  audio_features: null,
});

const output = (tracks: Track[]): RecipeOutput => ({
  id: "low",
  name: "Low Arousal",
  split_parameter: null,
  bin_index: null,
  range: null,
  track_count: tracks.length,
  tracks,
  groups: [],
  split_assignments: [],
  summary: {
    song_count: tracks.length,
    duration_ms: tracks.length * 180_000,
    average_energy: null,
    average_bpm: null,
    average_danceability: null,
    energy_range: null,
  },
});

describe("Apple Music import request", () => {
  it("preserves the exact output order and resolves relative paths", () => {
    const request = buildAppleMusicImportRequest({
      folderName: "Flowset — Night Drive",
      outputs: [output([track("second", "Second"), track("first", "First")])],
      localAudioPaths: { first: "First.mp3", second: "Second.flac" },
      libraryRootPath: "/Volumes/Music",
    });

    expect(request).toEqual({
      folderName: "Flowset — Night Drive",
      playlists: [{
        name: "Low Arousal",
        trackPaths: ["/Volumes/Music/Second.flac", "/Volumes/Music/First.mp3"],
      }],
    });
  });

  it("blocks the whole request instead of silently dropping missing tracks", () => {
    expect(() => buildAppleMusicImportRequest({
      folderName: "Flowset",
      outputs: [output([track("missing", "Missing")])],
      localAudioPaths: {},
    })).toThrow(/no absolute local file path/i);
  });

  it("uses separate dry-run and live native commands", async () => {
    const request = { folderName: "Flowset", playlists: [] };
    const invoke = vi.fn()
      .mockResolvedValueOnce({ dryRun: true, ready: true })
      .mockResolvedValueOnce({ dryRun: false, addedCount: 2 });

    await planAppleMusicImportWith(request, invoke);
    await runAppleMusicImportWith(request, invoke);

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "plan_apple_music_import",
      "import_apple_music_playlists",
    ]);
  });
});
