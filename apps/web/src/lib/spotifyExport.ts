import type {
  RecipeOutput,
  SpotifyMatchCandidate,
  SpotifyPlaylistCreateRequest,
  SpotifyTrackMatchResult,
  Track,
} from "./types";

export const SPOTIFY_MATCH_BATCH_SIZE = 10;
export const SPOTIFY_EXCLUDE_VALUE = "__exclude__";
export const SPOTIFY_UI_PLAYLIST_LIMIT = 216;
export const SPOTIFY_SOURCE_NAME_LIMIT = 500;
export const SPOTIFY_FINAL_NAME_LIMIT = 100;

export type SpotifyMatchDecision =
  | { kind: "unresolved" }
  | { kind: "excluded" }
  | {
      kind: "selected";
      spotifyId: string;
      spotifyUri: string;
      confidence: SpotifyMatchCandidate["confidence"];
      automatic: boolean;
    };

export interface SpotifyReviewCounts {
  total: number;
  matched: number;
  review: number;
  unmatched: number;
  excluded: number;
}

export interface SpotifyPlaylistPlanSummary {
  position: number;
  sourceName: string;
  expectedName: string;
  requestedEntryCount: number;
  submittedTrackCount: number;
  excludedEntryCount: number;
  entries: SpotifyPlaylistPlanEntry[];
}

export interface SpotifyPlaylistPlanEntry {
  sourcePosition: number;
  spotifyPosition: number | null;
  localTrackId: string;
  localTrackName: string;
  localArtist: string;
  action: "matched" | "excluded";
  spotifyUri: string | null;
}

export interface SpotifyCreatePlan {
  request: SpotifyPlaylistCreateRequest;
  playlists: SpotifyPlaylistPlanSummary[];
  uniqueTrackCount: number;
  selectedUniqueTrackCount: number;
  excludedUniqueTrackCount: number;
  submittedEntryCount: number;
  excludedEntryCount: number;
}

export interface SpotifyExportPreflightIssue {
  code: "too_many_playlists" | "empty_name" | "source_name_too_long";
  message: string;
  outputIds: string[];
}

export function spotifyExportPreflight(
  outputs: readonly RecipeOutput[],
): SpotifyExportPreflightIssue[] {
  const issues: SpotifyExportPreflightIssue[] = [];
  if (outputs.length > SPOTIFY_UI_PLAYLIST_LIMIT) {
    issues.push({
      code: "too_many_playlists",
      message: `This recipe creates ${outputs.length} playlists, above Flowset's ${SPOTIFY_UI_PLAYLIST_LIMIT}-playlist factor-grid maximum. Reduce one or more factor levels before matching.`,
      outputIds: outputs.map(({ id }) => id),
    });
  }
  const emptyNames = outputs.filter(({ name }) => !name.trim());
  if (emptyNames.length > 0) {
    issues.push({
      code: "empty_name",
      message: `${emptyNames.length} output playlist${emptyNames.length === 1 ? " has" : "s have"} no name. Give every output a name before matching.`,
      outputIds: emptyNames.map(({ id }) => id),
    });
  }
  const longNames = outputs.filter(
    ({ name }) => Array.from(name.trim()).length > SPOTIFY_SOURCE_NAME_LIMIT,
  );
  if (longNames.length > 0) {
    issues.push({
      code: "source_name_too_long",
      message: `${longNames.length} output name${longNames.length === 1 ? " is" : "s are"} longer than Spotify export's ${SPOTIFY_SOURCE_NAME_LIMIT}-character source-name limit. Shorten the recipe/output name before matching.`,
      outputIds: longNames.map(({ id }) => id),
    });
  }
  return issues;
}

export function uniqueSpotifySourceTracks(outputs: readonly RecipeOutput[]): Track[] {
  const seen = new Set<string>();
  const tracks: Track[] = [];
  for (const output of outputs) {
    for (const track of output.tracks) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      tracks.push(track);
    }
  }
  return tracks;
}

