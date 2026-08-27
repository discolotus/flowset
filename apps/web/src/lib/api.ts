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
  SemanticEmbeddingResponse,
  SemanticRankResponse,
  SemanticRepresentationIdentity,
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
  audioPaths: Record<string, string>;
} & ({ labels: readonly string[]; label?: never } | { label: string; labels?: never })): Promise<SemanticRankResponse> {
  const labels = "labels" in input ? input.labels : [input.label];
  return request<SemanticRankResponse>("/api/v1/semantic/rank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend_id: input.backendId, labels, audio_paths: input.audioPaths }),
  });
}

export function rankSemanticReference(input: {
  backendId: string;
  referenceTrackId: string;
  audioPaths: Record<string, string>;
  representation: SemanticRepresentationIdentity;
}): Promise<SemanticRankResponse> {
  return request<SemanticRankResponse>("/api/v1/semantic/reference-rank", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backend_id: input.backendId, reference_track_id: input.referenceTrackId, audio_paths: input.audioPaths, representation: input.representation }),
  });
}

export async function extractSemanticEmbeddings(input: {
  backend: SemanticBackendCapabilities;
  audioPaths: Record<string, string>;
  signal?: AbortSignal;
}): Promise<SemanticEmbeddingResponse> {
  if (!input.backend.capabilities.includes("embedding_extraction")) {
    throw new Error("The selected backend does not expose embeddings.");
  }
  const entries = Object.entries(input.audioPaths);
  if (entries.length === 0) {
    throw new Error("Select at least one authorized track for embedding extraction.");
  }
  const chunkSize = input.backend.max_embedding_batch;
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 20) {
    throw new Error("The backend reported an invalid embedding batch limit.");
  }

  let aggregate: SemanticEmbeddingResponse | null = null;
  for (let offset = 0; offset < entries.length; offset += chunkSize) {
    const response = await request<SemanticEmbeddingResponse>("/api/v1/semantic/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backend_id: input.backend.id,
        audio_paths: Object.fromEntries(entries.slice(offset, offset + chunkSize)),
      }),
      signal: input.signal,
    });
    if (response.backend.id !== input.backend.id) {
      throw new Error("Embedding response came from an unexpected backend.");
    }
    if (!aggregate) {
      aggregate = {
        ...response,
        embeddings: [...response.embeddings],
        failed_track_ids: [...response.failed_track_ids],
        cache: { ...response.cache },
      };
      continue;
    }
    const incompatible = response.backend.model !== aggregate.backend.model
      || response.representation !== aggregate.representation
      || (response.dimension != null
        && aggregate.dimension != null
        && response.dimension !== aggregate.dimension);
    if (incompatible) {
      throw new Error("Embedding chunks came from incompatible model spaces.");
    }
    aggregate.dimension ??= response.dimension;
    aggregate.backend = {
      ...aggregate.backend,
      embedding_dimension: aggregate.dimension,
    };
    aggregate.embeddings.push(...response.embeddings);
    aggregate.failed_track_ids.push(...response.failed_track_ids);
    aggregate.cache = {
      hits: aggregate.cache.hits + response.cache.hits,
      misses: aggregate.cache.misses + response.cache.misses,
      deduplicated: aggregate.cache.deduplicated + response.cache.deduplicated,
      evictions: aggregate.cache.evictions + response.cache.evictions,
      entries: response.cache.entries,
      capacity: response.cache.capacity,
    };
  }
  if (!aggregate) throw new Error("Embedding extraction returned no chunks.");
  return aggregate;
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
