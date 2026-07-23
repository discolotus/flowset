import { describe, expect, it } from "vitest";

import {
  addPlaylistCacheDirectory,
  trackReadyForProvider,
  tracksNeedingAnalysis,
} from "./analysisCache";
import type { Track } from "./types";

const bareTrack = (id: string): Track => ({
  id,
  name: id,
  artist: "Artist",
  album: "Album",
  duration_ms: 180_000,
  explicit: false,
  genres: [],
});

describe("playlist analysis cache state", () => {
  it("retains every playlist cache directory for overlapping tracks", () => {
    const first = addPlaylistCacheDirectory({}, ["shared"], "Sets/Warmup");
    const second = addPlaylistCacheDirectory(
      first,
      ["shared", "peak"],
      "Sets/Peak",
    );

    expect(second).toEqual({
      shared: ["Sets/Warmup", "Sets/Peak"],
      peak: ["Sets/Peak"],
    });
  });

  it("analyzes only tracks that are not already ready for the selected provider", () => {
    const cached = {
      ...bareTrack("cached"),
      audio_features: {
        tempo: 124,
        arousal: 0.5,
        valence: 0.5,
        aggressiveness: 0.5,
        party: 0.5,
        relaxed: 0.5,
      },
      audio_feature_provenance: { provider: "essentia" as const },
    };
    const otherProvider = {
      ...bareTrack("other"),
      audio_features: { tempo: 125 },
      audio_feature_provenance: { provider: "reccobeats" as const },
    };

    expect(
      tracksNeedingAnalysis([cached, otherProvider, bareTrack("missing")], "essentia")
        .map((track) => track.id),
    ).toEqual(["other", "missing"]);
  });

  it("retries an Essentia track when TensorFlow mood output is incomplete", () => {
    const partial = {
      ...bareTrack("partial"),
      audio_features: { tempo: 124, arousal: null },
      audio_feature_provenance: { provider: "essentia" as const },
    };

    expect(trackReadyForProvider(partial, "essentia")).toBe(false);
    expect(tracksNeedingAnalysis([partial], "essentia")).toEqual([partial]);
  });
});
