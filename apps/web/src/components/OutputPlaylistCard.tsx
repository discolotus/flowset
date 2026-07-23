import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { camelot, duration, runtime } from "../lib/format";
import {
  formatParameterValue,
  numericTrackValue,
  NUMERIC_PARAMETERS,
  parameterLabel,
  parameterShortLabel,
} from "../lib/parameters";
import type { PlaylistExportResult } from "../lib/playlistExport";
import type { RowDensity } from "../lib/rowDensity";
import type {
  NumericParameter,
  RecipeOutput,
  SortDirection,
  SortParameter,
  Track,
  TrackGroup,
} from "../lib/types";

interface OutputPlaylistCardProps {
  output: RecipeOutput;
  outputIndex: number;
  splitParameters: NumericParameter[];
  subgroupParameter: NumericParameter | null;
  sortParameter: SortParameter | null;
  sortDirection: SortDirection;
  onExport: (output: RecipeOutput) => Promise<PlaylistExportResult | void>;
  previewUrlForTrack?: (track: Track) => string | null | undefined;
  exportDisabled?: boolean;
  rowDensity?: RowDensity;
}

type AudioPreviewStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface AudioPreviewSnapshot {
  trackId: string | null;
  status: AudioPreviewStatus;
  message: string | null;
}

const IDLE_AUDIO_PREVIEW: AudioPreviewSnapshot = {
  trackId: null,
  status: "idle",
  message: null,
};

let audioPreviewSnapshot = IDLE_AUDIO_PREVIEW;
let activeAudio: HTMLAudioElement | null = null;
let activeAudioToken = 0;
const audioPreviewListeners = new Set<() => void>();

function publishAudioPreview(snapshot: AudioPreviewSnapshot) {
  audioPreviewSnapshot = snapshot;
  audioPreviewListeners.forEach((listener) => listener());
}

function subscribeToAudioPreview(listener: () => void) {
  audioPreviewListeners.add(listener);
  return () => audioPreviewListeners.delete(listener);
}

function audioPreviewError(audio: HTMLAudioElement) {
  return audio.error?.message || "This audio file could not be played.";
}

function stopAudioPreview() {
  activeAudioToken += 1;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.removeAttribute("src");
    activeAudio.load();
    activeAudio = null;
  }
  publishAudioPreview(IDLE_AUDIO_PREVIEW);
}

function startAudioPreview(trackId: string, url: string) {
  const token = activeAudioToken + 1;
  activeAudioToken = token;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.removeAttribute("src");
    activeAudio.load();
    activeAudio = null;
  }

  let audio: HTMLAudioElement;
  try {
    audio = new Audio();
    audio.preload = "none";
    audio.src = url;
  } catch {
    publishAudioPreview({
      trackId,
      status: "error",
      message: "Audio preview is not available in this window.",
    });
    return;
  }

  activeAudio = audio;
  const publishForActiveAudio = (status: AudioPreviewStatus, message: string | null = null) => {
    if (activeAudio === audio && activeAudioToken === token) {
      publishAudioPreview({ trackId, status, message });
    }
  };

  audio.addEventListener("playing", () => publishForActiveAudio("playing"));
  audio.addEventListener("waiting", () => publishForActiveAudio("loading"));
  audio.addEventListener("stalled", () => publishForActiveAudio("loading"));
  audio.addEventListener("ended", () => {
    if (activeAudio === audio && activeAudioToken === token) {
      activeAudio = null;
      publishAudioPreview(IDLE_AUDIO_PREVIEW);
    }
  });
  audio.addEventListener("error", () => {
    publishForActiveAudio("error", audioPreviewError(audio));
  });

  publishForActiveAudio("loading");
  void audio.play().catch((reason: unknown) => {
    publishForActiveAudio(
      "error",
      reason instanceof Error && reason.message
        ? reason.message
        : "This audio file could not be played.",
    );
  });
}

