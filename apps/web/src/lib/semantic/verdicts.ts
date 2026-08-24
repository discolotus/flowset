import type { SemanticComparisonRow } from "./compare";
import type { SemanticExperimentRunV1 } from "./types";

export type SemanticVerdict = "left" | "right" | "both" | "neither";

export interface SemanticVerdictRecord {
  readonly trackId: string;
  readonly verdict: SemanticVerdict;
}

export interface SemanticEvaluationExportV1 {
  readonly schema_version: "sequence.semantic-evaluation.v1";
  readonly created_at: string;
  readonly comparison: {
    readonly left_run_id: string;
    readonly left_score_key: string;
    readonly right_run_id: string;
    readonly right_score_key: string;
    readonly track_set_fingerprint: string;
  };
  readonly verdicts: ReadonlyArray<{
    readonly track_id: string;
    readonly name: string;
    readonly artist: string;
    readonly album: string;
    readonly left_score: number;
    readonly right_score: number;
    readonly left_rank: number;
    readonly right_rank: number;
    readonly rank_delta: number;
    readonly verdict: SemanticVerdict;
  }>;
}

export const SEMANTIC_VERDICTS_STORAGE_KEY = "sequence.semantic-verdicts.v1";
const MAX_STORED_COMPARISONS = 20;
const MAX_VERDICTS_PER_COMPARISON = 100;
const VERDICTS = new Set<SemanticVerdict>(["left", "right", "both", "neither"]);

interface StoredVerdictsV1 {
  readonly schema_version: "sequence.semantic-verdicts.v1";
  readonly comparisons: Readonly<Record<string, readonly SemanticVerdictRecord[]>>;
}

export function semanticComparisonId(
  leftRunId: string,
  leftScoreKey: string,
  rightRunId: string,
  rightScoreKey: string,
): string {
  return [leftRunId, leftScoreKey, rightRunId, rightScoreKey]
    .map((value) => `${value.length}:${value}`)
    .join("|");
}

function validRecord(value: unknown): value is SemanticVerdictRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SemanticVerdictRecord>;
  return typeof candidate.trackId === "string"
    && candidate.trackId.length > 0
    && candidate.trackId.length <= 256
    && VERDICTS.has(candidate.verdict as SemanticVerdict);
}

export function readSemanticVerdicts(storage: Pick<Storage, "getItem"> | null, comparisonId: string): Record<string, SemanticVerdict> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(SEMANTIC_VERDICTS_STORAGE_KEY) ?? "null") as Partial<StoredVerdictsV1> | null;
    const records = parsed?.schema_version === "sequence.semantic-verdicts.v1"
      ? parsed.comparisons?.[comparisonId]
      : undefined;
    if (!Array.isArray(records)) return {};
    return Object.fromEntries(records.filter(validRecord).slice(0, MAX_VERDICTS_PER_COMPARISON).map(({ trackId, verdict }) => [trackId, verdict]));
  } catch {
    return {};
  }
}

export function saveSemanticVerdicts(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  comparisonId: string,
  verdicts: Readonly<Record<string, SemanticVerdict>>,
): void {
  if (!storage) return;
  let comparisons: Record<string, readonly SemanticVerdictRecord[]> = {};
  try {
    const parsed = JSON.parse(storage.getItem(SEMANTIC_VERDICTS_STORAGE_KEY) ?? "null") as Partial<StoredVerdictsV1> | null;
    if (parsed?.schema_version === "sequence.semantic-verdicts.v1" && parsed.comparisons && typeof parsed.comparisons === "object") {
      comparisons = Object.fromEntries(Object.entries(parsed.comparisons).slice(-MAX_STORED_COMPARISONS + 1));
    }
  } catch {
    comparisons = {};
  }
  comparisons[comparisonId] = Object.entries(verdicts)
    .filter((entry): entry is [string, SemanticVerdict] => entry[0].length > 0 && entry[0].length <= 256 && VERDICTS.has(entry[1]))
    .slice(0, MAX_VERDICTS_PER_COMPARISON)
    .map(([trackId, verdict]) => Object.freeze({ trackId, verdict }));
  try {
    storage.setItem(SEMANTIC_VERDICTS_STORAGE_KEY, JSON.stringify({
      schema_version: "sequence.semantic-verdicts.v1",
      comparisons,
    } satisfies StoredVerdictsV1));
  } catch {
    // Storage can be unavailable in hardened browser contexts; verdict UI remains session-local.
  }
}

export function buildSemanticEvaluationExport({
  left,
  leftScoreKey,
  right,
  rightScoreKey,
  rows,
  verdicts,
  createdAt,
}: {
  left: SemanticExperimentRunV1;
  leftScoreKey: string;
  right: SemanticExperimentRunV1;
  rightScoreKey: string;
  rows: readonly SemanticComparisonRow[];
  verdicts: Readonly<Record<string, SemanticVerdict>>;
  createdAt: string;
}): SemanticEvaluationExportV1 {
  const evaluated: Array<SemanticEvaluationExportV1["verdicts"][number]> = rows.flatMap((row) => {
    const verdict = verdicts[row.trackId];
    if (!verdict || row.leftScore == null || row.rightScore == null || row.leftRank == null || row.rightRank == null || row.rankDelta == null) return [];
    return [{
      track_id: row.trackId,
      name: row.track.name,
      artist: row.track.artist,
      album: row.track.album,
      left_score: row.leftScore,
      right_score: row.rightScore,
      left_rank: row.leftRank,
      right_rank: row.rightRank,
      rank_delta: row.rankDelta,
      verdict,
    }];
  });
  return Object.freeze({
    schema_version: "sequence.semantic-evaluation.v1",
    created_at: createdAt,
    comparison: Object.freeze({
      left_run_id: left.id,
      left_score_key: leftScoreKey,
      right_run_id: right.id,
      right_score_key: rightScoreKey,
      track_set_fingerprint: left.trackSetFingerprint,
    }),
    verdicts: Object.freeze(evaluated.map((row) => Object.freeze(row))),
  });
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function semanticEvaluationCsv(evaluation: SemanticEvaluationExportV1): string {
  const headers = ["track_id", "name", "artist", "album", "left_run_id", "left_score_key", "left_score", "left_rank", "right_run_id", "right_score_key", "right_score", "right_rank", "rank_delta", "verdict"];
  const rows = evaluation.verdicts.map((row) => [
    row.track_id, row.name, row.artist, row.album,
    evaluation.comparison.left_run_id, evaluation.comparison.left_score_key, row.left_score, row.left_rank,
    evaluation.comparison.right_run_id, evaluation.comparison.right_score_key, row.right_score, row.right_rank,
    row.rank_delta, row.verdict,
  ].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\n");
}
