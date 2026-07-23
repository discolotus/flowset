import type { RecipeOutput } from "./types";
import { orderedTrackExportEntries } from "./orderedTrackExport";

interface SaveDialogOptions {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
  title: string;
}

interface FolderDialogOptions {
  directory: true;
  multiple: false;
  title: string;
}

type SaveDialog = (options: SaveDialogOptions) => Promise<string | null>;
type FolderDialog = (options: FolderDialogOptions) => Promise<string | string[] | null>;
type InvokeCommand = (
  command: string,
  args: { path: string; contents: string },
) => Promise<unknown>;
type InvokeBatchCommand = (
  command: string,
  args: {
    directory: string;
    exports: Array<{ filename: string; contents: string }>;
  },
) => Promise<unknown>;

export interface PlaylistExportResult {
  cancelled: boolean;
  path?: string;
  trackCount: number;
}

export interface PlaylistBatchExportResult {
  cancelled: boolean;
  directory?: string;
  paths: string[];
  playlistCount: number;
  trackCount: number;
}

export interface M3u8BuildResult {
  contents: string;
  missingTrackIds: string[];
  trackCount: number;
}

function cleanMetadata(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function exportFilename(name: string): string {
  const safeName = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return `${safeName || "playlist"}.m3u8`;
}

function withM3u8Extension(path: string): string {
  return path.toLowerCase().endsWith(".m3u8") ? path : `${path}.m3u8`;
}

export function buildM3u8(
  output: RecipeOutput,
  localAudioPaths: Readonly<Record<string, string>>,
  libraryRootPath?: string | null,
): M3u8BuildResult {
  const lines = ["#EXTM3U", `#PLAYLIST:${cleanMetadata(output.name)}`];
  const missingTrackIds: string[] = [];
  let trackCount = 0;
  const entries = orderedTrackExportEntries(output, localAudioPaths, libraryRootPath);
  for (const entry of entries) {
    const { track } = entry;
    if (!entry.location.location) {
      missingTrackIds.push(track.id);
      continue;
    }
    lines.push(`#EXTGRP:${cleanMetadata(entry.groupLabel)}`);
    lines.push(
      `#EXTINF:${Math.round(track.duration_ms / 1000)},${cleanMetadata(track.artist)} - ${cleanMetadata(track.name)}`,
    );
    lines.push(entry.location.location);
    trackCount += 1;
  }

  return {
    contents: `${lines.join("\n")}\n`,
    missingTrackIds,
    trackCount,
  };
}

export async function saveNativeM3u8({
  output,
  localAudioPaths,
  libraryRootPath,
  save,
  invoke,
}: {
  output: RecipeOutput;
  localAudioPaths: Record<string, string>;
  libraryRootPath?: string | null;
  save: SaveDialog;
  invoke: InvokeCommand;
}): Promise<PlaylistExportResult> {
  const playlist = buildM3u8(output, localAudioPaths, libraryRootPath);
  if (playlist.missingTrackIds.length > 0) {
    const count = playlist.missingTrackIds.length;
    throw new Error(
      `${count} ${count === 1 ? "track has" : "tracks have"} no usable local file path or Spotify URI. Nothing was exported.`,
    );
  }

  const selectedPath = await save({
    defaultPath: exportFilename(output.name),
    filters: [{ name: "M3U8 playlist", extensions: ["m3u8"] }],
    title: `Export ${output.name}`,
  });
  if (!selectedPath) {
    return { cancelled: true, trackCount: 0 };
  }

  const path = withM3u8Extension(selectedPath);
  const writtenPath = await invoke("write_playlist_export", {
    path,
    contents: playlist.contents,
  });
  return {
    cancelled: false,
    path: typeof writtenPath === "string" ? writtenPath : path,
    trackCount: playlist.trackCount,
  };
}

export async function saveNativeM3u8Batch({
  outputs,
  localAudioPaths,
  libraryRootPath,
  selectDirectory,
  invoke,
}: {
  outputs: RecipeOutput[];
  localAudioPaths: Record<string, string>;
  libraryRootPath?: string | null;
  selectDirectory: FolderDialog;
  invoke: InvokeBatchCommand;
}): Promise<PlaylistBatchExportResult> {
  if (outputs.length === 0) {
    throw new Error("There are no playlists to export.");
  }
  const playlists = outputs.map((output) => ({
    output,
    playlist: buildM3u8(output, localAudioPaths, libraryRootPath),
  }));
  const missingTrackCount = playlists.reduce(
    (count, item) => count + item.playlist.missingTrackIds.length,
    0,
  );
  if (missingTrackCount > 0) {
    throw new Error(
      `${missingTrackCount} ${missingTrackCount === 1 ? "track has" : "tracks have"} no usable local file path or Spotify URI. Nothing was exported.`,
    );
  }

  const selectedDirectory = await selectDirectory({
    directory: true,
    multiple: false,
    title: `Export ${outputs.length} ${outputs.length === 1 ? "playlist" : "playlists"}`,
  });
  if (!selectedDirectory || Array.isArray(selectedDirectory)) {
    return {
      cancelled: true,
      paths: [],
      playlistCount: 0,
      trackCount: 0,
    };
  }

  const writtenPaths = await invoke("write_playlist_exports", {
    directory: selectedDirectory,
    exports: playlists.map(({ output, playlist }) => ({
      filename: exportFilename(output.name),
      contents: playlist.contents,
    })),
  });
  if (
    !Array.isArray(writtenPaths)
    || writtenPaths.length !== playlists.length
    || writtenPaths.some((path) => typeof path !== "string")
  ) {
    throw new Error(
      `The native app did not confirm all ${playlists.length} playlist exports.`,
    );
  }
  const paths: string[] = writtenPaths;
  return {
    cancelled: false,
    directory: selectedDirectory,
    paths,
    playlistCount: playlists.length,
    trackCount: playlists.reduce((count, item) => count + item.playlist.trackCount, 0),
  };
}

function downloadBrowserM3u8(
  output: RecipeOutput,
  localAudioPaths: Record<string, string>,
): PlaylistExportResult {
  const playlist = buildM3u8(output, localAudioPaths);
  if (playlist.missingTrackIds.length > 0) {
    const count = playlist.missingTrackIds.length;
    throw new Error(
      `${count} ${count === 1 ? "track has" : "tracks have"} no usable local file path or Spotify URI. Use the Mac app to export local-library tracks.`,
    );
  }
  const filename = exportFilename(output.name);
  const url = URL.createObjectURL(
    new Blob([playlist.contents], { type: "audio/x-mpegurl;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return { cancelled: false, path: filename, trackCount: playlist.trackCount };
}

export async function exportPlaylistM3u8({
  output,
  localAudioPaths,
  libraryRootPath,
  nativeApp,
}: {
  output: RecipeOutput;
  localAudioPaths: Record<string, string>;
  libraryRootPath?: string | null;
  nativeApp: boolean;
}): Promise<PlaylistExportResult> {
  if (!nativeApp) return downloadBrowserM3u8(output, localAudioPaths);

  const [{ save }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  return saveNativeM3u8({ output, localAudioPaths, libraryRootPath, save, invoke });
}

export async function exportPlaylistsM3u8({
  outputs,
  localAudioPaths,
  libraryRootPath,
  nativeApp,
}: {
  outputs: RecipeOutput[];
  localAudioPaths: Record<string, string>;
  libraryRootPath?: string | null;
  nativeApp: boolean;
}): Promise<PlaylistBatchExportResult> {
  if (!nativeApp) {
    if (outputs.length === 0) {
      throw new Error("There are no playlists to export.");
    }
    const results = outputs.map((output) => downloadBrowserM3u8(output, localAudioPaths));
    return {
      cancelled: false,
      paths: results.flatMap((result) => result.path ? [result.path] : []),
      playlistCount: results.length,
      trackCount: results.reduce((count, result) => count + result.trackCount, 0),
    };
  }

  const [{ open }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  return saveNativeM3u8Batch({
    outputs,
    localAudioPaths,
    libraryRootPath,
    selectDirectory: (options) => open(options),
    invoke,
  });
}
