import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiRequestError,
  configureSpotify,
  createSpotifyPlaylists,
  disconnectSpotify,
  getSpotifyStatus,
  matchSpotifyTracks,
  startSpotifyAuthorization,
} from "../lib/api";
import {
  expiredSpotifyConnection,
  openSpotifyAuthorization,
  waitForSpotifyAuthentication,
  type NativeSpotifyAuthorizationOpener,
} from "../lib/spotifyAuthorization";
import {
  readStoredSpotifyClientId,
  storeSpotifyClientId,
} from "../lib/spotifyClientConfig";
import {
  buildSpotifyCreatePlan,
  createSpotifyIdempotencyKey,
  expectedSpotifyPlaylistName,
  initialSpotifyDecisions,
  safeSpotifyWebUrl,
  selectSpotifyCandidate,
  spotifyCreateIntentSignature,
  spotifyExportPreflight,
  spotifyMatchBatches,
  spotifyReviewCounts,
  uniqueSpotifySourceTracks,
  type SpotifyCreatePlan,
  type SpotifyMatchDecision,
} from "../lib/spotifyExport";
import type {
  RecipeOutput,
  SpotifyConnectionStatus,
  SpotifyPlaylistCreateResponse,
  SpotifyTrackMatchResult,
  Track,
} from "../lib/types";

type SpotifyReviewPhase =
  | "idle"
  | "matching"
  | "review"
  | "final_review"
  | "creating"
  | "complete"
  | "error";

