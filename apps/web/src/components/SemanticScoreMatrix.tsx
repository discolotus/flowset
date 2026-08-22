import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";

import { localAudioPreviewUrl } from "../lib/api";
import { normalizeSemanticPrompt } from "../lib/semantic/prompts";
import type { SemanticExperimentRunV1 } from "../lib/semantic/types";

type SortDirection = "descending" | "ascending";

function scoreFor(run: SemanticExperimentRunV1, trackId: string, scoreKey: string): number | null {
  return run.results.find((result) => result.trackId === trackId)?.scores.find(({ key }) => key === scoreKey)?.score ?? null;
}

function heatColor(score: number | null): string | undefined {
  if (score == null) return undefined;
  const intensity = Math.max(0, Math.min(1, (score + 1) / 2));
  return `rgba(184, 222, 128, ${0.08 + intensity * 0.42})`;
}

export function SemanticScoreMatrix({
  run,
  selectedScoreKey,
  sortDirection,
  audioPaths,
  onSelectScoreKey,
  onSort,
}: {
  run: SemanticExperimentRunV1;
  selectedScoreKey: string;
  sortDirection: SortDirection;
  audioPaths: Record<string, string>;
  onSelectScoreKey: (scoreKey: string) => void;
  onSort: (scoreKey: string) => void;
}) {
  const matrixId = useId().replaceAll(":", "");
  const [selectedTrackId, setSelectedTrackId] = useState(run.results[0]?.trackId ?? "");
  useEffect(() => {
    setSelectedTrackId((current) => run.results.some(({ trackId }) => trackId === current) ? current : run.results[0]?.trackId ?? "");
  }, [run]);

  const prompts = run.prompts.map((prompt) => ({
    prompt,
    scoreKey: run.scoreKeysByNormalizedLabel[normalizeSemanticPrompt(prompt)],
  })).filter((entry): entry is { prompt: string; scoreKey: string } => Boolean(entry.scoreKey));
  const snapshots = new Map(run.trackSnapshots.map((track) => [track.trackId, track]));
  const rows = useMemo(() => [...run.results].sort((left, right) => {
    const leftScore = scoreFor(run, left.trackId, selectedScoreKey);
    const rightScore = scoreFor(run, right.trackId, selectedScoreKey);
    if (leftScore == null || rightScore == null) {
      if (leftScore == null && rightScore == null) return left.trackId.localeCompare(right.trackId);
      return leftScore == null ? 1 : -1;
    }
    const difference = sortDirection === "descending" ? rightScore - leftScore : leftScore - rightScore;
    return difference || left.trackId.localeCompare(right.trackId);
  }), [run, selectedScoreKey, sortDirection]);
  const selectedResult = run.results.find(({ trackId }) => trackId === selectedTrackId);
  const selectedTrack = snapshots.get(selectedTrackId);

  function moveCell(event: KeyboardEvent<HTMLButtonElement>, rowIndex: number, columnIndex: number) {
    const offset = event.key === "ArrowLeft" ? [0, -1]
      : event.key === "ArrowRight" ? [0, 1]
        : event.key === "ArrowUp" ? [-1, 0]
          : event.key === "ArrowDown" ? [1, 0]
            : null;
    if (!offset) return;
    event.preventDefault();
    const nextRow = Math.max(0, Math.min(rows.length - 1, rowIndex + offset[0]));
    const nextColumn = Math.max(0, Math.min(prompts.length - 1, columnIndex + offset[1]));
    document.getElementById(`${matrixId}-cell-${nextRow}-${nextColumn}`)?.focus();
  }

  return <div className="mt-4">
    <div className="max-h-[34rem] overflow-auto rounded-xl border border-line" role="region" aria-label="Scrollable semantic score matrix" tabIndex={0}>
      <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
        <caption className="sr-only">Tracks by semantic prompt score. Use arrow keys to move between score cells.</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-30 min-w-60 border-b border-r border-line bg-[#111512] p-3">Track</th>
            {prompts.map(({ prompt, scoreKey }) => <th
              key={scoreKey}
              scope="col"
              aria-sort={selectedScoreKey === scoreKey ? sortDirection : "none"}
              className={`sticky top-0 z-20 min-w-40 border-b border-line bg-[#111512] p-3 ${selectedScoreKey === scoreKey ? "text-acid" : ""}`}
            >
              <button type="button" aria-pressed={selectedScoreKey === scoreKey} className="block w-full text-left font-medium" onClick={() => onSelectScoreKey(scoreKey)}>{prompt}</button>
              <button type="button" aria-label={`Sort ${prompt} ${selectedScoreKey === scoreKey && sortDirection === "descending" ? "ascending" : "descending"}`} className="mt-1 text-[10px] text-mist/55" onClick={() => onSort(scoreKey)}>
                Sort {selectedScoreKey === scoreKey && sortDirection === "descending" ? "ascending" : "descending"}
              </button>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((result, rowIndex) => {
            const track = snapshots.get(result.trackId);
            return <tr key={result.trackId} data-selected={selectedTrackId === result.trackId ? "true" : "false"} className={selectedTrackId === result.trackId ? "bg-acid/[0.035]" : ""}>
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-line bg-[#111512] p-3">
                <button type="button" className="w-full text-left" aria-pressed={selectedTrackId === result.trackId} onClick={() => setSelectedTrackId(result.trackId)}>
                  <strong>{track?.name ?? result.trackId}</strong><br />
                  <span className="text-xs font-normal text-mist/60">{track ? `${track.artist} · ${track.album}` : "Metadata unavailable"}</span>
                </button>
              </th>
              {prompts.map(({ prompt, scoreKey }, columnIndex) => {
                const score = result.scores.find(({ key }) => key === scoreKey)?.score ?? null;
                const unavailable = result.status === "failed" ? "Failed" : "Unavailable";
                return <td key={scoreKey} className="border-b border-line p-0" style={{ background: heatColor(score) }}>
                  <button
                    id={`${matrixId}-cell-${rowIndex}-${columnIndex}`}
                    type="button"
                    className="min-h-16 w-full px-3 py-2 text-left font-mono text-xs tabular-nums"
                    aria-label={`${track?.name ?? result.trackId}, ${prompt}: ${score == null ? unavailable : score.toFixed(4)}`}
                    onClick={() => { onSelectScoreKey(scoreKey); setSelectedTrackId(result.trackId); }}
                    onKeyDown={(event) => moveCell(event, rowIndex, columnIndex)}
                  >{score == null ? <span className="font-sans text-mist/55">{unavailable}</span> : score.toFixed(4)}</button>
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {selectedResult && <section className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-panel/45 p-3" aria-label="Selected track preview" aria-live="polite">
      <div><p className="eyebrow">Selected evidence</p><strong>{selectedTrack?.name ?? selectedResult.trackId}</strong><p className="text-xs text-mist/55">{selectedResult.status}{selectedResult.error ? ` · ${selectedResult.error}` : ""}</p></div>
      {audioPaths[selectedResult.trackId]
        ? <audio aria-label={`Preview ${selectedTrack?.name ?? selectedResult.trackId}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[selectedResult.trackId])} />
        : <span className="text-xs text-mist/55">Preview unavailable</span>}
    </section>}
  </div>;
}
