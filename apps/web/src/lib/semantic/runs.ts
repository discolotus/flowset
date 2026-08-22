import type { SemanticBackendCapabilities, SemanticRankResponse, Track } from "../types";
import { cleanSemanticPrompt, normalizeSemanticPrompt } from "./prompts";
import { snapshotTrack, type SemanticExperimentRunV1 } from "./types";

export const MAX_RECENT_SEMANTIC_RUNS = 8;

export function fingerprintTrackIds(trackIds: readonly string[]): string {
  const serialized = `flowset-track-set:v1\n${trackIds.map((id) => `${id.length}:${id}`).join("\n")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createTextRankingRun(input: {
  id: string;
  query?: string;
  labels?: readonly string[];
  tracks: readonly Track[];
  sourceTrackIds: readonly string[];
  backend: SemanticBackendCapabilities;
  response: SemanticRankResponse;
  createdAt: string;
  completedAt: string;
}): SemanticExperimentRunV1 {
  const prompts = (input.labels ?? [input.query ?? ""]).map(cleanSemanticPrompt);
  if (!prompts.length || prompts.some((prompt) => !prompt)) {
    throw new Error("A semantic run must contain at least one named prompt.");
  }
  const scoreKeysByNormalizedLabel = { ...input.response.score_keys_by_normalized_label };
  const requestedNormalizedLabels = new Set(prompts.map(normalizeSemanticPrompt));
  const expectedScoreKeys = new Set(Object.values(scoreKeysByNormalizedLabel));
  if (
    input.backend.id !== input.response.backend.id
    || input.backend.model !== input.response.backend.model
    || prompts.some((prompt) => !scoreKeysByNormalizedLabel[normalizeSemanticPrompt(prompt)])
    || input.response.score_key !== scoreKeysByNormalizedLabel[normalizeSemanticPrompt(prompts[0])]
    || Object.keys(scoreKeysByNormalizedLabel).length !== requestedNormalizedLabels.size
    || Object.keys(scoreKeysByNormalizedLabel).some((label) => normalizeSemanticPrompt(label) !== label || !requestedNormalizedLabels.has(label))
    || input.response.results.some((result) => result.scores.some((score) =>
      !expectedScoreKeys.has(score.key)
      || !requestedNormalizedLabels.has(score.normalized_label)
      || scoreKeysByNormalizedLabel[score.normalized_label] !== score.key
      || score.provenance.backend !== input.response.backend.id
      || score.provenance.model !== input.response.backend.model
    ))
  ) {
    throw new Error("Semantic ranking returned scores outside the requested prompt and model contract.");
  }
  const created = Date.parse(input.createdAt);
  const completed = Date.parse(input.completedAt);
  const missing = new Set(input.response.missing_track_ids);
  const returnedTrackIds = new Set(input.response.results.map(({ track_id }) => track_id));
  const results = [
    ...input.response.results.map((result) => Object.freeze({
      trackId: result.track_id,
      status: result.status,
      error: result.error,
      scores: Object.freeze(result.scores.map((score) => Object.freeze({
        ...score,
        provenance: Object.freeze({ ...score.provenance }),
      }))),
    })),
    ...input.tracks
      .filter(({ id }) => missing.has(id) && !returnedTrackIds.has(id))
      .map(({ id }) => Object.freeze({
        trackId: id,
        status: "unavailable" as const,
        error: "No semantic result was returned for this selected track.",
        scores: Object.freeze([]),
      })),
  ];
  const complete = results.filter(({ status }) => status === "complete").length;
  const status = complete === 0 && input.tracks.length > 0
    ? "failed"
    : results.some(({ status: resultStatus }) => resultStatus !== "complete")
      ? "partial"
      : "complete";
  const run: SemanticExperimentRunV1 = {
    schemaVersion: 1,
    id: input.id,
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    durationMs: Math.max(0, completed - created),
    kind: "text-ranking",
    status,
    backend: Object.freeze({
      ...input.backend,
      capabilities: Object.freeze([...input.backend.capabilities]),
    }),
    prompts: Object.freeze(prompts),
    scoreKeysByNormalizedLabel: Object.freeze(scoreKeysByNormalizedLabel),
    query: prompts[0],
    scoreKey: input.response.score_key,
    trackIds: Object.freeze(input.tracks.map(({ id }) => id)),
    trackSetFingerprint: fingerprintTrackIds(input.tracks.map(({ id }) => id)),
    sourceTrackSetFingerprint: fingerprintTrackIds(input.sourceTrackIds),
    trackSnapshots: Object.freeze(input.tracks.map((track) => Object.freeze(snapshotTrack(track)))),
    results: Object.freeze(results),
    missingTrackIds: Object.freeze([...input.response.missing_track_ids]),
    warnings: Object.freeze(missing.size ? [`${missing.size} selected track${missing.size === 1 ? " was" : "s were"} unavailable.`] : []),
  };
  return Object.freeze(run);
}

export function rememberSemanticRun(
  runs: readonly SemanticExperimentRunV1[],
  run: SemanticExperimentRunV1,
): readonly SemanticExperimentRunV1[] {
  return Object.freeze([run, ...runs.filter(({ id }) => id !== run.id)].slice(0, MAX_RECENT_SEMANTIC_RUNS));
}
