// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import type { SemanticExperimentRunV1, SemanticPromotion } from "../lib/semantic/types";
import type { Track } from "../lib/types";
import { SemanticRunComparison } from "./SemanticRunComparison";

const backend = { id: "local-test", display_name: "Local Test", model: "test-v1", available: true, requires_local_audio: true, max_tracks: 20, max_labels: 20, max_embedding_batch: 20, capabilities: ["text_similarity"] as const };

function run(id: string, values: readonly (number | null)[]): SemanticExperimentRunV1 {
  const trackIds = ["a", "b", "c"];
  const scoreKey = `semantic:${id}`;
  return Object.freeze({
    schemaVersion: 1, id, createdAt: `2026-08-22T00:00:0${id === "left" ? 0 : 2}.000Z`, completedAt: "2026-08-22T00:00:03.000Z", durationMs: 1000,
    kind: "text-ranking", status: "complete", backend, prompts: [id], scoreKeysByNormalizedLabel: { [id]: scoreKey }, query: id, scoreKey,
    trackIds, trackSetFingerprint: "same", sourceTrackSetFingerprint: "source", trackSnapshots: trackIds.map((trackId) => ({ trackId, name: `Track ${trackId.toUpperCase()}`, artist: "Artist", album: "Album", durationMs: 1000 })),
    results: trackIds.map((trackId, index) => ({ trackId, status: "complete" as const, scores: values[index] == null ? [] : [{ key: scoreKey, label: id, normalized_label: id, score: values[index]!, provenance: { backend: backend.id, model: backend.model } }] })),
    missingTrackIds: [], warnings: [],
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("compares recorded runs without inference and promotes an immutable selected winner", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const left = run("left", [1, 0.5, null]);
  const right = run("right", [0.5, 1, 0.25]);
  const before = JSON.stringify([left, right]);
  const onPromote = vi.fn((_promotion: SemanticPromotion, _scores: ReadonlyMap<string, Track["semantic_scores"]>) => true);
  render(<SemanticRunComparison runs={[left, right]} audioPaths={{ a: "authorized/a.mp3" }} onPromote={onPromote} />);

  expect((screen.getByLabelText("Pinned left run") as HTMLSelectElement).value).toBe("left");
  expect((screen.getByLabelText("Pinned right run") as HTMLSelectElement).value).toBe("right");
  await user.selectOptions(screen.getByLabelText("Pinned left run"), "right");
  expect(screen.getByRole("alert").textContent).toMatch(/two different completed runs/);
  await user.selectOptions(screen.getByLabelText("Pinned left run"), "left");
  expect(screen.getByLabelText("Comparison summary").textContent).toContain("2/3");
  expect(screen.getByText("Track A")).not.toBeNull();
  expect(screen.getByText("Track C").closest("tr")?.textContent).toContain("Missing");
  expect(screen.getByLabelText("Compare preview Track A").getAttribute("src")).toContain("authorized%2Fa.mp3");
  expect(fetchMock).not.toHaveBeenCalled();

  await user.click(screen.getByRole("radio", { name: "Right" }));
  await user.click(screen.getByRole("button", { name: "Promote selected winner" }));
  expect(onPromote).toHaveBeenCalledOnce();
  expect(onPromote.mock.calls[0][0]).toEqual(expect.objectContaining({ runId: "right", scoreKey: "semantic:right" }));
  expect(JSON.stringify([left, right])).toBe(before);
  expect(screen.getByRole("status").textContent).toContain("Source runs unchanged");
});