interface SpotifyDestinationProps {
  outputs: readonly RecipeOutput[];
  revision: number;
  nativeApp: boolean;
  localSource: boolean;
  disabled?: boolean;
  openAuthorization?: NativeSpotifyAuthorizationOpener;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function missingMatchResult(track: Track, error: string): SpotifyTrackMatchResult {
  return {
    local_track_id: track.id,
    status: "error",
    confidence: 0,
    query: `${track.name} ${track.artist}`,
    candidates: [],
    error,
  };
}

function selectionLabel(decision: SpotifyMatchDecision | undefined): string {
  if (decision?.kind === "selected") {
    return decision.automatic ? "High-confidence match" : "Chosen match";
  }
  if (decision?.kind === "excluded") return "Explicitly excluded";
  return "Needs review";
}

const REVIEW_VALIDATION_IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000000";

function isSpotifyAuthenticationError(reason: unknown): boolean {
  return reason instanceof ApiRequestError && reason.status === 401;
}

export function SpotifyDestination({
  outputs,
  revision,
  nativeApp,
  localSource,
  disabled = false,
  openAuthorization,
}: SpotifyDestinationProps) {
  const uniqueTracks = useMemo(() => uniqueSpotifySourceTracks(outputs), [outputs]);
  const preflightIssues = useMemo(() => spotifyExportPreflight(outputs), [outputs]);
  const [connection, setConnection] = useState<SpotifyConnectionStatus | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [clientId, setClientId] = useState("");
  const [phase, setPhase] = useState<SpotifyReviewPhase>("idle");
  const [results, setResults] = useState<Record<string, SpotifyTrackMatchResult>>({});
  const [decisions, setDecisions] = useState<Record<string, SpotifyMatchDecision>>({});
  const [matchProgress, setMatchProgress] = useState({ completed: 0, total: 0 });
  const [reviewWarnings, setReviewWarnings] = useState<string[]>([]);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [publicPlaylist, setPublicPlaylist] = useState(false);
  const [creationPlan, setCreationPlan] = useState<SpotifyCreatePlan | null>(null);
  const [creationReport, setCreationReport] = useState<SpotifyPlaylistCreateResponse | null>(null);
  const runRevision = useRef(0);
  const currentPreviewRevision = useRef(revision);
  const reviewedPreviewRevision = useRef<number | null>(null);
  const idempotencyIntent = useRef<{ signature: string; key: string } | null>(null);

  const browserStorage = (() => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    let active = true;
    setConnectionBusy(true);
    getSpotifyStatus()
      .then(async (status) => {
        if (!active) return;
        let resolvedStatus = status;
        const storedClientId = readStoredSpotifyClientId(browserStorage);
        if (!status.configured && storedClientId) {
          try {
            resolvedStatus = await configureSpotify(storedClientId);
          } catch (reason: unknown) {
            setConnectionError(
              reason instanceof Error
                ? `The saved Spotify Client ID could not be restored: ${reason.message}`
                : "The saved Spotify Client ID could not be restored.",
            );
          }
        }
        if (!active) return;
        setConnection(resolvedStatus);
        setNeedsReconnect(resolvedStatus.reauthorization_required);
        if (resolvedStatus.reauthorization_required) {
          setConnectionError(
            resolvedStatus.detail ?? "Spotify authorization expired. Connect Spotify again.",
          );
        }
        setClientId(resolvedStatus.client_id ?? storedClientId);
        storeSpotifyClientId(browserStorage, resolvedStatus.client_id ?? storedClientId);
        setSetupExpanded(!resolvedStatus.configured);
      })
      .catch((reason: unknown) => {
        if (active) {
          setConnectionError(
            reason instanceof Error ? reason.message : "Could not read Spotify connection status.",
          );
        }
      })
      .finally(() => {
        if (active) setConnectionBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    currentPreviewRevision.current = revision;
    runRevision.current += 1;
    reviewedPreviewRevision.current = null;
    idempotencyIntent.current = null;
    if (phase !== "creating") {
      setPhase("idle");
      setResults({});
      setDecisions({});
      setMatchProgress({ completed: 0, total: 0 });
      setReviewWarnings([]);
      setReviewError(null);
      setCreationPlan(null);
      setCreationReport(null);
    }
    // The revision is the intentional boundary: it changes as soon as any recipe input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  const counts = useMemo(() => spotifyReviewCounts({
    tracks: uniqueTracks,
    results,
    decisions,
  }), [decisions, results, uniqueTracks]);

  const readyPlan = useMemo(() => {
    if (phase !== "review") return null;
    try {
      return buildSpotifyCreatePlan({
        outputs,
        decisions,
        publicPlaylist,
        idempotencyKey: REVIEW_VALIDATION_IDEMPOTENCY_KEY,
      });
    } catch {
      return null;
    }
  }, [decisions, outputs, phase, publicPlaylist]);

  const saveSetup = async () => {
    if (phase === "creating") return;
    const trimmedClientId = clientId.trim();
    if (!trimmedClientId) {
      setConnectionError("Enter the public Client ID from your Spotify developer app.");
      return;
    }
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      const status = await configureSpotify(trimmedClientId);
      setConnection(status);
      setNeedsReconnect(status.reauthorization_required);
      if (status.reauthorization_required) {
        setConnectionError(
          status.detail ?? "Spotify authorization expired. Connect Spotify again.",
        );
      }
      setClientId(status.client_id ?? trimmedClientId);
      storeSpotifyClientId(browserStorage, status.client_id ?? trimmedClientId);
      setSetupExpanded(false);
    } catch (reason: unknown) {
      setConnectionError(
        reason instanceof Error ? reason.message : "Could not save Spotify setup.",
      );
    } finally {
      setConnectionBusy(false);
    }
  };

  const connect = async () => {
    setConnectionBusy(true);
    setConnectionError(null);
    const browserAuthorizationWindow = !nativeApp
      ? window.open("about:blank", "spotify-authorization")
      : null;
    if (!nativeApp && !browserAuthorizationWindow) {
      setConnectionBusy(false);
      setConnectionError("Allow pop-ups for this page, then connect Spotify again.");
      return;
    }
    let authorizationWindowNavigated = false;
    try {
      const authorization = await startSpotifyAuthorization();
      await openSpotifyAuthorization({
        authorizationUrl: authorization.authorization_url,
        nativeApp,
        openNative: openAuthorization,
        openBrowser: (url) => {
          if (browserAuthorizationWindow) {
            browserAuthorizationWindow.opener = null;
            browserAuthorizationWindow.location.href = url;
            authorizationWindowNavigated = true;
            return browserAuthorizationWindow;
          }
          return window.open(url, "spotify-authorization", "noopener,noreferrer");
        },
      });
      const status = await waitForSpotifyAuthentication({
        getStatus: getSpotifyStatus,
        onStatus: setConnection,
      });
      setConnection(status);
      setNeedsReconnect(status.reauthorization_required);
      if (status.reauthorization_required) {
        setConnectionError(
          status.detail ?? "Spotify authorization expired. Connect Spotify again.",
        );
      }
    } catch (reason: unknown) {
      if (browserAuthorizationWindow && !authorizationWindowNavigated) {
        browserAuthorizationWindow.close();
      }
      setConnectionError(
        reason instanceof Error ? reason.message : "Could not connect Spotify.",
      );
    } finally {
      setConnectionBusy(false);
    }
  };

