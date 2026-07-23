import { describe, expect, it } from "vitest";

import {
  completeAnalysisProgress,
  createInitialAnalysisProgress,
  mergeAnalysisBatchProgress,
  reconcileAnalysisProgressRows,
} from "./analysisProgress";
import type { AudioFeatureProgressSnapshot, Track } from "./types";

const track = (id: string, name: string): Track => ({
  id,
  name,
  artist: "Artist",
  album: "Album",
  duration_ms: 180_000,
  explicit: false,
  genres: [],
});

const stage = (
  state: "pending" | "active" | "complete" | "skipped" | "error",
  error: string | null = null,
) => ({
  state,
  started_at: null,
  completed_at: null,
  elapsed_seconds: state === "complete" ? 4 : null,
  error,
});

describe("analysis progress presentation", () => {
  it("shows restored tracks as cached before new analysis starts", () => {
    const view = createInitialAnalysisProgress(
      [track("cached", "Cached"), track("new", "New")],
      new Set(["new"]),
    );

    expect(view.completed).toBe(1);
    expect(view.tracks?.map(({ phase }) => phase)).toEqual(["cached", "waiting"]);
    expect(view.stages).toHaveLength(2);
  });

  it("maps real native DSP and TensorFlow states and aggregates batch offsets", () => {
    const initial = createInitialAnalysisProgress(
      [track("cached", "Cached"), track("one", "One"), track("two", "Two")],
      new Set(["one", "two"]),
    );
    const snapshot: AudioFeatureProgressSnapshot = {
      progress_token: "analysis-token-1234",
      provider: "essentia",
      phase: "tensorflow",
      completed_track_count: 1,
      total_track_count: 2,
      successful_track_count: 1,
      failed_track_count: 0,
      progress_fraction: 0.5,
      current_track: { track_id: "two", track_name: "Two", duration_ms: 180_000 },
      started_at: "2026-07-19T12:00:00Z",
      updated_at: "2026-07-19T12:00:10Z",
      completed_at: null,
      elapsed_seconds: 10,
      estimated_remaining_seconds: 3,
      tracks: [
        {
          track_id: "one",
          track_name: "One",
          duration_ms: 180_000,
          status: "complete",
          started_at: null,
          completed_at: null,
          elapsed_seconds: 7,
          error: null,
          stages: { native_dsp: stage("complete"), tensorflow: stage("complete") },
        },
        {
          track_id: "two",
          track_name: "Two",
          duration_ms: 180_000,
          status: "running",
          started_at: null,
          completed_at: null,
          elapsed_seconds: 3,
          error: null,
          stages: { native_dsp: stage("complete"), tensorflow: stage("active") },
        },
      ],
      error: null,
    };

    const view = mergeAnalysisBatchProgress({
      current: initial,
      snapshot,
      completedBeforeBatch: 1,
      successfulBeforeBatch: 1,
      failedBeforeBatch: 0,
      elapsedBeforeBatch: 20,
    });

    expect(view.completed).toBe(2);
    expect(view.successful).toBe(2);
    expect(view.progressFraction).toBeCloseTo(2 / 3);
    expect(view.phase).toBe("tensorflow");
    expect(view.currentTrackName).toBe("Two");
    expect(view.elapsedSeconds).toBe(30);
    expect(view.stages).toEqual([
      { id: "decode", label: "Decode + native DSP", state: "done" },
      { id: "tensorflow", label: "TensorFlow moods", state: "active" },
    ]);
  });

  it("keeps a native-only result incomplete when TensorFlow fails", () => {
    const initial = createInitialAnalysisProgress(
      [track("one", "One")],
      new Set(["one"]),
    );
    const snapshot: AudioFeatureProgressSnapshot = {
      progress_token: "analysis-token-1234",
      provider: "essentia",
      phase: "complete",
      completed_track_count: 1,
      total_track_count: 1,
      successful_track_count: 1,
      failed_track_count: 0,
      progress_fraction: 1,
      current_track: null,
      started_at: "2026-07-19T12:00:00Z",
      updated_at: "2026-07-19T12:00:10Z",
      completed_at: "2026-07-19T12:00:10Z",
      elapsed_seconds: 10,
      estimated_remaining_seconds: 0,
      tracks: [
        {
          track_id: "one",
          track_name: "One",
          duration_ms: 180_000,
          status: "complete",
          started_at: null,
          completed_at: null,
          elapsed_seconds: 10,
          error: null,
          stages: {
            native_dsp: stage("complete"),
            tensorflow: stage("error", "TensorFlow mood analysis failed."),
          },
        },
      ],
      error: null,
    };

    const view = mergeAnalysisBatchProgress({
      current: initial,
      snapshot,
      completedBeforeBatch: 0,
      successfulBeforeBatch: 0,
      failedBeforeBatch: 0,
      elapsedBeforeBatch: 0,
    });

    expect(view.phase).toBe("incomplete");
    expect(view.completed).toBe(1);
    expect(view.successful).toBe(0);
    expect(view.failed).toBe(1);
    expect(view.errorMessage).toBe("TensorFlow mood analysis failed.");
    expect(view.tracks).toEqual([
      expect.objectContaining({
        id: "one",
        phase: "incomplete",
        message: "TensorFlow mood analysis failed.",
      }),
    ]);
    expect(view.stages).toEqual([
      { id: "decode", label: "Decode + native DSP", state: "done" },
      { id: "tensorflow", label: "TensorFlow moods", state: "error" },
    ]);
  });

  it("surfaces a skipped TensorFlow reason as incomplete", () => {
    const initial = createInitialAnalysisProgress(
      [track("one", "One")],
      new Set(["one"]),
    );
    const snapshot: AudioFeatureProgressSnapshot = {
      progress_token: "analysis-token-1234",
      provider: "essentia",
      phase: "complete",
      completed_track_count: 1,
      total_track_count: 1,
      successful_track_count: 1,
      failed_track_count: 0,
      progress_fraction: 1,
      current_track: null,
      started_at: "2026-07-19T12:00:00Z",
      updated_at: "2026-07-19T12:00:10Z",
      completed_at: "2026-07-19T12:00:10Z",
      elapsed_seconds: 10,
      estimated_remaining_seconds: 0,
      tracks: [
        {
          track_id: "one",
          track_name: "One",
          duration_ms: 180_000,
          status: "complete",
          started_at: null,
          completed_at: null,
          elapsed_seconds: 10,
          error: null,
          stages: {
            native_dsp: stage("complete"),
            tensorflow: stage("skipped", "Mood models are unavailable."),
          },
        },
      ],
      error: null,
    };

    const view = mergeAnalysisBatchProgress({
      current: initial,
      snapshot,
      completedBeforeBatch: 0,
      successfulBeforeBatch: 0,
      failedBeforeBatch: 0,
      elapsedBeforeBatch: 0,
    });

    expect(view.phase).toBe("incomplete");
    expect(view.tracks?.[0]).toMatchObject({
      phase: "incomplete",
      message: "Mood models are unavailable.",
    });
  });

  it("preserves known row issues when the caller completes with optimistic counts", () => {
    const completed = completeAnalysisProgress(
      {
        completed: 2,
        successful: 1,
        failed: 1,
        total: 2,
        phase: "incomplete",
        stages: [
          { id: "decode", state: "done" },
          { id: "tensorflow", state: "error" },
        ],
        tracks: [
          { id: "ready", name: "Ready", phase: "done" },
          {
            id: "partial",
            name: "Partial",
            phase: "incomplete",
            message: "TensorFlow mood analysis failed.",
          },
        ],
      },
      { successful: 2, failed: 0, elapsedSeconds: 15 },
    );

    expect(completed.phase).toBe("incomplete");
    expect(completed.successful).toBe(1);
    expect(completed.failed).toBe(1);
    expect(completed.errorMessage).toBe("TensorFlow mood analysis failed.");
  });

  it("does not overwrite a hard terminal error with completion", () => {
    const completed = completeAnalysisProgress(
      {
        completed: 0,
        successful: 0,
        failed: 0,
        total: 1,
        phase: "error",
        errorMessage: "The analysis service stopped unexpectedly.",
        stages: [
          { id: "decode", state: "error" },
          { id: "tensorflow", state: "skipped" },
        ],
        tracks: [{ id: "one", name: "One", phase: "waiting" }],
      },
      { successful: 1, failed: 0, elapsedSeconds: 5 },
    );

    expect(completed.phase).toBe("error");
    expect(completed.errorMessage).toBe("The analysis service stopped unexpectedly.");
  });

  it("reconciles rows when the terminal progress poll is unavailable", () => {
    const initial = createInitialAnalysisProgress(
      [track("ready", "Ready"), track("partial", "Partial")],
      new Set(["ready", "partial"]),
    );

    const reconciled = reconcileAnalysisProgressRows(initial, {
      attemptedTrackIds: new Set(["ready", "partial"]),
      readyTrackIds: new Set(["ready"]),
    });

    expect(reconciled.tracks?.map(({ phase }) => phase)).toEqual(["done", "incomplete"]);
    expect(reconciled.tracks?.[1]?.message).toMatch(/retry analysis/i);
  });
});
