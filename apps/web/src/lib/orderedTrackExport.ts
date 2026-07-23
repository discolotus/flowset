import type { RecipeOutput, Track, TrackGroup } from "./types";

export type ExportLocationKind = "local" | "uri" | "missing";

export interface ResolvedExportLocation {
  kind: ExportLocationKind;
  location: string | null;
  localPath: string | null;
  reason:
    | "control_characters_in_path"
    | "missing"
    | "relative_path_without_library_root"
    | null;
}

function containsControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

export interface OrderedTrackExportEntry {
  track: Track;
  /** One-based position in the generated playlist. */
  position: number;
  group: TrackGroup | null;
  groupLabel: string;
  location: ResolvedExportLocation;
}

function isAbsoluteFilesystemPath(value: string): boolean {
  return value.startsWith("/")
    || value.startsWith("\\\\")
    || /^[A-Za-z]:[\\/]/.test(value);
}

function isUri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function joinRoot(root: string, relativePath: string): string {
  return `${root.replace(/[\\/]+$/g, "")}/${relativePath.replace(/^[\\/]+/g, "")}`;
}

/**
 * Resolve one track without changing its playlist position. Local paths take
 * precedence over service URIs because desktop/DJ exports need the audio file.
 */
export function resolveExportLocation(
  track: Track,
  localAudioPaths: Readonly<Record<string, string>>,
  libraryRootPath?: string | null,
): ResolvedExportLocation {
  const configuredPathValue = localAudioPaths[track.id];
  if (configuredPathValue && containsControlCharacters(configuredPathValue)) {
    return {
      kind: "missing",
      location: null,
      localPath: null,
      reason: "control_characters_in_path",
    };
  }
  const configuredPath = configuredPathValue?.trim();
  if (configuredPath) {
    if (isAbsoluteFilesystemPath(configuredPath) || isUri(configuredPath)) {
      return {
        kind: "local",
        location: configuredPath,
        localPath: configuredPath,
        reason: null,
      };
    }
    if (libraryRootPath && containsControlCharacters(libraryRootPath)) {
      return {
        kind: "missing",
        location: null,
        localPath: null,
        reason: "control_characters_in_path",
      };
    }
    const root = libraryRootPath?.trim();
    if (root && (isAbsoluteFilesystemPath(root) || /^file:/i.test(root))) {
      const path = joinRoot(root, configuredPath);
      return { kind: "local", location: path, localPath: path, reason: null };
    }
    return {
      kind: "missing",
      location: null,
      localPath: null,
      reason: "relative_path_without_library_root",
    };
  }

  if (track.uri && containsControlCharacters(track.uri)) {
    return {
      kind: "missing",
      location: null,
      localPath: null,
      reason: "control_characters_in_path",
    };
  }
  const uri = track.uri?.trim();
  if (uri) {
    return { kind: "uri", location: uri, localPath: null, reason: null };
  }
  return { kind: "missing", location: null, localPath: null, reason: "missing" };
}

function groupAtPosition(output: RecipeOutput, zeroBasedPosition: number): TrackGroup | null {
  return output.groups.find((group) => (
    zeroBasedPosition >= group.start_index
    && zeroBasedPosition < group.end_index_exclusive
  )) ?? null;
}

/**
 * Canonical export ordering. `output.tracks` is the authority; group ranges
 * annotate that order only. Mapping instead of deduplicating deliberately
 * preserves repeated tracks and repeated paths.
 */
export function orderedTrackExportEntries(
  output: RecipeOutput,
  localAudioPaths: Readonly<Record<string, string>>,
  libraryRootPath?: string | null,
): OrderedTrackExportEntry[] {
  return output.tracks.map((track, index) => {
    const group = groupAtPosition(output, index);
    return {
      track,
      position: index + 1,
      group,
      groupLabel: group?.label ?? "All tracks",
      location: resolveExportLocation(track, localAudioPaths, libraryRootPath),
    };
  });
}
