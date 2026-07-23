import { buildM3u8, exportFilename } from "./playlistExport";
import {
  orderedTrackExportEntries,
  type OrderedTrackExportEntry,
} from "./orderedTrackExport";
import type { RecipeOutput, Track } from "./types";

export const COMPATIBILITY_TARGETS = [
  "m3u8",
  "rekordbox",
  "apple_music",
  "djay_pro",
] as const;

export type CompatibilityTarget = typeof COMPATIBILITY_TARGETS[number];

export type CompatibilityIssueCode =
  | "control_characters_in_path"
  | "missing_location"
  | "relative_path_without_library_root"
  | "non_local_uri"
  | "invalid_local_path"
  | "unsupported_extension";

export interface TrackTargetCompatibility {
  compatible: boolean;
  issue_codes: CompatibilityIssueCode[];
}

export interface ExportCompatibilityIssue {
  code: CompatibilityIssueCode;
  severity: "warning" | "error";
  target: CompatibilityTarget;
  playlist_id: string;
  playlist_name: string;
  position: number;
  track_id: string;
  track_name: string;
  artist: string;
  location: string | null;
  extension: string | null;
  message: string;
}

export interface ExportManifestTrack {
  position: number;
  track_id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  group: string;
  location: string | null;
  file_url: string | null;
  extension: string | null;
  compatibility: Record<CompatibilityTarget, TrackTargetCompatibility>;
}

export interface ExportManifestPlaylist {
  id: string;
  name: string;
  expected_track_count: number;
  ordered_tracks: ExportManifestTrack[];
}

export interface TargetCompatibilitySummary {
  target: CompatibilityTarget;
  label: string;
  status: "ready" | "warning" | "blocked";
  expected_track_entries: number;
  compatible_track_entries: number;
  incompatible_track_entries: number;
  issue_count: number;
  supported_extensions: string[] | null;
}

export interface ExportCompatibilityManifest {
  schema_version: "sequence.export-manifest.v1";
  generated_at: string;
  ordering_authority: "recipe_output.tracks";
  duplicates_preserved: true;
  playlist_count: number;
  playlist_track_count: number;
  unique_local_file_count: number;
  duplicate_local_file_entry_count: number;
  playlists: ExportManifestPlaylist[];
  targets: Record<CompatibilityTarget, TargetCompatibilitySummary>;
  issues: ExportCompatibilityIssue[];
}

export interface RekordboxXmlBuildResult {
  contents: string | null;
  blocked: boolean;
  playlistCount: number;
  playlistTrackCount: number;
  collectionTrackCount: number;
  issues: ExportCompatibilityIssue[];
  manifest: ExportCompatibilityManifest;
}

export interface DjExportBundleFile {
  filename: string;
  contents: string;
  mediaType: string;
  target: CompatibilityTarget | "manifest" | "report";
}

export interface DjExportBundle {
  files: DjExportBundleFile[];
  manifest: ExportCompatibilityManifest;
  compatibilityReport: string;
  rekordbox: RekordboxXmlBuildResult;
}

export interface DjBundleExportResult {
  cancelled: boolean;
  directory?: string;
  paths: string[];
  fileCount: number;
  playlistCount: number;
  trackCount: number;
  warningCount: number;
  blockedTargets: CompatibilityTarget[];
}

export interface DjExportInput {
  outputs: readonly RecipeOutput[];
  localAudioPaths: Readonly<Record<string, string>>;
  libraryRootPath?: string | null;
  generatedAt?: string;
  bundleName?: string;
}

interface TargetDefinition {
  label: string;
  requiresLocalFile: boolean;
  extensions: ReadonlySet<string> | null;
}

const REKORDBOX_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".wav"]);
const APPLE_MUSIC_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".m4a", ".mp3", ".wav"]);
const DJAY_PRO_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".flac", ".m4a", ".mp3", ".wav"]);

const TARGET_DEFINITIONS: Record<CompatibilityTarget, TargetDefinition> = {
  m3u8: {
    label: "M3U8 playlists",
    requiresLocalFile: false,
    extensions: null,
  },
  rekordbox: {
    label: "Rekordbox XML",
    requiresLocalFile: true,
    extensions: REKORDBOX_EXTENSIONS,
  },
  apple_music: {
    label: "Apple Music",
    requiresLocalFile: true,
    extensions: APPLE_MUSIC_EXTENSIONS,
  },
  djay_pro: {
    label: "djay Pro",
    requiresLocalFile: true,
    extensions: DJAY_PRO_EXTENSIONS,
  },
};

