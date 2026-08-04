import { orderedTrackExportEntries } from "./orderedTrackExport";
import type { RecipeOutput } from "./types";

export type Mp3ExportAction = "copy" | "transcode";

export interface Mp3ExportTrackRequest {
  /** One-based position in this playlist. Repeated source paths remain repeated entries. */
  playlistPosition: number;
  sourcePath: string;
  title: string;
  artist: string;
  album: string;
  groupLabel: string;
}

export interface Mp3ExportPlaylistRequest {
  /** One-based position used for the zero-padded output folder name. */
  playlistPosition: number;
  name: string;
  tracks: Mp3ExportTrackRequest[];
}

export interface Mp3ExportRequest {
  requestId: string;
  exportName: string;
  libraryRoot: string;
  playlists: Mp3ExportPlaylistRequest[];
}

export interface Mp3ExportTrackReport {
  playlistPosition: number;
  sourcePath: string;
  outputPath?: string | null;
  action: Mp3ExportAction;
  status: "copied" | "transcoded" | "failed";
  error?: string | null;
  groupLabel: string;
}

export interface Mp3ExportPlaylistReport {
  name: string;
  directory: string;
  trackCount: number;
  copiedCount: number;
  transcodedCount: number;
  failedCount: number;
  tracks: Mp3ExportTrackReport[];
}

export interface Mp3ExportReport {
  cancelled: boolean;
  directory: string;
  manifestPath: string;
  reportPath: string;
  playlistCount: number;
  trackCount: number;
  copiedCount: number;
  transcodedCount: number;
  failedCount: number;
  /** Optional until the native exporter can cheaply report storage usage. */
  totalBytes?: number;
  playlists: Mp3ExportPlaylistReport[];
  warnings: string[];
}

export interface Mp3ExportProgress {
  requestId: string;
  completed: number;
  total: number;
  currentPlaylist?: string | null;
  currentTrack?: string | null;
  action?: Mp3ExportAction | null;
  phase: string;
}

export interface Mp3ExportEstimate {
  trackCount: number;
  copiedMp3Count: number;
  transcodeCount: number;
  /** 320 kilobits per second, excluding small container overhead. */
  estimatedTranscodeBytes: number;
}

interface FolderDialogOptions {
  directory: true;
  multiple: false;
  title: string;
}

type FolderDialog = (options: FolderDialogOptions) => Promise<string | string[] | null>;
type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type Unlisten = () => void;
type ProgressListener = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<Unlisten>;

export function runForCurrentMp3ExportRevision(
  startedRevision: number,
  currentRevision: number,
  update: () => void,
): boolean {
  if (startedRevision !== currentRevision) return false;
  update();
  return true;
}

function absoluteMacPath(value: string): boolean {
  return value.startsWith("/");
}

function normalizedPathForComparison(value: string): string {
  return value.replace(/\/{2,}/g, "/").replace(/\/$/g, "").toLowerCase();
}

function newRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `mp3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function finiteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isMp3Path(value: string | null): boolean {
  return value ? value.toLowerCase().endsWith(".mp3") : false;
}

export function estimateMp3Export({
  outputs,
  localAudioPaths,
  libraryRootPath,
}: {
  outputs: readonly RecipeOutput[];
  localAudioPaths: Readonly<Record<string, string>>;
  libraryRootPath?: string | null;
}): Mp3ExportEstimate {
  let trackCount = 0;
  let copiedMp3Count = 0;
  let transcodeCount = 0;
  let transcodeDurationMs = 0;
  for (const output of outputs) {
    for (const entry of orderedTrackExportEntries(output, localAudioPaths, libraryRootPath)) {
      trackCount += 1;
      if (isMp3Path(entry.location.localPath)) {
        copiedMp3Count += 1;
      } else {
        transcodeCount += 1;
        transcodeDurationMs += entry.track.duration_ms;
      }
    }
  }
  return {
    trackCount,
    copiedMp3Count,
    transcodeCount,
    estimatedTranscodeBytes: Math.round((transcodeDurationMs / 1_000) * (320_000 / 8)),
  };
}

function progressPayload(value: unknown): Mp3ExportProgress | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Mp3ExportProgress>;
  if (
    typeof candidate.requestId !== "string"
    || !finiteCount(candidate.completed)
    || !finiteCount(candidate.total)
    || typeof candidate.phase !== "string"
  ) return null;
  return candidate as Mp3ExportProgress;
}

export function buildMp3ExportRequest({
  exportName,
  requestId,
  outputs,
  localAudioPaths,
  libraryRootPath,
}: {
  exportName: string;
  requestId?: string;
  outputs: readonly RecipeOutput[];
  localAudioPaths: Readonly<Record<string, string>>;
  libraryRootPath?: string | null;
}): Mp3ExportRequest {
  if (outputs.length === 0) throw new Error("There are no playlists to export.");
  const libraryRoot = libraryRootPath?.trim();
  if (!libraryRoot || !absoluteMacPath(libraryRoot)) {
    throw new Error("Choose a local music library folder before exporting MP3 files.");
  }

  const missing: string[] = [];
  const playlists = outputs.map((output, playlistIndex) => ({
    playlistPosition: playlistIndex + 1,
    name: output.name,
    tracks: orderedTrackExportEntries(output, localAudioPaths, libraryRoot).flatMap((entry) => {
      const sourcePath = entry.location.localPath;
      if (!sourcePath || !absoluteMacPath(sourcePath)) {
        missing.push(
          `${output.name} #${entry.position}: ${entry.track.artist} — ${entry.track.name}`,
        );
        return [];
      }
      return [{
        playlistPosition: entry.position,
        sourcePath,
        title: entry.track.name,
        artist: entry.track.artist,
        album: entry.track.album,
        groupLabel: entry.groupLabel,
      }];
    }),
  }));

  if (missing.length > 0) {
    const preview = missing.slice(0, 3).join("; ");
    const remaining = missing.length > 3 ? `; and ${missing.length - 3} more` : "";
    throw new Error(
      `${missing.length} ${missing.length === 1 ? "track has" : "tracks have"} no absolute local file path: ${preview}${remaining}.`,
    );
  }

  return {
    requestId: requestId ?? newRequestId(),
    exportName: exportName.trim() || "Flowset MP3 export",
    libraryRoot,
    playlists,
  };
}

