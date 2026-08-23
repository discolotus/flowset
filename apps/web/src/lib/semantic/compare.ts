import type { SemanticScore, Track } from "../types";
import type { SemanticExperimentRunV1, SemanticPromotion, SemanticRecipeScope, SemanticTrackSnapshot } from "./types";

export interface SemanticComparisonCoverage {
  readonly total: number;
  readonly paired: number;
  readonly leftMissing: number;
  readonly rightMissing: number;
}

export interface SemanticComparisonRow {
  readonly trackId: string;
  readonly track: SemanticTrackSnapshot;
  readonly leftScore: number | null;
  readonly rightScore: number | null;
  readonly leftRank: number | null;
  readonly rightRank: number | null;
  readonly rankDelta: number | null;
}

export interface SemanticRunComparison {
  readonly compatible: boolean;
  readonly reason: string | null;
  readonly coverage: SemanticComparisonCoverage;
  readonly spearman: number | null;
  readonly rows: readonly SemanticComparisonRow[];
  readonly agreements: readonly SemanticComparisonRow[];
  readonly disagreements: readonly SemanticComparisonRow[];
}

export interface SemanticComparisonPromotion {
  readonly promotion: SemanticPromotion;
  readonly scoresByTrack: ReadonlyMap<string, Track["semantic_scores"]>;
}

function emptyComparison(reason: string, total: number): SemanticRunComparison {
  return Object.freeze({
    compatible: false,
    reason,
    coverage: Object.freeze({ total, paired: 0, leftMissing: total, rightMissing: total }),
    spearman: null,
    rows: Object.freeze([]),
    agreements: Object.freeze([]),
    disagreements: Object.freeze([]),
  });
}

function exactOrderedTrackSet(left: SemanticExperimentRunV1, right: SemanticExperimentRunV1): boolean {
  return left.trackSetFingerprint === right.trackSetFingerprint
    && left.trackIds.length === right.trackIds.length
    && left.trackIds.every((trackId, index) => trackId === right.trackIds[index]);
}

function scoresFor(run: SemanticExperimentRunV1, scoreKey: string): ReadonlyMap<string, number> {
  return new Map(run.results.flatMap((result) => {
    const score = result.status === "complete"
      ? result.scores.find(({ key }) => key === scoreKey)?.score
      : undefined;
    return score == null || !Number.isFinite(score) ? [] : [[result.trackId, score] as const];
  }));
}

function averageRanks(scores: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const ordered = [...scores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const ranks = new Map<string, number>();
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end][1] === ordered[start][1]) end += 1;
    const average = ((start + 1) + end) / 2;
    for (let index = start; index < end; index += 1) ranks.set(ordered[index][0], average);
    start = end;
  }
  return ranks;
}

function pearson(left: readonly number[], right: readonly number[]): number | null {
  if (left.length < 2 || left.length !== right.length) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator === 0 ? null : numerator / denominator;
}

export function compareSemanticRuns({
  left,
  leftScoreKey,
  right,
  rightScoreKey,
}: {
  left: SemanticExperimentRunV1;
  leftScoreKey: string;
  right: SemanticExperimentRunV1;
  rightScoreKey: string;
}): SemanticRunComparison {
  const total = left.trackIds.length;
  if (left.id === right.id) {
    return emptyComparison("Choose two different completed runs.", total);
  }
  if (left.status !== "complete" || right.status !== "complete") {
    return emptyComparison("Choose two completed scalar runs.", total);
  }
  if (!exactOrderedTrackSet(left, right)) {
    return emptyComparison("Track sets differ. Compare runs created from the same ordered track set.", total);
  }

  const leftScores = scoresFor(left, leftScoreKey);
  const rightScores = scoresFor(right, rightScoreKey);
  const pairedIds = left.trackIds.filter((trackId) => leftScores.has(trackId) && rightScores.has(trackId));
  const pairedLeft = new Map(pairedIds.map((trackId) => [trackId, leftScores.get(trackId)!]));
  const pairedRight = new Map(pairedIds.map((trackId) => [trackId, rightScores.get(trackId)!]));
  const leftRanks = averageRanks(pairedLeft);
  const rightRanks = averageRanks(pairedRight);
  const metadata = new Map([...left.trackSnapshots, ...right.trackSnapshots].map((track) => [track.trackId, track]));
  const rows = left.trackIds.map((trackId) => {
    const leftScore = leftScores.get(trackId) ?? null;
    const rightScore = rightScores.get(trackId) ?? null;
    const leftRank = leftRanks.get(trackId) ?? null;
    const rightRank = rightRanks.get(trackId) ?? null;
    return Object.freeze({
      trackId,
      track: metadata.get(trackId) ?? Object.freeze({ trackId, name: trackId, artist: "Metadata unavailable", album: "", durationMs: 0 }),
      leftScore,
      rightScore,
      leftRank,
      rightRank,
      rankDelta: leftRank == null || rightRank == null ? null : Math.abs(leftRank - rightRank),
    });
  });
  const pairedRows = rows.filter((row) => row.rankDelta != null);
  const agreements = [...pairedRows].sort((left, right) => left.rankDelta! - right.rankDelta! || left.trackId.localeCompare(right.trackId));
  const disagreements = [...pairedRows].sort((left, right) => right.rankDelta! - left.rankDelta! || left.trackId.localeCompare(right.trackId));
  const spearman = pearson(
    pairedIds.map((trackId) => leftRanks.get(trackId)!),
    pairedIds.map((trackId) => rightRanks.get(trackId)!),
  );
  return Object.freeze({
    compatible: true,
    reason: null,
    coverage: Object.freeze({
      total,
      paired: pairedIds.length,
      leftMissing: left.trackIds.filter((trackId) => !leftScores.has(trackId)).length,
      rightMissing: right.trackIds.filter((trackId) => !rightScores.has(trackId)).length,
    }),
    spearman,
    rows: Object.freeze(rows),
    agreements: Object.freeze(agreements),
    disagreements: Object.freeze(disagreements),
  });
}

export function comparisonPromotion(
  run: SemanticExperimentRunV1,
  scoreKey: string,
  scopes: Record<SemanticRecipeScope, boolean>,
): SemanticComparisonPromotion {
  const scoresByTrack = new Map<string, SemanticScore[]>(run.results.map((result) => [
    result.trackId,
    result.scores.filter(({ key }) => key === scoreKey),
  ]));
  return Object.freeze({
    promotion: Object.freeze({ runId: run.id, scoreKey, scopes: Object.freeze({ ...scopes }) }),
    scoresByTrack,
  });
}
