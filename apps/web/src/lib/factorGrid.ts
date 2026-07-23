import type { NumericParameter } from "./types";

export const MAX_SPLIT_FACTORS = 3;

export interface SplitFactor {
  id: string;
  parameter: NumericParameter;
  binCount: number;
}

export type SplitFactorChanges = Partial<Pick<SplitFactor, "parameter" | "binCount">>;

export function splitFactorProduct(factors: readonly SplitFactor[]): number {
  return factors.reduce((product, factor) => product * factor.binCount, 1);
}

export function hasSplitFactorParameter(
  factors: readonly SplitFactor[],
  parameter: NumericParameter,
  exceptFactorId?: string,
): boolean {
  return factors.some(
    (factor) => factor.id !== exceptFactorId && factor.parameter === parameter,
  );
}

export function canAddSplitFactor(
  factors: readonly SplitFactor[],
  parameter: NumericParameter,
): boolean {
  return factors.length < MAX_SPLIT_FACTORS
    && !hasSplitFactorParameter(factors, parameter);
}

export function addSplitFactor(
  factors: SplitFactor[],
  factor: SplitFactor,
): SplitFactor[] {
  if (
    factors.some((candidate) => candidate.id === factor.id)
    || !canAddSplitFactor(factors, factor.parameter)
  ) {
    return factors;
  }
  return [...factors, factor];
}

export function removeSplitFactor(
  factors: SplitFactor[],
  factorId: string,
): SplitFactor[] {
  if (!factors.some((factor) => factor.id === factorId)) {
    return factors;
  }
  return factors.filter((factor) => factor.id !== factorId);
}

export function updateSplitFactor(
  factors: SplitFactor[],
  factorId: string,
  changes: SplitFactorChanges,
): SplitFactor[] {
  const current = factors.find((factor) => factor.id === factorId);
  if (!current) return factors;

  if (
    changes.parameter !== undefined
    && hasSplitFactorParameter(factors, changes.parameter, factorId)
  ) {
    return factors;
  }

  const next = { ...current, ...changes };
  if (next.parameter === current.parameter && next.binCount === current.binCount) {
    return factors;
  }
  return factors.map((factor) => factor.id === factorId ? next : factor);
}
