import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NUMERIC_PARAMETERS, type ParameterCoverage } from "../lib/parameters";
import type { NumericParameter } from "../lib/types";
import { SplitFactorGrid } from "./SplitFactorGrid";

const coverage = new Map<NumericParameter, ParameterCoverage>(
  NUMERIC_PARAMETERS.map(({ value }) => [value, { available: 12, total: 12 }]),
);

const handlers = {
  onAddFactor: () => undefined,
  onRemoveFactor: () => undefined,
  onChangeFactor: () => undefined,
};

describe("SplitFactorGrid", () => {
  it("renders an accessible two-factor grid and configured product", () => {
    const markup = renderToStaticMarkup(
      <SplitFactorGrid
        factors={[
          { id: "energy", parameter: "energy", binCount: 3 },
          { id: "dance", parameter: "danceability", binCount: 2 },
        ]}
        coverage={coverage}
        {...handlers}
      />,
    );

    expect(markup).toContain("<fieldset");
    expect(markup).toContain("Playlist split factors");
    expect(markup).toContain("Factor 1");
    expect(markup).toContain("Factor 2");
    expect(markup).toContain("3 × 2 = up to 6 basis playlists");
    expect(markup).toContain('aria-label="Remove Energy factor"');
    expect(markup).toContain("tracks missing any selected factor are kept");
  });

  it("disables parameters already selected by another factor", () => {
    const markup = renderToStaticMarkup(
      <SplitFactorGrid
        factors={[
          { id: "energy", parameter: "energy", binCount: 3 },
          { id: "dance", parameter: "danceability", binCount: 2 },
        ]}
        coverage={coverage}
        {...handlers}
      />,
    );

    expect(markup).toMatch(/value="danceability" disabled=""[^>]*>Danceability/);
    expect(markup).toMatch(/value="energy" disabled=""[^>]*>Energy/);
  });

  it("disables adding a fourth factor and explains the limit", () => {
    const markup = renderToStaticMarkup(
      <SplitFactorGrid
        factors={[
          { id: "energy", parameter: "energy", binCount: 3 },
          { id: "dance", parameter: "danceability", binCount: 2 },
          { id: "arousal", parameter: "arousal", binCount: 4 },
        ]}
        coverage={coverage}
        {...handlers}
      />,
    );

    expect(markup).toContain("3 × 2 × 4 = up to 24 basis playlists");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Three-factor limit reached<\/button>/);
    expect(markup).toContain("Choose up to three different factors");
  });
});