function toggleAudioPreview(trackId: string, url: string) {
  const isActiveTrack = audioPreviewSnapshot.trackId === trackId;
  if (isActiveTrack && audioPreviewSnapshot.status === "playing" && activeAudio) {
    activeAudio.pause();
    publishAudioPreview({ trackId, status: "paused", message: null });
    return;
  }
  if (isActiveTrack && audioPreviewSnapshot.status === "loading") {
    stopAudioPreview();
    return;
  }
  if (isActiveTrack && audioPreviewSnapshot.status === "paused" && activeAudio) {
    publishAudioPreview({ trackId, status: "loading", message: null });
    void activeAudio.play().catch((reason: unknown) => {
      publishAudioPreview({
        trackId,
        status: "error",
        message: reason instanceof Error && reason.message
          ? reason.message
          : "This audio file could not be played.",
      });
    });
    return;
  }
  startAudioPreview(trackId, url);
}

function useAudioPreview() {
  return useSyncExternalStore(
    subscribeToAudioPreview,
    () => audioPreviewSnapshot,
    () => IDLE_AUDIO_PREVIEW,
  );
}

function coverTone(id: string): string {
  const seed = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const hue = 72 + (seed % 64);
  return `linear-gradient(145deg, hsl(${hue} 24% 42%), hsl(${hue + 28} 18% 15%))`;
}

function playlistRuntime(tracks: Track[]) {
  return runtime(tracks.reduce((sum, track) => sum + track.duration_ms, 0));
}

function metric(track: Track, parameter: NumericParameter) {
  return formatParameterValue(numericTrackValue(track, parameter), parameter);
}

function TrackRow({
  track,
  position,
  distributionParameter,
  subgroupParameter,
  inspectedParameter,
  previewUrl,
}: {
  track: Track;
  position: number;
  distributionParameter: NumericParameter;
  subgroupParameter: NumericParameter | null;
  inspectedParameter: NumericParameter;
  previewUrl?: string | null;
}) {
  const audioPreview = useAudioPreview();
  const previewIsActive = audioPreview.trackId === track.id;
  const previewStatus = previewIsActive ? audioPreview.status : "idle";
  const previewStatusId = `${track.id}-preview-status`;
  const previewLabel = previewStatus === "playing"
    ? `Pause preview of ${track.name} by ${track.artist}`
    : previewStatus === "paused"
      ? `Resume preview of ${track.name} by ${track.artist}`
      : previewStatus === "loading"
        ? `Cancel loading preview of ${track.name} by ${track.artist}`
        : previewStatus === "error"
          ? `Retry preview of ${track.name} by ${track.artist}`
          : `Play preview of ${track.name} by ${track.artist}`;
  return (
    <li className="track-row">
      <span
        className={`track-position-slot${previewUrl ? " has-preview" : ""}${previewIsActive ? " active" : ""}`}
      >
        <span className="track-position">{String(position).padStart(2, "0")}</span>
        {previewUrl && (
          <button
            type="button"
            className={`track-preview-button ${previewStatus}`}
            aria-label={previewLabel}
            aria-busy={previewStatus === "loading" || undefined}
            aria-describedby={previewStatus === "error" ? previewStatusId : undefined}
            title={previewLabel}
            onClick={() => toggleAudioPreview(track.id, previewUrl)}
          >
            {previewStatus === "loading" ? (
              <span className="track-preview-spinner" aria-hidden="true" />
            ) : previewStatus === "playing" ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4.25 3.25h2.5v9.5h-2.5zm5 0h2.5v9.5h-2.5z" />
              </svg>
            ) : previewStatus === "error" ? (
              <span className="track-preview-error" aria-hidden="true">!</span>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m5 3 7 5-7 5z" />
              </svg>
            )}
          </button>
        )}
        {previewStatus === "error" && (
          <span id={previewStatusId} className="sr-only" role="alert">
            Preview failed for {track.name}. {audioPreview.message}
          </span>
        )}
      </span>
      <span
        className="track-cover"
        style={{ background: coverTone(track.id) }}
        aria-hidden="true"
      >
        {track.name.slice(0, 1)}
      </span>
      <span className="track-details">
        <span className="track-title-line">
          <span className="track-title">{track.name}</span>
          {track.explicit && <span className="explicit-mark">E</span>}
        </span>
        <span className="track-byline">
          {track.artist} · {track.album}
        </span>
      </span>
      <span className="track-metric hidden sm:block">
        <small>{parameterShortLabel(distributionParameter)}</small>
        {metric(track, distributionParameter)}
      </span>
      {subgroupParameter && subgroupParameter !== distributionParameter && (
        <span className="track-metric hidden lg:block">
          <small>{parameterShortLabel(subgroupParameter)}</small>
          {metric(track, subgroupParameter)}
        </span>
      )}
      <span className="track-metric">
        <small>{parameterShortLabel(inspectedParameter)}</small>
        {metric(track, inspectedParameter)}
      </span>
      <span className="track-metric hidden md:block">
        <small>Key</small>
        {camelot(track)}
      </span>
      <span className="track-duration">{duration(track.duration_ms)}</span>
    </li>
  );
}

