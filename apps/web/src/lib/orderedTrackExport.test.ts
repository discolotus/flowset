import { describe, expect, it } from "vitest";

import { orderedTrackExportEntries } from "./orderedTrackExport";
import type { RecipeOutput, Track } from "./types";

function track(id: string, name: string): Track {
  return {
    id,
    name,
    artist: "Artist",
    album: "Album",
    duration_ms: 180_000,
    explicit: false,
    genres: [],
  };
}

const first = track("first", "First");
const second = track("second", "Second");
const output: RecipeOutput = {
  id: "ordered",
  name: "Ordered",
  split_parameter: null,
  bin_index: null,
  range: null,
  split_assignments: [],
  track_count: 3,
  tracks: [second, first, second],
  groups: [{
    id: "first-group",
    label: "First group",
    parameter: null,
    bin_index: null,
    range: null,
    start_index: 0,
    end_index_exclusive: 1,
    track_count: 1,
    tracks: [],
  }],
  summary: {
    song_count: 3,
    duration_ms: 540_000,
    average_energy: null,
    average_bpm: null,
    average_danceability: null,
    energy_range: null,
  },
};

describe("orderedTrackExportEntries", () => {
  it("uses output.tracks order, preserves duplicates, and treats groups as annotations", () => {
    const entries = orderedTrackExportEntries(
      output,
      { first: "First.mp3", second: "Second.flac" },
      "/Music",
    );

    expect(entries.map((entry) => entry.track.id)).toEqual(["second", "first", "second"]);
    expect(entries.map((entry) => entry.position)).toEqual([1, 2, 3]);
    expect(entries.map((entry) => entry.groupLabel)).toEqual([
      "First group",
      "All tracks",
      "All tracks",
    ]);
    expect(entries.map((entry) => entry.location.location)).toEqual([
      "/Music/Second.flac",
      "/Music/First.mp3",
      "/Music/Second.flac",
    ]);
  });
});
