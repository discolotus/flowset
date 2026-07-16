import { useState } from "react";

import { camelot, duration, flowScore } from "../lib/format";
import type { Track } from "../lib/types";

interface TrackTableProps {
  tracks: Track[];
  pinned: Set<string>;
  locked: Set<string>;
  onMove: (sourceId: string, targetId: string) => void;
  onRemove: (id: string) => void;
  onTogglePin: (id: string) => void;
  onToggleLock: (id: string) => void;
}

function coverGradient(id: string): string {
  const seed = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const hue = seed % 360;
  return `linear-gradient(145deg, hsl(${hue} 46% 48%), hsl(${(hue + 58) % 360} 38% 16%))`;
}

export function TrackTable({
  tracks,
  pinned,
  locked,
  onMove,
  onRemove,
  onTogglePin,
  onToggleLock,
}: TrackTableProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[840px] w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-[0.16em] text-mist/60">
            <th className="w-12 px-3 py-3 font-medium">#</th>
            <th className="px-3 py-3 font-medium">Track</th>
            <th className="px-3 py-3 font-medium">Energy</th>
            <th className="px-3 py-3 font-medium">BPM</th>
            <th className="px-3 py-3 font-medium">Key</th>
            <th className="px-3 py-3 font-medium">Dance</th>
            <th className="px-3 py-3 font-medium">Flow</th>
            <th className="px-3 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track, index) => {
            const score = flowScore(tracks[index - 1], track);
            const isLocked = locked.has(track.id);
            return (
              <tr
                key={track.id}
                draggable={!isLocked}
                onDragStart={() => setDraggedId(track.id)}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedId && draggedId !== track.id) onMove(draggedId, track.id);
                  setDraggedId(null);
                }}
                className={`group border-b border-line/70 transition ${
                  draggedId === track.id ? "opacity-40" : "hover:bg-white/[0.025]"
                }`}
              >
                <td className="px-3 py-3 font-mono text-xs text-mist/50">
                  {String(index + 1).padStart(2, "0")}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 text-xs font-semibold text-white/80 shadow-inner"
                      style={{ background: coverGradient(track.id) }}
                      aria-hidden="true"
                    >
                      {track.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-white/90">{track.name}</p>
                        {track.explicit && (
                          <span className="rounded bg-white/10 px-1 text-[9px] text-mist">E</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-mist/65">
                        {track.artist} <span className="px-1 text-mist/30">·</span>{" "}
                        {duration(track.duration_ms)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-8 font-mono text-xs text-white/80">
                      {track.audio_features?.energy.toFixed(2) ?? "—"}
                    </span>
                    <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/5">
                      <span
                        className="block h-full rounded-full bg-acid/80"
                        style={{ width: `${(track.audio_features?.energy ?? 0) * 100}%` }}
                      />
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 font-mono text-xs text-white/80">
                  {track.audio_features?.tempo.toFixed(0) ?? "—"}
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-white/75">
                    {camelot(track)}
                  </span>
                </td>
                <td className="px-3 py-3 font-mono text-xs text-white/80">
                  {track.audio_features?.danceability.toFixed(2) ?? "—"}
                </td>
                <td className="px-3 py-3">
                  {score === null ? (
                    <span className="text-mist/35">—</span>
                  ) : (
                    <span className={score >= 85 ? "text-acid" : score >= 70 ? "text-amber-300" : "text-rose-300"}>
                      {score}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-1 opacity-50 transition group-hover:opacity-100">
                    <button
                      className={`action-button ${pinned.has(track.id) ? "active" : ""}`}
                      onClick={() => onTogglePin(track.id)}
                      title="Pin track"
                      aria-label={`Pin ${track.name}`}
                    >
                      ◆
                    </button>
                    <button
                      className={`action-button ${isLocked ? "active" : ""}`}
                      onClick={() => onToggleLock(track.id)}
                      title="Lock track"
                      aria-label={`Lock ${track.name}`}
                    >
                      {isLocked ? "●" : "○"}
                    </button>
                    <button
                      className="action-button hover:!border-rose-400/40 hover:!text-rose-300"
                      onClick={() => onRemove(track.id)}
                      disabled={isLocked}
                      title="Remove from preview"
                      aria-label={`Remove ${track.name}`}
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
