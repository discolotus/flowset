import { describe, expect, it } from "vitest";

import type { SemanticExperimentRunV1 } from "./types";
import { compareSemanticRuns, comparisonPromotion } from "./compare";

const backend = { id: "test", display_name: "Test", model: "v1", available: true, requires_local_audio: true, max_tracks: 20, max_labels: 20, max_embedding_batch: 20, capabilities: ["text_similarity"] as const };

function run(id: string, scores: Readonly<Record<string, number | null>>, fingerprint = "same"): SemanticExperimentRunV1 {
  const scoreKey = `semantic:${id}`;
  const trackIds = Object.keys(scores);
  return Object.freeze({
    schemaVersion: 1,
    id,
    createdAt: "2026-08-22T00:00:00.000Z",
    completedAt: "2026-08-22T00:00:01.000Z",
    durationMs: 1000,
    kind: "text-ranking",
    status: "complete",
    backend,
    prompts: [id],
    scoreKeysByNormalizedLabel: { [id]: scoreKey },
    query: id,
    scoreKey,
    trackIds,
    trackSetFingerprint: fingerprint,
    sourceTrackSetFingerprint: fingerprint,
    trackSnapshots: trackIds.map((trackId) => ({ trackId, name: `Track ${trackId}`, artist: "Artist", album: "Album", durationMs: 1000 })),
    results: trackIds.map((trackId) => ({
      trackId,
      status: "complete" as const,
      scores: scores[trackId] == null ? [] : [{ key: scoreKey, label: id, normalized_label: id, score: scores[trackId]!, provenance: { backend: "test", model: "v1" } }],
    })),
    missingTrackIds: [],
    warnings: [],
  });
}

describe("semantic scalar comparison", () => {
  it("uses average ranks for ties and produces stable agreement order", () => {
    const left = run("left", { a: 1, b: 1, c: 0.5, d: 0 });
    const right = run("right", { a: 1, b: 0.5, c: 0.5, d: 0 });
    const comparison = compareSemanticRuns({ left, leftScoreKey: left.scoreKey, right, rightScoreKey: right.scoreKey });
    expect(comparison.spearman).toBeCloseTo(5 / 6);
    expect(comparison.rows.find(({ trackId }) => trackId === "a")).toMatchObject({ leftRank: 1.5, rightRank: 1, rankDelta: 0.5 });
    expect(comparison.agreements.map(({ trackId }) => trackId)).toEqual(["d", "a", "c", "b"]);
    expect(comparison.disagreements.map(({ trackId }) => trackId)).toEqual(["b", "a", "c", "d"]);
  });

  it("reports score coverage and excludes missing pairs from correlation", () => {
    const left = run("left", { a: 1, b: 0.5, c: null });
    const right = run("right", { a: 1, b: null, c: 0.25 });
    const comparison = compareSemanticRuns({ left, leftScoreKey: left.scoreKey, right, rightScoreKey: right.scoreKey });
    expect(comparison.coverage).toEqual({ total: 3, paired: 1, leftMissing: 1, rightMissing: 1 });
    expect(comparison.spearman).toBeNull();
    expect(comparison.rows.find(({ trackId }) => trackId === "b")).toMatchObject({ leftScore: 0.5, rightScore: null, rankDelta: null });
  });

  it("blocks different fingerprints even when the track count matches", () => {
    const left = run("left", { a: 1, b: 0 }, "left-set");
    const right = run("right", { a: 1, b: 0 }, "right-set");
    const comparison = compareSemanticRuns({ left, leftScoreKey: left.scoreKey, right, rightScoreKey: right.scoreKey });
    expect(comparison.compatible).toBe(false);
    expect(comparison.reason).toMatch(/Track sets differ/);

    const forgedSameFingerprint = Object.freeze({ ...right, trackSetFingerprint: "left-set", trackIds: ["b", "a"] });
    expect(compareSemanticRuns({ left, leftScoreKey: left.scoreKey, right: forgedSameFingerprint, rightScoreKey: right.scoreKey }).compatible).toBe(false);
  });

  it("builds an immutable winner promotion without mutating its source run", () => {
    const source = run("winner", { a: 1, b: 0 });
    const before = JSON.stringify(source);
    const result = comparisonPromotion(source, source.scoreKey, { distribution: true, split: false, subgroup: false, sort: false });
    expect(result.promotion).toEqual(expect.objectContaining({ runId: "winner", scoreKey: source.scoreKey }));
    expect(result.scoresByTrack.get("a")?.[0].score).toBe(1);
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.isFrozen(result.promotion)).toBe(true);
  });
});
