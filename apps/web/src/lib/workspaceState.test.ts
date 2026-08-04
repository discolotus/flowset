import { describe, expect, it } from "vitest";

import {
  EMPTY_WORKSPACE_STATE,
  normalizeWorkspaceState,
  rememberLibraryRoot,
  renameRecipe,
  saveRecipe,
} from "./workspaceState";

const recipe = {
  name: "Night Drive",
  distributionParameter: "energy" as const,
  distributionBinCount: 8,
  splitEnabled: true,
  splitFactors: [{ id: "factor-1", parameter: "energy" as const, binCount: 3 }],
  subgroupEnabled: true,
  subgroupParameter: "danceability" as const,
  subgroupBinCount: 2,
  sortEnabled: true,
  sortParameter: "tempo" as const,
  sortDirection: "ascending" as const,
};

describe("workspace state", () => {
  it("remembers recent roots most-recent-first without duplicates", () => {
    const withFirst = rememberLibraryRoot(EMPTY_WORKSPACE_STATE, "/Music/One");
    const withSecond = rememberLibraryRoot(withFirst, "/Music/Two");
    const reused = rememberLibraryRoot(withSecond, "/Music/One");

    expect(reused.recentLibraryRoots).toEqual(["/Music/One", "/Music/Two"]);
  });

  it("updates a saved recipe with the same name", () => {
    const first = saveRecipe(EMPTY_WORKSPACE_STATE, recipe, new Date("2026-07-30T10:00:00Z"));
    const updated = saveRecipe(first, { ...recipe, distributionBinCount: 12 }, new Date("2026-07-31T10:00:00Z"));

    expect(updated.savedRecipes).toHaveLength(1);
    expect(updated.savedRecipes[0].id).toBe(first.savedRecipes[0].id);
    expect(updated.savedRecipes[0].distributionBinCount).toBe(12);
  });

  it("renames a saved recipe without changing its settings or identity", () => {
    const saved = saveRecipe(EMPTY_WORKSPACE_STATE, recipe, new Date("2026-07-30T10:00:00Z"));
    const renamed = renameRecipe(saved, saved.savedRecipes[0].id, "  Sunrise Drive  ");

    expect(renamed.savedRecipes[0]).toEqual({
      ...saved.savedRecipes[0],
      name: "Sunrise Drive",
    });
  });

  it("rejects empty and duplicate recipe names", () => {
    const first = saveRecipe(EMPTY_WORKSPACE_STATE, recipe);
    const second = saveRecipe(first, { ...recipe, name: "Warm-up" });

    expect(() => renameRecipe(second, second.savedRecipes[0].id, "  ")).toThrow("cannot be empty");
    expect(() => renameRecipe(second, second.savedRecipes[0].id, "night drive")).toThrow("already exists");
  });

  it("drops malformed persisted data", () => {
    expect(normalizeWorkspaceState({
      savedRecipes: [{ id: "broken" }],
      recentLibraryRoots: ["/Music", "", 42],
      lastMp3Export: { directory: "/Export" },
    })).toEqual({
      schemaVersion: 1,
      savedRecipes: [],
      recentLibraryRoots: ["/Music"],
      lastMp3Export: null,
    });
  });
});
