import { describe, expect, it } from "vitest";

import { calculateSemanticScoreDiagnostics, LOW_SEPARATION_RANGE } from "./diagnostics";

describe("semantic score diagnostics", () => {
  it("calculates coverage, bounds, range, and deterministic histogram bins", () => {
    const diagnostics = calculateSemanticScoreDiagnostics([0, 0.25, null, 0.75, 1]);
    expect(diagnostics).toMatchObject({ totalCount: 5, availableCount: 4, missingCount: 1, coverage: 0.8, minimum: 0, maximum: 1, range: 1, lowSeparation: false });
    expect(diagnostics.histogram).toEqual([
      { minimum: 0, maximum: 0.5, count: 2 },
      { minimum: 0.5, maximum: 1, count: 2 },
    ]);
  });

  it("flags only observed multi-value ranges below the documented heuristic", () => {
    expect(calculateSemanticScoreDiagnostics([0.1, 0.1 + LOW_SEPARATION_RANGE / 2]).lowSeparation).toBe(true);
    expect(calculateSemanticScoreDiagnostics([0.1]).lowSeparation).toBe(false);
    expect(calculateSemanticScoreDiagnostics([null, undefined]).range).toBeNull();
  });
});
