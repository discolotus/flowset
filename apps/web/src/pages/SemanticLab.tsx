import { useEffect, useMemo, useState } from "react";

import { getSemanticCapabilities, localAudioPreviewUrl, rankSemanticAudio } from "../lib/api";
import { createTextRankingRun, fingerprintTrackIds, rememberSemanticRun } from "../lib/semantic/runs";
import type { SemanticExperimentRunV1, SemanticPromotion, SemanticRecipeScope } from "../lib/semantic/types";
import type { SemanticBackendCapabilities, Track } from "../lib/types";

const ALL_SCOPES: SemanticRecipeScope[] = ["distribution", "split", "subgroup", "sort"];

export function SemanticLab({ tracks, audioPaths, runs, onRunsChange, onPromote }: {
  tracks: readonly Track[];
  audioPaths: Record<string, string>;
  runs: readonly SemanticExperimentRunV1[];
  onRunsChange: (runs: readonly SemanticExperimentRunV1[]) => void;
  onPromote: (promotion: SemanticPromotion, scoresByTrack: ReadonlyMap<string, Track["semantic_scores"]>) => boolean;
}) {
  const authorizedTracks = useMemo(() => tracks.filter(({ id }) => Boolean(audioPaths[id])), [audioPaths, tracks]);
  const [backends, setBackends] = useState<SemanticBackendCapabilities[]>([]);
  const [backendId, setBackendId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRunId, setActiveRunId] = useState(runs[0]?.id ?? "");
  const [sortDirection, setSortDirection] = useState<"descending" | "ascending">("descending");
  const [scopes, setScopes] = useState<Record<SemanticRecipeScope, boolean>>({ distribution: true, split: false, subgroup: false, sort: false });
  const [status, setStatus] = useState("Checking local semantic backends…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSemanticCapabilities().then((items) => {
      setBackends(items);
      const first = items.find((item) => item.available && item.capabilities.includes("text_similarity"))
        ?? items.find((item) => item.capabilities.includes("text_similarity"));
      if (first) setBackendId(first.id);
      setStatus(
        first
          ? "Choose an authorized subset and run one text query."
          : items.length
            ? "No configured backend supports text similarity."
            : "No semantic backends configured.",
      );
    }).catch(() => setStatus("Local semantic backends unavailable. Check the local API setup."));
  }, []);

  useEffect(() => {
    setSelectedIds((current) => {
      const retained = [...current].filter((id) => authorizedTracks.some((track) => track.id === id));
      return new Set(retained.length ? retained : authorizedTracks.map(({ id }) => id));
    });
  }, [authorizedTracks]);

  const backend = backends.find(({ id }) => id === backendId);
  const selectedTracks = authorizedTracks.filter(({ id }) => selectedIds.has(id));
  const activeRun = runs.find(({ id }) => id === activeRunId) ?? runs[0];
  const resultRows = useMemo(() => {
    if (!activeRun) return [];
    const metadata = new Map(activeRun.trackSnapshots.map((track) => [track.trackId, track]));
    return activeRun.results.map((result) => ({ result, track: metadata.get(result.trackId), score: result.scores.find(({ key }) => key === activeRun.scoreKey)?.score ?? null }))
      .sort((left, right) => {
        if (left.score == null || right.score == null) {
          if (left.score == null && right.score == null) return left.result.trackId.localeCompare(right.result.trackId);
          return left.score == null ? 1 : -1;
        }
        const difference = sortDirection === "descending" ? right.score - left.score : left.score - right.score;
        return difference || left.result.trackId.localeCompare(right.result.trackId);
      });
  }, [activeRun, sortDirection]);
  const oversized = Boolean(backend && selectedTracks.length > backend.max_tracks);
  const staleSource = Boolean(activeRun && activeRun.sourceTrackSetFingerprint !== fingerprintTrackIds(tracks.map(({ id }) => id)));
  const hasPromotableScores = Boolean(activeRun?.results.some((result) =>
    result.status === "complete" && result.scores.some(({ key }) => key === activeRun.scoreKey),
  ));

  async function runExperiment() {
    if (!backend || !selectedTracks.length || oversized || !query.trim()) return;
    setBusy(true);
    const createdAt = new Date().toISOString();
    try {
      const response = await rankSemanticAudio({ backendId: backend.id, label: query, audioPaths: Object.fromEntries(selectedTracks.map(({ id }) => [id, audioPaths[id]])) });
      const completedAt = new Date().toISOString();
      const run = createTextRankingRun({ id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`, query, tracks: selectedTracks, sourceTrackIds: tracks.map(({ id }) => id), backend: response.backend ?? backend, response, createdAt, completedAt });
      onRunsChange(rememberSemanticRun(runs, run));
      setActiveRunId(run.id);
      setStatus(`${run.results.filter(({ status: resultStatus }) => resultStatus === "complete").length} ranked · ${run.results.filter(({ status: resultStatus }) => resultStatus !== "complete").length} unavailable. Recipe unchanged.`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Semantic ranking failed.");
    } finally { setBusy(false); }
  }

  function promote() {
    if (!activeRun || staleSource || !hasPromotableScores || !Object.values(scopes).some(Boolean)) return;
    const byTrack = new Map(activeRun.results.map((result) => [result.trackId, [...result.scores]]));
    const promoted = onPromote({ runId: activeRun.id, scoreKey: activeRun.scoreKey, scopes }, byTrack);
    setStatus(promoted ? "Score promoted to the selected recipe scopes." : "Promotion blocked because the selected source set changed.");
  }

  return <div className="grid gap-8">
    <section>
      <p className="eyebrow">Semantic Lab</p>
      <h1 className="mt-3 font-display text-4xl font-semibold">Explore locally. Promote deliberately.</h1>
      <p className="mt-3 max-w-3xl text-sm text-mist/65">Experiments use only authorized local tracks and cannot change the playlist recipe until you promote a score. Recent runs are bounded to this session.</p>
    </section>

    <section aria-labelledby="backend-heading">
      <h2 id="backend-heading" className="font-display text-xl font-semibold">Backend capabilities</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-3">{backends.map((item) => <article key={item.id} className="rounded-lg border border-line p-4">
        <div className="flex justify-between gap-2"><strong>{item.display_name}</strong><span>{item.available ? "Available" : "Unavailable"}</span></div>
        <p className="mt-1 text-xs text-mist/60">{item.model} · up to {item.max_tracks} tracks</p>
        <p className="mt-2 text-xs">{item.capabilities.map((capability) => capability.replaceAll("_", " ")).join(" · ")}</p>
        {item.detail && <p className="mt-2 text-xs text-mist/60">{item.detail}</p>}
        {item.license_note && <p className="mt-2 text-[10px] text-amber-200">{item.license_note}</p>}
      </article>)}</div>
    </section>

    <section className="rounded-lg border border-line p-5" aria-labelledby="experiment-heading">
      <h2 id="experiment-heading" className="font-display text-xl font-semibold">Text-ranking experiment</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label>Backend<select aria-label="Lab backend" className="mt-1 w-full rounded border border-line bg-ink p-2" value={backendId} onChange={(event) => setBackendId(event.target.value)}>{backends.filter((item) => item.capabilities.includes("text_similarity")).map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.available ? "" : " (unavailable)"}</option>)}</select></label>
        <label>Text query<input aria-label="Lab text query" className="mt-1 w-full rounded border border-line bg-black/20 p-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. hypnotic sunrise" /></label>
      </div>
      <fieldset className="mt-4"><legend>Authorized track subset ({selectedTracks.length}{backend ? `/${backend.max_tracks}` : ""})</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{authorizedTracks.map((track) => <label key={track.id} className="rounded border border-line p-2"><input type="checkbox" checked={selectedIds.has(track.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(track.id) : next.delete(track.id); return next; })} /> {track.name} · {track.artist}</label>)}</div>
      </fieldset>
      {authorizedTracks.length === 0 && <p role="alert" className="mt-3 text-amber-200">Import and select local tracks with authorized audio paths in Playlist Builder first.</p>}
      {oversized && <p role="alert" className="mt-3 text-amber-200">Select at most {backend?.max_tracks} tracks for this backend.</p>}
      <button type="button" className="primary-button mt-4" disabled={busy || !backend?.available || !query.trim() || !selectedTracks.length || oversized} onClick={runExperiment}>{busy ? "Running…" : "Run experiment"}</button>
      <p role="status" className="mt-3 text-xs text-mist/60">{status}</p>
    </section>

    {activeRun && <section aria-labelledby="results-heading">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Recent run</p><h2 id="results-heading" className="font-display text-xl font-semibold">{activeRun.query}</h2><p className="text-xs text-mist/60">{activeRun.backend.display_name} · {activeRun.backend.model} · {activeRun.status} · {activeRun.durationMs} ms · {activeRun.trackSetFingerprint}</p></div>
      <label>Recent runs<select aria-label="Recent experiment run" value={activeRun.id} onChange={(event) => setActiveRunId(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{run.query} · {run.createdAt}</option>)}</select></label></div>
      <table className="mt-4 w-full text-left text-sm"><caption className="sr-only">Semantic ranking results</caption><thead><tr><th>Track</th><th>Status</th><th>Model provenance</th><th><button type="button" onClick={() => setSortDirection((current) => current === "descending" ? "ascending" : "descending")}>Score {sortDirection === "descending" ? "↓" : "↑"}</button></th><th>Preview</th></tr></thead>
      <tbody>{resultRows.map(({ result, track, score }) => <tr key={result.trackId} className="border-t border-line"><td className="py-3"><strong>{track?.name ?? result.trackId}</strong><br/><span className="text-xs text-mist/60">{track ? `${track.artist} · ${track.album}` : "Metadata unavailable"}</span></td><td>{result.status}{result.error ? ` · ${result.error}` : ""}</td><td>{activeRun.backend.id}<br/><span className="text-xs">{activeRun.backend.model}</span></td><td>{score == null ? "—" : score.toFixed(4)}</td><td>{audioPaths[result.trackId] ? <audio aria-label={`Preview ${track?.name ?? result.trackId}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[result.trackId])} /> : "Unavailable"}</td></tr>)}</tbody></table>
      <fieldset className="mt-5"><legend>Promote score to recipe</legend><div className="flex flex-wrap gap-4">{ALL_SCOPES.map((scope) => <label key={scope} className="capitalize"><input type="checkbox" checked={scopes[scope]} onChange={(event) => setScopes((current) => ({ ...current, [scope]: event.target.checked }))} /> {scope === "sort" ? "ordering / sort" : scope}</label>)}</div></fieldset>
      {staleSource && <p role="alert" className="mt-3 text-amber-200">The selected source set changed after this experiment. Run it again before promotion.</p>}
      {!hasPromotableScores && <p role="alert" className="mt-3 text-amber-200">This run produced no usable scores to promote.</p>}
      <button type="button" className="primary-button mt-3" onClick={promote} disabled={staleSource || !hasPromotableScores || !Object.values(scopes).some(Boolean)}>Promote score to recipe</button>
    </section>}
  </div>;
}