export function spotifyMatchBatches(
  tracks: readonly Track[],
  batchSize = SPOTIFY_MATCH_BATCH_SIZE,
): Track[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > SPOTIFY_MATCH_BATCH_SIZE) {
    throw new Error(`Spotify match batches must contain 1–${SPOTIFY_MATCH_BATCH_SIZE} tracks.`);
  }
  const batches: Track[][] = [];
  for (let index = 0; index < tracks.length; index += batchSize) {
    batches.push(tracks.slice(index, index + batchSize));
  }
  return batches;
}

export function automaticSpotifyDecision(
  result: SpotifyTrackMatchResult | undefined,
): SpotifyMatchDecision {
  if (result?.status !== "matched") {
    return { kind: "unresolved" };
  }
  const candidate = result.candidates.reduce<SpotifyMatchCandidate | null>(
    (best, current) => best == null || current.score > best.score ? current : best,
    null,
  );
  if (!candidate || candidate.confidence !== "high") return { kind: "unresolved" };
  return {
    kind: "selected",
    spotifyId: candidate.spotify_id,
    spotifyUri: candidate.uri,
    confidence: candidate.confidence,
    automatic: true,
  };
}

export function initialSpotifyDecisions(
  tracks: readonly Track[],
  results: Readonly<Record<string, SpotifyTrackMatchResult>>,
): Record<string, SpotifyMatchDecision> {
  return Object.fromEntries(
    tracks.map((track) => [track.id, automaticSpotifyDecision(results[track.id])]),
  );
}

export function spotifyReviewCounts({
  tracks,
  results,
  decisions,
}: {
  tracks: readonly Track[];
  results: Readonly<Record<string, SpotifyTrackMatchResult>>;
  decisions: Readonly<Record<string, SpotifyMatchDecision>>;
}): SpotifyReviewCounts {
  const counts: SpotifyReviewCounts = {
    total: tracks.length,
    matched: 0,
    review: 0,
    unmatched: 0,
    excluded: 0,
  };
  for (const track of tracks) {
    const decision = decisions[track.id] ?? { kind: "unresolved" };
    if (decision.kind === "selected") counts.matched += 1;
    else if (decision.kind === "excluded") counts.excluded += 1;
    else if ((results[track.id]?.candidates.length ?? 0) > 0) counts.review += 1;
    else counts.unmatched += 1;
  }
  return counts;
}

export function expectedSpotifyPlaylistName(
  name: string,
  position: number,
  playlistCount: number,
): string {
  const width = Math.max(2, String(Math.max(playlistCount, 1)).length);
  const prefix = `${String(position).padStart(width, "0")} - `;
  const availableCodePoints = SPOTIFY_FINAL_NAME_LIMIT - prefix.length;
  const shortenedName = Array.from(name.trim())
    .slice(0, availableCodePoints)
    .join("")
    .trimEnd();
  return `${prefix}${shortenedName}`;
}

