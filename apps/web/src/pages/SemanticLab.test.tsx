// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SemanticLab } from "./SemanticLab";
import type { SemanticExperimentRunV1 } from "../lib/semantic/types";

const track = { id: "track-1", name: "Readable Track", artist: "Lab Artist", album: "Lab Album", duration_ms: 120000, explicit: false, genres: [] };
const backend = { id: "local-clap", display_name: "Local CLAP", model: "clap-v1", available: true, requires_local_audio: true, max_tracks: 1, max_labels: 1, capabilities: ["text_similarity"] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("runs an authorized subset without promotion, then promotes explicitly", async () => {
  const user = userEvent.setup();
  const onRunsChange = vi.fn();
  const onPromote = vi.fn(() => true);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/semantic/backends")
    ? { ok: true, json: async () => [backend] }
    : { ok: true, json: async () => ({ backend, score_key: "semantic:focus", results: [{ track_id: "track-1", status: "complete", scores: [{ key: "semantic:focus", label: "focus", normalized_label: "focus", score: 0.75, provenance: { backend: "local-clap", model: "clap-v1" } }] }], missing_track_ids: [], request: JSON.parse(String(init?.body)) }) }));
  const view = render(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={[]} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect((await screen.findByLabelText(/Readable Track/) as HTMLInputElement).checked).toBe(true);
  await user.type(screen.getByLabelText("Lab text query"), "focused pulse");
  await user.click(screen.getByRole("button", { name: "Run experiment" }));
  await waitFor(() => expect(onRunsChange).toHaveBeenCalledTimes(1));
  expect(onPromote).not.toHaveBeenCalled();
  const runs = onRunsChange.mock.calls[0][0];
  view.rerender(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect(await screen.findByText("Readable Track")).not.toBeNull();
  expect(screen.getByText("Lab Artist · Lab Album")).not.toBeNull();
  expect(screen.getByText("0.7500")).not.toBeNull();
  expect(screen.getByLabelText("Preview Readable Track").getAttribute("src")).toContain("authorized%2Ftrack.mp3");
  await user.click(screen.getByRole("button", { name: "Promote score to recipe" }));
  expect(onPromote).toHaveBeenCalledTimes(1);

  view.rerender(<SemanticLab tracks={[track, { ...track, id: "track-2", name: "New Source Track" }]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect((await screen.findByRole("alert")).textContent).toContain("selected source set changed");
  expect(screen.getByRole("button", { name: "Promote score to recipe" })).toHaveProperty("disabled", true);
});

it("does not allow an all-missing run to activate a recipe score", async () => {
  const user = userEvent.setup();
  const onRunsChange = vi.fn();
  const onPromote = vi.fn(() => true);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/semantic/backends")
    ? { ok: true, json: async () => [backend] }
    : { ok: true, json: async () => ({ backend, score_key: "semantic:focus", results: [], missing_track_ids: ["track-1"] }) }));
  const view = render(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={[]} onRunsChange={onRunsChange} onPromote={onPromote} />);
  await user.type(await screen.findByLabelText("Lab text query"), "focus");
  await user.click(screen.getByRole("button", { name: "Run experiment" }));
  await waitFor(() => expect(onRunsChange).toHaveBeenCalledTimes(1));
  const runs = onRunsChange.mock.calls[0][0] as SemanticExperimentRunV1[];
  view.rerender(<SemanticLab tracks={[track]} audioPaths={{ "track-1": "authorized/track.mp3" }} runs={runs} onRunsChange={onRunsChange} onPromote={onPromote} />);
  expect((await screen.findByRole("alert")).textContent).toContain("no usable scores");
  expect(screen.getByRole("button", { name: "Promote score to recipe" })).toHaveProperty("disabled", true);
  expect(onPromote).not.toHaveBeenCalled();
});
