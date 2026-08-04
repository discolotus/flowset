import { describe, expect, it } from "vitest";

import {
  buildLocalDistribution,
  formatParameterValue,
  numericTrackValue,
  NUMERIC_PARAMETERS,
  parameterCoverage,
  parameterDescription,
  parameterInterpretation,
  parameterLabel,
  parameterOptionLabel,
  parameterUnit,
} from "./parameters";
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
      arousal: 0.72,
      onset_rate: 3.45,
      brightness: 2_450,
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

  it("treats a provider's missing field as unavailable", () => {
    const partial = track("partial", 0.4);
    partial.audio_features = { tempo: 122 };

    expect(numericTrackValue(partial, "energy")).toBeNull();
  });

  it("uses reader-facing parameter labels", () => {
    expect(parameterLabel("key")).toBe("Harmonic key");
    expect(parameterLabel("tempo")).toBe("Tempo (BPM)");
    expect(parameterLabel("brightness")).toBe("Brightness (spectral centroid)");
    expect(parameterUnit("onset_rate")).toBe("onsets/s");
    expect(parameterDescription("valence")).toContain("emotional positivity");
    expect(parameterInterpretation("valence")).toContain("sad, dark, or tense");
  });

  it("exposes every energy-adjacent metric as a numeric recipe parameter", () => {
    expect(NUMERIC_PARAMETERS.map(({ value }) => value)).toEqual(expect.arrayContaining([
      "arousal",
      "aggressiveness",
      "party",
      "relaxed",
      "onset_rate",
      "beat_strength",
      "dynamic_complexity",
      "loudness_range",
      "brightness",
      "spectral_flux",
      "key_strength",
    ]));
  });

  it("formats metrics with honest measurement units", () => {
    expect(formatParameterValue(3.45, "onset_rate")).toBe("3.5/s");
    expect(formatParameterValue(2_450, "brightness")).toBe("2.45 kHz");
    expect(formatParameterValue(4.28, "dynamic_complexity")).toBe("4.28 dB-like");
    expect(formatParameterValue(7.24, "loudness_range")).toBe("7.2 LU");
    expect(formatParameterValue(-8.34, "loudness")).toBe("-8.3 dB/LUFS");
    expect(parameterLabel("loudness")).toBe("Loudness (source scale)");
    expect(parameterUnit("loudness")).toBe("dB/LUFS");
    expect(parameterLabel("loudness_range")).toBe("Dynamic range (EBU R128 loudness range)");
    expect(parameterUnit("loudness_range")).toBe("LU");
    expect(parameterUnit("beat_strength")).toBeNull();
    expect(parameterUnit("spectral_flux")).toBeNull();
    expect(formatParameterValue(null, "arousal")).toBe("—");
  });

  it("preserves significant digits for small raw extractor values", () => {
    expect(formatParameterValue(0.004321, "beat_strength")).toBe("0.004321");
    expect(formatParameterValue(0.00004321, "spectral_flux")).toBe("4.32e-5");
    expect(formatParameterValue(0, "key_strength")).toBe("0");
  });

  it("reports recipe and sort coverage without treating partial keys as usable", () => {
    const complete = track("complete", 0.6);
    const partial = track("partial", 0.4);
    partial.audio_features = { key: 4 };

    expect(parameterCoverage([complete, partial], "energy")).toEqual({
      available: 1,
      total: 2,
    });
    expect(parameterCoverage([complete, partial], "key")).toEqual({
      available: 1,
      total: 2,
    });
    expect(parameterCoverage([complete, partial], "artist")).toEqual({
      available: 2,
      total: 2,
    });
    expect(parameterOptionLabel("energy", { available: 1, total: 2 })).toBe(
      "Energy · 1/2",
    );
  });
});