export function buildSpotifyCreatePlan({
  outputs,
  decisions,
  publicPlaylist,
  idempotencyKey,
}: {
  outputs: readonly RecipeOutput[];
  decisions: Readonly<Record<string, SpotifyMatchDecision>>;
  publicPlaylist: boolean;
  idempotencyKey: string;
}): SpotifyCreatePlan {
  if (outputs.length === 0) throw new Error("There are no playlists to create in Spotify.");
  const preflightIssues = spotifyExportPreflight(outputs);
  if (preflightIssues.length > 0) {
    throw new Error(preflightIssues.map(({ message }) => message).join(" "));
  }
  if (!idempotencyKey.trim()) throw new Error("The Spotify review needs an idempotency key.");

  const uniqueTracks = uniqueSpotifySourceTracks(outputs);
  const unresolved = uniqueTracks.filter(
    (track) => !decisions[track.id] || decisions[track.id]?.kind === "unresolved",
  );
  if (unresolved.length > 0) {
    const names = unresolved.slice(0, 3).map(({ artist, name }) => `${artist} — ${name}`).join("; ");
    const remainder = unresolved.length > 3 ? `; and ${unresolved.length - 3} more` : "";
    throw new Error(
      `Match or explicitly exclude all ${unresolved.length} unresolved local track${unresolved.length === 1 ? "" : "s"}: ${names}${remainder}.`,
    );
  }

  let submittedEntryCount = 0;
  let excludedEntryCount = 0;
  const playlists = outputs.map((output, outputIndex) => {
    let spotifyPosition = 0;
    const entries: SpotifyPlaylistPlanEntry[] = output.tracks.map((track, sourceIndex) => {
      const decision = decisions[track.id];
      if (!decision || decision.kind === "unresolved") {
        throw new Error(`The final Spotify review lost its decision for ${track.artist} — ${track.name}.`);
      }
      if (decision.kind === "excluded") {
        excludedEntryCount += 1;
        return {
          sourcePosition: sourceIndex + 1,
          spotifyPosition: null,
          localTrackId: track.id,
          localTrackName: track.name,
          localArtist: track.artist,
          action: "excluded",
          spotifyUri: null,
        };
      }
      submittedEntryCount += 1;
      spotifyPosition += 1;
      return {
        sourcePosition: sourceIndex + 1,
        spotifyPosition,
        localTrackId: track.id,
        localTrackName: track.name,
        localArtist: track.artist,
        action: "matched",
        spotifyUri: decision.spotifyUri,
      };
    });
    const tracks = entries.flatMap((entry) => entry.action === "matched" ? [{
      position: entry.spotifyPosition ?? 0,
      local_track_id: entry.localTrackId,
      spotify_uri: entry.spotifyUri ?? "",
    }] : []);

    const requestedEntryCount = output.tracks.length;
    const excludedForPlaylist = requestedEntryCount - tracks.length;
    return {
      request: {
        position: outputIndex + 1,
        name: output.name.trim(),
        description: "Created by Flowset from an ordered local playlist.",
        tracks,
      },
      summary: {
        position: outputIndex + 1,
        sourceName: output.name,
        expectedName: expectedSpotifyPlaylistName(
          output.name,
          outputIndex + 1,
          outputs.length,
        ),
        requestedEntryCount,
        submittedTrackCount: tracks.length,
        excludedEntryCount: excludedForPlaylist,
        entries,
      },
    };
  });

  if (submittedEntryCount === 0) {
    throw new Error("Every local track is excluded. Select at least one Spotify match to continue.");
  }

  return {
    request: {
      playlists: playlists.map(({ request }) => request),
      public: publicPlaylist,
      idempotency_key: idempotencyKey,
    },
    playlists: playlists.map(({ summary }) => summary),
    uniqueTrackCount: uniqueTracks.length,
    selectedUniqueTrackCount: uniqueTracks.filter(
      ({ id }) => decisions[id]?.kind === "selected",
    ).length,
    excludedUniqueTrackCount: uniqueTracks.filter(
      ({ id }) => decisions[id]?.kind === "excluded",
    ).length,
    submittedEntryCount,
    excludedEntryCount,
  };
}

export function createSpotifyIdempotencyKey(
  randomUuid: () => string = () => globalThis.crypto.randomUUID(),
): string {
  return randomUuid();
}

export function spotifyCreateIntentSignature({
  outputs,
  decisions,
  publicPlaylist,
}: {
  outputs: readonly RecipeOutput[];
  decisions: Readonly<Record<string, SpotifyMatchDecision>>;
  publicPlaylist: boolean;
}): string {
  return JSON.stringify({
    public: publicPlaylist,
    playlists: outputs.map((output, outputIndex) => ({
      position: outputIndex + 1,
      name: output.name.trim(),
      entries: output.tracks.map((track) => {
        const decision = decisions[track.id];
        return decision?.kind === "selected"
          ? [track.id, decision.spotifyUri]
          : [track.id, decision?.kind ?? "unresolved"];
      }),
    })),
  });
}

export function safeSpotifyWebUrl(
  value: string | null | undefined,
  resource: "track" | "playlist",
): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.hostname !== "open.spotify.com"
      || parsed.port !== ""
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.hash !== ""
      || !new RegExp(`^/${resource}/[A-Za-z0-9]{22}/?$`).test(parsed.pathname)
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function selectSpotifyCandidate(
  candidate: SpotifyMatchCandidate,
): SpotifyMatchDecision {
  return {
    kind: "selected",
    spotifyId: candidate.spotify_id,
    spotifyUri: candidate.uri,
    confidence: candidate.confidence,
    automatic: false,
  };
}
