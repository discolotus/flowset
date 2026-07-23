import { describe, expect, it } from "vitest";

import {
  MAX_SPLIT_FACTORS,
  addSplitFactor,
  canAddSplitFactor,
  hasSplitFactorParameter,
  removeSplitFactor,
  splitFactorProduct,
  updateSplitFactor,
  type SplitFactor,
} from "./factorGrid";

const factors: SplitFactor[] = [
  { id: "energy", parameter: "energy", binCount: 3 },
  { id: "dance", parameter: "danceability", binCount: 2 },
];

describe("factor grid", () => {
  it("calculates the configured Cartesian product", () => {
    expect(splitFactorProduct([])).toBe(1);
    expect(splitFactorProduct(factors)).toBe(6);
    expect(splitFactorProduct([
      ...factors,
      { id: "arousal", parameter: "arousal", binCount: 4 },
    ])).toBe(24);
  });

  it("adds unique factors until the three-factor limit", () => {
    const withThird = addSplitFactor(factors, {
      id: "arousal",
      parameter: "arousal",
      binCount: 2,
    });

    expect(MAX_SPLIT_FACTORS).toBe(3);
    expect(withThird).toHaveLength(3);
    expect(canAddSplitFactor(withThird, "tempo")).toBe(false);
    expect(addSplitFactor(withThird, {
      id: "tempo",
      parameter: "tempo",
      binCount: 2,
    })).toBe(withThird);
  });

  it("prevents duplicate ids and parameters", () => {
    expect(hasSplitFactorParameter(factors, "energy")).toBe(true);
    expect(canAddSplitFactor(factors, "energy")).toBe(false);
    expect(addSplitFactor(factors, {
      id: "another-energy",
      parameter: "energy",
      binCount: 4,
    })).toBe(factors);
    expect(addSplitFactor(factors, {
      id: "energy",
      parameter: "tempo",
      binCount: 4,
    })).toBe(factors);
  });

  it("updates levels or a parameter without permitting a duplicate parameter", () => {
    expect(updateSplitFactor(factors, "energy", { binCount: 5 })).toEqual([
      { id: "energy", parameter: "energy", binCount: 5 },
      factors[1],
    ]);
    expect(updateSplitFactor(factors, "energy", {
      parameter: "danceability",
    })).toBe(factors);
    expect(updateSplitFactor(factors, "energy", {
      parameter: "arousal",
    })).toEqual([
      { id: "energy", parameter: "arousal", binCount: 3 },
      factors[1],
    ]);
  });

  it("removes the requested factor and ignores unknown ids", () => {
    expect(removeSplitFactor(factors, "energy")).toEqual([factors[1]]);
    expect(removeSplitFactor(factors, "missing")).toBe(factors);
  });
});
