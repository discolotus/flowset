import { describe, expect, it, vi } from "vitest";

import type { SemanticExperimentRunV1 } from "./types";
import {
  buildSemanticEvaluationExport,
  readSemanticVerdicts,
  saveSemanticVerdicts,
  semanticComparisonId,
  semanticEvaluationCsv,
} from "./verdicts";

const run = (id: string): SemanticExperimentRunV1 => ({
  schemaVersion: 1, id, createdAt: "2026-08-24T00:00:00.000Z", completedAt: "2026-08-24T00:00:01.000Z", durationMs: 1000,
  kind: "text-ranking", status: "complete", backend: { id: "test", display_name: "Test", model: "v1", available: true, requires_local_audio: true, max_tracks: 10, max_labels: 10, max_embedding_batch: 10, capabilities: ["text_similarity"] }, prompts: [id], scoreKeysByNormalizedLabel: { [id]: id }, query: id, scoreKey: id,
  trackIds: ["a"], trackSetFingerprint: "same", sourceTrackSetFingerprint: "same", trackSnapshots: [{ trackId: "a", name: "A, Track", artist: "Artist", album: "Album", durationMs: 1000 }], results: [], missingTrackIds: [], warnings: [],
});

describe("semantic evaluation verdicts", () => {
  it("persists only bounded typed verdict records for one comparison", () => {
    let stored = "";
    const storage = { getItem: vi.fn(() => stored || null), setItem: vi.fn((_key: string, value: string) => { stored = value; }) };
    const id = semanticComparisonId("left", "score:left", "right", "score:right");
    saveSemanticVerdicts(storage, id, { a: "left", b: "neither" });
    expect(readSemanticVerdicts(storage, id)).toEqual({ a: "left", b: "neither" });
    expect(stored).not.toContain("audio");
  });

  it("exports evaluated disagreement rows as versioned JSON data and escaped CSV", () => {
    const left = run("left");
    const right = run("right");
    const evaluation = buildSemanticEvaluationExport({
      left, leftScoreKey: "left", right, rightScoreKey: "right", createdAt: "2026-08-24T01:02:03.000Z",
      rows: [{ trackId: "a", track: left.trackSnapshots[0], leftScore: 0.9, rightScore: 0.2, leftRank: 1, rightRank: 3, rankDelta: 2 }],
      verdicts: { a: "left" },
    });
    expect(evaluation).toMatchObject({ schema_version: "sequence.semantic-evaluation.v1", verdicts: [{ track_id: "a", verdict: "left" }] });
    const csv = semanticEvaluationCsv(evaluation);
    expect(csv).toContain('a,"A, Track",Artist,Album,left,left,0.9,1,right,right,0.2,3,2,left');
  });
});