function cleanXmlText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

export function escapeXmlAttribute(value: string): string {
  return cleanXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeFilePath(path: string): string {
  return path.split("/").map((segment, index) => {
    if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
    return encodeURIComponent(safeDecodeURIComponent(segment))
      .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  }).join("/");
}

/** Convert a supplied absolute local path to Rekordbox's absolute file URL form. */
export function absoluteFileUrl(value: string): string | null {
  const path = value.trim();
  if (!path) return null;

  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.protocol !== "file:") return null;
      const host = url.hostname || "localhost";
      return `file://${host}${encodeFilePath(url.pathname)}`;
    } catch {
      return null;
    }
  }

  if (path.startsWith("/")) {
    return `file://localhost${encodeFilePath(path)}`;
  }

  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return `file://localhost/${encodeFilePath(path.replace(/\\/g, "/"))}`;
  }

  if (path.startsWith("\\\\")) {
    const [host, ...parts] = path.slice(2).split(/[\\/]+/);
    return host ? `file://${host}/${encodeFilePath(parts.join("/"))}` : null;
  }

  return null;
}

function extensionForPath(value: string | null): string | null {
  if (!value) return null;
  let path = value;
  if (/^file:/i.test(value)) {
    try {
      path = new URL(value).pathname;
    } catch {
      return null;
    }
  }
  const filename = safeDecodeURIComponent(path.replace(/\\/g, "/").split("/").pop() ?? "");
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot).toLowerCase() : null;
}

function issueFor(
  target: CompatibilityTarget,
  definition: TargetDefinition,
  output: RecipeOutput,
  entry: OrderedTrackExportEntry,
): ExportCompatibilityIssue | null {
  const { location } = entry;
  const extension = extensionForPath(location.localPath);
  const base = {
    target,
    playlist_id: output.id,
    playlist_name: output.name,
    position: entry.position,
    track_id: entry.track.id,
    track_name: entry.track.name,
    artist: entry.track.artist,
    location: location.location,
    extension,
  };

  if (!location.location) {
    const controlCharacters = location.reason === "control_characters_in_path";
    const relative = location.reason === "relative_path_without_library_root";
    return {
      ...base,
      code: controlCharacters
        ? "control_characters_in_path"
        : relative
          ? "relative_path_without_library_root"
          : "missing_location",
      severity: "error",
      message: controlCharacters
        ? "The track path contains a control character that cannot be represented safely in playlist exports."
        : relative
          ? "The track has a relative file path, but no absolute music-library root was supplied."
          : "The track has no local file path or usable URI.",
    };
  }

  if (!definition.requiresLocalFile) return null;
  if (!location.localPath) {
    return {
      ...base,
      code: "non_local_uri",
      severity: "error",
      message: `${definition.label} requires a local audio file; a service URI cannot be imported.`,
    };
  }
  if (!absoluteFileUrl(location.localPath)) {
    const isNonFileUri = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(location.localPath);
    return {
      ...base,
      code: isNonFileUri ? "non_local_uri" : "invalid_local_path",
      severity: "error",
      message: isNonFileUri
        ? `${definition.label} requires a local audio file; ${location.localPath.split(":", 1)[0]} URIs are not supported.`
        : `${definition.label} requires an absolute local file path.`,
    };
  }
  if (!extension || !definition.extensions?.has(extension)) {
    return {
      ...base,
      code: "unsupported_extension",
      severity: "warning",
      message: `${extension?.toUpperCase() || "Files without an extension"} is not on the verified format list for ${definition.label}; the target application may still accept it.`,
    };
  }
  return null;
}

function targetRecord<T>(factory: (target: CompatibilityTarget) => T): Record<CompatibilityTarget, T> {
  return Object.fromEntries(
    COMPATIBILITY_TARGETS.map((target) => [target, factory(target)]),
  ) as Record<CompatibilityTarget, T>;
}