function GroupSection({
  group,
  startPosition,
  distributionParameter,
  subgroupParameter,
  sortParameter,
  sortDirection,
  inspectedParameter,
  previewUrlForTrack,
}: {
  group: TrackGroup;
  startPosition: number;
  distributionParameter: NumericParameter;
  subgroupParameter: NumericParameter | null;
  sortParameter: SortParameter | null;
  sortDirection: SortDirection;
  inspectedParameter: NumericParameter;
  previewUrlForTrack?: (track: Track) => string | null | undefined;
}) {
  const rangeText = group.range && subgroupParameter
    ? `${formatParameterValue(group.range.minimum, subgroupParameter)}–${formatParameterValue(group.range.maximum, subgroupParameter)}`
    : null;
  return (
    <section className="group-section" aria-labelledby={`${group.id}-heading`}>
      <header className="group-header">
        <div>
          <p id={`${group.id}-heading`} className="font-display text-sm font-semibold text-white/85">
            {group.label}
          </p>
          <p className="mt-1 text-[11px] text-mist/50">
            {group.track_count} {group.track_count === 1 ? "track" : "tracks"}
            {rangeText ? ` · ${rangeText}` : ""}
          </p>
        </div>
        {sortParameter && (
          <span className="sort-note">
            {parameterLabel(sortParameter)} {sortDirection === "ascending" ? "↑" : "↓"}
          </span>
        )}
      </header>
      <ol className="divide-y divide-line/70">
        {group.tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            position={startPosition + index}
            distributionParameter={distributionParameter}
            subgroupParameter={subgroupParameter}
            inspectedParameter={inspectedParameter}
            previewUrl={previewUrlForTrack?.(track)}
          />
        ))}
      </ol>
    </section>
  );
}

