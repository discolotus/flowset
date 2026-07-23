import type { AudioFeatureProviderId, Track } from "./types";

export type AnalysisCacheDirectories = Record<string, string[]>;

const ESSENTIA_MODEL_FEATURES = [
  "arousal",
  "valence",
  "aggressiveness",
  "party",
  "relaxed",
] as const;

export function addPlaylistCacheDirectory(
  current: AnalysisCacheDirectories,
  trackIds: string[],
  cacheDirectory: string,
): AnalysisCacheDirectories {
  const next = { ...current };
  trackIds.forEach((trackId) => {
    next[trackId] = [...new Set([...(next[trackId] ?? []), cacheDirectory])];
  });
  return next;
}

export function tracksNeedingAnalysis(
  tracks: Track[],
  provider: AudioFeatureProviderId,
): Track[] {
  return tracks.filter((track) => !trackReadyForProvider(track, provider));
}

export function trackReadyForProvider(
  track: Track,
  provider: AudioFeatureProviderId,
): boolean {
  if (
    track.audio_features == null ||
    track.audio_feature_provenance?.provider !== provider
  ) {
    return false;
  }
  if (provider !== "essentia") return true;
  return ESSENTIA_MODEL_FEATURES.every(
    (feature) => track.audio_features?.[feature] != null,
  );
}
