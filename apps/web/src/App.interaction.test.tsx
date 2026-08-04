// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DemoPlaylist, RecipePreviewResponse, Track } from "./lib/types";

vi.mock("./components/DistributionChart", () => ({
  DistributionChart: ({ distribution }: { distribution: { parameter: string } }) => (
    <div aria-label={`${distribution.parameter} distribution`}>Chart</div>
  ),
  DistributionLegend: ({ parameter }: { parameter: string }) => (
    <span>Equal-width bins across observed {parameter}</span>
  ),
}));

import App from "./App";

const sharedTrack: Track = {
  id: "shared",
  name: "Shared Signal",
  artist: "Sequence QA Artist",
  album: "Fictional Fixture",
  duration_ms: 180_000,
  explicit: false,
  genres: ["fixture"],
  audio_features: { energy: 0.55, danceability: 0.72, tempo: 124, valence: 0.61 },
  audio_feature_provenance: { provider: "fixture" },
};

const uniqueTrack: Track = {
  ...sharedTrack,
  id: "unique",
  name: "Unique Signal",
  audio_features: { energy: 0.8, danceability: 0.4, tempo: 118, valence: 0.3 },
};

const demoPlaylists: DemoPlaylist[] = [
  {
    id: "fixture-a",
    name: "Fixture A",
    description: "First fictional source",
    tracks: [sharedTrack, uniqueTrack],
    summary: {
      song_count: 2,
      duration_ms: 360_000,
      average_energy: 0.675,
      average_bpm: 121,
      average_danceability: 0.56,
      energy_range: [0.55, 0.8],
    },
  },
  {
    id: "fixture-b",
    name: "Fixture B",
    description: "Second fictional source with one duplicate",
    tracks: [sharedTrack],
    summary: {
      song_count: 1,
      duration_ms: 180_000,
      average_energy: 0.55,
      average_bpm: 124,
      average_danceability: 0.72,
      energy_range: [0.55, 0.55],
    },
  },
];

const previewRequests: Array<Record<string, unknown>> = [];
const storageValues = new Map<string, string>();
const testStorage: Storage = {
  get length() { return storageValues.size; },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => [...storageValues.keys()][index] ?? null,
  removeItem: (key) => { storageValues.delete(key); },
  setItem: (key, value) => { storageValues.set(key, value); },
};

function previewFor(request: Record<string, unknown>): RecipePreviewResponse {
  const inputPlaylists = request.input_playlists as Array<{ tracks: Track[] }>;
  const allTracks = inputPlaylists.flatMap(({ tracks }) => tracks);
  const uniqueTracks = [...new Map(allTracks.map((track) => [track.id, track])).values()]
    .sort((left, right) => (left.audio_features?.tempo ?? 0) - (right.audio_features?.tempo ?? 0));
  const distributionParameter = request.distribution_parameter as "energy";
  const requestedBinCount = request.distribution_bin_count as number;
  return {
    recipe_name: String(request.name),
    input_playlist_count: inputPlaylists.length,
    input_track_count: allTracks.length,
    deduplicated_track_count: uniqueTracks.length,
    duplicate_track_count: allTracks.length - uniqueTracks.length,
    distribution: {
      parameter: distributionParameter,
      requested_bin_count: requestedBinCount,
      minimum: 0.55,
      maximum: 0.8,
      bins: [{
        id: "energy-1",
        index: 0,
        label: "Fixture range",
        range: { minimum: 0.55, maximum: 0.8, maximum_inclusive: true },
        track_count: uniqueTracks.length,
        percentage: 100,
      }],
      unavailable_track_count: 0,
    },
    split_distributions: [],
    factorial_combination_count: 3,
    populated_combination_count: 1,
    empty_combination_count: 2,
    factor_unavailable_track_count: 0,
    outputs: [{
      id: "fixture-output",
      name: `${String(request.name)} — Fixture basis`,
      split_parameter: "energy",
      bin_index: 0,
      range: { minimum: 0.55, maximum: 0.8, maximum_inclusive: true },
      split_assignments: [{
        factor_index: 0,
        parameter: "energy",
        bin_id: "energy-1",
        bin_index: 0,
        label: "Fixture energy",
        range: { minimum: 0.55, maximum: 0.8, maximum_inclusive: true },
        unavailable: false,
      }],
      track_count: uniqueTracks.length,
      tracks: uniqueTracks,
      groups: [{
        id: "fixture-group",
        label: "Fixture danceability section",
        parameter: "danceability",
        bin_index: 0,
        range: { minimum: 0.4, maximum: 0.72, maximum_inclusive: true },
        start_index: 0,
        end_index_exclusive: uniqueTracks.length,
        track_count: uniqueTracks.length,
        tracks: uniqueTracks,
      }],
      summary: {
        song_count: uniqueTracks.length,
        duration_ms: uniqueTracks.reduce((sum, track) => sum + track.duration_ms, 0),
        average_energy: 0.675,
        average_bpm: 121,
        average_danceability: 0.56,
        energy_range: [0.55, 0.8],
      },
    }],
    warnings: [],
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

beforeEach(() => {
  previewRequests.length = 0;
  storageValues.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: testStorage,
  });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes("/api/v1/audio-features/providers")) {
      return jsonResponse({ providers: [{
        id: "reccobeats",
        display_name: "ReccoBeats",
        status: "available",
        requires_local_audio: false,
        detail: "Fixture provider boundary",
      }] });
    }
    if (path.includes("/api/v1/demo/playlists")) return jsonResponse(demoPlaylists);
    if (path.includes("/api/v1/local-library/folders")) {
      return jsonResponse({
        root_name: "Music",
        current_path: "",
        current_name: "Music",
        parent_path: null,
        folders: [],
      });
    }
    if (path.includes("/api/v1/recipes/preview")) {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      previewRequests.push(request);
      return jsonResponse(previewFor(request));
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  storageValues.clear();
});

