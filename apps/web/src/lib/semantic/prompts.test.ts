import { describe, expect, it } from "vitest";

import { cleanSemanticPrompt, normalizeSemanticPrompt, validateSemanticPrompts } from "./prompts";

describe("semantic prompt identity and bounds", () => {
  it("collapses whitespace while preserving display case and normalizing identity case", () => {
    expect(cleanSemanticPrompt("  Warm   Analog Glow ")).toBe("Warm Analog Glow");
    expect(normalizeSemanticPrompt("  Warm   Analog Glow ")).toBe("warm analog glow");
  });

  it("rejects normalized duplicates and backend-bound overflow before inference", () => {
    expect(validateSemanticPrompts(["Warm Glow", " warm   glow "], 20).error).toMatch(/unique/);
    expect(validateSemanticPrompts(["one", "two", "three"], 2).error).toBe("This backend accepts at most 2 prompts per run.");
  });
});