  const disconnect = async () => {
    if (phase === "creating") return;
    runRevision.current += 1;
    reviewedPreviewRevision.current = null;
    setPhase("idle");
    setResults({});
    setDecisions({});
    setReviewWarnings([]);
    setReviewError(null);
    setConnectionBusy(true);
    setConnectionError(null);
    try {
      const status = await disconnectSpotify();
      setConnection(status);
      setNeedsReconnect(status.reauthorization_required);
      if (status.reauthorization_required) {
        setConnectionError(
          status.detail ?? "Spotify authorization expired. Connect Spotify again.",
        );
      }
    } catch (reason: unknown) {
      setConnectionError(
        reason instanceof Error ? reason.message : "Could not disconnect Spotify.",
      );
    } finally {
      setConnectionBusy(false);
    }
  };

  const reviewMatches = async () => {
    if (
      !connection?.authenticated
      || disabled
      || !localSource
      || uniqueTracks.length === 0
      || preflightIssues.length > 0
    ) return;
    const requestedRevision = revision;
    const run = runRevision.current + 1;
    runRevision.current = run;
    reviewedPreviewRevision.current = null;
    setPhase("matching");
    setSetupExpanded(false);
    setReviewError(null);
    setReviewWarnings([]);
    setCreationPlan(null);
    setCreationReport(null);
    setMatchProgress({ completed: 0, total: uniqueTracks.length });

    const accumulatedResults: Record<string, SpotifyTrackMatchResult> = {};
    const warnings: string[] = [];
    let completed = 0;
    for (const batch of spotifyMatchBatches(uniqueTracks)) {
      if (runRevision.current !== run || currentPreviewRevision.current !== requestedRevision) return;
      try {
        const response = await matchSpotifyTracks(batch);
        warnings.push(...response.warnings);
        const returned = new Map(response.results.map((result) => [result.local_track_id, result]));
        for (const track of batch) {
          accumulatedResults[track.id] = returned.get(track.id)
            ?? missingMatchResult(track, "Spotify returned no result for this local track.");
        }
      } catch (reason: unknown) {
        if (isSpotifyAuthenticationError(reason)) {
          runRevision.current += 1;
          reviewedPreviewRevision.current = null;
          setConnection(expiredSpotifyConnection);
          setNeedsReconnect(true);
          setConnectionError(
            "Your Spotify session expired. Reconnect Spotify, then review the matches again.",
          );
          setPhase("idle");
          setResults({});
          setDecisions({});
          setMatchProgress({ completed: 0, total: 0 });
          return;
        }
        const message = reason instanceof Error ? reason.message : "Spotify matching failed.";
        warnings.push(message);
        for (const track of batch) {
          accumulatedResults[track.id] = missingMatchResult(track, message);
        }
      }
      completed += batch.length;
      if (runRevision.current !== run || currentPreviewRevision.current !== requestedRevision) return;
      setResults({ ...accumulatedResults });
      setDecisions(initialSpotifyDecisions(uniqueTracks, accumulatedResults));
      setMatchProgress({ completed, total: uniqueTracks.length });
      setReviewWarnings([...new Set(warnings)]);
    }
    if (runRevision.current !== run || currentPreviewRevision.current !== requestedRevision) return;
    reviewedPreviewRevision.current = requestedRevision;
    setPhase("review");
  };

  const chooseDecision = (trackId: string, value: string) => {
    if (phase !== "review") return;
    if (value === "excluded") {
      setDecisions((current) => ({ ...current, [trackId]: { kind: "excluded" } }));
      return;
    }
    if (!value) {
      setDecisions((current) => ({ ...current, [trackId]: { kind: "unresolved" } }));
      return;
    }
    const candidate = results[trackId]?.candidates.find(({ spotify_id }) => spotify_id === value);
    if (!candidate) return;
    setDecisions((current) => ({
      ...current,
      [trackId]: selectSpotifyCandidate(candidate),
    }));
  };

