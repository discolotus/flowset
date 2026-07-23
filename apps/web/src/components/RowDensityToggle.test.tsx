import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RowDensityToggle } from "./RowDensityToggle";

describe("RowDensityToggle", () => {
  it("exposes the comfortable default as an unpressed compact toggle", () => {
    const markup = renderToStaticMarkup(
      <RowDensityToggle density="comfortable" onChange={() => undefined} />,
    );

    expect(markup).toContain('aria-label="Compact rows"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("Use compact single-line track rows");
  });

  it("shows compact mode as pressed and offers the comfortable layout", () => {
    const markup = renderToStaticMarkup(
      <RowDensityToggle density="compact" onChange={() => undefined} />,
    );

    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Use comfortable track rows");
    expect(markup).toContain("row-density-toggle active");
  });
});
