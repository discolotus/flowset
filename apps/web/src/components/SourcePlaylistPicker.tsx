import { runtime } from "../lib/format";
import type { InputPlaylist } from "../lib/types";

interface SourcePlaylistPickerProps {
  playlists: InputPlaylist[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

function sourceRuntime(playlist: InputPlaylist): number {
  return playlist.tracks.reduce((sum, track) => sum + track.duration_ms, 0);
}

export function SourcePlaylistPicker({
  playlists,
  selectedIds,
  onToggle,
}: SourcePlaylistPickerProps) {
  return (
    <fieldset>
      <legend className="sr-only">Choose input playlists</legend>
      <div className="grid gap-2 md:grid-cols-3">
        {playlists.map((playlist, index) => {
          const selected = selectedIds.has(playlist.id);
          return (
            <button
              key={playlist.id}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => onToggle(playlist.id)}
              className={`source-card group text-left ${selected ? "selected" : ""}`}
            >
              <span className="flex items-start justify-between gap-4">
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`source-index source-index-${index + 1}`} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-sm font-semibold text-white/90">
                      {playlist.name}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-mist/55">
                      {playlist.tracks.length} tracks · {runtime(sourceRuntime(playlist))}
                    </span>
                  </span>
                </span>
                <span className={`selection-box ${selected ? "selected" : ""}`} aria-hidden="true">
                  {selected ? "✓" : ""}
                </span>
              </span>
              <span className="mt-4 block line-clamp-2 text-xs leading-5 text-mist/55">
                {playlist.description ?? "Source playlist"}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
