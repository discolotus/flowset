import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ParameterGuide } from "./ParameterGuide";

describe("ParameterGuide", () => {
  it("explains the selected parameter and exposes the full glossary", () => {
    const markup = renderToStaticMarkup(<ParameterGuide parameter="valence" />);

    expect(markup).toContain("What valence means");
    expect(markup).toContain("perceived emotional positivity");
    expect(markup).toContain("Lower tends sad, dark, or tense");
    expect(markup).toContain("Browse all parameter definitions");
    expect(markup).toContain("Spectral flux");
    expect(markup).toContain("provider-specific");
  });
});
