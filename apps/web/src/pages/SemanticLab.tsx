import { useEffect, useMemo, useState } from "react";

import { ReferenceTrackPicker } from "../components/ReferenceTrackPicker";
import { SemanticPromptComposer, SEMANTIC_PROMPT_EXAMPLES, type SemanticPromptRow } from "../components/SemanticPromptComposer";
import { SemanticContrastControl } from "../components/SemanticContrastControl";
import { SemanticPromptDiagnostics } from "../components/SemanticPromptDiagnostics";
import { SemanticScoreMatrix } from "../components/SemanticScoreMatrix";
import { getSemanticCapabilities, localAudioPreviewUrl, rankSemanticAudio, rankSemanticReference } from "../lib/api";
import { deriveSemanticContrast } from "../lib/semantic/contrast";
import { normalizeSemanticPrompt, validateSemanticPrompts } from "../lib/semantic/prompts";
import { createReferenceRankingRun, createTextRankingRun, fingerprintTrackIds, rememberSemanticRun } from "../lib/semantic/runs";
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
  const [referenceBackendId, setReferenceBackendId] = useState("");
  const [referenceTrackId, setReferenceTrackId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeRunId, setActiveRunId] = useState(runs[0]?.id ?? "");
  const [selectedScoreKey, setSelectedScoreKey] = useState("");
  const [positiveScoreKey, setPositiveScoreKey] = useState("");
  const [negativeScoreKey, setNegativeScoreKey] = useState("");
  const [sortDirection, setSortDirection] = useState<"descending" | "ascending">("descending");
  const [scopes, setScopes] = useState<Record<SemanticRecipeScope, boolean>>({ distribution: true, split: false, subgroup: false, sort: false });
  const [status, setStatus] = useState("Checking local semantic backends…");
  const [referenceStatus, setReferenceStatus] = useState("Checking MERT reference capabilities…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSemanticCapabilities().then((items) => {
      setBackends(items);
      const first = items.find((item) => item.available && item.capabilities.includes("text_similarity"))
        ?? items.find((item) => item.capabilities.includes("text_similarity"));
      const firstReference = items.find((item) => item.available && item.capabilities.includes("reference_similarity"))
        ?? items.find((item) => item.capabilities.includes("reference_similarity"));
      if (first) setBackendId(first.id);
      if (firstReference) setReferenceBackendId(firstReference.id);
      setReferenceStatus(firstReference ? "Choose an authorized reference track and inspect its neighbors." : "No reference-ranking backend configured.");
      setStatus(
        first
          ? "Choose an authorized subset and compose a prompt matrix."
          : items.length
            ? "No configured backend supports text similarity."
            : "No semantic backends configured.",
      );
    }).catch(() => {
      setStatus("Local semantic backends unavailable. Check the local API setup.");
      setReferenceStatus("MERT reference capabilities unavailable. Check the local API setup.");
    });
  }, []);

  useEffect(() => {
    setSelectedIds((current) => {
      const retained = [...current].filter((id) => authorizedTracks.some((track) => track.id === id));
      return new Set(retained.length ? retained : authorizedTracks.map(({ id }) => id));
    });
  }, [authorizedTracks]);

  useEffect(() => {
    const selected = authorizedTracks.filter(({ id }) => selectedIds.has(id));
    if (!selected.some(({ id }) => id === referenceTrackId)) {
      setReferenceTrackId(selected[0]?.id ?? "");
    }
  }, [authorizedTracks, referenceTrackId, selectedIds]);

  const backend = backends.find(({ id }) => id === backendId);
  const referenceBackend = backends.find(({ id }) => id === referenceBackendId);
  const selectedTracks = authorizedTracks.filter(({ id }) => selectedIds.has(id));
  const activeRun = runs.find(({ id }) => id === activeRunId) ?? runs[0];
  const promptValidation = validateSemanticPrompts(promptRows.map(({ value }) => value), backend?.max_labels ?? 1);
  const rawScoreOptions = activeRun?.kind === "text-ranking"
    ? activeRun.prompts.map((label) => ({ label, scoreKey: activeRun.scoreKeysByNormalizedLabel[normalizeSemanticPrompt(label)] })).filter((option): option is { label: string; scoreKey: string } => Boolean(option.scoreKey))
    : [];
  const effectivePositiveScoreKey = rawScoreOptions.some(({ scoreKey }) => scoreKey === positiveScoreKey) ? positiveScoreKey : rawScoreOptions[0]?.scoreKey ?? "";
  const effectiveNegativeScoreKey = rawScoreOptions.some(({ scoreKey }) => scoreKey === negativeScoreKey && scoreKey !== effectivePositiveScoreKey)
    ? negativeScoreKey
    : rawScoreOptions.find(({ scoreKey }) => scoreKey !== effectivePositiveScoreKey)?.scoreKey ?? "";
  const contrast = useMemo(() => {
    if (!activeRun || activeRun.kind !== "text-ranking" || !effectivePositiveScoreKey || !effectiveNegativeScoreKey) return null;
    const positiveLabel = rawScoreOptions.find(({ scoreKey }) => scoreKey === effectivePositiveScoreKey)?.label;
    const negativeLabel = rawScoreOptions.find(({ scoreKey }) => scoreKey === effectiveNegativeScoreKey)?.label;
    if (!positiveLabel || !negativeLabel) return null;
    return deriveSemanticContrast({ run: activeRun, positiveScoreKey: effectivePositiveScoreKey, negativeScoreKey: effectiveNegativeScoreKey, positiveLabel, negativeLabel });
  }, [activeRun, effectiveNegativeScoreKey, effectivePositiveScoreKey, rawScoreOptions]);
  const activeScoreKey = activeRun?.kind === "reference-ranking"
    ? activeRun.scoreKey
    : activeRun && (Object.values(activeRun.scoreKeysByNormalizedLabel).includes(selectedScoreKey) || contrast?.scoreKey === selectedScoreKey)
      ? selectedScoreKey
      : activeRun?.scoreKey ?? "";
  const selectedContrast = contrast?.scoreKey === activeScoreKey ? contrast : null;
  const derivedMatrixColumn = useMemo(() => contrast ? {
    scoreKey: contrast.scoreKey,
    label: contrast.label,
    scoresByTrack: contrast.scoresByTrack,
  } : null, [contrast]);
  const resultRows = useMemo(() => {
    if (!activeRun) return [];
    const metadata = new Map(activeRun.trackSnapshots.map((track) => [track.trackId, track]));
    const sorted = activeRun.results.map((result) => ({ result, track: metadata.get(result.trackId), score: result.scores.find(({ key }) => key === activeRun.scoreKey)?.score ?? null }))
      .sort((left, right) => {
        if (left.score == null || right.score == null) {
          if (left.score == null && right.score == null) return left.result.trackId.localeCompare(right.result.trackId);
          return left.score == null ? 1 : -1;
        }
        const difference = sortDirection === "descending" ? right.score - left.score : left.score - right.score;
        return difference || left.result.trackId.localeCompare(right.result.trackId);
      });
    let neighborRank = 0;
    return sorted.map((row) => ({
      ...row,
      neighborRank: activeRun.kind === "reference-ranking" && row.result.trackId !== activeRun.referenceTrackId && row.score != null
        ? ++neighborRank
        : null,
    }));
  }, [activeRun, sortDirection]);
  const oversized = Boolean(backend && selectedTracks.length > backend.max_tracks);
  const referenceOversized = Boolean(referenceBackend && selectedTracks.length > referenceBackend.max_tracks);
  const staleSource = Boolean(activeRun && activeRun.sourceTrackSetFingerprint !== fingerprintTrackIds(tracks.map(({ id }) => id)));
  const hasPromotableScores = selectedContrast
    ? selectedContrast.scoresByTrack.size > 0
    : Boolean(activeRun?.results.some((result) => result.status === "complete" && result.scores.some(({ key }) => key === activeScoreKey)));
  const selectedScoreLabel = selectedContrast?.label
    ?? (activeRun?.kind === "reference-ranking" ? "the MERT similarity score" : rawScoreOptions.find(({ scoreKey }) => scoreKey === activeScoreKey)?.label)
    ?? "the selected score";
  const selectedScoreValues = activeRun?.results.map((result) => selectedContrast?.scoresByTrack.get(result.trackId)?.score
    ?? result.scores.find(({ key }) => key === activeScoreKey)?.score
    ?? null) ?? [];
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
      setPositiveScoreKey("");
      setNegativeScoreKey("");
      setStatus(`${run.results.filter(({ status: resultStatus }) => resultStatus === "complete").length} ranked · ${run.results.filter(({ status: resultStatus }) => resultStatus !== "complete").length} unavailable. Recipe unchanged.`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Semantic ranking failed.");
    } finally { setBusy(false); }
  }

  async function runReferenceExperiment() {
    const referenceTrack = selectedTracks.find(({ id }) => id === referenceTrackId);
    if (!referenceBackend || !referenceTrack || !selectedTracks.length || referenceOversized) return;
    setBusy(true);
    const createdAt = new Date().toISOString();
    try {
      const response = await rankSemanticReference({
        backendId: referenceBackend.id,
        referenceTrackId: referenceTrack.id,
        audioPaths: Object.fromEntries(selectedTracks.map(({ id }) => [id, audioPaths[id]])),
      });
      const completedAt = new Date().toISOString();
      const run = createReferenceRankingRun({
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
        referenceTrack,
        tracks: selectedTracks,
        sourceTrackIds: tracks.map(({ id }) => id),
        backend: response.backend ?? referenceBackend,
        response,
        createdAt,
        completedAt,
      });
      onRunsChange(rememberSemanticRun(runs, run));
      setActiveRunId(run.id);
      setSelectedScoreKey(run.scoreKey);
      setReferenceStatus(`${Math.max(0, run.results.filter(({ status: resultStatus }) => resultStatus === "complete").length - 1)} neighbors inspected · Recipe unchanged.`);
    } catch (reason) {
      setReferenceStatus(reason instanceof Error ? reason.message : "MERT neighbor search failed.");
    } finally { setBusy(false); }
  }

  function promote() {
    if (!activeRun || !activeScoreKey || staleSource || !hasPromotableScores || !Object.values(scopes).some(Boolean)) return;
    const byTrack = new Map(activeRun.results.map((result) => {
      const derivedScore = selectedContrast?.scoresByTrack.get(result.trackId);
      return [result.trackId, derivedScore ? [derivedScore] : result.scores.filter(({ key }) => key === activeScoreKey)];
    }));
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

    <section className="rounded-lg border border-line p-5" aria-labelledby="reference-heading">
      <p className="eyebrow">MERT</p>
      <h2 id="reference-heading" className="mt-2 font-display text-xl font-semibold">Reference-track neighbor explorer</h2>
      <p className="mt-2 max-w-3xl text-sm text-mist/65">Choose a track by its musical metadata, audition it locally, and inspect its closest neighbors before deciding whether to promote the similarity score.</p>
      <label className="mt-4 block">Reference backend
        <select aria-label="Reference backend" className="mt-1 w-full rounded border border-line bg-ink p-2" value={referenceBackendId} onChange={(event) => setReferenceBackendId(event.target.value)}>
          {backends.filter((item) => item.capabilities.includes("reference_similarity")).map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.available ? "" : " (unavailable)"}</option>)}
        </select>
      </label>
      <div className="mt-4"><ReferenceTrackPicker tracks={selectedTracks} audioPaths={audioPaths} value={referenceTrackId} onChange={setReferenceTrackId} /></div>
      {referenceBackend?.default_representation ? <div className="mt-4 rounded border border-line bg-black/10 p-3 text-xs" aria-label="MERT representation identity">
        <strong>Fixed representation for this slice</strong>
        <p className="mt-1 text-mist/65">{referenceBackend.default_representation.layer} · {referenceBackend.default_representation.pooling} pooling · {referenceBackend.default_representation.segment.replaceAll("_", " ")} · {referenceBackend.model}</p>
        <p className="mt-1 text-amber-200">Layer and pooling choices are not exposed yet; every result records this exact identity so future configurations cannot be silently mixed.</p>
      </div> : <p className="mt-4 text-xs text-amber-200">This backend does not report a representation identity and cannot run the reference explorer safely.</p>}
      {referenceOversized && <p role="alert" className="mt-3 text-amber-200">Select at most {referenceBackend?.max_tracks} tracks for this backend.</p>}
      <button type="button" className="primary-button mt-4" disabled={busy || !referenceBackend?.available || !referenceBackend.default_representation || !referenceTrackId || !selectedTracks.length || referenceOversized} onClick={runReferenceExperiment}>{busy ? "Running…" : "Inspect nearest neighbors"}</button>
      <p role="status" className="mt-3 text-xs text-mist/60">{referenceStatus}</p>
    </section>

    {activeRun && <section aria-labelledby="results-heading">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Recent run</p><h2 id="results-heading" className="font-display text-xl font-semibold">{activeRun.kind === "reference-ranking" ? activeRun.query : activeRun.prompts.join(" · ")}</h2><p className="text-xs text-mist/60">{activeRun.backend.display_name} · revision {activeRun.backend.model} · {activeRun.status} · {activeRun.durationMs} ms</p><p className="mt-1 font-mono text-[10px] text-mist/45">{availableCellCount}/{totalCellCount} score cells available · {totalCellCount - availableCellCount} missing · {activeRun.trackSetFingerprint}</p></div>
      <label>Recent runs<select aria-label="Recent experiment run" value={activeRun.id} onChange={(event) => { setActiveRunId(event.target.value); setSelectedScoreKey(""); setPositiveScoreKey(""); setNegativeScoreKey(""); }}>{runs.map((run) => <option key={run.id} value={run.id}>{run.query}{run.prompts.length > 1 ? ` +${run.prompts.length - 1}` : ""} · {run.createdAt}</option>)}</select></label></div>
      {activeRun.kind === "reference-ranking" ? <table className="mt-4 w-full text-left text-sm"><caption className="sr-only">Nearest-neighbor results</caption><thead><tr><th>Neighbor</th><th>Track</th><th>Status</th><th>Model provenance</th><th><button type="button" onClick={() => setSortDirection((current) => current === "descending" ? "ascending" : "descending")}>Similarity {sortDirection === "descending" ? "↓" : "↑"}</button></th><th>Preview</th></tr></thead>
      <tbody>{resultRows.map(({ result, track, score, neighborRank }) => <tr key={result.trackId} className="border-t border-line"><td>{result.trackId === activeRun.referenceTrackId ? "Reference" : neighborRank == null ? "—" : `#${neighborRank}`}</td><td className="py-3"><strong>{track?.name ?? result.trackId}</strong><br/><span className="text-xs text-mist/60">{track ? `${track.artist} · ${track.album}` : "Metadata unavailable"}</span></td><td>{result.status}{result.error ? ` · ${result.error}` : ""}</td><td>{activeRun.backend.id}<br/><span className="text-xs">{activeRun.backend.model}</span>{activeRun.representation && <span className="block text-xs">{activeRun.representation.layer} · {activeRun.representation.pooling} · {activeRun.representation.segment.replaceAll("_", " ")}</span>}</td><td>{score == null ? "—" : score.toFixed(4)}</td><td>{audioPaths[result.trackId] ? <audio aria-label={`Preview ${track?.name ?? result.trackId}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[result.trackId])} /> : "Unavailable"}</td></tr>)}</tbody></table> : <SemanticScoreMatrix
        run={activeRun}
        selectedScoreKey={activeScoreKey}
        sortDirection={sortDirection}
        audioPaths={audioPaths}
        derivedColumn={derivedMatrixColumn}
        onSelectScoreKey={setSelectedScoreKey}
        onSort={(scoreKey) => {
          if (activeScoreKey !== scoreKey) { setSelectedScoreKey(scoreKey); setSortDirection("descending"); }
          else setSortDirection((current) => current === "descending" ? "ascending" : "descending");
        }}
      />}
      {activeRun.kind === "text-ranking" && <SemanticContrastControl
        options={rawScoreOptions}
        positiveScoreKey={effectivePositiveScoreKey}
        negativeScoreKey={effectiveNegativeScoreKey}
        contrast={contrast}
        selected={Boolean(selectedContrast)}
        onPositiveChange={setPositiveScoreKey}
        onNegativeChange={setNegativeScoreKey}
        onSelectContrast={() => { if (contrast) setSelectedScoreKey(contrast.scoreKey); }}
      />}
      <SemanticPromptDiagnostics label={selectedScoreLabel} values={selectedScoreValues} derivedFormula={selectedContrast?.formula} />
      <div className="mt-5 rounded-xl border border-acid/20 bg-acid/[0.035] p-4" aria-label="Score promotion action bar"><fieldset><legend>Promote selected score to recipe</legend><p className="mt-1 text-xs text-mist/55">Only <strong>{selectedScoreLabel}</strong> will be merged into track data.{selectedContrast ? " This is a Flowset-derived contrast, not direct model output." : ""}</p><div className="mt-3 flex flex-wrap gap-4">{ALL_SCOPES.map((scope) => <label key={scope} className="capitalize"><input type="checkbox" checked={scopes[scope]} onChange={(event) => setScopes((current) => ({ ...current, [scope]: event.target.checked }))} /> {scope === "sort" ? "ordering / sort" : scope}</label>)}</div></fieldset>
      {staleSource && <p role="alert" className="mt-3 text-amber-200">The selected source set changed after this experiment. Run it again before promotion.</p>}
      {!hasPromotableScores && <p role="alert" className="mt-3 text-amber-200">The selected score produced no usable values to promote.</p>}
      <button type="button" className="primary-button mt-3" onClick={promote} disabled={staleSource || !hasPromotableScores || !Object.values(scopes).some(Boolean)}>Promote selected score to recipe</button></div>
    </section>}
  </div>;
}
