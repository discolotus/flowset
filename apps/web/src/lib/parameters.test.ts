import { describe, expect, it } from "vitest";

import { buildLocalDistribution, numericTrackValue, parameterLabel } from "./parameters";
import type { Track } from "./types";

function track(id: string, energy: number): Track {
  return {
    id,
    name: id,
    artist: "Test artist",
    album: "Test album",
    duration_ms: 180_000,
    explicit: false,
    release_year: 2024,
    genres: [],
    audio_features: {
      tempo: 120,
      key: 0,
      mode: 1,
      energy,
      danceability: 0.6,
      valence: 0.5,
      loudness: -8,
      acousticness: 0.1,
      instrumentalness: 0.2,
      speechiness: 0.04,
      liveness: 0.08,
      time_signature: 4,
    },
  };
}

describe("parameter helpers", () => {
  it("builds a complete equal-width distribution", () => {
    const distribution = buildLocalDistribution(
      [track("low", 0.1), track("middle", 0.5), track("high", 0.9)],
      "energy",
      3,
    );

    expect(distribution.bins.map((bin) => bin.track_count)).toEqual([1, 1, 1]);
    expect(distribution.bins.reduce((sum, bin) => sum + bin.percentage, 0)).toBeCloseTo(100);
  });

  it("maps duration to the track metadata field", () => {
    expect(numericTrackValue(track("one", 0.4), "duration")).toBe(180_000);
  });

  it("uses reader-facing parameter labels", () => {
    expect(parameterLabel("key")).toBe("Harmonic key");
    expect(parameterLabel("tempo")).toBe("Tempo (BPM)");
  });
});
