import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiNetworkAttemptLimit,
  browseLocalLibrary,
  configureSpotify,
  createSpotifyPlaylists,
  discoverLocalPlaylists,
  extractSemanticEmbeddings,
  getAudioFeatureProgress,
  getAudioFeatureProviders,
  getSpotifyStatus,
  importLocalPlaylist,
  localAudioPreviewUrl,
  matchSpotifyTracks,
  previewRecipe,
  rankSemanticAudio,
  resolveAudioFeatures,
  startSpotifyAuthorization,
} from "./api";
import type { InputPlaylist } from "./types";

const inputPlaylist: InputPlaylist = {
  id: "source-one",
  name: "Source one",
  tracks: [
    {
      id: "track-one",
      name: "First track",
      artist: "Test artist",
      album: "Test album",
      duration_ms: 180_000,
      explicit: false,
      genres: [],
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audio feature provider API", () => {
  it("reads the provider catalog from the API envelope", async () => {
    const providers = [
      {
        id: "reccobeats" as const,
        display_name: "ReccoBeats",
        status: "available" as const,
        requires_local_audio: false,
        detail: "Hosted catalog lookup",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers }) }),
    );

    await expect(getAudioFeatureProviders()).resolves.toEqual(providers);
  });

  it("sends the selected provider to the resolution endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          provider: "reccobeats",
          status: "unavailable",
          tracks: inputPlaylist.tracks,
          analyzed_track_count: 0,
          unavailable_track_ids: ["track-one"],
          warnings: [],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await resolveAudioFeatures({
      provider: "essentia",
      tracks: inputPlaylist.tracks,
      localAudioPaths: { "track-one": "Sets/Warmup/track-one.wav" },
      analysisCacheDirectories: { "track-one": ["Sets/Warmup"] },
      progressToken: "analysis-token-1234",
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/audio-features/resolve");
    expect(JSON.parse(String(options.body))).toMatchObject({
      provider: "essentia",
      tracks: [{ id: "track-one" }],
      local_audio_paths: { "track-one": "Sets/Warmup/track-one.wav" },
      analysis_cache_directories: { "track-one": ["Sets/Warmup"] },
      progress_token: "analysis-token-1234",
    });
  });

  it("polls an encoded progress token", async () => {
    const snapshot = {
      progress_token: "analysis~token",
      provider: "essentia",
      phase: "queued",
      completed_track_count: 0,
      total_track_count: 1,
      successful_track_count: 0,
      failed_track_count: 0,
      progress_fraction: 0,
      current_track: null,
      started_at: "2026-07-19T12:00:00Z",
      updated_at: "2026-07-19T12:00:00Z",
      completed_at: null,
      elapsed_seconds: 0,
      estimated_remaining_seconds: null,
      tracks: [],
      error: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAudioFeatureProgress("analysis~token")).resolves.toEqual(snapshot);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/v1/audio-features/progress/analysis~token",
    );
  });

  it("keeps provider selection out of fixture-only preview requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await previewRecipe({
      name: "Test recipe",
      inputPlaylists: [inputPlaylist],
      distributionParameter: "energy",
      distributionBinCount: 5,
      splitFactors: [],
      subgroup: null,
      sort: null,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(options.body))).not.toHaveProperty("feature_provider");
  });

  it("serializes an ordered factor grid for recipe previews", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await previewRecipe({
      name: "Factor grid",
      inputPlaylists: [inputPlaylist],
      distributionParameter: "energy",
      distributionBinCount: 5,
      splitFactors: [
        { parameter: "energy", binCount: 3 },
        { parameter: "danceability", binCount: 2 },
        { parameter: "arousal", binCount: 4 },
      ],
      subgroup: null,
      sort: null,
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(options.body));
    expect(body.split_factors).toEqual([
      { parameter: "energy", bin_count: 3 },
      { parameter: "danceability", bin_count: 2 },
      { parameter: "arousal", bin_count: 4 },
    ]);
    expect(body).not.toHaveProperty("split");
  });

  it("browses a root-relative local folder", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current_path: "Sets/July", folders: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await browseLocalLibrary("Sets/July");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/local-library/folders?path=Sets%2FJuly",
    );
  });

  it("imports a subfolder recursively as a playlist", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await importLocalPlaylist({ sourcePath: "Sets/Warmup" });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/local-library/import");
    expect(JSON.parse(String(options.body))).toEqual({
      source_path: "Sets/Warmup",
      recursive: true,
    });
  });

  it("discovers playlist files recursively beneath a root-relative parent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ playlists: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await discoverLocalPlaylists("Playlists/Archived");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/local-library/playlists?path=Playlists%2FArchived",
    );
  });

  it("imports a discovered playlist file by its exact relative path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await importLocalPlaylist({
      sourcePath: "Playlists/Archived/Closing Set.m3u8",
      recursive: false,
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/local-library/import");
    expect(JSON.parse(String(options.body))).toEqual({
      source_path: "Playlists/Archived/Closing Set.m3u8",
      recursive: false,
    });
  });

  it("builds an encoded local-audio preview URL", () => {
    expect(localAudioPreviewUrl("Sets/June 26/A&B #1.opus")).toBe(
      "/api/v1/local-library/audio?path=Sets%2FJune+26%2FA%26B+%231.opus",
    );
  });
});

describe("semantic ranking API", () => {
  it("sends every prompt in one ordered multi-label request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await rankSemanticAudio({
      backendId: "local-clap",
      labels: ["hypnotic sunrise", "warm analog glow"],
      audioPaths: { "track-one": "Sets/track-one.wav" },
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/semantic/rank");
    expect(JSON.parse(String(options.body))).toEqual({
      backend_id: "local-clap",
      labels: ["hypnotic sunrise", "warm analog glow"],
      audio_paths: { "track-one": "Sets/track-one.wav" },
    });
  });
});

