import type {
  DemoPlaylist,
  OptimizationResponse,
  Strategy,
  Track,
} from "./types";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getDemoPlaylist(): Promise<DemoPlaylist> {
  return request<DemoPlaylist>("/api/v1/demo");
}

export function optimizePlaylist(input: {
  name: string;
  strategy: Strategy;
  tracks: Track[];
  maximumBpmJump?: number;
  maximumEnergyJump?: number;
  minimumArtistSpacing: number;
  excludeExplicit: boolean;
}): Promise<OptimizationResponse> {
  return request<OptimizationResponse>("/api/v1/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${input.name} — Optimized`,
      strategy: input.strategy,
      tracks: input.tracks,
      constraints: {
        maximum_bpm_jump: input.maximumBpmJump,
        maximum_energy_jump: input.maximumEnergyJump,
        minimum_artist_spacing: input.minimumArtistSpacing,
        avoid_duplicate_artists: input.minimumArtistSpacing > 0,
        exclude_explicit: input.excludeExplicit,
      },
    }),
  });
}
