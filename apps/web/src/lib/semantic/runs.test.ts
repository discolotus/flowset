import { describe, expect, it } from "vitest";

import type { SemanticBackendCapabilities, SemanticRankResponse, Track } from "../types";
import type { SemanticExperimentRunV1 } from "./types";
import { createTextRankingRun, fingerprintTrackIds, MAX_RECENT_SEMANTIC_RUNS, rememberSemanticRun } from "./runs";

const backend: SemanticBackendCapabilities = { id: "local-clap", display_name: "Local CLAP", model: "clap-v1", available: true, requires_local_audio: true, max_tracks: 20, max_labels: 1, capabilities: ["text_similarity"] };
const track = (id: string): Track => ({ id, name: `Track ${id}`, artist: "Lab Artist", album: "Lab Album", duration_ms: 120000, explicit: false, genres: [] });

describe("semantic experiment runs", () => {
  it("fingerprints ordered, length-delimited track membership deterministically", () => {
    expect(fingerprintTrackIds(["a", "bc"])).toBe(fingerprintTrackIds(["a", "bc"]));
    expect(fingerprintTrackIds(["a", "bc"])).not.toBe(fingerprintTrackIds(["ab", "c"]));
    expect(fingerprintTrackIds(["a", "bc"])).not.toBe(fingerprintTrackIds(["bc", "a"]));
  });

  it("creates an isolated immutable metadata-and-score snapshot", () => {
    const response: SemanticRankResponse = { backend, score_key: "semantic:focus", results: [{ track_id: "a", status: "complete", scores: [{ key: "semantic:focus", label: "focus", normalized_label: "focus", score: 0.8, provenance: { backend: "local-clap", model: "clap-v1" } }] }], missing_track_ids: [] };
    const run = createTextRankingRun({ id: "run-1", query: " focus ", tracks: [track("a")], sourceTrackIds: ["a", "b"], backend, response, createdAt: "2026-08-21T10:00:00.000Z", completedAt: "2026-08-21T10:00:01.250Z" });
    response.results[0].scores[0].score = 0;
    expect(run.query).toBe("focus");
    expect(run.durationMs).toBe(1250);
    expect(run.results[0].scores[0].score).toBe(0.8);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.results)).toBe(true);
    expect(Object.isFrozen(run.results[0].scores)).toBe(true);
    expect(run.sourceTrackSetFingerprint).toBe(fingerprintTrackIds(["a", "b"]));
  });

  it("keeps only a bounded list of recent runs", () => {
    const base: Omit<SemanticExperimentRunV1, "id"> = { schemaVersion: 1, createdAt: "", completedAt: "", durationMs: 0, kind: "text-ranking", status: "complete", backend, query: "q", scoreKey: "key", trackIds: [], trackSetFingerprint: "fp", sourceTrackSetFingerprint: "source-fp", trackSnapshots: [], results: [], missingTrackIds: [], warnings: [] };
    const runs = Array.from({ length: MAX_RECENT_SEMANTIC_RUNS + 2 }, (_, index) => ({ ...base, id: `run-${index}` }));
    expect(rememberSemanticRun([], runs[0])).toHaveLength(1);
    expect(runs.reduce<readonly SemanticExperimentRunV1[]>((recent, run) => rememberSemanticRun(recent, run), [])).toHaveLength(MAX_RECENT_SEMANTIC_RUNS);
  });

  it("keeps missing selected tracks visible as unavailable results", () => {
    const response: SemanticRankResponse = {
      backend,
      score_key: "semantic:focus",
      results: [],
      missing_track_ids: ["missing"],
    };
    const run = createTextRankingRun({
      id: "run-missing",
      query: "focus",
      tracks: [track("missing")],
      sourceTrackIds: ["missing"],
      backend,
      response,
      createdAt: "2026-08-21T10:00:00.000Z",
      completedAt: "2026-08-21T10:00:01.000Z",
    });
    expect(run.status).toBe("failed");
    expect(run.results).toEqual([expect.objectContaining({
      trackId: "missing",
      status: "unavailable",
      scores: [],
    })]);
  });
});
