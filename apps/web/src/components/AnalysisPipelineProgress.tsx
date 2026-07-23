import { useId, useState } from "react";

export type AnalysisPhase =
  | "waiting"
  | "decoding"
  | "dsp"
  | "tensorflow"
  | "finalizing"
  | "done"
  | "cached"
  | "incomplete"
  | "error";

export type AnalysisStageId = "decode" | "beat" | "key" | "spectral" | "tensorflow";
export type AnalysisStageState =
  | "waiting"
  | "active"
  | "done"
  | "cached"
  | "skipped"
  | "error";

export interface AnalysisPipelineStage {
  id: AnalysisStageId;
  state: AnalysisStageState;
  label?: string;
}

export interface AnalysisTrackProgress {
  id: string;
  name: string;
  artist?: string | null;
  phase: AnalysisPhase;
  analysisSeconds?: number | null;
  message?: string | null;
}

export interface AnalysisPipelineProgressProps {
  completed: number;
  successful?: number;
  failed?: number;
  total: number;
  progressFraction?: number;
  currentTrackName?: string | null;
  currentTrackDurationSeconds?: number | null;
  currentTrackElapsedSeconds?: number | null;
  elapsedSeconds?: number | null;
  phase: AnalysisPhase;
  stages: readonly AnalysisPipelineStage[];
  estimatedRemainingSeconds?: number | null;
  tracks?: readonly AnalysisTrackProgress[];
  errorMessage?: string | null;
  initiallyExpanded?: boolean;
}

const PHASE_LABELS: Record<AnalysisPhase, string> = {
  waiting: "Waiting",
  decoding: "Decoding audio",
  dsp: "Native audio + DSP",
  tensorflow: "TensorFlow moods",
  finalizing: "Saving to cache",
  done: "Analysis complete",
  cached: "Already analyzed",
  incomplete: "Analysis incomplete",
  error: "Analysis error",
};

const STAGE_LABELS: Record<AnalysisStageId, string> = {
  decode: "Decode",
  beat: "Beat",
  key: "Key",
  spectral: "Spectral",
  tensorflow: "TensorFlow moods",
};

const STAGE_STATE_LABELS: Record<AnalysisStageState, string> = {
  waiting: "Waiting",
  active: "In progress",
  done: "Done",
  cached: "Already complete",
  skipped: "Skipped",
  error: "Error",
};

