import type { SemanticContrast } from "../lib/semantic/contrast";

export interface SemanticScoreOption {
  scoreKey: string;
  label: string;
}

export function SemanticContrastControl({
  options,
  positiveScoreKey,
  negativeScoreKey,
  contrast,
  selected,
  onPositiveChange,
  onNegativeChange,
  onSelectContrast,
}: {
  options: readonly SemanticScoreOption[];
  positiveScoreKey: string;
  negativeScoreKey: string;
  contrast: SemanticContrast | null;
  selected: boolean;
  onPositiveChange: (scoreKey: string) => void;
  onNegativeChange: (scoreKey: string) => void;
  onSelectContrast: () => void;
}) {
  return <section className="mt-4 rounded-xl border border-line bg-panel/35 p-4" aria-labelledby="contrast-heading">
    <p className="eyebrow">Derived comparison</p>
    <h3 id="contrast-heading" className="mt-1 font-medium">Positive minus negative</h3>
    {options.length < 2
      ? <p className="mt-2 text-xs text-mist/55">Add at least two prompts to create a contrast score.</p>
      : <>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <label className="text-xs">Positive prompt<select aria-label="Positive contrast prompt" className="mt-1 w-full rounded border border-line bg-ink p-2" value={positiveScoreKey} onChange={(event) => onPositiveChange(event.target.value)}>{options.map((option) => <option key={option.scoreKey} value={option.scoreKey} disabled={option.scoreKey === negativeScoreKey}>{option.label}</option>)}</select></label>
          <span className="pb-2 text-center text-mist/45" aria-hidden="true">−</span>
          <label className="text-xs">Negative prompt<select aria-label="Negative contrast prompt" className="mt-1 w-full rounded border border-line bg-ink p-2" value={negativeScoreKey} onChange={(event) => onNegativeChange(event.target.value)}>{options.map((option) => <option key={option.scoreKey} value={option.scoreKey} disabled={option.scoreKey === positiveScoreKey}>{option.label}</option>)}</select></label>
        </div>
        {contrast && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-acid/15 bg-acid/[0.025] p-3">
          <div><p className="text-xs"><code>positive - negative</code> · {contrast.scoresByTrack.size} paired track{contrast.scoresByTrack.size === 1 ? "" : "s"}</p><details className="mt-1 text-[10px] text-mist/45"><summary>Derived provenance</summary><p className="mt-1 break-all">Flowset contrast-v1<br />positive: {contrast.positiveScoreKey}<br />negative: {contrast.negativeScoreKey}</p></details></div>
          <button type="button" className="secondary-button" aria-pressed={selected} onClick={onSelectContrast}>{selected ? "Contrast selected" : "Use contrast score"}</button>
        </div>}
      </>}
  </section>;
}
