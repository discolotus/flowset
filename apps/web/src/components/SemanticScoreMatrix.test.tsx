// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { SemanticExperimentRunV1 } from "../lib/semantic/types";
import { SemanticScoreMatrix } from "./SemanticScoreMatrix";

const backend = { id: "local-clap", display_name: "Local CLAP", model: "clap-v1", available: true, requires_local_audio: true, max_tracks: 20, max_labels: 20, capabilities: ["text_similarity"] } as const;
const focusKey = "semantic:focus";
const warmKey = "semantic:warm";
const score = (key: string, label: string, value: number) => ({ key, label, normalized_label: label, score: value, provenance: { backend: "local-clap", model: "clap-v1" } });
const run: SemanticExperimentRunV1 = {
  schemaVersion: 1,
  id: "matrix-run",
  createdAt: "2026-08-22T00:00:00.000Z",
  completedAt: "2026-08-22T00:00:01.000Z",
  durationMs: 1000,
  kind: "text-ranking",
  status: "partial",
  backend,
  prompts: ["focus", "warm"],
  scoreKeysByNormalizedLabel: { focus: focusKey, warm: warmKey },
  query: "focus",
  scoreKey: focusKey,
  trackIds: ["alpha", "beta"],
  trackSetFingerprint: "tracks",
  sourceTrackSetFingerprint: "source",
  trackSnapshots: [
    { trackId: "alpha", name: "Alpha", artist: "Artist A", album: "Album A", durationMs: 1000 },
    { trackId: "beta", name: "Beta", artist: "Artist B", album: "Album B", durationMs: 1000 },
  ],
  results: [
    { trackId: "alpha", status: "complete", scores: [score(focusKey, "focus", 0.2), score(warmKey, "warm", 0.8)] },
    { trackId: "beta", status: "unavailable", scores: [score(focusKey, "focus", 0.9)], error: "Warm score unavailable" },
  ],
  missingTrackIds: [],
  warnings: [],
};

afterEach(cleanup);

function MatrixHarness() {
  const [selectedScoreKey, setSelectedScoreKey] = useState(focusKey);
  const [direction, setDirection] = useState<"descending" | "ascending">("descending");
  return <SemanticScoreMatrix
    run={run}
    selectedScoreKey={selectedScoreKey}
    sortDirection={direction}
    audioPaths={{ alpha: "alpha.mp3", beta: "beta.mp3" }}
    onSelectScoreKey={setSelectedScoreKey}
    onSort={(key) => {
      if (key !== selectedScoreKey) { setSelectedScoreKey(key); setDirection("descending"); }
      else setDirection((current) => current === "descending" ? "ascending" : "descending");
    }}
  />;
}

describe("SemanticScoreMatrix", () => {
  it("sorts selected columns, exposes missing cells, and keeps audition selection pinned", async () => {
    const user = userEvent.setup();
    const { container } = render(<MatrixHarness />);
    const rowNames = () => [...container.querySelectorAll("tbody tr")].map((row) => within(row as HTMLElement).getAllByRole("button")[0].textContent);
    expect(rowNames()).toEqual([expect.stringContaining("Beta"), expect.stringContaining("Alpha")]);
    expect(screen.getByRole("button", { name: "Beta, warm: Unavailable" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Sort focus ascending" }));
    expect(rowNames()).toEqual([expect.stringContaining("Alpha"), expect.stringContaining("Beta")]);
    await user.click(screen.getByRole("button", { name: "Alpha, warm: 0.8000" }));
    expect(screen.getByLabelText("Selected track preview").textContent).toContain("Alpha");
    await user.click(screen.getByRole("button", { name: "Sort warm descending" }));
    expect(screen.getByLabelText("Selected track preview").textContent).toContain("Alpha");
    expect(screen.getByLabelText("Preview Alpha").getAttribute("src")).toContain("alpha.mp3");
  });

  it("moves between score cells with arrow keys while retaining numeric text", async () => {
    const user = userEvent.setup();
    render(<MatrixHarness />);
    const focusCell = screen.getByRole("button", { name: "Beta, focus: 0.9000" });
    focusCell.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Beta, warm: Unavailable" }));
    expect(focusCell.textContent).toBe("0.9000");
  });
});
