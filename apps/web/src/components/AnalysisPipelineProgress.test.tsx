import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnalysisPipelineProgress,
  type AnalysisPipelineStage,
} from "./AnalysisPipelineProgress";

const stages: AnalysisPipelineStage[] = [
  { id: "decode", state: "done" },
  { id: "beat", state: "done" },
  { id: "key", state: "done" },
  { id: "spectral", state: "done" },
  { id: "tensorflow", state: "active" },
];

describe("AnalysisPipelineProgress", () => {
  it("exposes live overall, current-track, ETA, and ordered stage progress", () => {
    const markup = renderToStaticMarkup(
      <AnalysisPipelineProgress
        completed={7}
        total={92}
        currentTrackName="Antimatter (Original Mix)"
        currentTrackDurationSeconds={599}
        currentTrackElapsedSeconds={12.4}
        elapsedSeconds={48}
        phase="tensorflow"
        stages={stages}
        estimatedRemainingSeconds={125}
        tracks={[
          { id: "queued", name: "Queued Track", phase: "waiting" },
        ]}
      />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-label="Overall audio analysis progress"');
    expect(markup).toContain('aria-valuetext="7 of 92 tracks processed"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Antimatter (Original Mix)");
    expect(markup).toContain("9:59");
    expect(markup).toContain("12s");
    expect(markup).toContain("48s");
    expect(markup).toContain("About 2m 5s remaining");
    expect(markup).toContain('aria-current="step"');

    const stageMarkup = markup.slice(markup.indexOf('aria-label="Analysis stages"'));
    const decodeIndex = stageMarkup.indexOf("Decode");
    const beatIndex = stageMarkup.indexOf("Beat");
    const keyIndex = stageMarkup.indexOf("Key");
    const spectralIndex = stageMarkup.indexOf("Spectral");
    const tensorflowIndex = stageMarkup.indexOf("TensorFlow moods");
    expect(decodeIndex).toBeLessThan(beatIndex);
    expect(beatIndex).toBeLessThan(keyIndex);
    expect(keyIndex).toBeLessThan(spectralIndex);
    expect(spectralIndex).toBeLessThan(tensorflowIndex);
    expect(markup).toContain("Track details");
    expect(markup).not.toContain("Queued Track");
  });

  it("reveals compact per-track status and timing rows on demand", () => {
    const markup = renderToStaticMarkup(
      <AnalysisPipelineProgress
        completed={2}
        total={3}
        currentTrackName="Unreadable Track"
        currentTrackElapsedSeconds={61}
        phase="error"
        errorMessage="The local audio file could not be decoded."
        stages={[
          { id: "decode", state: "error" },
          { id: "beat", state: "waiting" },
          { id: "key", state: "waiting" },
          { id: "spectral", state: "waiting" },
          { id: "tensorflow", state: "waiting" },
        ]}
        tracks={[
          { id: "ready", name: "Ready Track", artist: "Artist One", phase: "done", analysisSeconds: 0.8 },
          { id: "cache", name: "Cached Track", phase: "cached", analysisSeconds: 0 },
          {
            id: "failed",
            name: "Unreadable Track",
            phase: "error",
            analysisSeconds: 61,
            message: "Decode failed",
          },
        ]}
        initiallyExpanded
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The local audio file could not be decoded.");
    expect(markup).toContain("Per-track audio analysis progress");
    expect(markup).toContain("Ready Track");
    expect(markup).toContain("Cached Track");
    expect(markup).toContain("Already analyzed");
    expect(markup).toContain("Unreadable Track");
    expect(markup).toContain("Decode failed");
    expect(markup).toContain("0.8s");
    expect(markup).toContain("1m 1s");
  });

  it("presents partial TensorFlow results as an issue instead of success", () => {
    const markup = renderToStaticMarkup(
      <AnalysisPipelineProgress
        completed={2}
        successful={1}
        failed={1}
        total={2}
        phase="incomplete"
        errorMessage="TensorFlow mood analysis failed."
        stages={[
          { id: "decode", state: "done" },
          { id: "tensorflow", state: "error" },
        ]}
        tracks={[
          { id: "ready", name: "Ready Track", phase: "done" },
          {
            id: "partial",
            name: "Native-only Track",
            phase: "incomplete",
            message: "TensorFlow mood analysis failed.",
          },
        ]}
        estimatedRemainingSeconds={0}
        initiallyExpanded
      />,
    );

    expect(markup).toContain("Analysis finished with issues");
    expect(markup).toContain("Analysis incomplete");
    expect(markup).toContain("1 track needs attention");
    expect(markup).toContain("TensorFlow mood analysis failed.");
    expect(markup).not.toContain("Less than a second remaining");
  });

  it("calls previously measured tracks already analyzed without claiming a cache restore", () => {
    const markup = renderToStaticMarkup(
      <AnalysisPipelineProgress
        completed={1}
        successful={1}
        total={1}
        phase="cached"
        stages={[
          { id: "decode", state: "cached" },
          { id: "tensorflow", state: "cached" },
        ]}
      />,
    );

    expect(markup).toContain("Everything is already analyzed");
    expect(markup).toContain("Already analyzed");
    expect(markup).toContain("Already complete");
    expect(markup).not.toContain("Cached");
    expect(markup).not.toContain("restored from cache");
  });
});
