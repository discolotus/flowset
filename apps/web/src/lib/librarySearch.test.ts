import { describe, expect, it } from "vitest";
import { searchScore } from "./librarySearch";
import { combineJobIds, rankedJobIds, type LibraryJob } from "./libraryJobs";
describe("library discovery", () => {
  it("folds accents, swaps words and tolerates typos while exact mode stays literal", () => {
    expect(searchScore("André Würhme – Bass", "andre wruhme")).toBeGreaterThan(
      0,
    );
    expect(searchScore("Adrian Hour – Bass", "bass adrian")).toBeGreaterThan(0);
    expect(searchScore("Adrian Hour", "adrian houx", false)).toBe(0);
    expect(searchScore("Low", "lot")).toBe(0);
    expect(searchScore("Deep bass", "deep bass")).toBeGreaterThan(
      searchScore("Depp bass", "deep bass"),
    );
  });
  it("combines membership without duplicate tracks or comparing model scores", () => {
    expect([...combineJobIds(["a", "b"], ["b", "c"], "both")]).toEqual(["b"]);
    expect([...combineJobIds(["a", "b"], ["b", "c"], "either")]).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect([...combineJobIds(["a", "b"], ["b", "c"], "exclude")]).toEqual([
      "a",
    ]);
  });
  it("ranks only complete finite scores with deterministic ties", () => {
    const job = {
      results: {
        b: { status: "complete", scores: [{ key: "bass", score: 0.8 }] },
        a: { status: "complete", scores: [{ key: "bass", score: 0.8 }] },
        missing: { status: "unavailable" },
        failed: { status: "failed", scores: [{ key: "bass", score: 1 }] },
      },
    } as unknown as LibraryJob;
    expect(rankedJobIds(job, "bass", 2)).toEqual(["a", "b"]);
    expect(rankedJobIds(job, "unknown", 2)).toEqual([]);
  });
});
