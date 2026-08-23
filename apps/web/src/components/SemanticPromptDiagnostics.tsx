import { calculateSemanticScoreDiagnostics, LOW_SEPARATION_RANGE } from "../lib/semantic/diagnostics";

function score(value: number | null): string {
  return value == null ? "—" : value.toFixed(4);
}

export function SemanticPromptDiagnostics({
  label,
  values,
  derivedFormula,
}: {
  label: string;
  values: readonly (number | null)[];
  derivedFormula?: string;
}) {
  const diagnostics = calculateSemanticScoreDiagnostics(values);
  const maximumBinCount = Math.max(1, ...diagnostics.histogram.map(({ count }) => count));
  return <section className="mt-4 rounded-xl border border-line bg-panel/35 p-4" aria-labelledby="semantic-diagnostics-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="eyebrow">Selected score diagnostics</p><h3 id="semantic-diagnostics-heading" className="mt-1 font-medium">{label}</h3>{derivedFormula && <p className="mt-1 text-xs text-mist/55">Derived formula: <code>{derivedFormula}</code></p>}</div>
      <span className="font-mono text-xs text-mist/55">{Math.round(diagnostics.coverage * 100)}% coverage</span>
    </div>
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {[
        ["Available", `${diagnostics.availableCount}/${diagnostics.totalCount}`],
        ["Missing", String(diagnostics.missingCount)],
        ["Minimum", score(diagnostics.minimum)],
        ["Maximum", score(diagnostics.maximum)],
        ["Range", score(diagnostics.range)],
      ].map(([term, value]) => <div key={term} className="rounded-lg border border-line bg-black/10 p-3"><dt className="text-[10px] uppercase tracking-wide text-mist/45">{term}</dt><dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd></div>)}
    </dl>
    <figure className="mt-4" aria-label={`Score histogram for ${label}`}>
      <figcaption className="text-xs text-mist/55">Observed score histogram</figcaption>
      {diagnostics.histogram.length
        ? <ol className="mt-2 flex h-24 items-end gap-2">{diagnostics.histogram.map((bin, index) => <li key={`${bin.minimum}-${bin.maximum}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="font-mono text-[9px] text-mist/45">{bin.count}</span>
          <span className="w-full rounded-t bg-acid/45" style={{ height: `${Math.max(4, (bin.count / maximumBinCount) * 60)}px` }} aria-label={`Bin ${index + 1}: ${bin.count} scores from ${bin.minimum.toFixed(3)} to ${bin.maximum.toFixed(3)}`} />
          <span className="max-w-full truncate font-mono text-[8px] text-mist/35">{bin.minimum.toFixed(2)}</span>
        </li>)}</ol>
        : <p className="mt-2 text-xs text-mist/45">No usable values to chart.</p>}
    </figure>
    {diagnostics.lowSeparation && <p role="status" className="mt-4 rounded-lg border border-amber-100/20 bg-amber-100/[0.04] p-3 text-xs text-amber-100/80">
      Low observed separation: this run spans less than {LOW_SEPARATION_RANGE.toFixed(2)}. This is a review heuristic, not a judgment of prompt quality.
    </p>}
  </section>;
}
