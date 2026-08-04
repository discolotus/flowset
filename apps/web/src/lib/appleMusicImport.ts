import { orderedTrackExportEntries } from "./orderedTrackExport";
import type { RecipeOutput } from "./types";

export interface AppleMusicPlaylistRequest {
  name: string;
  trackPaths: string[];
}

export interface AppleMusicImportRequest {
  folderName: string;
  playlists: AppleMusicPlaylistRequest[];
}

export interface AppleMusicPlaylistPlan {
  index: number;
  name: string;
  trackCount: number;
  validTrackCount: number;
  errors: string[];
}

export interface AppleMusicImportPlan {
  dryRun: true;
  ready: boolean;
  requestedFolderName: string;
  playlistCount: number;
  totalTrackCount: number;
  playlists: AppleMusicPlaylistPlan[];
  errors: string[];
  messages: string[];
}

export interface AppleMusicPlaylistImportResult {
  index: number;
  requestedName: string;
  createdName: string;
  requestedCount: number;
  addedCount: number;
  failedCount: number;
  orderVerified: boolean;
  messages: string[];
}

export interface AppleMusicImportReport {
  dryRun: false;
  requestedFolderName: string;
  createdFolderName: string;
  playlistCount: number;
  totalTrackCount: number;
  addedCount: number;
  failedCount: number;
  allOrdersVerified: boolean;
  playlists: AppleMusicPlaylistImportResult[];
  messages: string[];
}

type NativeInvoke = <T>(
  command: string,
  args: { request: AppleMusicImportRequest },
) => Promise<T>;

export function buildAppleMusicImportRequest({
  folderName,
  outputs,
  localAudioPaths,
  libraryRootPath,
}: {
  folderName: string;
  outputs: readonly RecipeOutput[];
  localAudioPaths: Readonly<Record<string, string>>;
  libraryRootPath?: string | null;
}): AppleMusicImportRequest {
  if (outputs.length === 0) throw new Error("There are no playlists to import.");
  const missing: string[] = [];
  const playlists = outputs.map((output) => ({
    name: output.name,
    trackPaths: orderedTrackExportEntries(
      output,
      localAudioPaths,
      libraryRootPath,
    ).flatMap((entry) => {
      if (entry.location.localPath) return [entry.location.localPath];
      missing.push(`${output.name} #${entry.position}: ${entry.track.artist} — ${entry.track.name}`);
      return [];
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
    folderName: folderName.trim() || "Flowset playlists",
    playlists,
  };
}

export async function planAppleMusicImportWith(
  request: AppleMusicImportRequest,
  invoke: NativeInvoke,
): Promise<AppleMusicImportPlan> {
  return invoke<AppleMusicImportPlan>("plan_apple_music_import", { request });
}

export async function runAppleMusicImportWith(
  request: AppleMusicImportRequest,
  invoke: NativeInvoke,
): Promise<AppleMusicImportReport> {
  return invoke<AppleMusicImportReport>("import_apple_music_playlists", { request });
}

export async function planAppleMusicImport(
  request: AppleMusicImportRequest,
): Promise<AppleMusicImportPlan> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("Direct Apple Music import is available in the Mac app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return planAppleMusicImportWith(request, invoke);
}

export async function runAppleMusicImport(
  request: AppleMusicImportRequest,
): Promise<AppleMusicImportReport> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("Direct Apple Music import is available in the Mac app.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return runAppleMusicImportWith(request, invoke);
}
