import { useEffect, useMemo, useState } from "react";

import { localAudioPreviewUrl } from "../lib/api";
import { compareSemanticRuns, comparisonPromotion } from "../lib/semantic/compare";
import { normalizeSemanticPrompt } from "../lib/semantic/prompts";
import type { SemanticExperimentRunV1, SemanticPromotion, SemanticRecipeScope } from "../lib/semantic/types";
import {
  buildSemanticEvaluationExport,
  readSemanticVerdicts,
  saveSemanticVerdicts,
  semanticComparisonId,
  semanticEvaluationCsv,
  type SemanticVerdict,
} from "../lib/semantic/verdicts";
import type { Track } from "../lib/types";

const ALL_SCOPES: SemanticRecipeScope[] = ["distribution", "split", "subgroup", "sort"];

function scoreOptions(run: SemanticExperimentRunV1): ReadonlyArray<{ key: string; label: string }> {
  const options = run.prompts.flatMap((prompt) => {
    const key = run.scoreKeysByNormalizedLabel[normalizeSemanticPrompt(prompt)];
    return key ? [{ key, label: prompt }] : [];
  });
  if (!options.some(({ key }) => key === run.scoreKey)) {
    options.unshift({ key: run.scoreKey, label: run.kind === "reference-ranking" ? "Reference similarity" : run.query });
  }
  return options.filter((option, index) => options.findIndex(({ key }) => key === option.key) === index);
}

function runLabel(run: SemanticExperimentRunV1): string {
  return `${run.query} · ${run.backend.display_name} · ${run.createdAt}`;
}

function semanticVerdictStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function SemanticRunComparison({ runs, audioPaths, onPromote }: {
  runs: readonly SemanticExperimentRunV1[];
  audioPaths: Readonly<Record<string, string>>;
  onPromote: (promotion: SemanticPromotion, scoresByTrack: ReadonlyMap<string, Track["semantic_scores"]>) => boolean;
}) {
  const completedRuns = useMemo(() => runs.filter(({ status }) => status === "complete"), [runs]);
  const [leftRunId, setLeftRunId] = useState(completedRuns[0]?.id ?? "");
  const [rightRunId, setRightRunId] = useState(completedRuns[1]?.id ?? "");
  const [leftScoreKey, setLeftScoreKey] = useState("");
  const [rightScoreKey, setRightScoreKey] = useState("");
  const [view, setView] = useState<"disagreements" | "agreements">("disagreements");
  const [winner, setWinner] = useState<"left" | "right">("left");
  const [scopes, setScopes] = useState<Record<SemanticRecipeScope, boolean>>({ distribution: true, split: false, subgroup: false, sort: false });
  const [status, setStatus] = useState("");
  const [verdicts, setVerdicts] = useState<Record<string, SemanticVerdict>>({});
  const [activeVerdictIndex, setActiveVerdictIndex] = useState(0);

  const left = completedRuns.find(({ id }) => id === leftRunId) ?? completedRuns[0];
  const right = completedRuns.find(({ id }) => id === rightRunId) ?? completedRuns[1];
  const leftOptions = left ? scoreOptions(left) : [];
  const rightOptions = right ? scoreOptions(right) : [];
  const activeLeftScoreKey = leftOptions.some(({ key }) => key === leftScoreKey) ? leftScoreKey : leftOptions[0]?.key ?? "";
  const activeRightScoreKey = rightOptions.some(({ key }) => key === rightScoreKey) ? rightScoreKey : rightOptions[0]?.key ?? "";
  const comparison = useMemo(() => left && right && activeLeftScoreKey && activeRightScoreKey
    ? compareSemanticRuns({ left, leftScoreKey: activeLeftScoreKey, right, rightScoreKey: activeRightScoreKey })
    : null, [activeLeftScoreKey, activeRightScoreKey, left, right]);
  const rankedRows = comparison ? (view === "disagreements" ? comparison.disagreements : comparison.agreements) : [];
  const visibleRows = comparison
    ? [...rankedRows, ...comparison.rows.filter(({ rankDelta }) => rankDelta == null)]
    : [];
  const comparisonId = left && right && activeLeftScoreKey && activeRightScoreKey
    ? semanticComparisonId(left.id, activeLeftScoreKey, right.id, activeRightScoreKey)
    : "";
  const verdictRows = comparison?.compatible ? comparison.disagreements : [];
  const activeVerdictRow = verdictRows[Math.min(activeVerdictIndex, Math.max(0, verdictRows.length - 1))];
  const verdictCount = verdictRows.filter(({ trackId }) => verdicts[trackId]).length;

  useEffect(() => {
    setVerdicts(comparisonId ? readSemanticVerdicts(semanticVerdictStorage(), comparisonId) : {});
    setActiveVerdictIndex(0);
  }, [comparisonId]);

  function recordVerdict(verdict: SemanticVerdict) {
    if (!comparisonId || !activeVerdictRow) return;
    setVerdicts((current) => {
      const next = { ...current, [activeVerdictRow.trackId]: verdict };
      saveSemanticVerdicts(semanticVerdictStorage(), comparisonId, next);
      return next;
    });
    setActiveVerdictIndex((current) => Math.min(current + 1, verdictRows.length - 1));
  }

  function downloadEvaluation(format: "json" | "csv") {
    if (!left || !right || !comparison || verdictCount === 0) return;
    const evaluation = buildSemanticEvaluationExport({
      left,
      leftScoreKey: activeLeftScoreKey,
      right,
      rightScoreKey: activeRightScoreKey,
      rows: comparison.disagreements,
      verdicts,
      createdAt: new Date().toISOString(),
    });
    const contents = format === "json" ? `${JSON.stringify(evaluation, null, 2)}\n` : `${semanticEvaluationCsv(evaluation)}\n`;
    const url = URL.createObjectURL(new Blob([contents], { type: format === "json" ? "application/json" : "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `flowset-semantic-evaluation.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${verdictCount} local verdict${verdictCount === 1 ? "" : "s"} as ${format.toUpperCase()}.`);
  }

  function promoteWinner() {
    const run = winner === "left" ? left : right;
    const scoreKey = winner === "left" ? activeLeftScoreKey : activeRightScoreKey;
    if (!run || !scoreKey || !comparison?.compatible || !comparison.coverage.paired || !Object.values(scopes).some(Boolean)) return;
    const request = comparisonPromotion(run, scoreKey, scopes);
    const promoted = onPromote(request.promotion, request.scoresByTrack);
    setStatus(promoted ? `${winner === "left" ? "Left" : "Right"} score promoted. Source runs unchanged.` : "Promotion blocked because the selected source set changed.");
  }

  return <section className="rounded-lg border border-line p-5" aria-labelledby="comparison-heading">
    <p className="eyebrow">Comparison</p>
    <h2 id="comparison-heading" className="mt-2 font-display text-xl font-semibold">Pin two scalar runs</h2>
    <p className="mt-2 max-w-3xl text-sm text-mist/65">Compare recorded scores locally without rerunning inference. Correlation uses paired tracks only; missing scores remain visible.</p>
    {completedRuns.length < 2 ? <p role="status" className="mt-4 text-sm text-mist/60">Complete at least two Semantic Lab runs to compare them.</p> : <>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <fieldset className="rounded border border-line p-3"><legend>Pinned left</legend>
          <label className="mt-2 block text-xs">Run<select aria-label="Pinned left run" className="mt-1 w-full rounded border border-line bg-ink p-2" value={left?.id ?? ""} onChange={(event) => { setLeftRunId(event.target.value); setLeftScoreKey(""); }}>{completedRuns.map((run) => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select></label>
          <label className="mt-2 block text-xs">Scalar score<select aria-label="Pinned left score" className="mt-1 w-full rounded border border-line bg-ink p-2" value={activeLeftScoreKey} onChange={(event) => setLeftScoreKey(event.target.value)}>{leftOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          {left && <p className="mt-2 text-[10px] text-mist/55">{left.backend.id} · {left.backend.model} · {left.trackSetFingerprint}</p>}
        </fieldset>
        <fieldset className="rounded border border-line p-3"><legend>Pinned right</legend>
          <label className="mt-2 block text-xs">Run<select aria-label="Pinned right run" className="mt-1 w-full rounded border border-line bg-ink p-2" value={right?.id ?? ""} onChange={(event) => { setRightRunId(event.target.value); setRightScoreKey(""); }}>{completedRuns.map((run) => <option key={run.id} value={run.id}>{runLabel(run)}</option>)}</select></label>
          <label className="mt-2 block text-xs">Scalar score<select aria-label="Pinned right score" className="mt-1 w-full rounded border border-line bg-ink p-2" value={activeRightScoreKey} onChange={(event) => setRightScoreKey(event.target.value)}>{rightOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></label>
          {right && <p className="mt-2 text-[10px] text-mist/55">{right.backend.id} · {right.backend.model} · {right.trackSetFingerprint}</p>}
        </fieldset>
      </div>
      {comparison && !comparison.compatible ? <p role="alert" className="mt-4 text-amber-200">{comparison.reason}</p> : comparison && <>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Comparison summary">
          <p><span className="block text-xs text-mist/55">Spearman rank correlation</span><strong>{comparison.spearman == null ? "Not enough variation" : comparison.spearman.toFixed(4)}</strong></p>
          <p><span className="block text-xs text-mist/55">Paired coverage</span><strong>{comparison.coverage.paired}/{comparison.coverage.total}</strong></p>
          <p><span className="block text-xs text-mist/55">Left missing</span><strong>{comparison.coverage.leftMissing}</strong></p>
          <p><span className="block text-xs text-mist/55">Right missing</span><strong>{comparison.coverage.rightMissing}</strong></p>
        </div>
        <div className="mt-4 flex gap-2" role="group" aria-label="Comparison row order">
          <button type="button" className="compact-button" aria-pressed={view === "disagreements"} onClick={() => setView("disagreements")}>Top disagreements</button>
          <button type="button" className="compact-button" aria-pressed={view === "agreements"} onClick={() => setView("agreements")}>Top agreements</button>
        </div>
        <div className="mt-3 overflow-auto"><table className="min-w-full text-left text-sm"><caption className="sr-only">Side-by-side scalar run comparison</caption><thead><tr><th>Track</th><th>Left score / rank</th><th>Right score / rank</th><th>Rank delta</th><th>Preview</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.trackId} className="border-t border-line"><td className="py-3"><strong>{row.track.name}</strong><br/><span className="text-xs text-mist/60">{row.track.artist} · {row.track.album}</span></td><td>{row.leftScore == null ? "Missing" : `${row.leftScore.toFixed(4)} / ${row.leftRank}`}</td><td>{row.rightScore == null ? "Missing" : `${row.rightScore.toFixed(4)} / ${row.rightRank}`}</td><td>{row.rankDelta == null ? "—" : row.rankDelta.toFixed(2)}</td><td>{audioPaths[row.trackId] ? <audio aria-label={`Compare preview ${row.track.name}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[row.trackId])} /> : "Unavailable"}</td></tr>)}</tbody></table></div>
        <div className="mt-5 rounded-xl border border-line p-4" tabIndex={0} onKeyDown={(event) => {
          const shortcut = ({ "1": "left", "2": "right", "3": "both", "4": "neither" } as const)[event.key as "1" | "2" | "3" | "4"];
          if (shortcut) { event.preventDefault(); recordVerdict(shortcut); }
        }} aria-labelledby="verdict-queue-heading">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">A/B evaluation</p><h3 id="verdict-queue-heading" className="mt-1 font-display text-lg font-semibold">Disagreement verdict queue</h3><p className="mt-1 text-xs text-mist/60">Verdicts stay in this browser and do not alter either run. Focus this panel and use keys 1–4.</p></div><p className="font-mono text-xs text-mist/55">{verdictCount}/{verdictRows.length} judged</p></div>
          {activeVerdictRow ? <div className="mt-4 rounded-lg border border-line p-3">
            <p className="text-sm"><strong>{activeVerdictRow.track.name}</strong> <span className="text-mist/55">· {activeVerdictRow.track.artist}</span></p>
            <p className="mt-1 text-xs text-mist/55">Left {activeVerdictRow.leftScore?.toFixed(4)} / rank {activeVerdictRow.leftRank} · Right {activeVerdictRow.rightScore?.toFixed(4)} / rank {activeVerdictRow.rightRank}</p>
            {audioPaths[activeVerdictRow.trackId] && <audio className="mt-3 w-full" aria-label={`Verdict preview ${activeVerdictRow.track.name}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[activeVerdictRow.trackId])} />}
            <div className="mt-3 grid gap-2 sm:grid-cols-4">{(["left", "right", "both", "neither"] as const).map((verdict, index) => <button key={verdict} type="button" className="compact-button capitalize" aria-pressed={verdicts[activeVerdictRow.trackId] === verdict} onClick={() => recordVerdict(verdict)}>{index + 1}. {verdict}</button>)}</div>
            <div className="mt-3 flex gap-2"><button type="button" className="compact-button" disabled={activeVerdictIndex === 0} onClick={() => setActiveVerdictIndex((current) => Math.max(0, current - 1))}>Previous</button><button type="button" className="compact-button" disabled={activeVerdictIndex >= verdictRows.length - 1} onClick={() => setActiveVerdictIndex((current) => Math.min(verdictRows.length - 1, current + 1))}>Next</button></div>
          </div> : <p className="mt-3 text-xs text-mist/60">No paired disagreement rows are available.</p>}
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="compact-button" disabled={verdictCount === 0} onClick={() => downloadEvaluation("json")}>Export verdicts JSON</button><button type="button" className="compact-button" disabled={verdictCount === 0} onClick={() => downloadEvaluation("csv")}>Export verdicts CSV</button></div>
        </div>
        <div className="mt-5 rounded-xl border border-acid/20 bg-acid/[0.035] p-4"><fieldset><legend>Promote comparison winner</legend><div className="mt-2 flex gap-4"><label><input type="radio" name="comparison-winner" checked={winner === "left"} onChange={() => setWinner("left")} /> Left</label><label><input type="radio" name="comparison-winner" checked={winner === "right"} onChange={() => setWinner("right")} /> Right</label></div><div className="mt-3 flex flex-wrap gap-4">{ALL_SCOPES.map((scope) => <label key={scope} className="capitalize"><input type="checkbox" checked={scopes[scope]} onChange={(event) => setScopes((current) => ({ ...current, [scope]: event.target.checked }))} /> {scope === "sort" ? "ordering / sort" : scope}</label>)}</div></fieldset>
          <button type="button" className="primary-button mt-3" disabled={!comparison.coverage.paired || !Object.values(scopes).some(Boolean)} onClick={promoteWinner}>Promote selected winner</button>
          <p role="status" className="mt-2 text-xs text-mist/60">{status}</p>
        </div>
      </>}
    </>}
  </section>;
}
