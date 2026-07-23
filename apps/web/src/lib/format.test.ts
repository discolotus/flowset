import { describe, expect, it } from "vitest";

import { camelot, duration, flowScore } from "./format";
import type { Track } from "./types";

const track = (energy: number, tempo: number): Track => ({
  id: `${energy}-${tempo}`,
  name: "Test",
  artist: "Artist",
  album: "Album",
  duration_ms: 185_000,
  explicit: false,
  genres: [],
  audio_features: {
    tempo,
    key: 0,
    mode: 1,
    energy,
    danceability: 0.5,
    valence: 0.5,
    loudness: -8,
    acousticness: 0.1,
    instrumentalness: 0.2,
    speechiness: 0.05,
    liveness: 0.1,
    time_signature: 4,
  },
});

describe("format helpers", () => {
  it("formats durations", () => expect(duration(185_000)).toBe("3:05"));
  it("maps Spotify keys to Camelot", () => expect(camelot(track(0.5, 120))).toBe("8B"));
  it("scores a smooth transition highly", () => {
    expect(flowScore(track(0.5, 120), track(0.53, 122))).toBeGreaterThan(90);
  });
  it("keeps partially available provider features display-safe", () => {
    const partial = track(0.5, 120);
    partial.audio_features = { tempo: 120, key: 4 };

    expect(camelot(partial)).toBe("—");
    expect(flowScore(track(0.5, 120), partial)).toBeNull();
  });
});
