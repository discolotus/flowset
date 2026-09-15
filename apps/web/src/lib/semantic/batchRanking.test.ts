import { expect, it, vi } from "vitest";
import { batchSemanticRanking } from "./batchRanking";
import type { SemanticBackendCapabilities, SemanticRankResponse } from "../types";
const backend = { id: "test", model: "fixture", display_name: "Test", max_tracks: 100 } as SemanticBackendCapabilities;
const paths = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${i}`, `${i}.wav`]));
const response = (audioPaths: Record<string, string>): SemanticRankResponse => ({ backend, score_key: "s", score_keys_by_normalized_label: { vibe: "s" }, missing_track_ids: [], results: Object.keys(audioPaths).map((track_id) => ({ track_id, status: "complete", scores: [] })) });
it("covers 5000 songs in bounded sequential batches with no dropped or repeated candidates", async () => {
  let running = 0; let peak = 0;
  const runBatch = vi.fn(async (batch) => { running++; peak = Math.max(peak, running); await Promise.resolve(); running--; return response(batch); });
  const result = await batchSemanticRanking({ backend, audioPaths: paths(5000), runBatch });
  expect(peak).toBe(1);
  expect(runBatch).toHaveBeenCalledTimes(1000);
  expect(runBatch.mock.calls.every(([batch]) => Object.keys(batch).length <= 5)).toBe(true);
  expect(new Set(result.results.map(({ track_id }) => track_id)).size).toBe(5000);
});
it("does not overlap a restarted search with cancelled in-flight inference", async () => {
  let finish!: (value: SemanticRankResponse) => void; let stop = false;
  const first = batchSemanticRanking({ backend, audioPaths: paths(10), shouldStop: () => stop, runBatch: () => new Promise((resolve) => { finish = resolve; }) });
  const rejection = expect(first).rejects.toThrow("stopped");
  await Promise.resolve(); stop = true;
  const nextBatch = vi.fn(async (batch) => response(batch));
  const next = batchSemanticRanking({ backend, audioPaths: paths(1), runBatch: nextBatch });
  await Promise.resolve(); expect(nextBatch).not.toHaveBeenCalled();
  finish(response(paths(5))); await rejection; await next;
  expect(nextBatch).toHaveBeenCalledTimes(1);
});
it("rejects scores from incompatible model versions", async () => {
  let calls = 0;
  await expect(batchSemanticRanking({ backend, audioPaths: paths(6), runBatch: async (batch) => ({ ...response(batch), score_key: String(calls++) }) })).rejects.toThrow("changed");
});