  const finalizeReview = () => {
    if (
      phase !== "review"
      || reviewedPreviewRevision.current !== revision
      || currentPreviewRevision.current !== revision
    ) {
      setReviewError("The playlist preview changed. Review Spotify matches again.");
      return;
    }
    try {
      const signature = spotifyCreateIntentSignature({ outputs, decisions, publicPlaylist });
      const idempotencyKey = idempotencyIntent.current?.signature === signature
        ? idempotencyIntent.current.key
        : createSpotifyIdempotencyKey();
      const plan = buildSpotifyCreatePlan({
        outputs,
        decisions,
        publicPlaylist,
        idempotencyKey,
      });
      idempotencyIntent.current = { signature, key: idempotencyKey };
      setCreationPlan(plan);
      setReviewError(null);
      setPhase("final_review");
    } catch (reason: unknown) {
      setReviewError(reason instanceof Error ? reason.message : "The Spotify review is incomplete.");
    }
  };

  const createPlaylists = async () => {
    if (
      phase !== "final_review"
      || reviewedPreviewRevision.current !== revision
      || currentPreviewRevision.current !== revision
      || !creationPlan
    ) {
      setReviewError("The playlist preview changed. Review Spotify matches again before creating anything.");
      return;
    }
    setPhase("creating");
    setReviewError(null);
    try {
      const report = await createSpotifyPlaylists(creationPlan.request);
      setCreationReport(report);
      setPhase("complete");
      reviewedPreviewRevision.current = null;
    } catch (reason: unknown) {
      setPhase("final_review");
      if (isSpotifyAuthenticationError(reason)) {
        setConnection(expiredSpotifyConnection);
        setNeedsReconnect(true);
        setConnectionError(
          "Your Spotify session expired before creation. Reconnect, inspect this same final review, then retry safely.",
        );
      } else {
        setReviewError(
          reason instanceof Error ? reason.message : "Could not create the Spotify playlists.",
        );
      }
    }
  };

  const showWorkspace = setupExpanded
    || phase !== "idle"
    || connectionError != null
    || (localSource && preflightIssues.length > 0);
  const statusLabel = connectionBusy
    ? "Checking Spotify…"
    : connection?.authenticated
      ? "Spotify connected"
      : connection?.configured
        ? needsReconnect ? "Reconnect required" : "Ready to connect"
        : "Setup required";

