import type {
  AudioFeatureProviderId,
  AudioFeatureProviderListResponse,
  AudioFeatureProviderOption,
  AudioFeatureProgressSnapshot,
  AudioFeatureResolutionResponse,
  DemoPlaylist,
  InputPlaylist,
  LocalLibraryBrowseResponse,
  LocalPlaylistDiscoveryResponse,
  LocalPlaylistImportResponse,
  NumericParameter,
  RecipePreviewResponse,
  SortDirection,
  SortParameter,
  SpotifyAuthorizationStartResponse,
  SpotifyConnectionStatus,
  SpotifyMatchResponse,
  SpotifyPlaylistCreateRequest,
  SpotifyPlaylistCreateResponse,
  Track,
  SemanticBackendCapabilities,
  SemanticRankResponse,
} from "./types";
import type { SplitFactor } from "./factorGrid";

const API_BASE_URL =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
    ? "http://127.0.0.1:8001"
    : "";
const NATIVE_STARTUP_RETRIES = 60;

interface RequestPolicy {
  retryNetworkErrors?: boolean;
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export function apiNetworkAttemptLimit({
  nativeApi,
  retryNetworkErrors,
}: {
  nativeApi: boolean;
  retryNetworkErrors: boolean;
}): number {
  return nativeApi && retryNetworkErrors ? NATIVE_STARTUP_RETRIES : 1;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function request<T>(
  path: string,
  options?: RequestInit,
  policy: RequestPolicy = {},
): Promise<T> {
  let response: Response | null = null;
  let networkError: unknown = null;
  const attempts = apiNetworkAttemptLimit({
    nativeApi: Boolean(API_BASE_URL),
    retryNetworkErrors: policy.retryNetworkErrors !== false,
  });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(`${API_BASE_URL}${path}`, options);
      break;
    } catch (reason: unknown) {
      networkError = reason;
      if (options?.signal?.aborted) break;
      if (attempt + 1 < attempts) await wait(500);
    }
  }
  if (!response) {
    throw networkError instanceof Error
      ? networkError
      : new Error("The local analysis service did not start.");
  }
  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.json() as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : null;
    } catch {
      // The status remains useful when a proxy or server returns a non-JSON error page.
    }
    throw new ApiRequestError(
      detail ?? `API request failed (${response.status})`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export function getDemoPlaylists(): Promise<DemoPlaylist[]> {
  return request<DemoPlaylist[]>("/api/v1/demo/playlists");
}

export async function getAudioFeatureProviders(): Promise<AudioFeatureProviderOption[]> {
  const response = await request<AudioFeatureProviderListResponse>(
    "/api/v1/audio-features/providers",
  );
  return response.providers;
}

export function resolveAudioFeatures(input: {
  provider: AudioFeatureProviderId;
  tracks: InputPlaylist["tracks"];
  localAudioPaths?: Record<string, string>;
  analysisCacheDirectories?: Record<string, string[]>;
  progressToken?: string;
}): Promise<AudioFeatureResolutionResponse> {
  return request<AudioFeatureResolutionResponse>("/api/v1/audio-features/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: input.provider,
      tracks: input.tracks,
      local_audio_paths: input.localAudioPaths,
      analysis_cache_directories: input.analysisCacheDirectories,
      progress_token: input.progressToken,
    }),
  });
}

export function getAudioFeatureProgress(
  progressToken: string,
  signal?: AbortSignal,
): Promise<AudioFeatureProgressSnapshot> {
  return request<AudioFeatureProgressSnapshot>(
    `/api/v1/audio-features/progress/${encodeURIComponent(progressToken)}`,
    { signal },
  );
}

export function browseLocalLibrary(path = ""): Promise<LocalLibraryBrowseResponse> {
  const query = new URLSearchParams({ path });
  return request<LocalLibraryBrowseResponse>(`/api/v1/local-library/folders?${query}`);
}

export function discoverLocalPlaylists(path = ""): Promise<LocalPlaylistDiscoveryResponse> {
  const query = new URLSearchParams({ path });
  return request<LocalPlaylistDiscoveryResponse>(`/api/v1/local-library/playlists?${query}`);
}

export function selectLocalLibraryRoot(path: string): Promise<LocalLibraryBrowseResponse> {
  return request<LocalLibraryBrowseResponse>("/api/v1/local-library/root", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function importLocalPlaylist(input: {
  sourcePath: string;
  recursive?: boolean;
}): Promise<LocalPlaylistImportResponse> {
  return request<LocalPlaylistImportResponse>("/api/v1/local-library/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_path: input.sourcePath,
      recursive: input.recursive ?? true,
    }),
  });
}

