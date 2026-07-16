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

export type NumericParameter =
  | "energy"
  | "danceability"
  | "valence"
  | "tempo"
  | "acousticness"
  | "instrumentalness"
  | "speechiness"
  | "liveness"
  | "loudness"
  | "release_year"
  | "duration";

export type SortParameter =
  | NumericParameter
  | "key"
  | "duration_ms"
  | "name"
  | "artist"
  | "album";

export type SortDirection = "ascending" | "descending";

export interface InputPlaylist {
  id: string;
  name: string;
  description?: string;
  tracks: Track[];
}

export interface ParameterRange {
  minimum: number | null;
  maximum: number | null;
  maximum_inclusive?: boolean;
}

export interface DistributionBin {
  id: string;
  index: number;
  label: string;
  range: ParameterRange | null;
  track_count: number;
  percentage: number;
}

export interface ParameterDistribution {
  parameter: NumericParameter;
  requested_bin_count: number;
  minimum: number | null;
  maximum: number | null;
  bins: DistributionBin[];
  unavailable_track_count: number;
}

export interface TrackGroup {
  id: string;
  label: string;
  parameter: NumericParameter | null;
  bin_index: number | null;
  range: ParameterRange | null;
  start_index: number;
  end_index_exclusive: number;
  track_count: number;
  tracks: Track[];
}

export interface RecipeOutput {
  id: string;
  name: string;
  split_parameter: NumericParameter | null;
  bin_index: number | null;
  range: ParameterRange | null;
  track_count: number;
  tracks: Track[];
  groups: TrackGroup[];
  summary: PlaylistSummary;
}

export interface RecipePreviewResponse {
  recipe_name: string;
  input_playlist_count: number;
  input_track_count: number;
  deduplicated_track_count: number;
  duplicate_track_count: number;
  distribution: ParameterDistribution;
  outputs: RecipeOutput[];
  warnings: string[];
}
