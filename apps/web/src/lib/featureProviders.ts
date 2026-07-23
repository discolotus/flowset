import type { AudioFeatureProviderOption } from "./types";

export const DEFAULT_AUDIO_FEATURE_PROVIDERS: AudioFeatureProviderOption[] = [
  {
    id: "reccobeats",
    display_name: "ReccoBeats",
    status: "checking",
    requires_local_audio: false,
    detail:
      "Matches Spotify tracks to a hosted feature catalog. No audio files need to leave your device.",
  },
  {
    id: "essentia",
    display_name: "Essentia",
    status: "checking",
    requires_local_audio: true,
    detail:
      "Analyzes audio files you provide locally. Spotify playlist metadata alone is not enough.",
  },
];

export function markProviderStatusUnknown(
  providers: AudioFeatureProviderOption[],
): AudioFeatureProviderOption[] {
  return providers.map((provider) => ({ ...provider, status: "unknown" }));
}
