export type Strategy =
  | "energy_buckets"
  | "energy_progression"
  | "energy_pyramid"
  | "bpm_first"
  | "key_first"
  | "energy_bpm_key";

export interface AudioFeatures {
  tempo: number;
  key: number;
  mode: number;
  energy: number;
  danceability: number;
  valence: number;
  loudness: number;
  acousticness: number;
  instrumentalness: number;
  speechiness: number;
  liveness: number;
  time_signature: number;
}

export interface Track {
  id: string;
  uri?: string | null;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  album_art_url?: string | null;
  explicit: boolean;
  release_year?: number | null;
  genres: string[];
  audio_features?: AudioFeatures | null;
}

export interface PlaylistSummary {
  song_count: number;
  duration_ms: number;
  average_energy: number | null;
  average_bpm: number | null;
  average_danceability: number | null;
  energy_range: [number, number] | null;
}

export interface DemoPlaylist {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
  summary: PlaylistSummary;
}

export interface GeneratedPlaylist {
  name: string;
  tracks: Track[];
  summary: PlaylistSummary;
  violations: Array<{ kind: string; position: number; message: string }>;
}

export interface OptimizationResponse {
  strategy: Strategy;
  generated_playlists: GeneratedPlaylist[];
  warnings: string[];
}
