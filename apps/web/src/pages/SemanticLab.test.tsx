// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SemanticLab } from "./SemanticLab";
import type { SemanticExperimentRunV1, SemanticPromotion } from "../lib/semantic/types";
import type { Track } from "../lib/types";

const track = { id: "track-1", name: "Readable Track", artist: "Lab Artist", album: "Lab Album", duration_ms: 120000, explicit: false, genres: [] };
const secondTrack = { ...track, id: "track-2", name: "Second Track" };
const backend = { id: "local-clap", display_name: "Local CLAP", model: "clap-v1", available: true, requires_local_audio: true, max_tracks: 2, max_labels: 3, max_embedding_batch: 20, capabilities: ["text_similarity"] };
const focusKey = "semantic:local-clap:clap-v1:focus";
const warmKey = "semantic:local-clap:clap-v1:warm glow";
const mertBackend = { id: "local-mert", display_name: "Local MERT", model: "mert-v1", available: true, requires_local_audio: true, max_tracks: 10, max_labels: 1, max_embedding_batch: 10, capabilities: ["reference_similarity", "embedding_extraction"], embedding_representation: "mert-last-hidden-mean-30s-v1", default_representation: { layer: "last_hidden_state", pooling: "mean", segment: "whole_track" } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("searches readable MERT references, previews locally, and inspects neighbors before promotion", async () => {
  const user = userEvent.setup();
  const onRunsChange = vi.fn();
  const onPromote = vi.fn(() => true);
  const tracks = [
    track,
    { ...track, id: "track-2", name: "Second Wave", artist: "South Arc", album: "Night Set", duration_ms: 240000 },
    { ...track, id: "track-3", name: "Close Echo", artist: "West Arc", album: "Night Set" },
  ];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/semantic/backends")) return { ok: true, json: async () => [backend, mertBackend] };
    if (path.endsWith("/semantic/reference-rank")) return { ok: true, json: async () => ({
      backend: mertBackend,
      score_key: "semantic:local-mert:mert-v1:last_hidden_state:mean:whole_track:similar to track-2",
      score_keys_by_normalized_label: { "similar to track-2": "semantic:local-mert:mert-v1:last_hidden_state:mean:whole_track:similar to track-2" },
      results: [
        { track_id: "track-1", status: "complete", scores: [{ key: "semantic:local-mert:mert-v1:last_hidden_state:mean:whole_track:similar to track-2", label: "similar", normalized_label: "similar", score: 0.2, provenance: { backend: "local-mert", model: "mert-v1", representation: mertBackend.default_representation } }] },
        { track_id: "track-2", status: "complete", scores: [{ key: "semantic:local-mert:mert-v1:last_hidden_state:mean:whole_track:similar to track-2", label: "similar", normalized_label: "similar", score: 1, provenance: { backend: "local-mert", model: "mert-v1", representation: mertBackend.default_representation } }] },
        { track_id: "track-3", status: "complete", scores: [{ key: "semantic:local-mert:mert-v1:last_hidden_state:mean:whole_track:similar to track-2", label: "similar", normalized_label: "similar", score: 0.8, provenance: { backend: "local-mert", model: "mert-v1", representation: mertBackend.default_representation } }] },
      ],
      missing_track_ids: [],
      request: JSON.parse(String(init?.body)),
    }) };
    throw new Error(`Unexpected request: ${path}`);
  }));
  const audioPaths = { "track-1": "authorized/one.mp3", "track-2": "authorized/two.mp3", "track-3": "authorized/three.mp3" };
  const view = render(<SemanticLab tracks={tracks} audioPaths={audioPaths} runs={[]} onRunsChange={onRunsChange} onPromote={onPromote} />);

  await user.type(await screen.findByLabelText("Search reference tracks"), "South Arc");
  expect(screen.queryByRole("radio", { name: /Readable Track/ })).toBeNull();
  await user.click(screen.getByRole("radio", { name: /Second Wave/ }));
  expect(screen.getByLabelText("Preview reference Second Wave").getAttribute("src")).toContain("authorized%2Ftwo.mp3");
  expect(screen.getByLabelText("MERT representation identity").textContent).toContain("last_hidden_state · mean pooling · whole track · mert-v1");
  await user.click(screen.getByRole("button", { name: "Inspect nearest neighbors" }));
  await waitFor(() => expect(onRunsChange).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body)).reference_track_id).toBe("track-2");
  expect(onPromote).not.toHaveBeenCalled();

  const runs = onRunsChange.mock.calls[0][0] as SemanticExperimentRunV1[];
  view.rerender(<SemanticLab tracks={tracks} audioPaths={audioPaths} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect(await screen.findByRole("cell", { name: "Reference" })).not.toBeNull();
  expect(screen.getByRole("cell", { name: "#1" })).not.toBeNull();
  expect(screen.getAllByText("0.8000").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/last_hidden_state · mean · whole track/).length).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Promote selected score to recipe" }));
  expect(onPromote).toHaveBeenCalledOnce();
});

