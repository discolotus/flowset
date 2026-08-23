import { describe, expect, it } from "vitest";

import type { SemanticExperimentRunV1 } from "./types";
import { deriveSemanticContrast, SEMANTIC_CONTRAST_FORMULA } from "./contrast";

const backend = { id: "local-clap", display_name: "Local CLAP", model: "clap-v1", available: true, requires_local_audio: true, max_tracks: 20, max_labels: 20, max_embedding_batch: 20, capabilities: ["text_similarity"] } as const;
const direct = (key: string, value: number) => ({ key, label: key, normalized_label: key, score: value, provenance: { backend: "local-clap", model: "clap-v1" } });
const run: SemanticExperimentRunV1 = {
  schemaVersion: 1, id: "run", createdAt: "", completedAt: "", durationMs: 0, kind: "text-ranking", status: "partial", backend,
  prompts: ["positive", "negative"], scoreKeysByNormalizedLabel: { positive: "positive", negative: "negative" }, query: "positive", scoreKey: "positive",
  trackIds: ["complete", "missing"], trackSetFingerprint: "tracks", sourceTrackSetFingerprint: "source", trackSnapshots: [], missingTrackIds: [], warnings: [],
  results: [
    { trackId: "complete", status: "complete", scores: [direct("positive", 0.8), direct("negative", 0.3)] },
    { trackId: "missing", status: "unavailable", scores: [direct("positive", 0.4)] },
  ],
};

describe("semantic contrast", () => {
  it("subtracts negative from positive deterministically without mutating the run", () => {
    const first = deriveSemanticContrast({ run, positiveScoreKey: "positive", negativeScoreKey: "negative", positiveLabel: "Peak", negativeLabel: "Warmup" });
    const second = deriveSemanticContrast({ run, positiveScoreKey: "positive", negativeScoreKey: "negative", positiveLabel: "Peak", negativeLabel: "Warmup" });
    const reversed = deriveSemanticContrast({ run, positiveScoreKey: "negative", negativeScoreKey: "positive", positiveLabel: "Warmup", negativeLabel: "Peak" });
    expect(second.scoreKey).toBe(first.scoreKey);
    expect(reversed.scoreKey).not.toBe(first.scoreKey);
    expect(reversed.scoresByTrack.get("complete")?.score).toBe(-0.5);
    expect(first.scoresByTrack.get("complete")).toEqual(expect.objectContaining({ score: 0.5 }));
    expect(first.scoresByTrack.has("missing")).toBe(false);
    expect(first.scoresByTrack.get("complete")?.provenance).toEqual({
      kind: "derived",
      backend: "flowset-derived",
      model: "contrast-v1",
      derivation: { type: "difference", formula: SEMANTIC_CONTRAST_FORMULA, positive_score_key: "positive", negative_score_key: "negative" },
    });
    expect(run.results[0].scores).toHaveLength(2);
  });

  it("rejects a contrast against the same source score", () => {
    expect(() => deriveSemanticContrast({ run, positiveScoreKey: "positive", negativeScoreKey: "positive", positiveLabel: "Peak", negativeLabel: "Peak" })).toThrow(/two different/);
  });
});
