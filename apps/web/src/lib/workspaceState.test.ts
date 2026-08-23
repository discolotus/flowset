import { describe, expect, it } from "vitest";

import {
  EMPTY_WORKSPACE_STATE,
  LEGACY_WORKSPACE_STATE_STORAGE_KEY,
  MAX_PERSISTED_SEMANTIC_TRACKS,
  WORKSPACE_STATE_STORAGE_KEY,
  normalizeWorkspaceState,
  readBrowserWorkspaceState,
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

function semanticRun(id: string, query = "focus", score = 0.75) {
  const scoreKey = `semantic:local-clap:clap-v1:${query}`;
  return {
    schemaVersion: 1,
    id,
    createdAt: "2026-08-22T10:00:00.000Z",
    completedAt: "2026-08-22T10:00:01.000Z",
    durationMs: 1_000,
    kind: "text-ranking",
    status: "complete",
    backend: {
      id: "local-clap",
      display_name: "Local CLAP",
      model: "clap-v1",
      available: true,
      requires_local_audio: true,
      max_tracks: 20,
      max_labels: 3,
      max_embedding_batch: 20,
      capabilities: ["text_similarity"],
    },
    prompts: [query],
    scoreKeysByNormalizedLabel: { [query]: scoreKey },
    query,
    scoreKey,
    trackIds: ["track-1"],
    trackSetFingerprint: "fnv1a32:track",
    sourceTrackSetFingerprint: "fnv1a32:source",
    trackSnapshots: [{ trackId: "track-1", name: "Fixture Track", artist: "Fixture Artist", album: "Fixture Album", durationMs: 120_000 }],
    results: [{
      trackId: "track-1",
      status: "complete",
      scores: [{ key: scoreKey, label: query, normalized_label: query, score, provenance: { backend: "local-clap", model: "clap-v1" } }],
    }],
    missingTrackIds: [],
    warnings: [],
  };
}

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
      schemaVersion: 2,
      savedRecipes: [],
      recentLibraryRoots: ["/Music"],
      lastMp3Export: null,
      semanticRuns: [],
    });
  });

  it("migrates browser schema v1 without losing recipes or library history", () => {
    const saved = saveRecipe(EMPTY_WORKSPACE_STATE, recipe, new Date("2026-08-22T10:00:00Z"));
    const legacy = {
      schemaVersion: 1,
      savedRecipes: saved.savedRecipes,
      recentLibraryRoots: ["/Music"],
      lastMp3Export: null,
    };
    const storage = { getItem: (key: string) => key === LEGACY_WORKSPACE_STATE_STORAGE_KEY ? JSON.stringify(legacy) : null, setItem: () => undefined };

    expect(readBrowserWorkspaceState(storage)).toEqual({
      ...legacy,
      schemaVersion: 2,
      semanticRuns: [],
    });
  });

  it("hydrates only bounded scalar run history with metadata, provenance, and snapshots", () => {
    const normalized = normalizeWorkspaceState({
      ...EMPTY_WORKSPACE_STATE,
      semanticRuns: Array.from({ length: 10 }, (_, index) => semanticRun(`run-${index}`, `focus-${index}`, index / 10)),
    });

    expect(normalized.semanticRuns).toHaveLength(8);
    expect(normalized.semanticRuns[0]).toMatchObject(semanticRun("run-0", "focus-0", 0));
    expect(normalized.semanticRuns[0].trackSnapshots[0].name).toBe("Fixture Track");
    expect(normalized.semanticRuns[0].results[0].scores[0].provenance).toEqual({ backend: "local-clap", model: "clap-v1" });
    expect(normalized.semanticRuns[7].id).toBe("run-7");
    expect(normalizeWorkspaceState({
      ...EMPTY_WORKSPACE_STATE,
      semanticRuns: [{
        ...semanticRun("oversized"),
        trackIds: Array.from({ length: MAX_PERSISTED_SEMANTIC_TRACKS + 1 }, (_, index) => `track-${index}`),
      }],
    }).semanticRuns).toEqual([]);
  });

  it("redacts embeddings, raw audio material, paths, and provider secrets by projection", () => {
    const contaminated = {
      ...semanticRun("safe-run"),
      embeddings: [[0.1, 0.2]],
      audioPaths: { "track-1": "/Users/fixture/Music/private.mp3" },
      audioBlob: "base64-audio-sentinel",
      providerSecret: "provider-secret-sentinel",
      backend: { ...semanticRun("safe-run").backend, client_secret: "client-secret-sentinel" },
      results: semanticRun("safe-run").results.map((result) => ({
        ...result,
        rawAudioPath: "/Users/fixture/Music/private.mp3",
        scores: result.scores.map((score) => ({
          ...score,
          provenance: { ...score.provenance, accessToken: "access-token-sentinel" },
        })),
      })),
    };

    const serialized = JSON.stringify(normalizeWorkspaceState({ ...EMPTY_WORKSPACE_STATE, semanticRuns: [contaminated] }));
    expect(serialized).not.toContain("0.1");
    expect(serialized).not.toContain("/Users/fixture/Music/private.mp3");
    expect(serialized).not.toContain("base64-audio-sentinel");
    expect(serialized).not.toContain("provider-secret-sentinel");
    expect(serialized).not.toContain("client-secret-sentinel");
    expect(serialized).not.toContain("access-token-sentinel");
    expect(JSON.parse(serialized).semanticRuns[0].results[0].scores[0].score).toBe(0.75);
  });
});