export function localAudioPreviewUrl(path: string): string {
  const query = new URLSearchParams({ path });
  return `${API_BASE_URL}/api/v1/local-library/audio?${query}`;
}

export function getSemanticCapabilities(): Promise<SemanticBackendCapabilities[]> {
  return request<SemanticBackendCapabilities[]>("/api/v1/semantic/backends");
}

export function rankSemanticAudio(input: {
  backendId: string;
  label: string;
  audioPaths: Record<string, string>;
}): Promise<SemanticRankResponse> {
  return request<SemanticRankResponse>("/api/v1/semantic/rank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend_id: input.backendId, labels: [input.label], audio_paths: input.audioPaths }),
  });
}

export function rankSemanticReference(input: {
  backendId: string;
  referenceTrackId: string;
  audioPaths: Record<string, string>;
}): Promise<SemanticRankResponse> {
  return request<SemanticRankResponse>("/api/v1/semantic/reference-rank", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend_id: input.backendId, reference_track_id: input.referenceTrackId, audio_paths: input.audioPaths }),
  });
}

export function getSpotifyStatus(): Promise<SpotifyConnectionStatus> {
  return request<SpotifyConnectionStatus>("/api/v1/spotify/status");
}

export function configureSpotify(clientId: string): Promise<SpotifyConnectionStatus> {
  return request<SpotifyConnectionStatus>("/api/v1/spotify/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
}

export function startSpotifyAuthorization(): Promise<SpotifyAuthorizationStartResponse> {
  return request<SpotifyAuthorizationStartResponse>("/api/v1/spotify/auth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function disconnectSpotify(): Promise<SpotifyConnectionStatus> {
  return request<SpotifyConnectionStatus>("/api/v1/spotify/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export function matchSpotifyTracks(tracks: readonly Track[]): Promise<SpotifyMatchResponse> {
  if (tracks.length === 0 || tracks.length > 10) {
    throw new Error("Spotify matching accepts between 1 and 10 unique tracks per batch.");
  }
  if (new Set(tracks.map(({ id }) => id)).size !== tracks.length) {
    throw new Error("Spotify matching batches must contain unique local track IDs.");
  }
  return request<SpotifyMatchResponse>("/api/v1/spotify/matches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks }),
  });
}

export function createSpotifyPlaylists(
  payload: SpotifyPlaylistCreateRequest,
): Promise<SpotifyPlaylistCreateResponse> {
  return request<SpotifyPlaylistCreateResponse>(
    "/api/v1/spotify/playlists/create",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    // A lost response may mean Spotify already created or partially filled playlists.
    // Only a deliberate user retry may replay this mutation; its stable idempotency key makes
    // that explicit retry safe, while an automatic transport replay could hide uncertainty.
    { retryNetworkErrors: false },
  );
}

export function previewRecipe(input: {
  name: string;
  inputPlaylists: InputPlaylist[];
  distributionParameter: NumericParameter;
  distributionBinCount: number;
  splitFactors: ReadonlyArray<Pick<SplitFactor, "parameter" | "binCount">>;
  subgroup: { parameter: NumericParameter; binCount: number } | null;
  sort: { parameter: SortParameter; direction: SortDirection } | null;
  semanticScoreKeys?: { distribution?: string | null; split?: string | null; subgroup?: string | null; sort?: string | null };
}): Promise<RecipePreviewResponse> {
  return request<RecipePreviewResponse>("/api/v1/recipes/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      input_playlists: input.inputPlaylists.map(({ id, name, tracks }) => ({
        id,
        name,
        tracks,
      })),
      distribution_parameter: input.distributionParameter,
      distribution_bin_count: input.distributionBinCount,
      ...(input.semanticScoreKeys?.distribution ? { distribution_semantic_score_key: input.semanticScoreKeys.distribution } : {}),
      split_factors: input.splitFactors.map((factor) => ({
        parameter: factor.parameter,
        bin_count: factor.binCount,
        ...(input.semanticScoreKeys?.split ? { semantic_score_key: input.semanticScoreKeys.split } : {}),
      })),
      subgroup: input.subgroup
        ? { parameter: input.subgroup.parameter, bin_count: input.subgroup.binCount, ...(input.semanticScoreKeys?.subgroup ? { semantic_score_key: input.semanticScoreKeys.subgroup } : {}) }
        : null,
      sort: input.sort
        ? {
            parameter: input.sort.parameter,
            direction: input.sort.direction === "ascending" ? "asc" : "desc",
            ...(input.semanticScoreKeys?.sort ? { semantic_score_key: input.semanticScoreKeys.sort } : {}),
          }
        : null,
    }),
  });
}
