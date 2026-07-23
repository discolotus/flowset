import { describe, expect, it } from "vitest";

import {
  automaticSpotifyDecision,
  buildSpotifyCreatePlan,
  createSpotifyIdempotencyKey,
  expectedSpotifyPlaylistName,
  initialSpotifyDecisions,
  safeSpotifyWebUrl,
  spotifyCreateIntentSignature,
  spotifyMatchBatches,
  spotifyExportPreflight,
  spotifyReviewCounts,
  uniqueSpotifySourceTracks,
} from "./spotifyExport";
import type {
  RecipeOutput,
  SpotifyMatchCandidate,
  SpotifyTrackMatchResult,
  Track,
} from "./types";

function track(id: string): Track {
  return {
    id,
    name: `Track ${id}`,
    artist: "Artist",
    album: "Album",
    duration_ms: 180_000,
    explicit: false,
    genres: [],
  };
}

function output(name: string, tracks: Track[]): RecipeOutput {
  return {
    id: name,
    name,
    split_parameter: null,
    bin_index: null,
    range: null,
    split_assignments: [],
    track_count: tracks.length,
    tracks,
    groups: [],
    summary: {
      song_count: tracks.length,
      duration_ms: tracks.length * 180_000,
      average_energy: null,
      average_bpm: null,
      average_danceability: null,
      energy_range: null,
    },
  };
}

function candidate(id: string, confidence: SpotifyMatchCandidate["confidence"]): SpotifyMatchCandidate {
  return {
    spotify_id: id,
    uri: `spotify:track:${id}`,
    name: `Spotify ${id}`,
    artist: "Artist",
    album: "Album",
    duration_ms: 180_000,
    isrc: null,
    external_url: `https://open.spotify.com/track/${id}`,
    score: confidence === "high" ? 0.98 : 0.7,
    confidence,
    signals: { isrc: null, name: 1, artist: 1, album: 1, duration: 1, version: 1 },
  };
}

function result(
  localTrackId: string,
  status: SpotifyTrackMatchResult["status"],
  confidence: number,
  candidates: SpotifyMatchCandidate[],
): SpotifyTrackMatchResult {
  return {
    local_track_id: localTrackId,
    status,
    confidence,
    query: `Track ${localTrackId} Artist`,
    candidates,
    error: null,
  };
}

