// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecipeOutput } from "../lib/types";
import { LocalDataSummary } from "./LocalDataSummary";
import { OutputPlaylistCard } from "./OutputPlaylistCard";
import { ParameterGuide } from "./ParameterGuide";
import { RowDensityToggle } from "./RowDensityToggle";

afterEach(cleanup);

const output: RecipeOutput = {
  id: "qa-output",
  name: "Sequence QA output",
  split_parameter: null,
  bin_index: null,
  range: null,
  split_assignments: [],
  track_count: 1,
  tracks: [{
    id: "qa-track",
    name: "Fictional track",
    artist: "Sequence QA",
    album: "Generated fixture",
    duration_ms: 120_000,
    explicit: false,
    genres: [],
    audio_features: { energy: 0.6, valence: 0.25, tempo: 126 },
  }],
  groups: [],
  summary: {
    song_count: 1,
    duration_ms: 120_000,
    average_energy: 0.6,
    average_bpm: 126,
    average_danceability: null,
    energy_range: [0.6, 0.6],
  },
};

describe("compact utility controls", () => {
  it("keeps local cache and history paths available inside a collapsed disclosure", async () => {
    const user = userEvent.setup();
    render(
      <LocalDataSummary
        analysisCachePaths={["/Sequence QA/.sequence/analysis-cache.json"]}
        lastMp3Export={{
          directory: "/Sequence QA/MP3",
          manifestPath: "/Sequence QA/MP3/manifest.json",
          exportedAt: "2026-08-04T00:00:00Z",
        }}
        workspaceStatePath="/Sequence QA/sequence-workspace.json"
      />,
    );

    const disclosure = screen.getByText("Cache & history").closest("details");
    expect(disclosure?.open).toBe(false);
    expect(screen.getByTitle("/Sequence QA/.sequence/analysis-cache.json")).not.toBeNull();
    await user.click(screen.getByText("Cache & history"));
    expect(disclosure?.open).toBe(true);
    expect(screen.getByTitle("/Sequence QA/sequence-workspace.json")).not.toBeNull();
  });

  it("changes the inspected output metric and runs contextual M3U8 export", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn(async () => undefined);
    render(
      <OutputPlaylistCard
        output={output}
        outputIndex={0}
        splitParameters={[]}
        subgroupParameter={null}
        sortParameter="tempo"
        sortDirection="ascending"
        onExport={onExport}
      />,
    );

    const metric = screen.getByRole("combobox", { name: "Inspect a metric for Sequence QA output" });
    expect((metric as HTMLSelectElement).value).toBe("tempo");
    await user.selectOptions(metric, "valence");
    expect((metric as HTMLSelectElement).value).toBe("valence");
    expect(screen.getByText("0.25")).not.toBeNull();

    expect(screen.queryByRole("button", { name: "Export M3U8" })).not.toBeNull();
    await user.click(screen.getByText("•••"));
    await user.click(screen.getByRole("button", { name: "Export M3U8" }));
    expect(onExport).toHaveBeenCalledWith(output);
  });

  it("opens the complete parameter glossary and wires compact-row selection", async () => {
    const user = userEvent.setup();
    const onDensityChange = vi.fn();
    const { container } = render(
      <>
        <ParameterGuide parameter="valence" />
        <RowDensityToggle density="comfortable" onChange={onDensityChange} />
      </>,
    );

    const glossary = container.querySelector(".parameter-glossary") as HTMLDetailsElement;
    expect(glossary.open).toBe(false);
    await user.click(screen.getByText("Browse all parameter definitions"));
    expect(glossary.open).toBe(true);
    expect(screen.getByRole("heading", { name: "Spectral flux" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Compact rows" }));
    expect(onDensityChange).toHaveBeenCalledWith("compact");
  });
});