function confirmedReport(value: unknown): value is Mp3ExportReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<Mp3ExportReport>;
  const countsAreConsistent = finiteCount(report.trackCount)
    && finiteCount(report.copiedCount)
    && finiteCount(report.transcodedCount)
    && finiteCount(report.failedCount)
    && report.copiedCount + report.transcodedCount + report.failedCount === report.trackCount;
  return typeof report.cancelled === "boolean"
    && typeof report.directory === "string"
    && typeof report.manifestPath === "string"
    && typeof report.reportPath === "string"
    && finiteCount(report.playlistCount)
    && countsAreConsistent
    && Array.isArray(report.playlists)
    && Array.isArray(report.warnings);
}

export async function exportMp3FoldersWith({
  request,
  selectDirectory,
  invoke,
  listen,
  onProgress,
}: {
  request: Mp3ExportRequest;
  selectDirectory: FolderDialog;
  invoke: InvokeCommand;
  listen?: ProgressListener;
  onProgress?: (progress: Mp3ExportProgress) => void;
}): Promise<Mp3ExportReport | null> {
  const selectedDirectory = await selectDirectory({
    directory: true,
    multiple: false,
    title: "Choose where to save the ordered MP3 folders",
  });
  if (typeof selectedDirectory !== "string") return null;
  const root = normalizedPathForComparison(request.libraryRoot);
  const destination = normalizedPathForComparison(selectedDirectory);
  if (destination === root || destination.startsWith(`${root}/`)) {
    throw new Error(
      "Choose an export destination outside the selected music library. This prevents exported copies from being analyzed as source tracks.",
    );
  }

  let unlisten: Unlisten | undefined;
  if (listen && onProgress) {
    unlisten = await listen("mp3-export-progress", ({ payload }) => {
      const progress = progressPayload(payload);
      if (progress?.requestId === request.requestId) onProgress(progress);
    });
  }

  try {
    const report = await invoke("export_playlists_as_mp3", {
      directory: selectedDirectory,
      ...request,
    });
    if (!confirmedReport(report)) {
      throw new Error("The Mac app did not return a complete MP3 export report.");
    }
    return report;
  } finally {
    unlisten?.();
  }
}

export async function exportMp3Folders({
  exportName,
  outputs,
  localAudioPaths,
  libraryRootPath,
  nativeApp,
  onProgress,
}: {
  exportName: string;
  outputs: readonly RecipeOutput[];
  localAudioPaths: Readonly<Record<string, string>>;
  libraryRootPath?: string | null;
  nativeApp: boolean;
  onProgress?: (progress: Mp3ExportProgress) => void;
}): Promise<Mp3ExportReport | null> {
  if (!nativeApp) {
    throw new Error("MP3 folder export requires the Mac desktop app.");
  }
  const request = buildMp3ExportRequest({
    exportName,
    outputs,
    localAudioPaths,
    libraryRootPath,
  });
  const [{ open }, { invoke }, { listen }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return exportMp3FoldersWith({
    request,
    selectDirectory: (options) => open(options),
    invoke,
    listen,
    onProgress,
  });
}
