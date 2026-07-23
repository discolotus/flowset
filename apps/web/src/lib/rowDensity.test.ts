import { describe, expect, it, vi } from "vitest";

import {
  readRowDensity,
  ROW_DENSITY_STORAGE_KEY,
  saveRowDensity,
} from "./rowDensity";

describe("row density preference", () => {
  it("defaults to the comfortable layout", () => {
    expect(readRowDensity(null)).toBe("comfortable");
    expect(readRowDensity({ getItem: () => "unexpected" })).toBe("comfortable");
  });

  it("restores and saves compact rows", () => {
    const getItem = vi.fn(() => "compact");
    const setItem = vi.fn();

    expect(readRowDensity({ getItem })).toBe("compact");
    expect(getItem).toHaveBeenCalledWith(ROW_DENSITY_STORAGE_KEY);

    saveRowDensity({ setItem }, "compact");
    expect(setItem).toHaveBeenCalledWith(ROW_DENSITY_STORAGE_KEY, "compact");
  });

  it("falls back safely when storage access is blocked", () => {
    expect(readRowDensity({ getItem: () => { throw new Error("blocked"); } })).toBe("comfortable");
    expect(() => saveRowDensity({ setItem: () => { throw new Error("blocked"); } }, "compact"))
      .not.toThrow();
  });
});
