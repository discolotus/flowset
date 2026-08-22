// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SemanticLab } from "./SemanticLab";
import type { SemanticExperimentRunV1, SemanticPromotion } from "../lib/semantic/types";
import type { Track } from "../lib/types";

const track = { id: "track-1", name: "Readable Track", artist: "Lab Artist", album: "Lab Album", duration_ms: 120000, explicit: false, genres: [] };
const backend = { id: "local-clap", display_name: "Local CLAP", model: "clap-v1", available: true, requires_local_audio: true, max_tracks: 2, max_labels: 3, capabilities: ["text_similarity"] };
const focusKey = "semantic:local-clap:clap-v1:focus";
const warmKey = "semantic:local-clap:clap-v1:warm glow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  expect((await screen.findByLabelText(/Readable Track/) as HTMLInputElement).checked).toBe(true);
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
  expect(screen.getByText(/selected prompt produced no usable scores/)).not.toBeNull();
  expect(screen.getByRole("button", { name: "Promote selected score to recipe" })).toHaveProperty("disabled", true);
  expect(onPromote).not.toHaveBeenCalled();
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