export function buildExportCompatibilityManifest({
  outputs,
  localAudioPaths,
  libraryRootPath,
  generatedAt = new Date().toISOString(),
}: DjExportInput): ExportCompatibilityManifest {
  const issues: ExportCompatibilityIssue[] = [];
  const localFileUrls: string[] = [];

  const playlists = outputs.map((output): ExportManifestPlaylist => {
    const entries = orderedTrackExportEntries(output, localAudioPaths, libraryRootPath);
    const tracks = entries.map((entry): ExportManifestTrack => {
      const fileUrl = entry.location.localPath
        ? absoluteFileUrl(entry.location.localPath)
        : null;
      if (fileUrl) localFileUrls.push(fileUrl);
      const compatibility = targetRecord((target): TrackTargetCompatibility => {
        const issue = issueFor(target, TARGET_DEFINITIONS[target], output, entry);
        if (issue) issues.push(issue);
        return {
          compatible: issue == null,
          issue_codes: issue ? [issue.code] : [],
        };
      });
      return {
        position: entry.position,
        track_id: entry.track.id,
        name: entry.track.name,
        artist: entry.track.artist,
        album: entry.track.album,
        duration_ms: entry.track.duration_ms,
        group: entry.groupLabel,
        location: entry.location.location,
        file_url: fileUrl,
        extension: extensionForPath(entry.location.localPath),
        compatibility,
      };
    });
    return {
      id: output.id,
      name: output.name,
      expected_track_count: output.tracks.length,
      ordered_tracks: tracks,
    };
  });

  const playlistTrackCount = playlists.reduce(
    (count, playlist) => count + playlist.ordered_tracks.length,
    0,
  );
  const uniqueLocalFileCount = new Set(localFileUrls).size;
  const targets = targetRecord((target): TargetCompatibilitySummary => {
    const targetIssues = issues.filter((issue) => issue.target === target);
    const hasBlockingIssue = targetIssues.some((issue) => issue.severity === "error");
    const incompatibleTrackEntries = playlists.reduce(
      (count, playlist) => count + playlist.ordered_tracks.filter(
        (track) => !track.compatibility[target].compatible,
      ).length,
      0,
    );
    const extensions = TARGET_DEFINITIONS[target].extensions;
    return {
      target,
      label: TARGET_DEFINITIONS[target].label,
      status: hasBlockingIssue
        ? "blocked"
        : targetIssues.length > 0
          ? "warning"
          : "ready",
      expected_track_entries: playlistTrackCount,
      compatible_track_entries: playlistTrackCount - incompatibleTrackEntries,
      incompatible_track_entries: incompatibleTrackEntries,
      issue_count: targetIssues.length,
      supported_extensions: extensions ? [...extensions].sort() : null,
    };
  });

  return {
    schema_version: "sequence.export-manifest.v1",
    generated_at: generatedAt,
    ordering_authority: "recipe_output.tracks",
    duplicates_preserved: true,
    playlist_count: playlists.length,
    playlist_track_count: playlistTrackCount,
    unique_local_file_count: uniqueLocalFileCount,
    duplicate_local_file_entry_count: Math.max(localFileUrls.length - uniqueLocalFileCount, 0),
    playlists,
    targets,
    issues,
  };
}

function kindForExtension(extension: string | null): string {
  switch (extension) {
    case ".aac": return "AAC File";
    case ".aif":
    case ".aiff": return "AIFF File";
    case ".flac": return "FLAC File";
    case ".m4a": return "M4A File";
    case ".mp3": return "MP3 File";
    case ".wav": return "WAV File";
    default: return "Audio File";
  }
}

interface CollectionTrack {
  key: number;
  track: Track;
  fileUrl: string;
  extension: string | null;
}