export function OutputPlaylistCard({
  output,
  outputIndex,
  splitParameters,
  subgroupParameter,
  sortParameter,
  sortDirection,
  onExport,
  previewUrlForTrack,
  exportDisabled = false,
  rowDensity = "comfortable",
}: OutputPlaylistCardProps) {
  const [exportState, setExportState] = useState<
    | { status: "idle" }
    | { status: "saving" }
    | { status: "saved"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [inspectedParameter, setInspectedParameter] =
    useState<NumericParameter>(() => {
      const numericSort = NUMERIC_PARAMETERS.find(({ value }) => value === sortParameter)?.value;
      if (
        numericSort &&
        output.tracks.some((track) => numericTrackValue(track, numericSort) != null)
      ) {
        return numericSort;
      }
      return NUMERIC_PARAMETERS.find(({ value }) =>
        output.tracks.some((track) => numericTrackValue(track, value) != null)
      )?.value ?? "energy";
    });
  const groups = output.groups.length
    ? output.groups
    : [{
        id: `${output.id}-all`,
        label: "All tracks",
        parameter: null,
        bin_index: null,
        range: null,
        start_index: 0,
        end_index_exclusive: output.tracks.length,
        track_count: output.tracks.length,
        tracks: output.tracks,
      }];
  const inspectedValueCount = useMemo(
    () => output.tracks.reduce(
      (count, track) => count + (numericTrackValue(track, inspectedParameter) == null ? 0 : 1),
      0,
    ),
    [inspectedParameter, output.tracks],
  );
  const outputTrackIds = useMemo(
    () => new Set(output.tracks.map((track) => track.id)),
    [output.tracks],
  );
  useEffect(
    () => () => {
      if (audioPreviewSnapshot.trackId && outputTrackIds.has(audioPreviewSnapshot.trackId)) {
        stopAudioPreview();
      }
    },
    [outputTrackIds],
  );
  let runningPosition = 1;

  const exportPlaylist = async () => {
    if (exportDisabled) return;
    setExportState({ status: "saving" });
    try {
      const result = await onExport(output);
      if (!result || result.cancelled) {
        setExportState({ status: "idle" });
        return;
      }
      setExportState({
        status: "saved",
        message: `Saved ${result.trackCount} tracks to ${result.path ?? "an M3U8 playlist"}`,
      });
    } catch (reason: unknown) {
      setExportState({
        status: "error",
        message: reason instanceof Error ? reason.message : "Could not export this playlist.",
      });
    }
  };

  return (
    <article className={`output-playlist row-density-${rowDensity}`} data-density={rowDensity}>
      <header className="output-header">
        <div className="flex min-w-0 items-start gap-4">
          <span className="output-number">{String(outputIndex + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <p className="eyebrow">Basis playlist</p>
            <h3 className="mt-1 text-pretty font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {output.name}
            </h3>
            <p className="mt-2 text-xs text-mist/55">
              {output.track_count} tracks · {playlistRuntime(output.tracks)}
              {splitParameters.length
                ? ` · split by ${splitParameters.map(parameterLabel).join(" × ").toLowerCase()}`
                : ""}
            </p>
            {output.split_assignments.length > 0 && (
              <div className="factor-assignment-list" aria-label="Factor grid assignment">
                {output.split_assignments.map((assignment) => (
                  <span key={`${assignment.parameter}-${assignment.bin_index ?? "unavailable"}`}>
                    {assignment.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="output-actions">
          <label className="metric-inspector">
            <span>
              Inspect metric
              <small>{inspectedValueCount}/{output.track_count} available</small>
            </span>
            <select
              value={inspectedParameter}
              onChange={(event) => setInspectedParameter(event.target.value as NumericParameter)}
              aria-label={`Inspect a metric for ${output.name}`}
            >
              {NUMERIC_PARAMETERS.map((parameter) => (
                <option key={parameter.value} value={parameter.value}>
                  {parameter.label}{parameter.unit ? ` · ${parameter.unit}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="export-button"
            disabled={exportDisabled || exportState.status === "saving"}
            title={exportDisabled
              ? "Wait for the latest playlist preview before exporting"
              : "Save this ordered playlist as an M3U8 file"}
            onClick={exportPlaylist}
          >
            {exportState.status === "saving" ? "Exporting…" : "Export M3U8"}
          </button>
          {exportState.status !== "idle" && exportState.status !== "saving" && (
            <p
              className={`export-feedback ${exportState.status}`}
              role={exportState.status === "error" ? "alert" : "status"}
            >
              {exportState.message}
            </p>
          )}
        </div>
      </header>
      <div className="playlist-body">
        {groups.map((group) => {
          const startPosition = runningPosition;
          runningPosition += group.tracks.length;
          return (
            <GroupSection
              key={group.id}
              group={group}
              startPosition={startPosition}
              distributionParameter={splitParameters[0] ?? subgroupParameter ?? "energy"}
              subgroupParameter={subgroupParameter}
              sortParameter={sortParameter}
              sortDirection={sortDirection}
              inspectedParameter={inspectedParameter}
              previewUrlForTrack={previewUrlForTrack}
            />
          );
        })}
      </div>
    </article>
  );
}