function safeSeconds(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

function clockTime(value: number | null | undefined) {
  const seconds = safeSeconds(value);
  if (seconds == null) return null;
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function elapsedTime(value: number | null | undefined) {
  const seconds = safeSeconds(value);
  if (seconds == null) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}

function remainingTime(value: number | null | undefined) {
  const seconds = safeSeconds(value);
  if (seconds == null) return null;
  if (seconds < 1) return "Less than a second remaining";
  if (seconds < 60) return `About ${Math.ceil(seconds)}s remaining`;
  const rounded = Math.ceil(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `About ${minutes}m${remainder ? ` ${remainder}s` : ""} remaining`;
}

function stageMark(state: AnalysisStageState, position: number) {
  if (state === "done") return "✓";
  if (state === "cached") return "✓";
  if (state === "skipped") return "—";
  if (state === "error") return "!";
  return String(position + 1).padStart(2, "0");
}

export function AnalysisPipelineProgress({
  completed,
  successful,
  failed = 0,
  total,
  progressFraction,
  currentTrackName,
  currentTrackDurationSeconds,
  currentTrackElapsedSeconds,
  elapsedSeconds,
  phase,
  stages,
  estimatedRemainingSeconds,
  tracks = [],
  errorMessage,
  initiallyExpanded = false,
}: AnalysisPipelineProgressProps) {
  const headingId = useId();
  const [tracksExpanded, setTracksExpanded] = useState(initiallyExpanded);
  const normalizedTotal = Math.max(0, Math.floor(total));
  const normalizedCompleted = Math.min(
    normalizedTotal,
    Math.max(0, Math.floor(completed)),
  );
  const normalizedProgressFraction = progressFraction == null
    ? normalizedTotal > 0 ? normalizedCompleted / normalizedTotal : 0
    : Math.min(1, Math.max(0, progressFraction));
  const percentage = normalizedTotal > 0
    ? Math.round(normalizedProgressFraction * 100)
    : 0;
  const normalizedSuccessful = Math.min(
    normalizedTotal,
    Math.max(0, Math.floor(successful ?? normalizedCompleted - failed)),
  );
  const normalizedFailed = Math.min(
    normalizedTotal,
    Math.max(0, Math.floor(failed)),
  );
  const progressText = normalizedTotal > 0
    ? `${normalizedCompleted} of ${normalizedTotal} tracks processed`
    : "No tracks queued";
  const phaseLabel = PHASE_LABELS[phase];
  const currentDuration = clockTime(currentTrackDurationSeconds);
  const eta = remainingTime(estimatedRemainingSeconds);
  const isBusy = phase === "decoding"
    || phase === "dsp"
    || phase === "tensorflow"
    || phase === "finalizing";
  const title = phase === "done"
    ? "Analysis complete"
    : phase === "cached"
      ? "Everything is already analyzed"
      : phase === "incomplete"
        ? "Analysis finished with issues"
        : phase === "error"
          ? "Analysis needs attention"
          : "Analyzing your library";
  const idleTrackLabel = phase === "done"
    ? "All tracks are ready"
    : phase === "cached"
      ? "No analysis needed"
      : phase === "incomplete" || phase === "error"
        ? normalizedFailed > 0
          ? `${normalizedFailed} ${normalizedFailed === 1 ? "track needs" : "tracks need"} attention`
          : "Analysis needs attention"
        : phase === "finalizing"
          ? "Saving completed measurements"
          : "Waiting for a track";
  const liveStatus = [
    progressText,
    phaseLabel,
    currentTrackName ? `Current track: ${currentTrackName}` : null,
  ].filter(Boolean).join(". ");

  return (
    <section
      className="analysis-pipeline"
      aria-labelledby={headingId}
      aria-busy={isBusy}
    >
      <header className="analysis-pipeline-header">
        <div className="min-w-0">
          <p className="eyebrow">Essentia analysis</p>
          <h3 id={headingId} className="analysis-pipeline-title">
            {title}
          </h3>
        </div>
        <div className="analysis-progress-count" aria-hidden="true">
          <strong>{normalizedCompleted}</strong>
          <span>/ {normalizedTotal}</span>
        </div>
      </header>

      <div className="analysis-progress-summary">
        <div className="analysis-progress-copy">
          <span>{progressText}</span>
          <span>
            {percentage}% · {normalizedSuccessful} ready
            {normalizedFailed > 0
              ? ` · ${normalizedFailed} ${normalizedFailed === 1 ? "track needs" : "tracks need"} attention`
              : ""}
          </span>
        </div>
        <progress
          className="analysis-progress-bar"
          value={normalizedProgressFraction}
          max={1}
          aria-label="Overall audio analysis progress"
          aria-valuetext={progressText}
        />
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {liveStatus}
      </p>

      <div className="analysis-current-track">
        <div className="min-w-0">
          <span className={`analysis-phase ${phase}`}>
            <span aria-hidden="true" />
            {phaseLabel}
          </span>
          <p className="analysis-current-name">
            {currentTrackName ?? idleTrackLabel}
          </p>
          {(phase === "error" || phase === "incomplete") && (
            <p
              className={`analysis-error-message ${phase}`}
              role={phase === "error" ? "alert" : "status"}
            >
              {errorMessage ?? (phase === "incomplete"
                ? "Some requested measurements are unavailable."
                : "Analysis could not continue.")}
            </p>
          )}
        </div>
        <dl className="analysis-current-timing">
          {currentDuration && (
            <div>
              <dt>Track</dt>
              <dd>{currentDuration}</dd>
            </div>
          )}
          {elapsedSeconds != null && (
            <div>
              <dt>Total elapsed</dt>
              <dd>{elapsedTime(elapsedSeconds)}</dd>
            </div>
          )}
          {currentTrackElapsedSeconds != null && (
            <div>
              <dt>On track</dt>
              <dd>{elapsedTime(currentTrackElapsedSeconds)}</dd>
            </div>
          )}
          {eta
            && phase !== "done"
            && phase !== "cached"
            && phase !== "incomplete"
            && phase !== "error" && (
            <div className="analysis-eta">
              <dt>Estimate</dt>
              <dd>{eta}</dd>
            </div>
          )}
        </dl>
      </div>

      <ol className="analysis-stage-list" aria-label="Analysis stages">
        {stages.map((stage, index) => (
          <li
            key={stage.id}
            className="analysis-stage"
            data-state={stage.state}
            aria-current={stage.state === "active" ? "step" : undefined}
          >
            <span className="analysis-stage-mark" aria-hidden="true">
              {stageMark(stage.state, index)}
            </span>
            <span className="min-w-0">
              <strong>{stage.label ?? STAGE_LABELS[stage.id]}</strong>
              <small>{STAGE_STATE_LABELS[stage.state]}</small>
            </span>
          </li>
        ))}
      </ol>

      {tracks.length > 0 && (
        <details
          className="analysis-track-details"
          open={tracksExpanded}
          onToggle={(event) => setTracksExpanded(event.currentTarget.open)}
        >
          <summary>
            <span>
              Track details
              <small>{tracks.length} {tracks.length === 1 ? "track" : "tracks"}</small>
            </span>
            <span aria-hidden="true">{tracksExpanded ? "Hide" : "Show"}</span>
          </summary>
          {tracksExpanded && (
            <div className="analysis-track-table-wrap">
              <table className="analysis-track-table">
                <caption className="sr-only">Per-track audio analysis progress</caption>
                <thead>
                  <tr>
                    <th scope="col">Track</th>
                    <th scope="col">Status</th>
                    <th scope="col">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {tracks.map((track) => (
                    <tr key={track.id}>
                      <th scope="row">
                        <span>{track.name}</span>
                        {(track.artist || track.message) && (
                          <small>{track.message ?? track.artist}</small>
                        )}
                      </th>
                      <td>
                        <span className={`analysis-track-status ${track.phase}`}>
                          {PHASE_LABELS[track.phase]}
                        </span>
                      </td>
                      <td>{elapsedTime(track.analysisSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
