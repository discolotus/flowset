export interface AudioFeatures {
  tempo?: number | null;
  key?: number | null;
  mode?: number | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  loudness?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  liveness?: number | null;
  time_signature?: number | null;
  arousal?: number | null;
  aggressiveness?: number | null;
  party?: number | null;
  relaxed?: number | null;
  onset_rate?: number | null;
  beat_strength?: number | null;
  dynamic_complexity?: number | null;
  loudness_range?: number | null;
  brightness?: number | null;
  spectral_flux?: number | null;
  key_strength?: number | null;
}

export type AudioFeatureProviderId = "reccobeats" | "essentia";

export type AudioFeatureProviderAvailability =
  | "available"
  | "unavailable"
  | "checking"
  | "unknown";

export interface AudioFeatureProviderOption {
  id: AudioFeatureProviderId;
  display_name: string;
  status: AudioFeatureProviderAvailability;
  requires_local_audio: boolean;
  detail: string;
}

export interface AudioFeatureProviderListResponse {
  providers: AudioFeatureProviderOption[];
}

export type AudioFeatureResolutionStatus =
  | "complete"
  | "partial"
  | "unavailable"
  | "failed";

export interface AudioFeatureProvenance {
  provider: AudioFeatureProviderId | "fixture";
  source_id?: string | null;
  source_url?: string | null;
  analyzer_version?: string | null;
  notes?: string[];
}

export interface Track {
  id: string;
  uri?: string | null;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  album_art_url?: string | null;
  external_url?: string | null;
  isrc?: string | null;
  explicit: boolean;
  release_year?: number | null;
  genres: string[];
  audio_features?: AudioFeatures | null;
  audio_feature_provenance?: AudioFeatureProvenance | null;
  semantic_scores?: SemanticScore[];
}

export interface SemanticRepresentationIdentity {
  layer: string;
  pooling: string;
  segment: string;
}
export interface SemanticDirectScoreProvenance {
  backend: string;
  model: string;
  kind?: "direct";
  representation?: SemanticRepresentationIdentity | null;
}
export interface SemanticContrastScoreProvenance {
  kind: "derived";
  backend: "flowset-derived";
  model: "contrast-v1";
  representation?: never;
  derivation: {
    type: "difference";
    formula: "positive - negative";
    positive_score_key: string;
    negative_score_key: string;
  };
}
export type SemanticScoreProvenance = SemanticDirectScoreProvenance | SemanticContrastScoreProvenance;
export interface SemanticScore {
  key: string;
  label: string;
  normalized_label: string;
  score: number;
  provenance: SemanticScoreProvenance;
}
export interface SemanticDirectScore extends Omit<SemanticScore, "provenance"> {
  provenance: SemanticDirectScoreProvenance;
}
export interface SemanticBackendCapabilities {
  id: string; display_name: string; model: string; available: boolean;
  detail?: string | null; requires_local_audio: boolean; max_tracks: number; max_labels: number;
  capabilities: ReadonlyArray<"text_similarity" | "reference_similarity" | "embedding_extraction">;
  license_note?: string | null;
  embedding_dimension?: number | null;
  embedding_representation?: string | null;
  max_embedding_batch: number;
  default_representation?: SemanticRepresentationIdentity | null;
}
export interface SemanticRankResponse {
  backend: SemanticBackendCapabilities;
  score_key: string;
  score_keys_by_normalized_label: Record<string, string>;
  results: Array<{ track_id: string; status: "complete" | "unavailable" | "failed"; scores: SemanticDirectScore[]; error?: string | null }>;
  missing_track_ids: string[];
}
export type SemanticEmbeddingCacheStatus = "hit" | "miss" | "deduplicated";
export interface SemanticEmbeddingResult {
  track_id: string;
  status: "complete" | "unavailable" | "failed";
  values: number[];
  cache_status?: SemanticEmbeddingCacheStatus | null;
  error?: string | null;
}
export interface SemanticEmbeddingCacheMetadata {
  hits: number;
  misses: number;
  deduplicated: number;
  evictions: number;
  entries: number;
  capacity: number;
}
export interface SemanticEmbeddingResponse {
  backend: SemanticBackendCapabilities;
  representation: string;
  dimension: number | null;
  embeddings: SemanticEmbeddingResult[];
  failed_track_ids: string[];
  cache: SemanticEmbeddingCacheMetadata;
}

export interface AudioFeatureResolutionResponse {
  provider: AudioFeatureProviderId;
  status: AudioFeatureResolutionStatus;
  tracks: Track[];
  analyzed_track_count: number;
  unavailable_track_ids: string[];
  warnings: string[];
}

export type AnalysisProgressPhase =
  | "queued"
  | "preparing"
  | "native_dsp"
  | "tensorflow"
  | "finalizing"
  | "complete"
  | "error";

export type AnalysisTrackStatus =
  | "pending"
  | "running"
  | "complete"
  | "error"
  | "unavailable";

export type AnalysisStageState = "pending" | "active" | "complete" | "skipped" | "error";

export interface AnalysisProgressStageSnapshot {
  state: AnalysisStageState;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number | null;
  error: string | null;
}

