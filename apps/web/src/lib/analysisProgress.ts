import type {
  AnalysisPhase,
  AnalysisPipelineProgressProps,
  AnalysisPipelineStage,
  AnalysisStageState as ViewStageState,
  AnalysisTrackProgress,
} from "../components/AnalysisPipelineProgress";
import type {
  AnalysisProgressPhase,
  AnalysisProgressStageSnapshot,
  AnalysisProgressTrackSnapshot,
  AudioFeatureProgressSnapshot,
  Track,
} from "./types";

export type AnalysisProgressView = AnalysisPipelineProgressProps;

const waitingStages = (): AnalysisPipelineStage[] => [
  { id: "decode", label: "Decode + native DSP", state: "waiting" },
  { id: "tensorflow", label: "TensorFlow moods", state: "waiting" },
];

function viewPhase(phase: AnalysisProgressPhase): AnalysisPhase {
  switch (phase) {
    case "queued":
      return "waiting";
    case "preparing":
      return "decoding";
    case "native_dsp":
      return "dsp";
    case "tensorflow":
      return "tensorflow";
    case "finalizing":
      return "finalizing";
    case "complete":
      return "done";
    case "error":
      return "error";
  }
}

function viewStageState(
  stage: AnalysisProgressStageSnapshot,
): ViewStageState {
  switch (stage.state) {
    case "pending":
      return "waiting";
    case "active":
      return "active";
    case "complete":
      return "done";
    case "skipped":
      return "skipped";
    case "error":
      return "error";
  }
}

function viewStages(track?: AnalysisProgressTrackSnapshot): AnalysisPipelineStage[] {
  if (!track) return waitingStages();
  return [
    {
      id: "decode",
      label: "Decode + native DSP",
      state: viewStageState(track.stages.native_dsp),
    },
    {
      id: "tensorflow",
      label: "TensorFlow moods",
      state: viewStageState(track.stages.tensorflow),
    },
  ];
}

function trackIssueMessage(track: AnalysisProgressTrackSnapshot): string | null {
  if (track.error) return track.error;
  if (track.stages.native_dsp.error) return track.stages.native_dsp.error;
  if (track.stages.tensorflow.error) return track.stages.tensorflow.error;
  if (track.stages.tensorflow.state === "error") {
    return "TensorFlow mood analysis failed.";
  }
  if (track.stages.tensorflow.state === "skipped") {
    return "TensorFlow mood analysis was skipped.";
  }
  return null;
}

function trackPhase(track: AnalysisProgressTrackSnapshot): AnalysisPhase {
  if (track.status === "error" || track.status === "unavailable") return "error";
  if (track.stages.native_dsp.state === "error") return "error";
  if (
    track.stages.tensorflow.state === "error"
    || track.stages.tensorflow.state === "skipped"
  ) {
    return "incomplete";
  }
  if (track.status === "complete") {
    return track.stages.native_dsp.state === "complete"
      && track.stages.tensorflow.state === "complete"
      ? "done"
      : "incomplete";
  }
  if (track.status === "pending") return "waiting";
  if (track.stages.tensorflow.state === "active") return "tensorflow";
  if (track.stages.native_dsp.state === "active") return "dsp";
  return "decoding";
}

function isTerminalTrackPhase(phase: AnalysisPhase): boolean {
  return phase === "done"
    || phase === "cached"
    || phase === "incomplete"
    || phase === "error";
}

function trackCounts(tracks: readonly AnalysisTrackProgress[]) {
  const completed = tracks.filter(({ phase }) => isTerminalTrackPhase(phase)).length;
  const successful = tracks.filter(
    ({ phase }) => phase === "done" || phase === "cached",
  ).length;
  const failed = tracks.filter(
    ({ phase }) => phase === "incomplete" || phase === "error",
  ).length;
  return { completed, successful, failed };
}