  return (
    <>
      <article id="spotify-destination" className="export-destination-card spotify-destination-card">
        <span className="export-destination-kicker">Local files → streaming playlists</span>
        <h4>Spotify</h4>
        <p>
          Match local tracks to Spotify, review every result, then create numbered playlists in the exact preview order.
        </p>
        {!connection?.configured ? (
          <button
            type="button"
            className="export-button"
            disabled={connectionBusy}
            onClick={() => setSetupExpanded(true)}
          >
            Set up Spotify
          </button>
        ) : !connection.authenticated ? (
          <button
            type="button"
            className="export-button"
            disabled={connectionBusy}
            onClick={connect}
          >
            {connectionBusy
              ? "Waiting for Spotify…"
              : needsReconnect ? "Reconnect Spotify" : "Connect Spotify"}
          </button>
        ) : (
          <button
            type="button"
            className="export-button"
            disabled={
              disabled
              || !localSource
              || preflightIssues.length > 0
              || phase === "matching"
              || phase === "final_review"
              || phase === "creating"
            }
            onClick={reviewMatches}
          >
            {phase === "matching" ? "Matching tracks…" : "Review Spotify matches"}
          </button>
        )}
        <small className={connection?.authenticated ? "spotify-connected" : ""}>
          {statusLabel}. {!localSource && "Choose Local folders as the source to use this destination."}
        </small>
        {connection?.configured && phase !== "creating" && (
          <div className="spotify-card-links">
            <button type="button" onClick={() => setSetupExpanded((value) => !value)}>Setup</button>
            <button type="button" onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </article>

      {showWorkspace && (
        <section className="spotify-workspace" aria-labelledby="spotify-workspace-title">
          <header className="spotify-workspace-header">
            <div>
              <p className="eyebrow">Spotify destination</p>
              <h4 id="spotify-workspace-title">
                {phase === "matching"
                  ? "Matching the local crate"
                  : phase === "review"
                    ? "Review every local track"
                    : phase === "final_review"
                      ? "Final Spotify dry run"
                    : phase === "creating"
                      ? "Creating playlists"
                      : phase === "complete"
                        ? "Spotify creation report"
                        : "Connection setup"}
              </h4>
            </div>
            {connection?.authenticated && phase !== "complete" && (
              <span className="spotify-status connected">Connected</span>
            )}
          </header>

          {localSource && preflightIssues.length > 0 && (
            <div className="spotify-preflight" role="alert">
              <strong>Spotify export needs attention before matching</strong>
              {preflightIssues.map((issue) => <p key={issue.code}>{issue.message}</p>)}
            </div>
          )}

          {setupExpanded && (
            <div className="spotify-setup">
              <label className="control-field">
                <span>Spotify Client ID</span>
                <input
                  value={clientId}
                  disabled={phase === "creating"}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="Public Client ID"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="control-field">
                <span>Redirect URI</span>
                <input
                  value={connection?.redirect_uri ?? "Loading from the local service…"}
                  readOnly
                  aria-readonly="true"
                />
              </label>
              <div className="spotify-setup-copy">
                <p>Add this exact redirect URI to the allowlist in your Spotify developer app.</p>
                <small>Flowset stores only this public Client ID. No client secret is requested or displayed.</small>
              </div>
              <div className="apple-music-review-actions">
                {connection?.configured && (
                  <button type="button" className="export-button subtle" onClick={() => setSetupExpanded(false)}>Close</button>
                )}
                <button type="button" className="export-button" disabled={connectionBusy || phase === "creating"} onClick={saveSetup}>
                  {connectionBusy ? "Saving…" : "Save Spotify setup"}
                </button>
              </div>
            </div>
          )}

          {(phase === "matching" || phase === "review") && (
            <div className="spotify-review">
              <div className="spotify-review-summary">
                <div>
                  <strong>{phase === "matching" ? "Finding candidates" : "Matching review"}</strong>
                  <p>
                    {phase === "matching"
                      ? `${matchProgress.completed}/${matchProgress.total} unique local tracks checked in batches of 10.`
                      : "High-confidence matches are preselected. Ambiguous and missing tracks require your choice or an explicit Exclude."}
                  </p>
                </div>
                {phase === "matching" ? (
                  <progress max={Math.max(matchProgress.total, 1)} value={matchProgress.completed} aria-label="Spotify matching progress" />
                ) : (
                  <div className="spotify-counts" aria-label="Spotify match counts">
                    <span><strong>{counts.matched}</strong> matched</span>
                    <span><strong>{counts.review}</strong> review</span>
                    <span><strong>{counts.unmatched}</strong> unmatched</span>
                    <span><strong>{counts.excluded}</strong> excluded</span>
                  </div>
                )}
              </div>

              {phase === "review" && (
                <div className="spotify-playlist-plan">
                  <div>
                    <strong>{outputs.length} numbered playlist{outputs.length === 1 ? "" : "s"}</strong>
                    <small>Spotify has no playlist folders, so Flowset prefixes names to preserve their order.</small>
                  </div>
                  <ol>
                    {outputs.map((output, index) => (
                      <li key={output.id}>
                        <span>{expectedSpotifyPlaylistName(output.name, index + 1, outputs.length)}</span>
                        <small>{output.tracks.length} ordered entries</small>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="spotify-track-review" aria-label="Local track Spotify matches">
                {uniqueTracks.map((track, index) => {
                  const result = results[track.id];
                  const decision = decisions[track.id];
                  const selectedId = decision?.kind === "selected" ? decision.spotifyId : "";
                  return (
                    <details className="spotify-track-match" key={track.id}>
                      <summary>
                        <span className="spotify-track-number">{String(index + 1).padStart(2, "0")}</span>
                        <span className="spotify-track-source">
                          <strong>{track.name}</strong>
                          <small>{track.artist} · {track.album} · {formatDuration(track.duration_ms)}</small>
                        </span>
                        <span className={`spotify-match-state ${decision?.kind ?? "pending"}`}>
                          {phase === "matching" && !result ? "Waiting" : selectionLabel(decision)}
                        </span>
                      </summary>
                      <div className="spotify-candidate-list">
                        {result?.candidates.length ? result.candidates.map((candidate) => (
                          <label className={`spotify-candidate ${selectedId === candidate.spotify_id ? "selected" : ""}`} key={candidate.spotify_id}>
                            <input
                              type="radio"
                              name={`spotify-match-${track.id}`}
                              checked={selectedId === candidate.spotify_id}
                              disabled={phase !== "review"}
                              onChange={() => chooseDecision(track.id, candidate.spotify_id)}
                            />
                            <span>
                              {safeSpotifyWebUrl(candidate.external_url, "track") ? (
                                <a
                                  href={safeSpotifyWebUrl(candidate.external_url, "track") ?? undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {candidate.name}
                                </a>
                              ) : <strong>{candidate.name}</strong>}
                              <small>{candidate.artist} · {candidate.album} · {formatDuration(candidate.duration_ms)}</small>
                            </span>
                            <em>{candidate.confidence} · {Math.round(candidate.score * 100)} match score</em>
                          </label>
                        )) : (
                          <p className="spotify-no-candidates">
                            {result?.error ?? "No Spotify candidates were found for this local file."}
                          </p>
                        )}
                        <label className={`spotify-candidate exclude ${decision?.kind === "excluded" ? "selected" : ""}`}>
                          <input
                            type="radio"
                            name={`spotify-match-${track.id}`}
                            checked={decision?.kind === "excluded"}
                            disabled={phase !== "review"}
                            onChange={() => chooseDecision(track.id, "excluded")}
                          />
                          <span>
                            <strong>Exclude this local track</strong>
                            <small>It will be omitted everywhere it occurs, and counted in the review.</small>
                          </span>
                        </label>
                      </div>
                    </details>
                  );
                })}
              </div>

              {phase === "review" && (
                <div className="spotify-create-actions">
                  <label className="control-field">
                    <span>Spotify visibility</span>
                    <select value={publicPlaylist ? "public" : "private"} onChange={(event) => setPublicPlaylist(event.target.value === "public")}>
                      <option value="private">Private (default)</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  <div>
                    <p>
                      {readyPlan
                        ? `${readyPlan.submittedEntryCount} ordered entries ready; ${readyPlan.excludedEntryCount} explicitly excluded.`
                        : `${counts.review + counts.unmatched} local track${counts.review + counts.unmatched === 1 ? " still needs" : "s still need"} a match or Exclude choice.`}
                    </p>
                    <button type="button" className="export-button" disabled={!readyPlan || disabled || connectionBusy} onClick={finalizeReview}>
                      Review final Spotify plan
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === "final_review" && creationPlan && (
            <div className="spotify-final-review" role="group" aria-label="Final Spotify creation review">
              <div className="spotify-final-review-heading">
                <div>
                  <strong>Dry run only — nothing has been created yet</strong>
                  <p>
                    {creationPlan.playlists.length} numbered playlist{creationPlan.playlists.length === 1 ? "" : "s"} · {creationPlan.submittedEntryCount} matched entries · {creationPlan.excludedEntryCount} explicit exclusion{creationPlan.excludedEntryCount === 1 ? "" : "s"} · {creationPlan.request.public ? "public" : "private"}
                  </p>
                </div>
                <small>Every row below follows the canonical preview order. Repeated tracks remain repeated.</small>
              </div>
              <ol className="spotify-final-playlists">
                {creationPlan.playlists.map((playlist) => (
                  <li key={playlist.position}>
                    <details open>
                      <summary>
                        <span>
                          <strong>{playlist.expectedName}</strong>
                          <small>{playlist.submittedTrackCount} matched · {playlist.excludedEntryCount} excluded</small>
                        </span>
                        <span>Inspect ordered entries</span>
                      </summary>
                      <ol className="spotify-final-entries">
                        {playlist.entries.map((entry) => {
                          const candidate = entry.spotifyUri
                            ? results[entry.localTrackId]?.candidates.find(
                              ({ uri }) => uri === entry.spotifyUri,
                            )
                            : null;
                          const candidateUrl = safeSpotifyWebUrl(
                            candidate?.external_url,
                            "track",
                          );
                          return (
                            <li
                              className={entry.action === "excluded" ? "excluded" : ""}
                              key={`${entry.sourcePosition}-${entry.localTrackId}`}
                            >
                              <span className="spotify-final-position">
                                {String(entry.sourcePosition).padStart(3, "0")}
                              </span>
                              <span className="spotify-final-local">
                                <strong>{entry.localTrackName}</strong>
                                <small>{entry.localArtist} · local ID {entry.localTrackId}</small>
                              </span>
                              {entry.action === "excluded" ? (
                                <span className="spotify-final-excluded">Explicitly excluded · no Spotify write</span>
                              ) : (
                                <span className="spotify-final-match">
                                  {candidateUrl && candidate ? (
                                    <a href={candidateUrl} target="_blank" rel="noopener noreferrer">
                                      {candidate.name} — {candidate.artist}
                                    </a>
                                  ) : candidate ? (
                                    <span>{candidate.name} — {candidate.artist}</span>
                                  ) : null}
                                  <code>{entry.spotifyUri}</code>
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  </li>
                ))}
              </ol>
              <div className="spotify-final-actions">
                <button
                  type="button"
                  className="export-button subtle"
                  onClick={() => {
                    setCreationPlan(null);
                    setReviewError(null);
                    setPhase("review");
                  }}
                >
                  Back to match choices
                </button>
                <div>
                  {!connection?.authenticated && <p>Reconnect Spotify before creating this reviewed plan.</p>}
                  <button
                    type="button"
                    className="export-button"
                    disabled={disabled || connectionBusy || !connection?.authenticated}
                    onClick={createPlaylists}
                  >
                    Create in Spotify
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase === "creating" && (
            <p className="spotify-creating" role="status">
              Creating {creationPlan?.playlists.length ?? outputs.length} numbered Spotify playlists and adding tracks in canonical order…
            </p>
          )}

          {phase === "complete" && creationReport && (
            <div className="spotify-creation-report">
              <p className={creationReport.failed_count > 0 || creationReport.partial_count > 0 || !creationReport.all_orders_verified ? "error" : ""} role="status">
                {creationReport.created_count} created · {creationReport.partial_count} partial · {creationReport.failed_count} failed
                {creationReport.replayed ? " · safely recovered the earlier result" : ""}
                {creationPlan?.excludedEntryCount ? ` · ${creationPlan.excludedEntryCount} explicitly excluded before creation` : ""}
                {creationReport.all_orders_verified ? " · every created order verified." : " · one or more orders could not be verified."}
              </p>
              <ol>
                {creationReport.results.map((result) => {
                  const failedTracks = result.track_results.filter(({ status }) => status === "failed");
                  const playlistUrl = safeSpotifyWebUrl(result.spotify_url, "playlist");
                  return (
                    <li key={`${result.position}-${result.name}`}>
                      <div>
                        <strong>{result.name}</strong>
                        <small>
                          {result.added_track_count}/{result.requested_track_count} added · {result.status} · {result.order_verified === true ? "order verified" : result.order_verified === false ? "order mismatch" : "order not verified"}
                        </small>
                      </div>
                      {playlistUrl && <a href={playlistUrl} target="_blank" rel="noopener noreferrer">Open playlist</a>}
                      {result.error && <p>{result.error}</p>}
                      {failedTracks.length > 0 && (
                        <details className="spotify-failed-tracks" open>
                          <summary>
                            {failedTracks.length} failed position{failedTracks.length === 1 ? "" : "s"}: {failedTracks.map(({ position }) => `#${position}`).join(", ")}
                          </summary>
                          <ul>
                            {failedTracks.map((trackResult) => (
                              <li key={`${trackResult.position}-${trackResult.local_track_id}`}>
                                <strong>#{trackResult.position} · local ID {trackResult.local_track_id}</strong>
                                <code>{trackResult.spotify_uri}</code>
                                <span>{trackResult.error ?? "Spotify did not confirm this track was added."}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ol>
              {creationReport.warnings.length > 0 && <small>{creationReport.warnings.join(" ")}</small>}
            </div>
          )}

          {(connectionError || reviewError || reviewWarnings.length > 0) && (
            <div className={connectionError || reviewError ? "spotify-workspace-error" : "spotify-workspace-warning"} role={connectionError || reviewError ? "alert" : "status"}>
              {connectionError ?? reviewError ?? reviewWarnings.join(" ")}
            </div>
          )}
        </section>
      )}
    </>
  );
}