export interface AnalysisProgressTrackSnapshot {
  track_id: string;
  track_name: string;
  duration_ms: number;
  status: AnalysisTrackStatus;
  started_at: string | null;
  completed_at: string | null;
  elapsed_seconds: number | null;
  error: string | null;
  stages: {
    native_dsp: AnalysisProgressStageSnapshot;
    tensorflow: AnalysisProgressStageSnapshot;
  };
}

export interface AudioFeatureProgressSnapshot {
  progress_token: string;
  provider: AudioFeatureProviderId;
  phase: AnalysisProgressPhase;
  completed_track_count: number;
  total_track_count: number;
  successful_track_count: number;
  failed_track_count: number;
  progress_fraction: number;
  current_track: {
    track_id: string;
    track_name: string;
    duration_ms: number;
  } | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  elapsed_seconds: number;
  estimated_remaining_seconds: number | null;
  tracks: AnalysisProgressTrackSnapshot[];
  error: string | null;
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
  | "arousal"
  | "aggressiveness"
  | "party"
  | "relaxed"
  | "onset_rate"
  | "beat_strength"
  | "dynamic_complexity"
  | "loudness_range"
  | "brightness"
  | "spectral_flux"
  | "key_strength"
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

export interface LocalLibraryFolder {
  path: string;
  name: string;
}

export interface LocalLibraryBrowseResponse {
  root_name: string;
  current_path: string;
  current_name: string;
  parent_path?: string | null;
  folders: LocalLibraryFolder[];
}

export interface LocalPlaylistFile {
  path: string;
  name: string;
  source_kind: "m3u" | "m3u8";
}

export interface LocalPlaylistDiscoveryResponse {
  root_name: string;
  search_path: string;
  search_name: string;
  playlists: LocalPlaylistFile[];
}

export interface LocalPlaylistImportResponse {
  source_kind: "directory" | "m3u" | "m3u8";
  playlist: InputPlaylist;
  local_audio_paths: Record<string, string>;
  analysis_cache_directory: string;
  cached_track_count: number;
  skipped_files: Array<{ path: string; reason: string }>;
  warnings: string[];
}

export interface SpotifyConnectionStatus {
  configured: boolean;
  authenticated: boolean;
  client_id: string | null;
  redirect_uri: string;
  scopes: string[];
  token_expires_at: string | null;
  pending_authorization: boolean;
  reauthorization_required: boolean;
  detail: string | null;
}

export interface SpotifyAuthorizationStartResponse {
  authorization_url: string;
  expires_at: string;
}

export type SpotifyMatchStatus = "matched" | "ambiguous" | "not_found" | "error";
export type SpotifyMatchConfidence = "high" | "medium" | "low";

export interface SpotifyMatchSignals {
  isrc: number | null;
  name: number;
  artist: number;
  album: number;
  duration: number;
  version: number;
}

export interface SpotifyMatchCandidate {
  spotify_id: string;
  uri: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  isrc: string | null;
  external_url: string | null;
  score: number;
  confidence: SpotifyMatchConfidence;
  signals: SpotifyMatchSignals;
}

export interface SpotifyTrackMatchResult {
  local_track_id: string;
  status: SpotifyMatchStatus;
  confidence: number;
  query: string;
  candidates: SpotifyMatchCandidate[];
  error: string | null;
}

export interface SpotifyMatchResponse {
  results: SpotifyTrackMatchResult[];
  matched_count: number;
  ambiguous_count: number;
  not_found_count: number;
  error_count: number;
  warnings: string[];
}

export interface SpotifyPlaylistCreateTrackRequest {
  position: number;
  local_track_id: string;
  spotify_uri: string;
}

export interface SpotifyPlaylistCreateItemRequest {
  position: number;
  name: string;
  description: string;
  tracks: SpotifyPlaylistCreateTrackRequest[];
}

export interface SpotifyPlaylistCreateRequest {
  playlists: SpotifyPlaylistCreateItemRequest[];
  public: boolean;
  idempotency_key: string;
}

export interface SpotifyPlaylistTrackResult {
  position: number;
  local_track_id: string;
  spotify_uri: string;
  status: "added" | "failed";
  error: string | null;
}

export interface SpotifyPlaylistCreateResult {
  position: number;
  name: string;
  status: "created" | "partial" | "failed";
  spotify_playlist_id: string | null;
  spotify_url: string | null;
  requested_track_count: number;
  added_track_count: number;
  order_verified: boolean | null;
  track_results: SpotifyPlaylistTrackResult[];
  error: string | null;
}

export interface SpotifyPlaylistCreateResponse {
  idempotency_key: string;
  replayed: boolean;
  results: SpotifyPlaylistCreateResult[];
  created_count: number;
  partial_count: number;
  failed_count: number;
  all_orders_verified: boolean;
  warnings: string[];
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
  semantic_score_key?: string | null;
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

export interface SplitAssignment {
  factor_index: number;
  parameter: NumericParameter;
  bin_id: string;
  bin_index: number;
  label: string;
  range: ParameterRange;
  unavailable: boolean;
}

export interface RecipeOutput {
  id: string;
  name: string;
  split_parameter: NumericParameter | null;
  bin_index: number | null;
  range: ParameterRange | null;
  split_assignments: SplitAssignment[];
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
  split_distributions: ParameterDistribution[];
  factorial_combination_count: number;
  populated_combination_count: number;
  empty_combination_count: number;
  factor_unavailable_track_count: number;
  outputs: RecipeOutput[];
  warnings: string[];
}