function lastIssueTrack(
  tracks: readonly AnalysisProgressTrackSnapshot[],
): AnalysisProgressTrackSnapshot | undefined {
  const reversed = [...tracks].reverse();
  return reversed.find(
    (track) =>
      track.stages.native_dsp.state === "error"
      || track.stages.tensorflow.state === "error",
  ) ?? reversed.find((track) => {
    const phase = trackPhase(track);
    return phase === "incomplete" || phase === "error";
  });
}

function lastProgressedTrack(
  tracks: readonly AnalysisProgressTrackSnapshot[],
): AnalysisProgressTrackSnapshot | undefined {
  for (let index = tracks.length - 1; index >= 0; index -= 1) {
    if (tracks[index]?.status !== "pending") return tracks[index];
  }
  return undefined;
}

export function createAnalysisProgressToken(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `analysis-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createInitialAnalysisProgress(
  tracks: readonly Track[],
  pendingTrackIds: ReadonlySet<string>,
): AnalysisProgressView {
  const cachedCount = tracks.length - pendingTrackIds.size;
  const allCached = pendingTrackIds.size === 0;
  return {
    completed: cachedCount,
    successful: cachedCount,
    failed: 0,
    total: tracks.length,
    progressFraction: tracks.length > 0 ? cachedCount / tracks.length : 0,
    phase: allCached ? "cached" : "waiting",
    stages: waitingStages().map((stage) => ({
      ...stage,
      state: allCached ? "cached" : "waiting",
    })),
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      artist: track.artist,
      phase: pendingTrackIds.has(track.id) ? "waiting" : "cached",
      analysisSeconds: pendingTrackIds.has(track.id) ? null : 0,
    })),
  };
}

export function mergeAnalysisBatchProgress({
  current,
  snapshot,
  completedBeforeBatch,
  successfulBeforeBatch,
  failedBeforeBatch,
  elapsedBeforeBatch,
}: {
  current: AnalysisProgressView;
  snapshot: AudioFeatureProgressSnapshot;
  completedBeforeBatch: number;
  successfulBeforeBatch: number;
  failedBeforeBatch: number;
  elapsedBeforeBatch: number;
}): AnalysisProgressView {
  const rows = new Map(current.tracks?.map((track) => [track.id, track]) ?? []);
  for (const track of snapshot.tracks) {
    const previous = rows.get(track.track_id);
    rows.set(track.track_id, {
      id: track.track_id,
      name: track.track_name,
      artist: previous?.artist,
      phase: trackPhase(track),
      analysisSeconds: track.elapsed_seconds,
      message: trackIssueMessage(track),
    });
  }

  const currentTrack = snapshot.current_track
    ? snapshot.tracks.find(({ track_id }) => track_id === snapshot.current_track?.track_id)
    : undefined;
  const snapshotTerminal = snapshot.phase === "complete" || snapshot.phase === "error";
  const issueTrack = snapshotTerminal ? lastIssueTrack(snapshot.tracks) : undefined;
  const stageTrack = currentTrack ?? issueTrack ?? lastProgressedTrack(snapshot.tracks);
  const updatedTracks = [...rows.values()];
  const derivedCounts = trackCounts(updatedTracks);
  const hasCompleteTrackList = updatedTracks.length === current.total;
  const completed = hasCompleteTrackList
    ? derivedCounts.completed
    : completedBeforeBatch + snapshot.completed_track_count;
  const successful = hasCompleteTrackList
    ? derivedCounts.successful
    : successfulBeforeBatch + snapshot.successful_track_count;
  const failed = hasCompleteTrackList
    ? derivedCounts.failed
    : failedBeforeBatch + snapshot.failed_track_count;
  const completedTimings = updatedTracks.flatMap((track) =>
    track.phase === "done" && track.analysisSeconds != null && track.analysisSeconds > 0
      ? [track.analysisSeconds]
      : [],
  );
  const averageTrackSeconds = completedTimings.length > 0
    ? completedTimings.reduce((total, value) => total + value, 0) / completedTimings.length
    : null;
  const futureTrackCount = Math.max(
    0,
    current.total - completedBeforeBatch - snapshot.total_track_count,
  );
  const futureEstimate = averageTrackSeconds == null
    ? 0
    : averageTrackSeconds * futureTrackCount;
  const batchEstimate = snapshot.estimated_remaining_seconds;
  const backendPhase = viewPhase(snapshot.phase);
  const phase = backendPhase === "done" && failed > 0
    ? successful > 0 || updatedTracks.some(({ phase }) => phase === "incomplete")
      ? "incomplete"
      : "error"
    : backendPhase;
  const issueMessage = issueTrack ? trackIssueMessage(issueTrack) : null;

  return {
    completed,
    successful,
    failed,
    total: current.total,
    progressFraction: current.total > 0
      ? (
          completedBeforeBatch
          + snapshot.progress_fraction * snapshot.total_track_count
        ) / current.total
      : 0,
    currentTrackName: snapshot.current_track?.track_name,
    currentTrackDurationSeconds: snapshot.current_track
      ? snapshot.current_track.duration_ms / 1000
      : null,
    currentTrackElapsedSeconds: currentTrack?.elapsed_seconds,
    elapsedSeconds: elapsedBeforeBatch + snapshot.elapsed_seconds,
    phase,
    stages: viewStages(stageTrack),
    estimatedRemainingSeconds: batchEstimate == null && averageTrackSeconds == null
      ? null
      : (batchEstimate ?? 0) + futureEstimate,
    tracks: updatedTracks,
    errorMessage: snapshot.error ?? issueMessage,
    initiallyExpanded: current.initiallyExpanded,
  };
}

export function completeAnalysisProgress(
  current: AnalysisProgressView,
  { successful, failed, elapsedSeconds }: {
    successful: number;
    failed: number;
    elapsedSeconds: number;
  },
): AnalysisProgressView {
  const rows = current.tracks ?? [];
  const derivedCounts = trackCounts(rows);
  const rowsAreTerminal = rows.length === current.total
    && derivedCounts.completed === current.total;
  const reconciledFailed = rowsAreTerminal
    ? derivedCounts.failed
    : Math.max(failed, derivedCounts.failed);
  const reconciledSuccessful = rowsAreTerminal
    ? derivedCounts.successful
    : Math.min(successful, Math.max(0, current.total - reconciledFailed));
  const hasIncompleteRow = rows.some(({ phase }) => phase === "incomplete");
  const terminalPhase: AnalysisPhase = current.phase === "error"
    ? "error"
    : reconciledFailed === 0
      ? "done"
      : hasIncompleteRow || reconciledSuccessful > 0
        ? "incomplete"
        : "error";
  const issueMessage = rows.find(
    ({ phase, message }) =>
      (phase === "incomplete" || phase === "error") && Boolean(message),
  )?.message ?? null;

  return {
    ...current,
    completed: Math.min(current.total, reconciledSuccessful + reconciledFailed),
    successful: reconciledSuccessful,
    failed: reconciledFailed,
    progressFraction: 1,
    phase: terminalPhase,
    currentTrackName: null,
    currentTrackDurationSeconds: null,
    currentTrackElapsedSeconds: null,
    elapsedSeconds,
    estimatedRemainingSeconds: 0,
    errorMessage: terminalPhase === "done"
      ? null
      : current.errorMessage ?? issueMessage,
  };
}

export function reconcileAnalysisProgressRows(
  current: AnalysisProgressView,
  {
    attemptedTrackIds,
    readyTrackIds,
  }: {
    attemptedTrackIds: ReadonlySet<string>;
    readyTrackIds: ReadonlySet<string>;
  },
): AnalysisProgressView {
  return {
    ...current,
    tracks: current.tracks?.map((track) => {
      if (!attemptedTrackIds.has(track.id)) return track;
      if (track.phase === "error" || track.phase === "incomplete") return track;
      if (readyTrackIds.has(track.id)) return { ...track, phase: "done" };
      return {
        ...track,
        phase: "incomplete",
        message: track.message
          ?? "TensorFlow mood measurements are incomplete; retry analysis.",
      };
    }),
  };
}
