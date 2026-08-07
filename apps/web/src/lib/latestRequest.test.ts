import { describe, expect, it } from "vitest";

import { LatestRequestGuard } from "./latestRequest";

describe("LatestRequestGuard", () => {
  it("rejects an older request after a newer request starts", () => {
    const guard = new LatestRequestGuard();
    const older = guard.begin();
    const newer = guard.begin();

    expect(older.isCurrent()).toBe(false);
    expect(newer.isCurrent()).toBe(true);
  });

  it("invalidates an in-flight request when its destination is cleared", () => {
    const guard = new LatestRequestGuard();
    const request = guard.begin();

    guard.invalidate();

    expect(request.isCurrent()).toBe(false);
  });
});
