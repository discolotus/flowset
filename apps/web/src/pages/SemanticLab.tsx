import { useEffect, useMemo, useState } from "react";

import { SemanticPromptComposer, SEMANTIC_PROMPT_EXAMPLES, type SemanticPromptRow } from "../components/SemanticPromptComposer";
import { SemanticScoreMatrix } from "../components/SemanticScoreMatrix";
import { getSemanticCapabilities, rankSemanticAudio } from "../lib/api";
import { normalizeSemanticPrompt, validateSemanticPrompts } from "../lib/semantic/prompts";
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
  const [promptRows, setPromptRows] = useState<readonly SemanticPromptRow[]>([{ id: "prompt-initial", value: "" }]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRunId, setActiveRunId] = useState(runs[0]?.id ?? "");
  const [selectedScoreKey, setSelectedScoreKey] = useState("");
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
          ? "Choose an authorized subset and compose a prompt matrix."
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
  const promptValidation = validateSemanticPrompts(promptRows.map(({ value }) => value), backend?.max_labels ?? 1);
  const activeScoreKey = activeRun && Object.values(activeRun.scoreKeysByNormalizedLabel).includes(selectedScoreKey)
    ? selectedScoreKey
    : activeRun?.scoreKey ?? "";
  const oversized = Boolean(backend && selectedTracks.length > backend.max_tracks);
  const staleSource = Boolean(activeRun && activeRun.sourceTrackSetFingerprint !== fingerprintTrackIds(tracks.map(({ id }) => id)));
  const hasPromotableScores = Boolean(activeRun?.results.some((result) =>
    result.status === "complete" && result.scores.some(({ key }) => key === activeScoreKey),
  ));
  const availableCellCount = activeRun?.results.reduce((count, result) => count + result.scores.length, 0) ?? 0;
  const totalCellCount = (activeRun?.trackIds.length ?? 0) * (activeRun?.prompts.length ?? 0);

  async function runExperiment() {
    if (!backend || !selectedTracks.length || oversized || promptValidation.error) return;
    setBusy(true);
    const createdAt = new Date().toISOString();
    try {
      const response = await rankSemanticAudio({ backendId: backend.id, labels: promptValidation.labels, audioPaths: Object.fromEntries(selectedTracks.map(({ id }) => [id, audioPaths[id]])) });
      const completedAt = new Date().toISOString();
      const run = createTextRankingRun({ id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`, labels: promptValidation.labels, tracks: selectedTracks, sourceTrackIds: tracks.map(({ id }) => id), backend: response.backend ?? backend, response, createdAt, completedAt });
      onRunsChange(rememberSemanticRun(runs, run));
      setActiveRunId(run.id);
      setSelectedScoreKey(run.scoreKey);
      setStatus(`${run.results.filter(({ status: resultStatus }) => resultStatus === "complete").length} ranked · ${run.results.filter(({ status: resultStatus }) => resultStatus !== "complete").length} unavailable. Recipe unchanged.`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Semantic ranking failed.");
    } finally { setBusy(false); }
  }

  function promote() {
    if (!activeRun || !activeScoreKey || staleSource || !hasPromotableScores || !Object.values(scopes).some(Boolean)) return;
    const byTrack = new Map(activeRun.results.map((result) => [result.trackId, result.scores.filter(({ key }) => key === activeScoreKey)]));
    const promoted = onPromote({ runId: activeRun.id, scoreKey: activeScoreKey, scopes }, byTrack);
    setStatus(promoted ? "Selected score promoted to the chosen recipe scopes." : "Promotion blocked because the selected source set changed.");
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
        <p className="mt-1 text-xs text-mist/60">{item.model} · up to {item.max_tracks} tracks × {item.max_labels} prompts</p>
        <p className="mt-2 text-xs">{item.capabilities.map((capability) => capability.replaceAll("_", " ")).join(" · ")}</p>
        {item.detail && <p className="mt-2 text-xs text-mist/60">{item.detail}</p>}
        {item.license_note && <p className="mt-2 text-[10px] text-amber-200">{item.license_note}</p>}
      </article>)}</div>
    </section>

    <section className="rounded-lg border border-line p-5" aria-labelledby="experiment-heading">
      <h2 id="experiment-heading" className="font-display text-xl font-semibold">Text-ranking experiment</h2>
      <div className="mt-4 grid gap-4">
        <label>Backend<select aria-label="Lab backend" className="mt-1 w-full rounded border border-line bg-ink p-2" value={backendId} onChange={(event) => setBackendId(event.target.value)}>{backends.filter((item) => item.capabilities.includes("text_similarity")).map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.available ? "" : " (unavailable)"}</option>)}</select></label>
      </div>
      <SemanticPromptComposer
        rows={promptRows}
        maxPrompts={backend?.max_labels ?? 1}
        validationError={promptValidation.error}
        onChange={setPromptRows}
        onUseExamples={() => setPromptRows(SEMANTIC_PROMPT_EXAMPLES.slice(0, backend?.max_labels ?? 1).map((value, index) => ({ id: `example-${index}`, value })))}
      />
      <fieldset className="mt-4"><legend>Authorized track subset ({selectedTracks.length}{backend ? `/${backend.max_tracks}` : ""})</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{authorizedTracks.map((track) => <label key={track.id} className="rounded border border-line p-2"><input type="checkbox" checked={selectedIds.has(track.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(track.id) : next.delete(track.id); return next; })} /> {track.name} · {track.artist}</label>)}</div>
      </fieldset>
      {authorizedTracks.length === 0 && <p role="alert" className="mt-3 text-amber-200">Import and select local tracks with authorized audio paths in Playlist Builder first.</p>}
      {oversized && <p role="alert" className="mt-3 text-amber-200">Select at most {backend?.max_tracks} tracks for this backend.</p>}
      <button type="button" className="primary-button mt-4" disabled={busy || !backend?.available || Boolean(promptValidation.error) || !selectedTracks.length || oversized} onClick={runExperiment}>{busy ? "Running…" : "Run prompt matrix"}</button>
      <p role="status" className="mt-3 text-xs text-mist/60">{status}</p>
    </section>

    {activeRun && <section aria-labelledby="results-heading">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Recent run</p><h2 id="results-heading" className="font-display text-xl font-semibold">{activeRun.prompts.join(" · ")}</h2><p className="text-xs text-mist/60">{activeRun.backend.display_name} · revision {activeRun.backend.model} · {activeRun.status} · {activeRun.durationMs} ms</p><p className="mt-1 font-mono text-[10px] text-mist/45">{availableCellCount}/{totalCellCount} score cells available · {totalCellCount - availableCellCount} missing · {activeRun.trackSetFingerprint}</p></div>
      <label>Recent runs<select aria-label="Recent experiment run" value={activeRun.id} onChange={(event) => { setActiveRunId(event.target.value); setSelectedScoreKey(""); }}>{runs.map((run) => <option key={run.id} value={run.id}>{run.query}{run.prompts.length > 1 ? ` +${run.prompts.length - 1}` : ""} · {run.createdAt}</option>)}</select></label></div>
      <SemanticScoreMatrix
        run={activeRun}
        selectedScoreKey={activeScoreKey}
        sortDirection={sortDirection}
        audioPaths={audioPaths}
        onSelectScoreKey={setSelectedScoreKey}
        onSort={(scoreKey) => {
          if (activeScoreKey !== scoreKey) { setSelectedScoreKey(scoreKey); setSortDirection("descending"); }
          else setSortDirection((current) => current === "descending" ? "ascending" : "descending");
        }}
      />
      <div className="mt-5 rounded-xl border border-acid/20 bg-acid/[0.035] p-4" aria-label="Score promotion action bar"><fieldset><legend>Promote selected score to recipe</legend><p className="mt-1 text-xs text-mist/55">Only <strong>{activeRun.prompts.find((prompt) => activeRun.scoreKeysByNormalizedLabel[normalizeSemanticPrompt(prompt)] === activeScoreKey) ?? "the selected prompt"}</strong> will be merged into track data.</p><div className="mt-3 flex flex-wrap gap-4">{ALL_SCOPES.map((scope) => <label key={scope} className="capitalize"><input type="checkbox" checked={scopes[scope]} onChange={(event) => setScopes((current) => ({ ...current, [scope]: event.target.checked }))} /> {scope === "sort" ? "ordering / sort" : scope}</label>)}</div></fieldset>
      {staleSource && <p role="alert" className="mt-3 text-amber-200">The selected source set changed after this experiment. Run it again before promotion.</p>}
      {!hasPromotableScores && <p role="alert" className="mt-3 text-amber-200">The selected prompt produced no usable scores to promote.</p>}
      <button type="button" className="primary-button mt-3" onClick={promote} disabled={staleSource || !hasPromotableScores || !Object.values(scopes).some(Boolean)}>Promote selected score to recipe</button></div>
    </section>}
  </div>;
}