describe("Spotify local-track review", () => {
  it("matches each unique local track once and uses API-sized batches", () => {
    const tracks = Array.from({ length: 23 }, (_, index) => track(String(index)));
    const outputs = [output("One", [...tracks, tracks[0]]), output("Two", [tracks[0]])];
    const unique = uniqueSpotifySourceTracks(outputs);

    expect(unique).toHaveLength(23);
    expect(spotifyMatchBatches(unique).map((batch) => batch.length)).toEqual([10, 10, 3]);
  });

  it("only auto-selects a high-confidence matched candidate", () => {
    const high = result("one", "matched", 0.98, [candidate("high", "high")]);
    const ambiguous = result("two", "ambiguous", 0.72, [candidate("medium", "medium")]);
    const mismatchedConfidence = result("three", "matched", 0.72, [candidate("medium", "medium")]);

    expect(automaticSpotifyDecision(high)).toMatchObject({
      kind: "selected",
      spotifyId: "high",
      automatic: true,
    });
    expect(automaticSpotifyDecision(ambiguous)).toEqual({ kind: "unresolved" });
    expect(automaticSpotifyDecision(mismatchedConfidence)).toEqual({ kind: "unresolved" });
  });

  it("keeps review and no-candidate counts separate with no silent drops", () => {
    const tracks = [track("high"), track("review"), track("missing"), track("excluded")];
    const results = {
      high: result("high", "matched", 0.98, [candidate("a", "high")]),
      review: result("review", "ambiguous", 0.72, [candidate("b", "medium")]),
      missing: result("missing", "not_found", 0, []),
      excluded: result("excluded", "not_found", 0, []),
    };
    const decisions = initialSpotifyDecisions(tracks, results);
    decisions.excluded = { kind: "excluded" };

    expect(spotifyReviewCounts({ tracks, results, decisions })).toEqual({
      total: 4,
      matched: 1,
      review: 1,
      unmatched: 1,
      excluded: 1,
    });
  });

  it("preserves canonical duplicate order and leaves numbering to the backend", () => {
    const first = track("first");
    const second = track("second");
    const plan = buildSpotifyCreatePlan({
      outputs: [output("Low", [second, first, second]), output("Peak", [first])],
      decisions: {
        first: {
          kind: "selected",
          spotifyId: "spotify-first",
          spotifyUri: "spotify:track:spotify-first",
          confidence: "high",
          automatic: true,
        },
        second: {
          kind: "selected",
          spotifyId: "spotify-second",
          spotifyUri: "spotify:track:spotify-second",
          confidence: "medium",
          automatic: false,
        },
      },
      publicPlaylist: false,
      idempotencyKey: "review-key",
    });

    expect(plan.request.public).toBe(false);
    expect(plan.request.idempotency_key).toBe("review-key");
    expect(plan.request.playlists[0].name).toBe("Low");
    expect(plan.playlists[0].expectedName).toBe("01 - Low");
    expect(plan.request.playlists[0].tracks).toEqual([
      { position: 1, local_track_id: "second", spotify_uri: "spotify:track:spotify-second" },
      { position: 2, local_track_id: "first", spotify_uri: "spotify:track:spotify-first" },
      { position: 3, local_track_id: "second", spotify_uri: "spotify:track:spotify-second" },
    ]);
    expect(plan.request.playlists[1].position).toBe(2);
    expect(plan.submittedEntryCount).toBe(4);
    expect(plan.playlists[0].entries).toEqual([
      {
        sourcePosition: 1,
        spotifyPosition: 1,
        localTrackId: "second",
        localTrackName: "Track second",
        localArtist: "Artist",
        action: "matched",
        spotifyUri: "spotify:track:spotify-second",
      },
      {
        sourcePosition: 2,
        spotifyPosition: 2,
        localTrackId: "first",
        localTrackName: "Track first",
        localArtist: "Artist",
        action: "matched",
        spotifyUri: "spotify:track:spotify-first",
      },
      {
        sourcePosition: 3,
        spotifyPosition: 3,
        localTrackId: "second",
        localTrackName: "Track second",
        localArtist: "Artist",
        action: "matched",
        spotifyUri: "spotify:track:spotify-second",
      },
    ]);
  });

  it("uses contiguous positions after explicit exclusions", () => {
    const first = track("first");
    const excluded = track("excluded");
    const plan = buildSpotifyCreatePlan({
      outputs: [output("Low", [first, excluded, first])],
      decisions: {
        first: {
          kind: "selected",
          spotifyId: "spotify-first",
          spotifyUri: "spotify:track:spotify-first",
          confidence: "high",
          automatic: true,
        },
        excluded: { kind: "excluded" },
      },
      publicPlaylist: true,
      idempotencyKey: "review-key",
    });

    expect(plan.request.playlists[0].tracks.map(({ position }) => position)).toEqual([1, 2]);
    expect(plan.excludedEntryCount).toBe(1);
    expect(plan.request.public).toBe(true);
    expect(plan.playlists[0].entries[1]).toMatchObject({
      sourcePosition: 2,
      spotifyPosition: null,
      localTrackId: "excluded",
      action: "excluded",
      spotifyUri: null,
    });
  });

  it("blocks creation until every local track is selected or excluded", () => {
    expect(() => buildSpotifyCreatePlan({
      outputs: [output("Low", [track("one")])],
      decisions: { one: { kind: "unresolved" } },
      publicPlaylist: false,
      idempotencyKey: "review-key",
    })).toThrow(/explicitly exclude/i);
  });

  it("formats expected numbered names for Spotify's flat playlist list", () => {
    expect(expectedSpotifyPlaylistName("Warmup", 3, 12)).toBe("03 - Warmup");
    expect(expectedSpotifyPlaylistName("Peak", 100, 100)).toBe("100 - Peak");
  });

  it("preflights oversized batches and source names before matching", () => {
    const tooMany = Array.from(
      { length: 217 },
      (_, index) => output(`Playlist ${index}`, [track(String(index))]),
    );
    expect(spotifyExportPreflight(tooMany).map(({ code }) => code)).toContain(
      "too_many_playlists",
    );
    expect(spotifyExportPreflight([
      output("x".repeat(501), [track("long")]),
    ]).map(({ code }) => code)).toContain("source_name_too_long");
  });

  it("mirrors backend Unicode-safe numbered-name truncation", () => {
    const longName = `${"🎛️".repeat(60)} trailing words`;
    const rendered = expectedSpotifyPlaylistName(longName, 1, 216);
    expect(Array.from(rendered)).toHaveLength(100);
    expect(rendered.startsWith("001 - ")).toBe(true);
    expect(rendered.endsWith(" ")).toBe(false);
  });

  it("creates a stable-format review id and accepts only canonical Spotify web links", () => {
    expect(createSpotifyIdempotencyKey(() => "12345678-1234-1234-1234-123456789abc"))
      .toBe("12345678-1234-1234-1234-123456789abc");
    expect(safeSpotifyWebUrl(
      "https://open.spotify.com/track/1234567890123456789012?si=test",
      "track",
    )).toContain("open.spotify.com/track/");
    expect(safeSpotifyWebUrl("javascript:alert(1)", "track")).toBeNull();
    expect(safeSpotifyWebUrl(
      "https://open.spotify.com.example.com/track/1234567890123456789012",
      "track",
    )).toBeNull();
    expect(safeSpotifyWebUrl(
      "https://open.spotify.com/playlist/1234567890123456789012",
      "track",
    )).toBeNull();
  });

  it("keeps the create-intent signature stable until the reviewed payload changes", () => {
    const outputs = [output("Low", [track("one")])];
    const decisions = {
      one: {
        kind: "selected" as const,
        spotifyId: "spotify-one",
        spotifyUri: "spotify:track:spotify-one",
        confidence: "high" as const,
        automatic: true,
      },
    };
    const first = spotifyCreateIntentSignature({ outputs, decisions, publicPlaylist: false });
    expect(spotifyCreateIntentSignature({ outputs, decisions, publicPlaylist: false })).toBe(first);
    expect(spotifyCreateIntentSignature({ outputs, decisions, publicPlaylist: true })).not.toBe(first);
    expect(spotifyCreateIntentSignature({
      outputs,
      decisions: { one: { kind: "excluded" } },
      publicPlaylist: false,
    })).not.toBe(first);
  });
});