async function openFixtureWorkspace(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("button", { name: /Demo playlists/ });
  await user.click(screen.getByRole("button", { name: /Demo playlists/ }));
  await screen.findByRole("heading", { name: /1 basis playlist/ }, { timeout: 2_000 });
}

describe("App behavior", () => {
  it("runs the visible source, deduplication, split, subgroup, scoped-sort, and output flow", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("button", { name: /^Export/ })).toBeNull();
    await openFixtureWorkspace(user);

    const summary = screen.getByLabelText("Combined source summary");
    expect(summary.textContent).toContain("2 sources");
    expect(summary.textContent).toContain("3 input tracks");
    expect(summary.textContent).toContain("2 unique");
    expect(summary.textContent).toContain("1 duplicates removed");
    expect(screen.getByRole("note", { name: "Fixture measurement source" }).textContent)
      .toContain("ReccoBeats and Essentia are not queried");
    expect(screen.queryByText("Choose where musical measurements come from")).toBeNull();

    await waitFor(() => expect(previewRequests.length).toBeGreaterThan(0));
    const request = previewRequests.at(-1)!;
    expect(request.split_factors).toEqual([{ parameter: "energy", bin_count: 3 }]);
    expect(request.subgroup).toEqual({ parameter: "danceability", bin_count: 2 });
    expect(request.sort).toEqual({ parameter: "tempo", direction: "asc" });

    expect(screen.getByText("Night Drive Levels — Fixture basis")).not.toBeNull();
    expect(screen.getByText("Unique Signal")).not.toBeNull();
    expect(screen.getByText("Shared Signal")).not.toBeNull();
    expect(document.querySelector(".recipe-sentence")?.textContent)
      .toContain("sort inside each section by tempo (bpm) low to high");

    const advanced = screen.getByText("Advanced").closest("details");
    expect(advanced?.open).toBe(false);
    await user.click(screen.getByText("Advanced"));
    expect(advanced?.open).toBe(true);
    expect(within(advanced!).getByRole("combobox", { name: "Histogram bins" })).not.toBeNull();

    const exportButton = screen.getByRole("button", { name: "Export 1 playlist…" });
    expect(exportButton).not.toHaveProperty("disabled", true);
    await user.click(exportButton);
    expect(screen.getByRole("heading", { name: "Choose a destination" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /^Configure / })).toHaveLength(5);
  });

  it("persists a saved recipe through save, rename, mutation, apply, reload, and delete", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App />);
    await openFixtureWorkspace(user);

    const outputName = screen.getByRole("textbox", { name: "Output name" });
    await user.clear(outputName);
    await user.type(outputName, "Sequence QA reusable");
    await user.click(screen.getByRole("button", { name: "Save current recipe" }));
    await screen.findByRole("combobox", { name: "Recipe history" });

    const renameInput = screen.getByRole("textbox", { name: "Recipe name" });
    await user.clear(renameInput);
    await user.type(renameInput, "Sequence QA renamed");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Recipe history" }).textContent)
      .toContain("Sequence QA renamed"));

    const levels = screen.getByRole("combobox", { name: "Levels" });
    await user.selectOptions(levels, "5");
    expect((levels as HTMLSelectElement).value).toBe("5");
    await user.click(screen.getByRole("button", { name: "Apply recipe" }));
    expect((screen.getByRole("combobox", { name: "Levels" }) as HTMLSelectElement).value).toBe("3");

    firstRender.unmount();
    render(<App />);
    await openFixtureWorkspace(user);
    const history = await screen.findByRole("combobox", { name: "Recipe history" });
    expect(history.textContent).toContain("Sequence QA renamed");
    await user.selectOptions(history, screen.getByRole("option", { name: "Sequence QA renamed" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Recipe history" })).toBeNull());
    expect(screen.getByText("No saved recipes yet.")).not.toBeNull();
  });
});