it("submits one bounded multi-prompt request and promotes only the selected raw score", async () => {
  const user = userEvent.setup();
  const onRunsChange = vi.fn();
  const onPromote = vi.fn((_promotion: SemanticPromotion, _scores: ReadonlyMap<string, Track["semantic_scores"]>) => true);
  const rankPayloads: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/semantic/backends")) return { ok: true, json: async () => [backend] };
    rankPayloads.push(JSON.parse(String(init?.body)));
    return { ok: true, json: async () => ({
      backend,
      score_key: focusKey,
      score_keys_by_normalized_label: { focus: focusKey, "warm glow": warmKey },
      results: [{ track_id: "track-1", status: "complete", scores: [
        { key: focusKey, label: "focus", normalized_label: "focus", score: 0.75, provenance: { backend: "local-clap", model: "clap-v1" } },
        { key: warmKey, label: "warm glow", normalized_label: "warm glow", score: 0.25, provenance: { backend: "local-clap", model: "clap-v1" } },
      ] }],
      missing_track_ids: [],
    }) };
  }));
  const view = render(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={[]} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect((await screen.findByRole("checkbox", { name: /Readable Track/ }) as HTMLInputElement).checked).toBe(true);
  await user.type(screen.getByLabelText("Prompt 1"), "focus");
  await user.click(screen.getByRole("button", { name: "Add prompt" }));
  await user.type(screen.getByLabelText("Prompt 2"), "warm glow");
  await user.click(screen.getByRole("button", { name: "Run prompt matrix" }));
  await waitFor(() => expect(onRunsChange).toHaveBeenCalledTimes(1));
  expect(rankPayloads).toEqual([{ backend_id: "local-clap", labels: ["focus", "warm glow"], audio_paths: { "track-1": "authorized/track.mp3" } }]);
  expect(onPromote).not.toHaveBeenCalled();

  const runs = onRunsChange.mock.calls[0][0] as SemanticExperimentRunV1[];
  view.rerender(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect(await screen.findByText("Lab Artist · Lab Album")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Readable Track, focus: 0.7500" })).not.toBeNull();
  expect(screen.getByLabelText("Preview Readable Track").getAttribute("src")).toContain("authorized%2Ftrack.mp3");

  await user.click(screen.getByRole("button", { name: "warm glow" }));
  await user.click(screen.getByRole("button", { name: "Promote selected score to recipe" }));
  expect(onPromote).toHaveBeenCalledTimes(1);
  expect(onPromote.mock.calls[0][0]).toEqual(expect.objectContaining({ scoreKey: warmKey }));
  expect([...onPromote.mock.calls[0][1].values()]).toEqual([[
    expect.objectContaining({ key: warmKey, score: 0.25 }),
  ]]);

  view.rerender(<SemanticLab tracks={[track, { ...track, id: "track-2", name: "New Source Track" }]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect((await screen.findByText(/selected source set changed/)).textContent).toContain("selected source set changed");
  expect(screen.getByRole("button", { name: "Promote selected score to recipe" })).toHaveProperty("disabled", true);
});

it("keeps missing results visible and blocks promotion for an empty selected column", async () => {
  const user = userEvent.setup();
  const onRunsChange = vi.fn();
  const onPromote = vi.fn(() => true);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/semantic/backends")
    ? { ok: true, json: async () => [backend] }
    : { ok: true, json: async () => ({ backend, score_key: focusKey, score_keys_by_normalized_label: { focus: focusKey }, results: [], missing_track_ids: ["track-1"] }) }));
  const view = render(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={[]} onRunsChange={onRunsChange} onPromote={onPromote} />);
  await user.type(await screen.findByLabelText("Prompt 1"), "focus");
  await user.click(screen.getByRole("button", { name: "Run prompt matrix" }));
  await waitFor(() => expect(onRunsChange).toHaveBeenCalledTimes(1));
  const runs = onRunsChange.mock.calls[0][0] as SemanticExperimentRunV1[];
  view.rerender(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect(await screen.findByRole("button", { name: "Readable Track, focus: Unavailable" })).not.toBeNull();
  expect(screen.getByText(/selected score produced no usable values/)).not.toBeNull();
  expect(screen.getByRole("button", { name: "Promote selected score to recipe" })).toHaveProperty("disabled", true);
  expect(onPromote).not.toHaveBeenCalled();
});

it("shows selected-score diagnostics and promotes a typed contrast without mutating the run", async () => {
  const user = userEvent.setup();
  const onRunsChange = vi.fn();
  const onPromote = vi.fn((_promotion: SemanticPromotion, _scores: ReadonlyMap<string, Track["semantic_scores"]>) => true);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/semantic/backends")
    ? { ok: true, json: async () => [backend] }
    : { ok: true, json: async () => ({
      backend,
      score_key: focusKey,
      score_keys_by_normalized_label: { focus: focusKey, "warm glow": warmKey },
      results: [
        { track_id: "track-1", status: "complete", scores: [
          { key: focusKey, label: "focus", normalized_label: "focus", score: 0.75, provenance: { backend: "local-clap", model: "clap-v1" } },
          { key: warmKey, label: "warm glow", normalized_label: "warm glow", score: 0.25, provenance: { backend: "local-clap", model: "clap-v1" } },
        ] },
        { track_id: "track-2", status: "complete", scores: [
          { key: focusKey, label: "focus", normalized_label: "focus", score: 0.77, provenance: { backend: "local-clap", model: "clap-v1" } },
          { key: warmKey, label: "warm glow", normalized_label: "warm glow", score: 0.26, provenance: { backend: "local-clap", model: "clap-v1" } },
        ] },
      ],
      missing_track_ids: [],
    }) }));
  const view = render(<SemanticLab tracks={[track, secondTrack]} audioPaths={{ "track-1": "one.mp3", "track-2": "two.mp3" }} runs={[]} onRunsChange={onRunsChange} onPromote={onPromote} />);
  await user.type(await screen.findByLabelText("Prompt 1"), "focus");
  await user.click(screen.getByRole("button", { name: "Add prompt" }));
  await user.type(screen.getByLabelText("Prompt 2"), "warm glow");
  await user.click(screen.getByRole("button", { name: "Run prompt matrix" }));
  await waitFor(() => expect(onRunsChange).toHaveBeenCalledTimes(1));
  const runs = onRunsChange.mock.calls[0][0] as SemanticExperimentRunV1[];
  view.rerender(<SemanticLab tracks={[track, secondTrack]} audioPaths={{ "track-1": "one.mp3", "track-2": "two.mp3" }} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);

  const rawDiagnostics = screen.getByRole("heading", { name: "focus" }).closest("section") as HTMLElement;
  expect(within(rawDiagnostics).getByText("100% coverage")).not.toBeNull();
  expect(within(rawDiagnostics).getByText("0.0200")).not.toBeNull();
  expect(within(rawDiagnostics).getByText(/Low observed separation/)).not.toBeNull();

  await user.click(screen.getByRole("button", { name: "Use contrast score" }));
  expect(screen.getByText(/Derived formula:/).textContent).toContain("positive - negative");
  expect(screen.getByRole("button", { name: "Readable Track, focus minus warm glow: 0.5000" })).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "Promote selected score to recipe" }));

  const promotion = onPromote.mock.calls[0][0];
  const scores = [...onPromote.mock.calls[0][1].values()].flat();
  expect(promotion.scoreKey).toMatch(/^semantic:flowset-derived:contrast-v1:/);
  expect(scores).toHaveLength(2);
  expect(scores[0]?.provenance).toEqual(expect.objectContaining({
    kind: "derived",
    backend: "flowset-derived",
    model: "contrast-v1",
    derivation: expect.objectContaining({ formula: "positive - negative", positive_score_key: focusKey, negative_score_key: warmKey }),
  }));
  expect(runs[0].results.every(({ scores: sourceScores }) => sourceScores.length === 2)).toBe(true);
});

it("blocks duplicate and oversized prompt sets before inference", async () => {
  const user = userEvent.setup();
  const limitedBackend = { ...backend, max_labels: 2 };
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [limitedBackend] }));
  vi.stubGlobal("fetch", fetchMock);
  render(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={[]} onRunsChange={vi.fn()} onPromote={vi.fn(() => true)} />);
  await user.type(await screen.findByLabelText("Prompt 1"), "Warm Glow");
  await user.click(screen.getByRole("button", { name: "Add prompt" }));
  await user.type(screen.getByLabelText("Prompt 2"), " warm   glow ");
  expect(screen.getByRole("alert").textContent).toMatch(/unique/);
  expect(screen.getByRole("button", { name: "Run prompt matrix" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Add prompt" })).toHaveProperty("disabled", true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
