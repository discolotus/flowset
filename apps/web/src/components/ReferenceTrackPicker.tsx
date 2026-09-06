import { useEffect, useMemo, useState } from "react";

import { ResultPages } from "./ResultPages";
import { localAudioPreviewUrl } from "../lib/api";
import { duration } from "../lib/format";
import type { Track } from "../lib/types";

export function ReferenceTrackPicker({ tracks, audioPaths, value, onChange }: {
  tracks: readonly Track[];
  audioPaths: Record<string, string>;
  value: string;
  onChange: (trackId: string) => void;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [tracks]);
  const [search, setSearch] = useState("");
  const filteredTracks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return tracks;
    return tracks.filter((track) => [track.name, track.artist, track.album]
      .some((field) => field.toLocaleLowerCase().includes(query)));
  }, [search, tracks]);

  return <fieldset className="grid gap-3">
    <legend>Reference track</legend>
    <label className="text-xs text-mist/70">Search by title, artist, or album
      <input
        aria-label="Search reference tracks"
        className="mt-1 w-full rounded border border-line bg-black/20 p-2"
        type="search"
        value={search}
        onChange={(event) => { setSearch(event.target.value); setPage(0); }}
        placeholder="Search authorized tracks"
      />
    </label>
    <ResultPages page={page} total={filteredTracks.length} onChange={setPage} label="Reference pages" />
    <div className="grid max-h-80 gap-2 overflow-y-auto pr-1" aria-label="Reference track choices">
      {filteredTracks.slice(page * 50, (page + 1) * 50).map((track) => <div key={track.id} className={`rounded border p-3 ${value === track.id ? "border-acid bg-acid/5" : "border-line"}`}>
        <label className="flex cursor-pointer items-start gap-2">
          <input type="radio" name="semantic-reference-track" checked={value === track.id} onChange={() => onChange(track.id)} />
          <span>
            <strong className="block">{track.name}</strong>
            <span className="block text-xs text-mist/60">{track.artist} · {track.album} · {duration(track.duration_ms)}</span>
          </span>
        </label>
        {audioPaths[track.id] && <audio
          aria-label={`Preview reference ${track.name}`}
          className="mt-2 h-8 w-full"
          controls
          preload="none"
          src={localAudioPreviewUrl(audioPaths[track.id])}
        />}
      </div>)}
      {filteredTracks.length === 0 && <p role="status" className="text-xs text-mist/60">No authorized tracks match this search.</p>}
    </div>
  </fieldset>;
}