export function buildRekordboxXml(input: DjExportInput): RekordboxXmlBuildResult {
  const manifest = buildExportCompatibilityManifest(input);
  const issues = manifest.issues.filter((issue) => issue.target === "rekordbox");
  const blockingIssues = issues.filter((issue) => issue.severity === "error");
  const playlistTrackCount = input.outputs.reduce(
    (count, output) => count + output.tracks.length,
    0,
  );
  if (blockingIssues.length > 0) {
    return {
      contents: null,
      blocked: true,
      playlistCount: input.outputs.length,
      playlistTrackCount,
      collectionTrackCount: 0,
      issues: blockingIssues,
      manifest,
    };
  }

  const collection = new Map<string, CollectionTrack>();
  const playlistKeys = input.outputs.map((output) => {
    const entries = orderedTrackExportEntries(
      output,
      input.localAudioPaths,
      input.libraryRootPath,
    );
    return entries.map((entry) => {
      const fileUrl = absoluteFileUrl(entry.location.localPath ?? "");
      // The compatibility pass above guarantees every entry has a supported file URL.
      if (!fileUrl) throw new Error("Rekordbox compatibility invariant failed.");
      let collectionTrack = collection.get(fileUrl);
      if (!collectionTrack) {
        collectionTrack = {
          key: collection.size + 1,
          track: entry.track,
          fileUrl,
          extension: extensionForPath(entry.location.localPath),
        };
        collection.set(fileUrl, collectionTrack);
      }
      return collectionTrack.key;
    });
  });

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '  <PRODUCT Name="Sequence" Version="0.1.0" Company="Sequence"/>',
    `  <COLLECTION Entries="${collection.size}">`,
  ];
  for (const item of collection.values()) {
    const attributes = [
      `TrackID="${item.key}"`,
      `Name="${escapeXmlAttribute(item.track.name)}"`,
      `Artist="${escapeXmlAttribute(item.track.artist)}"`,
      `Album="${escapeXmlAttribute(item.track.album)}"`,
      `Kind="${kindForExtension(item.extension)}"`,
      `TotalTime="${Math.round(item.track.duration_ms / 1000)}"`,
      `Location="${escapeXmlAttribute(item.fileUrl)}"`,
    ];
    lines.push(`    <TRACK ${attributes.join(" ")}/>`);
  }
  lines.push("  </COLLECTION>");
  lines.push("  <PLAYLISTS>");
  lines.push(`    <NODE Type="0" Name="ROOT" Count="${input.outputs.length}">`);
  input.outputs.forEach((output, playlistIndex) => {
    const keys = playlistKeys[playlistIndex];
    lines.push(
      `      <NODE Name="${escapeXmlAttribute(output.name)}" Type="1" KeyType="0" Entries="${keys.length}">`,
    );
    keys.forEach((key) => lines.push(`        <TRACK Key="${key}"/>`));
    lines.push("      </NODE>");
  });
  lines.push("    </NODE>");
  lines.push("  </PLAYLISTS>");
  lines.push("</DJ_PLAYLISTS>");

  return {
    contents: `${lines.join("\n")}\n`,
    blocked: false,
    playlistCount: input.outputs.length,
    playlistTrackCount,
    collectionTrackCount: collection.size,
    issues: [],
    manifest,
  };
}

export function formatCompatibilityReport(manifest: ExportCompatibilityManifest): string {
  const lines = [
    "Sequence DJ export compatibility report",
    `Generated: ${manifest.generated_at}`,
    "",
    `${manifest.playlist_count} playlist(s), ${manifest.playlist_track_count} ordered track entries, ${manifest.unique_local_file_count} unique local files.`,
    "Playlist order and repeated entries are preserved exactly from the app preview.",
    "",
    "Targets",
  ];
  COMPATIBILITY_TARGETS.forEach((target) => {
    const summary = manifest.targets[target];
    lines.push(
      `- ${summary.label}: ${summary.status.toUpperCase()} (${summary.compatible_track_entries}/${summary.expected_track_entries} compatible)`,
    );
  });

  lines.push("");
  lines.push("Issues");
  if (manifest.issues.length === 0) {
    lines.push("- None");
  } else {
    manifest.issues.forEach((issue) => {
      lines.push(
        `- [${TARGET_DEFINITIONS[issue.target].label}] ${issue.playlist_name} #${issue.position}: ${issue.artist} — ${issue.track_name}. ${issue.message}`,
      );
    });
  }
  lines.push("");
  return lines.join("\n");
}

function safeBaseName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim() || "Sequence DJ export";
}

function uniqueM3u8Filenames(outputs: readonly RecipeOutput[]): string[] {
  const allocated = new Set<string>();
  return outputs.map((output) => {
    const filename = exportFilename(output.name);
    if (!allocated.has(filename.toLowerCase())) {
      allocated.add(filename.toLowerCase());
      return filename;
    }

    const stem = filename.slice(0, -".m3u8".length);
    for (let copyNumber = 2; ; copyNumber += 1) {
      const candidate = `${stem} (${copyNumber}).m3u8`;
      const key = candidate.toLowerCase();
      if (allocated.has(key)) continue;
      allocated.add(key);
      return candidate;
    }
  });
}

