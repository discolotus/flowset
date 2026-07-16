import { useEffect, useMemo, useState } from "react";

import { EnergyTimeline } from "./components/EnergyTimeline";
import { TrackTable } from "./components/TrackTable";
import { getDemoPlaylist, optimizePlaylist } from "./lib/api";
import { runtime } from "./lib/format";
import type {
  DemoPlaylist,
  GeneratedPlaylist,
  PlaylistSummary,
  Strategy,
  Track,
} from "./lib/types";

const STRATEGIES: Array<{ value: Strategy; label: string; detail: string }> = [
  { value: "energy_bpm_key", label: "Balanced flow", detail: "Energy → BPM → key" },
  { value: "energy_progression", label: "Build energy", detail: "Calm to peak" },
  { value: "energy_pyramid", label: "Full journey", detail: "Rise, peak, resolve" },
  { value: "bpm_first", label: "Tempo rooms", detail: "10 BPM windows" },
  { value: "key_first", label: "Harmonic", detail: "Camelot wheel first" },
  { value: "energy_buckets", label: "Create five moods", detail: "Separate playlists" },
];

function summarize(tracks: Track[]): PlaylistSummary {
  const features = tracks.flatMap((track) => (track.audio_features ? [track.audio_features] : []));
  const mean = (values: number[]) =>
    values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  const energies = features.map((item) => item.energy);
  return {
    song_count: tracks.length,
    duration_ms: tracks.reduce((total, track) => total + track.duration_ms, 0),
    average_energy: mean(energies),
    average_bpm: mean(features.map((item) => item.tempo)),
    average_danceability: mean(features.map((item) => item.danceability)),
    energy_range: energies.length ? [Math.min(...energies), Math.max(...energies)] : null,
  };
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 border-r border-line px-5 last:border-r-0 first:pl-0">
      <p className="text-[10px] uppercase tracking-[0.16em] text-mist/50">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tracking-tight text-white/90">{value}</p>
      {detail && <p className="mt-0.5 truncate text-[11px] text-mist/50">{detail}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" onClick={onChange} className="flex w-full items-center justify-between gap-3 py-1.5 text-left">
      <span className="text-sm text-white/70">{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-acid" : "bg-white/10"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full transition ${checked ? "left-[18px] bg-ink" : "left-0.5 bg-mist"}`} />
      </span>
    </button>
  );
}

export default function App() {
  const [demo, setDemo] = useState<DemoPlaylist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [outputs, setOutputs] = useState<GeneratedPlaylist[]>([]);
  const [activeOutput, setActiveOutput] = useState(0);
  const [strategy, setStrategy] = useState<Strategy>("energy_bpm_key");
  const [maximumBpmJump, setMaximumBpmJump] = useState(8);
  const [maximumEnergyJump, setMaximumEnergyJump] = useState(0.15);
  const [artistSpacing, setArtistSpacing] = useState(2);
  const [excludeExplicit, setExcludeExplicit] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDemoPlaylist()
      .then((playlist) => {
        setDemo(playlist);
        setTracks(playlist.tracks);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Unable to load the demo playlist."),
      )
      .finally(() => setLoading(false));
  }, []);

  const summary = useMemo(() => summarize(tracks), [tracks]);
  const selectedStrategy = STRATEGIES.find((item) => item.value === strategy)!;

  const runOptimization = async () => {
    if (!demo || tracks.length === 0) return;
    setOptimizing(true);
    setError(null);
    try {
      const response = await optimizePlaylist({
        name: demo.name,
        strategy,
        tracks,
        maximumBpmJump,
        maximumEnergyJump,
        minimumArtistSpacing: artistSpacing,
        excludeExplicit,
      });
      setOutputs(response.generated_playlists);
      setActiveOutput(0);
      setTracks(response.generated_playlists[0]?.tracks ?? []);
      setWarnings(response.warnings);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Optimization failed.");
    } finally {
      setOptimizing(false);
    }
  };

  const chooseOutput = (index: number) => {
    setActiveOutput(index);
    setTracks(outputs[index].tracks);
  };

  const moveTrack = (sourceId: string, targetId: string) => {
    if (locked.has(sourceId) || locked.has(targetId)) return;
    setTracks((current) => {
      const sourceIndex = current.findIndex((track) => track.id === sourceId);
      const targetIndex = current.findIndex((track) => track.id === targetId);
      const copy = [...current];
      const [moved] = copy.splice(sourceIndex, 1);
      copy.splice(targetIndex, 0, moved);
      return copy;
    });
  };

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    if (!demo) return;
    setTracks(demo.tracks);
    setOutputs([]);
    setWarnings([]);
    setPinned(new Set());
    setLocked(new Set());
  };

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-ink text-mist">Loading the crate…</main>;
  }

  if (error && !demo) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink p-8 text-center text-white">
        <div>
          <p className="text-acid">The API is not running.</p>
          <p className="mt-2 text-sm text-mist">Start both services with `npm run dev`.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white selection:bg-acid selection:text-ink">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-ink/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-acid/40 bg-acid/10 font-display text-sm font-bold text-acid">S</span>
            <div>
              <p className="font-display text-sm font-semibold tracking-tight">Sequence</p>
              <p className="text-[9px] uppercase tracking-[0.2em] text-mist/45">Playlist optimizer</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-amber-200/80 sm:block">Fixture data</span>
            <button className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-white/50" disabled>
              Connect Spotify — next milestone
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-6 px-5 py-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8 lg:py-8">
        <aside className="h-fit rounded-2xl border border-line bg-panel p-5 shadow-glow lg:sticky lg:top-24">
          <p className="eyebrow">Optimization recipe</p>
          <h2 className="mt-2 font-display text-xl font-semibold">Shape the arc</h2>
          <p className="mt-1 text-xs leading-5 text-mist/60">Choose how the set should move, then tune its guardrails.</p>

          <label className="mt-6 block text-[10px] uppercase tracking-[0.14em] text-mist/50" htmlFor="strategy">Strategy</label>
          <select
            id="strategy"
            className="mt-2 w-full rounded-xl border border-line bg-ink/60 px-3 py-3 text-sm text-white outline-none focus:border-acid/50"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as Strategy)}
          >
            {STRATEGIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <p className="mt-2 text-xs text-acid/70">{selectedStrategy.detail}</p>

          <div className="mt-6 space-y-5 border-t border-line pt-5">
            <label className="block">
              <span className="flex justify-between text-xs text-mist"><span>Max BPM jump</span><span className="font-mono text-white/80">{maximumBpmJump}</span></span>
              <input className="range" type="range" min="2" max="30" value={maximumBpmJump} onChange={(event) => setMaximumBpmJump(Number(event.target.value))} />
            </label>
            <label className="block">
              <span className="flex justify-between text-xs text-mist"><span>Max energy jump</span><span className="font-mono text-white/80">{maximumEnergyJump.toFixed(2)}</span></span>
              <input className="range" type="range" min="0.05" max="0.5" step="0.05" value={maximumEnergyJump} onChange={(event) => setMaximumEnergyJump(Number(event.target.value))} />
            </label>
            <label className="block">
              <span className="flex justify-between text-xs text-mist"><span>Artist spacing</span><span className="font-mono text-white/80">{artistSpacing} tracks</span></span>
              <input className="range" type="range" min="0" max="10" value={artistSpacing} onChange={(event) => setArtistSpacing(Number(event.target.value))} />
            </label>
            <Toggle checked={excludeExplicit} onChange={() => setExcludeExplicit((value) => !value)} label="Exclude explicit tracks" />
          </div>

          <button className="mt-6 w-full rounded-xl bg-acid px-4 py-3 text-sm font-semibold text-ink transition hover:bg-[#c8ff81] disabled:opacity-50" onClick={runOptimization} disabled={optimizing || tracks.length === 0}>
            {optimizing ? "Finding the flow…" : "Generate preview"}
          </button>
          <button className="mt-2 w-full px-4 py-2 text-xs text-mist/55 transition hover:text-white" onClick={reset}>Reset source order</button>
        </aside>

        <section className="min-w-0">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="eyebrow">Working playlist</p>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-[-0.035em] md:text-4xl">{outputs[activeOutput]?.name ?? demo?.name}</h1>
              <p className="mt-2 max-w-2xl text-sm text-mist/60">{demo?.description} Drag any unlocked row to refine the sequence.</p>
            </div>
            <div className="flex gap-2">
              <button className="secondary-button" onClick={reset}>Discard changes</button>
              <button className="secondary-button cursor-not-allowed opacity-45" disabled>Save to Spotify</button>
            </div>
          </div>

          {outputs.length > 1 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {outputs.map((output, index) => (
                <button key={output.name} onClick={() => chooseOutput(index)} className={`rounded-full border px-3 py-1.5 text-xs transition ${index === activeOutput ? "border-acid/50 bg-acid/10 text-acid" : "border-line text-mist hover:text-white"}`}>{output.name.split("—").at(-1)}</button>
              ))}
            </div>
          )}

          {(warnings.length > 0 || error) && (
            <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-4 py-3 text-xs leading-5 text-amber-100/75">
              {error ?? warnings.join(" ")}
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-y-5 rounded-2xl border border-line bg-panel px-5 py-5 shadow-glow sm:grid-cols-4">
            <Stat label="Tracks" value={String(summary.song_count)} detail={`${pinned.size} pinned · ${locked.size} locked`} />
            <Stat label="Runtime" value={runtime(summary.duration_ms)} detail="Estimated set length" />
            <Stat label="Avg. energy" value={summary.average_energy?.toFixed(2) ?? "—"} detail={summary.energy_range ? `${summary.energy_range[0].toFixed(2)}–${summary.energy_range[1].toFixed(2)} range` : undefined} />
            <Stat label="Avg. tempo" value={summary.average_bpm ? `${summary.average_bpm.toFixed(0)} BPM` : "—"} detail={`${summary.average_danceability?.toFixed(2) ?? "—"} danceability`} />
          </div>

          <div className="mt-6 rounded-2xl border border-line bg-panel p-5 shadow-glow">
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Energy timeline</p>
                <h2 className="mt-1 font-display text-lg font-semibold">The shape of the set</h2>
              </div>
              <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-mist/55">0.0 — 1.0</span>
            </div>
            <div className="mt-3"><EnergyTimeline tracks={tracks} /></div>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel shadow-glow">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="eyebrow">Sequence preview</p>
                <h2 className="mt-1 font-display text-lg font-semibold">Transition by transition</h2>
              </div>
              <p className="hidden text-xs text-mist/45 sm:block">Drag to reorder · Pin ◆ · Lock ○</p>
            </div>
            <TrackTable
              tracks={tracks}
              pinned={pinned}
              locked={locked}
              onMove={moveTrack}
              onRemove={(id) => setTracks((current) => current.filter((track) => track.id !== id))}
              onTogglePin={(id) => toggleSet(setPinned, id)}
              onToggleLock={(id) => toggleSet(setLocked, id)}
            />
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1500px] items-center justify-between border-t border-line px-5 py-6 text-[11px] text-mist/40 lg:px-8">
        <span>Sequence · V0.1 foundation</span>
        <span>Original playlists are always read-only</span>
      </footer>
    </div>
  );
}