describe("semantic embedding acquisition", () => {
  const backend = {
    id: "local-muq-mulan",
    display_name: "Local MuQ-MuLan",
    model: "muq-local-v1",
    available: true,
    requires_local_audio: true,
    max_tracks: 100,
    max_labels: 20,
    max_embedding_batch: 2,
    capabilities: ["text_similarity", "embedding_extraction"] as const,
    embedding_representation: "muq-mean-v1",
  };

  it("acquires bounded chunks and preserves visible cache and failure metadata", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { audio_paths: Record<string, string> };
      const ids = Object.keys(body.audio_paths);
      const failed = ids.filter((id) => id === "track-3");
      return {
        ok: true,
        json: async () => ({
          backend: { ...backend, embedding_dimension: 2 },
          representation: "muq-mean-v1",
          dimension: 2,
          embeddings: ids.map((trackId) => trackId === "track-3"
            ? { track_id: trackId, status: "failed", values: [], cache_status: null, error: "Could not extract." }
            : { track_id: trackId, status: "complete", values: [1, 0], cache_status: "miss", error: null }),
          failed_track_ids: failed,
          cache: { hits: 0, misses: ids.length - failed.length, deduplicated: 0, evictions: 0, entries: ids.length, capacity: 128 },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await extractSemanticEmbeddings({
      backend,
      audioPaths: {
        "track-1": "set/one.wav",
        "track-2": "set/two.wav",
        "track-3": "set/three.wav",
        "track-4": "set/four.wav",
        "track-5": "set/five.wav",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([, options]) =>
      Object.keys(JSON.parse(String(options?.body)).audio_paths).length)).toEqual([2, 2, 1]);
    expect(response.embeddings.map(({ track_id }) => track_id)).toEqual([
      "track-1", "track-2", "track-3", "track-4", "track-5",
    ]);
    expect(response.failed_track_ids).toEqual(["track-3"]);
    expect(response.cache).toMatchObject({ misses: 4, hits: 0, entries: 1, capacity: 128 });
  });

  it("rejects mixed model revisions before consumers can compare the vectors", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      return {
        ok: true,
        json: async () => ({
          backend: { ...backend, model: call === 1 ? "muq-local-v1" : "muq-local-v2", embedding_dimension: 2 },
          representation: "muq-mean-v1",
          dimension: 2,
          embeddings: [{ track_id: `track-${call}`, status: "complete", values: [1, 0], cache_status: "miss" }],
          failed_track_ids: [],
          cache: { hits: 0, misses: 1, deduplicated: 0, evictions: 0, entries: call, capacity: 128 },
        }),
      };
    }));

    await expect(extractSemanticEmbeddings({
      backend,
      audioPaths: { "track-1": "one.wav", "track-2": "two.wav", "track-3": "three.wav" },
    })).rejects.toThrow("incompatible model spaces");
  });
});

describe("Spotify destination API", () => {
  it("never enables native network replay for a Spotify create mutation", () => {
    expect(apiNetworkAttemptLimit({ nativeApi: true, retryNetworkErrors: false })).toBe(1);
    expect(apiNetworkAttemptLimit({ nativeApi: true, retryNetworkErrors: true })).toBeGreaterThan(1);
  });

  it("reads status and saves only the public client ID", async () => {
    const status = {
      configured: false,
      authenticated: false,
      client_id: null,
      redirect_uri: "http://127.0.0.1:8001/api/v1/spotify/auth/callback",
      scopes: [],
      token_expires_at: null,
      pending_authorization: false,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => status });
    vi.stubGlobal("fetch", fetchMock);

    await getSpotifyStatus();
    await configureSpotify("public-client-id");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/spotify/status");
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/v1/spotify/config");
    expect(JSON.parse(String(options.body))).toEqual({ client_id: "public-client-id" });
    expect(String(options.body)).not.toContain("secret");
  });

  it("starts PKCE authorization and matches a maximum of ten full tracks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await startSpotifyAuthorization();
    await matchSpotifyTracks(inputPlaylist.tracks);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/spotify/auth/start");
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/v1/spotify/matches");
    expect(JSON.parse(String(options.body))).toEqual({ tracks: inputPlaylist.tracks });

    expect(() => matchSpotifyTracks([])).toThrow(/between 1 and 10/i);
    expect(() => matchSpotifyTracks(Array.from(
      { length: 11 },
      (_, index) => ({ ...inputPlaylist.tracks[0], id: `track-${index}` }),
    ))).toThrow(/between 1 and 10/i);
  });

  it("sends canonical Spotify playlist positions and visibility", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    const payload = {
      idempotency_key: "12345678-1234-1234-1234-123456789abc",
      public: false,
      playlists: [{
        position: 1,
        name: "Low",
        description: "Created by Flowset",
        tracks: [
          { position: 1, local_track_id: "second", spotify_uri: "spotify:track:second" },
          { position: 2, local_track_id: "first", spotify_uri: "spotify:track:first" },
          { position: 3, local_track_id: "second", spotify_uri: "spotify:track:second" },
        ],
      }],
    };

    await createSpotifyPlaylists(payload);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/spotify/playlists/create");
    expect(JSON.parse(String(options.body))).toEqual(payload);
  });

  it("does not replay a Spotify create request after a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("connection dropped"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createSpotifyPlaylists({
      idempotency_key: "12345678-1234-1234-1234-123456789abc",
      public: false,
      playlists: [{
        position: 1,
        name: "Low",
        description: "Created by Flowset",
        tracks: [],
      }],
    })).rejects.toThrow(/connection dropped/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
