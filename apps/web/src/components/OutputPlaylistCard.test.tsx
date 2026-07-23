import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RecipeOutput } from "../lib/types";
import { OutputPlaylistCard } from "./OutputPlaylistCard";

const output: RecipeOutput = {
  id: "local-set",
  name: "Local set",
  split_parameter: null,
  bin_index: null,
  range: null,
  track_count: 1,
  tracks: [{
    id: "track-1",
    name: "Unknown Arousal",
    artist: "Test Artist",
    album: "Test Album",
    duration_ms: 180_000,
    explicit: false,
    genres: [],
    audio_features: { tempo: 124, key: 0, mode: 1, arousal: null },
  }],
  split_assignments: [],
  groups: [],
  summary: {
    song_count: 1,
    duration_ms: 180_000,
    average_energy: null,
    average_bpm: 124,
    average_danceability: null,
    energy_range: null,
  },
};

describe("OutputPlaylistCard", () => {
  it("exposes a compact metric inspector and lists unavailable values honestly", () => {
    const markup = renderToStaticMarkup(
      <OutputPlaylistCard
        output={output}
        outputIndex={0}
        splitParameters={[]}
        subgroupParameter={null}
        sortParameter={null}
        sortDirection="ascending"
        onExport={async () => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Inspect a metric for Local set"');
    expect(markup).toContain("Arousal · score");
    expect(markup).toContain("Brightness (spectral centroid) · Hz");
    expect(markup).toContain("Dynamic range (EBU R128 loudness range) · LU");
    expect(markup).toContain("1/1 available");
    expect(markup).toContain("124 BPM");
    expect(markup).toContain("Export M3U8");
    expect(markup).toContain('data-density="comfortable"');
    expect(markup).not.toContain("Play preview of Unknown Arousal");
    expect(markup).not.toContain("Spotify export is not connected yet");
    expect(markup).not.toContain("disabled=\"\"");
  });

  it("marks compact rows without dropping track details or controls", () => {
    const markup = renderToStaticMarkup(
      <OutputPlaylistCard
        output={output}
        outputIndex={0}
        splitParameters={[]}
        subgroupParameter={null}
        sortParameter={null}
        sortDirection="ascending"
        rowDensity="compact"
        onExport={async () => undefined}
        previewUrlForTrack={(track) => `asset://localhost/${track.id}.flac`}
      />,
    );

    expect(markup).toContain('data-density="compact"');
    expect(markup).toContain("row-density-compact");
    expect(markup).toContain("Unknown Arousal");
    expect(markup).toContain("Test Artist · Test Album");
    expect(markup).toContain("124 BPM");
    expect(markup).toContain("3:00");
    expect(markup).toContain('aria-label="Play preview of Unknown Arousal by Test Artist"');
  });

  it("exposes an accessible inline preview control when a track has a playable URL", () => {
    const markup = renderToStaticMarkup(
      <OutputPlaylistCard
        output={output}
        outputIndex={0}
        splitParameters={[]}
        subgroupParameter={null}
        sortParameter={null}
        sortDirection="ascending"
        onExport={async () => undefined}
        previewUrlForTrack={(track) => `asset://localhost/${track.id}.flac`}
      />,
    );

    expect(markup).toContain(
      'aria-label="Play preview of Unknown Arousal by Test Artist"',
    );
    expect(markup).toContain('class="track-preview-button idle"');
    expect(markup).not.toContain("asset://localhost/");
  });

  it("shows every selected factor assignment for a factorial output", () => {
    const factorialOutput: RecipeOutput = {
      ...output,
      name: "Local set — High Arousal × Low Danceability",
      split_assignments: [
        {
          factor_index: 0,
          parameter: "arousal",
          bin_id: "arousal-3",
          bin_index: 2,
          label: "High Arousal",
          range: { minimum: 0.6, maximum: 0.9, maximum_inclusive: true },
          unavailable: false,
        },
        {
          factor_index: 1,
          parameter: "danceability",
          bin_id: "danceability-1",
          bin_index: 0,
          label: "Low Danceability",
          range: { minimum: 0.1, maximum: 0.5, maximum_inclusive: false },
          unavailable: false,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <OutputPlaylistCard
        output={factorialOutput}
        outputIndex={0}
        splitParameters={["arousal", "danceability"]}
        subgroupParameter={null}
        sortParameter={null}
        sortDirection="ascending"
        onExport={async () => undefined}
      />,
    );

    expect(markup).toContain("split by arousal × danceability");
    expect(markup).toContain('aria-label="Factor grid assignment"');
    expect(markup).toContain("High Arousal");
    expect(markup).toContain("Low Danceability");
  });
});
