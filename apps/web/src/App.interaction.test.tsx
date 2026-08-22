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

const localTrack: Track = {
  ...sharedTrack,
  id: "local-main-track",
  name: "Local Main Track",
  genres: [],
  audio_features: null,
  audio_feature_provenance: null,
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
const playlistDiscoveryPaths: string[] = [];
const localPlaylistImportRequests: Array<Record<string, unknown>> = [];
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
  playlistDiscoveryPaths.length = 0;
  localPlaylistImportRequests.length = 0;
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
    if (path.includes("/api/v1/semantic/backends")) return jsonResponse([{
      id: "local-clap",
      display_name: "Local CLAP",
      model: "clap-v1",
      available: true,
      requires_local_audio: true,
      max_tracks: 20,
      max_labels: 1,
      capabilities: ["text_similarity"],
      detail: "Runs on loopback over authorized paths.",
    }]);
    if (path.includes("/api/v1/semantic/rank")) return jsonResponse({
      backend: {
        id: "local-clap",
        display_name: "Local CLAP",
        model: "clap-v1",
        available: true,
        requires_local_audio: true,
        max_tracks: 20,
        max_labels: 1,
        capabilities: ["text_similarity"],
      },
      score_key: "semantic:local-clap:clap-v1:focus",
      score_keys_by_normalized_label: { focus: "semantic:local-clap:clap-v1:focus" },
      results: [{
        track_id: localTrack.id,
        status: "complete",
        scores: [{
          key: "semantic:local-clap:clap-v1:focus",
          label: "focus",
          normalized_label: "focus",
          score: 0.75,
          provenance: { backend: "local-clap", model: "clap-v1" },
        }],
      }],
      missing_track_ids: [],
    });
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
    if (path.includes("/api/v1/local-library/playlists")) {
      playlistDiscoveryPaths.push(path);
      return jsonResponse({
        root_name: "Music",
        search_path: "",
        search_name: "Music",
        playlists: [{
          path: "Playlists/2026/August/Main Set.m3u8",
          name: "Main Set",
          source_kind: "m3u8",
        }],
      });
    }
    if (path.includes("/api/v1/local-library/import")) {
      localPlaylistImportRequests.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      return jsonResponse({
        source_kind: "m3u8",
        playlist: {
          id: "local-main-set",
          name: "Main Set",
          tracks: [localTrack],
        },
        local_audio_paths: {
          [localTrack.id]: "Audio/House/Local Main Track.mp3",
        },
        analysis_cache_directory: "Playlists/2026/August",
        cached_track_count: 0,
        skipped_files: [],
        warnings: [],
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
  it("switches workspaces without unmounting Builder state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openFixtureWorkspace(user);
    expect(screen.getByLabelText("Combined source summary").textContent).toContain("2 sources");

    await user.click(screen.getByRole("button", { name: "Semantic Lab" }));
    expect(await screen.findByRole("heading", { name: "Explore locally. Promote deliberately." })).not.toBeNull();
    expect(screen.getAllByText("Local CLAP").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Playlist Builder" }));
    expect(screen.getByLabelText("Combined source summary").textContent).toContain("2 sources");
    expect(screen.getByText("Night Drive Levels — Fixture basis")).not.toBeNull();
  });

  it("discovers, imports, selects, and readies a playlist-file source", async () => {
    const user = userEvent.setup();
    render(<App />);

    const playlistFiles = await screen.findByRole("button", { name: "Playlist files" });
    expect(playlistFiles.getAttribute("aria-pressed")).toBe("false");
    await user.click(playlistFiles);
    expect(playlistFiles.getAttribute("aria-pressed")).toBe("true");

    await user.click(await screen.findByRole("button", { name: /Search.*Music/ }));
    const addPlaylist = await screen.findByRole("button", { name: "Add playlist" });
    expect(screen.getByTitle("Playlists/2026/August/Main Set.m3u8")).not.toBeNull();
    expect(playlistDiscoveryPaths).toEqual(["/api/v1/local-library/playlists?path="]);

    await user.click(addPlaylist);
    await waitFor(() => expect(localPlaylistImportRequests).toEqual([{
      source_path: "Playlists/2026/August/Main Set.m3u8",
      recursive: false,
    }]));

    const importedSources = await screen.findAllByRole("checkbox", { name: /Main Set/ });
    expect(importedSources).toHaveLength(2);
    expect(importedSources.every((source) => source.getAttribute("aria-checked") === "true")).toBe(true);
    const summary = screen.getByLabelText("Combined source summary");
    expect(summary.textContent).toContain("1 sources");
    expect(summary.textContent).toContain("1 input tracks");
    const analyze = screen.getByRole("button", { name: "Analyze selected tracks" });
    expect(analyze).toHaveProperty("disabled", false);
  });

  it("keeps Lab inference isolated until explicit recipe promotion", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Playlist files" }));
    await user.click(await screen.findByRole("button", { name: /Search.*Music/ }));
    await user.click(await screen.findByRole("button", { name: "Add playlist" }));
    await screen.findByLabelText("Combined source summary");
    await waitFor(() => expect(previewRequests.length).toBeGreaterThan(0));

    await user.click(screen.getByRole("button", { name: "Semantic Lab" }));
    expect((await screen.findByLabelText(/Local Main Track/) as HTMLInputElement).checked).toBe(true);
    await user.type(screen.getByLabelText("Prompt 1"), "focus");
    const previewsBeforeRun = previewRequests.length;
    await user.click(screen.getByRole("button", { name: "Run prompt matrix" }));
    await screen.findByText(/Recipe unchanged/);
    expect(previewRequests).toHaveLength(previewsBeforeRun);
    expect(previewRequests.at(-1)).not.toHaveProperty("distribution_semantic_score_key");

    await user.click(screen.getByRole("button", { name: "Promote selected score to recipe" }));
    await waitFor(() => expect(previewRequests.at(-1)).toHaveProperty(
      "distribution_semantic_score_key",
      "semantic:local-clap:clap-v1:focus",
    ));
    const promotedTrack = (previewRequests.at(-1)?.input_playlists as Array<{ tracks: Track[] }>)[0].tracks[0];
    expect(promotedTrack.semantic_scores?.[0].score).toBe(0.75);
  });

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
