import { describe, expect, it } from "vitest";

import type { SemanticEmbeddingResponse } from "../types";
import {
  analyzeEmbeddingSpace,
  clusterEmbeddings,
  cosineNeighbors,
  prototypeSimilarities,
  projectEmbeddingPca,
} from "./embeddingExplorer";

const points = [
  { trackId: "alpha", values: [1, 0, 0] },
  { trackId: "beta", values: [0.9, 0.1, 0] },
  { trackId: "delta", values: [0, 0.1, 0.9] },
  { trackId: "gamma", values: [0, 0, 1] },
];

describe("embedding explorer analysis", () => {
  it("ranks deterministic cosine neighbors with stable ties", () => {
    expect(cosineNeighbors(points, "alpha")).toEqual([
      expect.objectContaining({ trackId: "beta", similarity: expect.closeTo(0.9938837, 6) }),
      expect.objectContaining({ trackId: "delta", similarity: 0 }),
      expect.objectContaining({ trackId: "gamma", similarity: 0 }),
    ]);
  });

  it("ranks tracks against the normalized centroid of positive anchors", () => {
    const ranking = prototypeSimilarities(points, ["gamma", "alpha"]);
    expect(ranking.map(({ trackId }) => trackId)).toEqual(["alpha", "gamma", "beta", "delta"]);
    expect(ranking[0]).toMatchObject({ trackId: "alpha", similarity: expect.closeTo(Math.SQRT1_2, 6), isAnchor: true });
    expect(ranking[2]).toMatchObject({ trackId: "beta", isAnchor: false });
    expect(() => prototypeSimilarities(points, [])).toThrow(/at least one positive anchor/);
    expect(() => prototypeSimilarities(points, ["missing"])).toThrow(/must be in this embedding space/);
  });

  it("produces deterministic PCA coordinates independent of input order", () => {
    const first = projectEmbeddingPca(points);
    const second = projectEmbeddingPca([...points].reverse());
    expect(second).toEqual(first);
    expect(new Set(first.map(({ x }) => x.toFixed(6))).size).toBeGreaterThan(1);
    expect(first.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it("groups the two known neighborhoods deterministically", () => {
    expect(Object.fromEntries(clusterEmbeddings(points, 2))).toEqual({
      alpha: 0,
      beta: 0,
      delta: 1,
      gamma: 1,
    });
    expect(Object.fromEntries(clusterEmbeddings([...points].reverse(), 2))).toEqual({
      alpha: 0,
      beta: 0,
      delta: 1,
      gamma: 1,
    });
    expect(Object.fromEntries(clusterEmbeddings([
      { trackId: "a", values: [1, 0] },
      { trackId: "b", values: [1, 0] },
      { trackId: "c", values: [1, 0] },
    ], 3))).toEqual({ a: 0, b: 0, c: 0 });
  });

  it("keeps partial coverage explicit and excludes failed vectors", () => {
    const response = {
      backend: { id: "local-muq-mulan", display_name: "MuQ", model: "muq-v1", available: true, requires_local_audio: true, max_tracks: 100, max_labels: 20, max_embedding_batch: 20, capabilities: ["embedding_extraction"] },
      representation: "muq-mean-v1",
      dimension: 3,
      embeddings: [
        ...points.slice(0, 2).map(({ trackId, values }) => ({ track_id: trackId, status: "complete" as const, values, cache_status: "hit" as const })),
        { track_id: "failed", status: "failed" as const, values: [], cache_status: null, error: "Decode failed" },
      ],
      failed_track_ids: ["failed"],
      cache: { hits: 2, misses: 0, deduplicated: 0, evictions: 0, entries: 2, capacity: 128 },
    } satisfies SemanticEmbeddingResponse;
    const analysis = analyzeEmbeddingSpace(response, 2);
    expect(analysis).toMatchObject({ requestedCount: 3, completeCount: 2, failedTrackIds: ["failed"], clusterCount: 2 });
    expect(analysis.points.map(({ trackId }) => trackId)).toEqual(["alpha", "beta"]);
  });
});
