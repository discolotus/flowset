import type { SemanticScore } from "../types";
import type { SemanticExperimentRunV1 } from "./types";

export const SEMANTIC_CONTRAST_FORMULA = "positive - negative" as const;

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface SemanticContrast {
  readonly scoreKey: string;
  readonly label: string;
  readonly positiveScoreKey: string;
  readonly negativeScoreKey: string;
  readonly formula: typeof SEMANTIC_CONTRAST_FORMULA;
  readonly scoresByTrack: ReadonlyMap<string, SemanticScore>;
}

export function deriveSemanticContrast(input: {
  run: SemanticExperimentRunV1;
  positiveScoreKey: string;
  negativeScoreKey: string;
  positiveLabel: string;
  negativeLabel: string;
}): SemanticContrast {
  if (input.positiveScoreKey === input.negativeScoreKey) {
    throw new Error("Contrast requires two different source scores.");
  }
  const sourceIdentity = `${input.positiveScoreKey.length}:${input.positiveScoreKey}\n${input.negativeScoreKey.length}:${input.negativeScoreKey}`;
  const identity = fnv1a32(sourceIdentity);
  const scoreKey = `semantic:flowset-derived:contrast-v1:${identity}`;
  const label = `${input.positiveLabel} minus ${input.negativeLabel}`;
  const scoresByTrack = new Map<string, SemanticScore>();
  for (const result of input.run.results) {
    const positive = result.scores.find(({ key }) => key === input.positiveScoreKey);
    const negative = result.scores.find(({ key }) => key === input.negativeScoreKey);
    if (!positive || !negative || !Number.isFinite(positive.score) || !Number.isFinite(negative.score)) continue;
    const difference = positive.score - negative.score;
    if (!Number.isFinite(difference)) continue;
    scoresByTrack.set(result.trackId, Object.freeze({
      key: scoreKey,
      label,
      normalized_label: `contrast:${identity}`,
      score: difference,
      provenance: Object.freeze({
        kind: "derived" as const,
        backend: "flowset-derived" as const,
        model: "contrast-v1" as const,
        derivation: Object.freeze({
          type: "difference" as const,
          formula: SEMANTIC_CONTRAST_FORMULA,
          positive_score_key: input.positiveScoreKey,
          negative_score_key: input.negativeScoreKey,
        }),
      }),
    }));
  }
  return Object.freeze({
    scoreKey,
    label,
    positiveScoreKey: input.positiveScoreKey,
    negativeScoreKey: input.negativeScoreKey,
    formula: SEMANTIC_CONTRAST_FORMULA,
    scoresByTrack,
  });
}
