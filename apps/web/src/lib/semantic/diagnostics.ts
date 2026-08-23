export const LOW_SEPARATION_RANGE = 0.05;

export interface SemanticHistogramBin {
  readonly minimum: number;
  readonly maximum: number;
  readonly count: number;
}

export interface SemanticScoreDiagnostics {
  readonly totalCount: number;
  readonly availableCount: number;
  readonly missingCount: number;
  readonly coverage: number;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly range: number | null;
  readonly histogram: readonly SemanticHistogramBin[];
  readonly lowSeparation: boolean;
}

export function calculateSemanticScoreDiagnostics(
  values: readonly (number | null | undefined)[],
): SemanticScoreDiagnostics {
  const available = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const minimum = available.length ? Math.min(...available) : null;
  const maximum = available.length ? Math.max(...available) : null;
  const range = minimum == null || maximum == null ? null : maximum - minimum;
  const binCount = available.length ? Math.min(8, Math.max(1, Math.ceil(Math.sqrt(available.length)))) : 0;
  const histogram = binCount === 0 || minimum == null || maximum == null || range == null
    ? []
    : range === 0
      ? [{ minimum, maximum, count: available.length }]
      : Array.from({ length: binCount }, (_, index) => {
        const width = range / binCount;
        const binMinimum = minimum + width * index;
        const binMaximum = index === binCount - 1 ? maximum : minimum + width * (index + 1);
        const count = available.filter((value) => {
          const binIndex = Math.min(binCount - 1, Math.floor((value - minimum) / width));
          return binIndex === index;
        }).length;
        return { minimum: binMinimum, maximum: binMaximum, count };
      });
  return Object.freeze({
    totalCount: values.length,
    availableCount: available.length,
    missingCount: values.length - available.length,
    coverage: values.length ? available.length / values.length : 0,
    minimum,
    maximum,
    range,
    histogram: Object.freeze(histogram.map((bin) => Object.freeze(bin))),
    lowSeparation: available.length >= 2 && range != null && range < LOW_SEPARATION_RANGE,
  });
}
