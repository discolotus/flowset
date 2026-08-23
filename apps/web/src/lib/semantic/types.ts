import type { SemanticBackendCapabilities, SemanticRepresentationIdentity, SemanticScore, Track } from "../types";

export type SemanticResultStatus = "complete" | "unavailable" | "failed";
export type SemanticRecipeScope = "distribution" | "split" | "subgroup" | "sort";

export interface SemanticTrackSnapshot {
  trackId: string;
  name: string;
  artist: string;
  album: string;
  durationMs: number;
}

export interface SemanticScalarResult {
  readonly trackId: string;
  readonly status: SemanticResultStatus;
  readonly scores: readonly SemanticScore[];
  readonly error?: string | null;
}

export interface SemanticExperimentRunV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly kind: "text-ranking" | "reference-ranking";
  readonly status: "complete" | "partial" | "failed";
  readonly backend: SemanticBackendCapabilities;
  readonly prompts: readonly string[];
  readonly scoreKeysByNormalizedLabel: Readonly<Record<string, string>>;
  readonly query: string;
  readonly referenceTrackId?: string;
  readonly representation?: SemanticRepresentationIdentity | null;
  readonly scoreKey: string;
  readonly trackIds: readonly string[];
  readonly trackSetFingerprint: string;
  readonly sourceTrackSetFingerprint: string;
  readonly trackSnapshots: readonly SemanticTrackSnapshot[];
  readonly results: readonly SemanticScalarResult[];
  readonly missingTrackIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface SemanticPromotion {
  runId: string;
  scoreKey: string;
  scopes: Record<SemanticRecipeScope, boolean>;
}

export function snapshotTrack(track: Track): SemanticTrackSnapshot {
  return { trackId: track.id, name: track.name, artist: track.artist, album: track.album, durationMs: track.duration_ms };
}