/**
 * Build a write-ready DJ bundle. A target is all-or-nothing: incompatible
 * entries block that target's files, while the JSON/TXT diagnostics are always
 * included so nothing is silently omitted.
 */
export function buildDjExportBundle(input: DjExportInput): DjExportBundle {
  const rekordbox = buildRekordboxXml(input);
  const { manifest } = rekordbox;
  const report = formatCompatibilityReport(manifest);
  const baseName = safeBaseName(input.bundleName ?? "Sequence DJ export");
  const files: DjExportBundleFile[] = [];

  if (manifest.targets.m3u8.status === "ready") {
    const filenames = uniqueM3u8Filenames(input.outputs);
    input.outputs.forEach((output, index) => {
      const playlist = buildM3u8(
        output,
        input.localAudioPaths,
        input.libraryRootPath,
      );
      files.push({
        filename: filenames[index],
        contents: playlist.contents,
        mediaType: "audio/x-mpegurl;charset=utf-8",
        target: "m3u8",
      });
    });
  }
  if (rekordbox.contents) {
    files.push({
      filename: `${baseName} - Rekordbox.xml`,
      contents: rekordbox.contents,
      mediaType: "application/xml;charset=utf-8",
      target: "rekordbox",
    });
  }
  files.push({
    filename: `${baseName} - manifest.json`,
    contents: `${JSON.stringify(manifest, null, 2)}\n`,
    mediaType: "application/json;charset=utf-8",
    target: "manifest",
  });
  files.push({
    filename: `${baseName} - compatibility.txt`,
    contents: report,
    mediaType: "text/plain;charset=utf-8",
    target: "report",
  });

  return {
    files,
    manifest,
    compatibilityReport: report,
    rekordbox,
  };
}

function downloadBundleFile(file: DjExportBundleFile): string {
  const url = URL.createObjectURL(
    new Blob([file.contents], { type: file.mediaType }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return file.filename;
}

/** Save one portable folder containing M3U8, Rekordbox XML, and diagnostics. */
export async function exportDjBundle({
  outputs,
  localAudioPaths,
  libraryRootPath,
  bundleName,
  nativeApp,
}: DjExportInput & { nativeApp: boolean }): Promise<DjBundleExportResult> {
  if (outputs.length === 0) throw new Error("There are no playlists to export.");
  const bundle = buildDjExportBundle({
    outputs,
    localAudioPaths,
    libraryRootPath,
    bundleName,
  });
  const blockedTargets = COMPATIBILITY_TARGETS.filter(
    (target) => bundle.manifest.targets[target].status === "blocked",
  );
  const baseResult = {
    fileCount: bundle.files.length,
    playlistCount: bundle.manifest.playlist_count,
    trackCount: bundle.manifest.playlist_track_count,
    warningCount: bundle.manifest.issues.filter((issue) => issue.severity === "warning").length,
    blockedTargets,
  };

  if (!nativeApp) {
    return {
      cancelled: false,
      paths: bundle.files.map(downloadBundleFile),
      ...baseResult,
    };
  }

  const [{ open }, { invoke }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/api/core"),
  ]);
  const selectedDirectory = await open({
    directory: true,
    multiple: false,
    title: "Choose where to save the DJ bundle",
  });
  if (typeof selectedDirectory !== "string") {
    return { cancelled: true, paths: [], ...baseResult };
  }

  const folderName = safeBaseName(bundleName ?? "Sequence DJ export");
  const written = await invoke<{ directory: string; paths: string[] }>(
    "write_export_bundle",
    {
      directory: selectedDirectory,
      bundleName: folderName,
      files: bundle.files.map(({ filename, contents }) => ({ filename, contents })),
    },
  );
  if (!written || typeof written.directory !== "string" || !Array.isArray(written.paths)) {
    throw new Error("The native app did not confirm the DJ bundle export.");
  }
  return {
    cancelled: false,
    directory: written.directory,
    paths: written.paths,
    ...baseResult,
  };
}
