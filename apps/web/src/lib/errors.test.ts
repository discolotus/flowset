import { describe, expect, it } from "vitest";

import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("preserves native Tauri string errors", () => {
    expect(errorMessage("Music is still loading.", "Fallback")).toBe("Music is still loading.");
  });

  it("preserves Error messages and falls back for empty values", () => {
    expect(errorMessage(new Error("Export failed."), "Fallback")).toBe("Export failed.");
    expect(errorMessage("  ", "Fallback")).toBe("Fallback");
    expect(errorMessage(null, "Fallback")).toBe("Fallback");
  });
});
