export interface SemanticPromptRow {
  id: string;
  value: string;
}

export const SEMANTIC_PROMPT_EXAMPLES = [
  "hypnotic sunrise",
  "warm analog glow",
  "focused late-night pulse",
] as const;

export function SemanticPromptComposer({
  rows,
  maxPrompts,
  validationError,
  onChange,
  onUseExamples,
}: {
  rows: readonly SemanticPromptRow[];
  maxPrompts: number;
  validationError: string | null;
  onChange: (rows: readonly SemanticPromptRow[]) => void;
  onUseExamples: () => void;
}) {
  function update(index: number, value: string) {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, value } : row));
  }

  function move(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (destination < 0 || destination >= rows.length) return;
    const next = [...rows];
    [next[index], next[destination]] = [next[destination], next[index]];
    onChange(next);
  }

  return <fieldset className="mt-5" aria-describedby={validationError ? "semantic-prompt-error" : "semantic-prompt-help"}>
    <legend className="font-medium">Named prompts</legend>
    <div className="mt-2 flex flex-wrap justify-end gap-3">
      <div className="flex gap-2">
        <button type="button" className="compact-button" onClick={onUseExamples} disabled={maxPrompts < 2}>Use examples</button>
        <button
          type="button"
          className="compact-button"
          disabled={rows.length >= maxPrompts}
          onClick={() => onChange([...rows, { id: `prompt-${Date.now()}-${rows.length}`, value: "" }])}
        >Add prompt</button>
      </div>
    </div>
    <p id="semantic-prompt-help" className="mt-1 text-xs text-mist/55">Compare up to {maxPrompts} descriptions in one bounded local run. Names are matched without case or extra spaces.</p>
    <div className="mt-3 grid gap-2">
      {rows.map((row, index) => <div key={row.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-line bg-black/10 p-2">
        <span className="w-7 text-center font-mono text-xs text-mist/45" aria-hidden="true">{index + 1}</span>
        <label className="sr-only" htmlFor={`semantic-${row.id}`}>Prompt {index + 1}</label>
        <input
          id={`semantic-${row.id}`}
          aria-label={`Prompt ${index + 1}`}
          className="w-full rounded border border-line bg-black/20 p-2"
          value={row.value}
          maxLength={100}
          placeholder={index === 0 ? "e.g. hypnotic sunrise" : "Another musical description"}
          onChange={(event) => update(index, event.target.value)}
        />
        <div className="flex gap-1">
          <button type="button" className="compact-button" aria-label={`Move prompt ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" className="compact-button" aria-label={`Move prompt ${index + 1} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" className="compact-button" aria-label={`Remove prompt ${index + 1}`} disabled={rows.length === 1} onClick={() => onChange(rows.filter(({ id }) => id !== row.id))}>Remove</button>
        </div>
      </div>)}
    </div>
    {validationError && <p id="semantic-prompt-error" role="alert" className="mt-2 text-xs text-amber-200">{validationError}</p>}
  </fieldset>;
}
