import { useEffect, useRef, useState } from "react";
import { getSemanticCapabilities, localAudioPreviewUrl, rankSemanticAudio, rankSemanticReference } from "../lib/api";
import type { SemanticBackendCapabilities, SemanticRankResponse, Track } from "../lib/types";
import { batchSemanticRanking } from "../lib/semantic/batchRanking";
import { ReferenceTrackPicker } from "./ReferenceTrackPicker";

export type ListeningPreset = "journey" | "crates";
const MODES = [
  { id: "vibe", title: "Describe a vibe", detail: "Find a sound you can put into words.", model: "CLAP · MuQ-MuLan" },
  { id: "neighbors", title: "More like this", detail: "Rediscover songs that sound like a favorite.", model: "MERT" },
  { id: "journey", title: "Build an energy journey", detail: "Move from a gentle start to a stronger finish.", model: "Essentia measurements" },
  { id: "crates", title: "Make mood crates", detail: "Separate moods, then organize the energy inside.", model: "Essentia measurements" },
] as const;
type Mode = typeof MODES[number]["id"];

export function MusicDiscovery({ tracks, audioPaths, fixture, canJourney, canCrates, journeyParameter = "energy", onApplyRanking, onPreset, onAdvanced }: {
  tracks: readonly Track[];
  audioPaths: Record<string, string>;
  fixture: boolean;
  canJourney: boolean;
  canCrates: boolean;
  journeyParameter?: "energy" | "arousal";
  onApplyRanking: (ranking: SemanticRankResponse, name: string) => void;
  onPreset: (preset: ListeningPreset) => void;
  onAdvanced: () => void;
}) {
  const [mode, setMode] = useState<Mode>("vibe");
  const [backends, setBackends] = useState<SemanticBackendCapabilities[]>([]);
  const [checkingModels, setCheckingModels] = useState(true);
  const [backendId, setBackendId] = useState("");
  const [query, setQuery] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ ranking: SemanticRankResponse; name: string; source: string } | null>(null);
  const revision = useRef(0);
  const source = JSON.stringify(tracks.map(({ id }) => [id, audioPaths[id] ?? ""]).sort());
  useEffect(() => {
    let stale = false;
    getSemanticCapabilities().then((items) => { if (!stale) setBackends(items); })
      .catch(() => { if (!stale) setStatus("Model status unavailable. Open model tools to check setup."); })
      .finally(() => { if (!stale) setCheckingModels(false); });
    return () => { stale = true; };
  }, []);
  useEffect(() => {
    revision.current += 1;
    setPage(0);
    setResult(null);
    setBusy(false);
    setStatus("");
    return () => { revision.current += 1; };
  }, [source, mode, query, backendId, referenceId]);
  const candidates = backends.filter((item) => item.capabilities.includes(mode === "neighbors" ? "reference_similarity" : "text_similarity"));
  const backend = candidates.find(({ id }) => id === backendId) ?? candidates.find(({ available }) => available) ?? candidates[0];
  const authorized = tracks.filter(({ id }) => audioPaths[id]);
  const reference = authorized.find(({ id }) => id === referenceId);
  const representation = backend?.default_representation ?? backend?.supported_representations?.[0];
  const oversized = Boolean(backend && authorized.length > backend.max_tracks);
  const batchReference = Boolean(backend && backend.max_tracks >= (mode === "neighbors" ? 2 : 1));
  const ready = !fixture && backend?.available && authorized.length > 0 && (!oversized || batchReference) && (mode === "neighbors" ? reference && representation : query.trim());
  const resultById = new Map(result?.ranking.results.map((item) => [item.track_id, item]));
  const rows = result?.source === source ? tracks.map((track) => {
    const item = resultById.get(track.id);
    return { track, score: item?.scores.find(({ key }) => key === result.ranking.score_key)?.score ?? null };
  }).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.track.id.localeCompare(b.track.id)) : [];
  async function discover() {
    if (!ready || !backend) return;
    const request = ++revision.current;
    setBusy(true);
    setPage(0);
    setResult(null);
    setStatus("Listening to the selected audio…");
    try {
      const paths = Object.fromEntries(authorized.map(({ id }) => [id, audioPaths[id]]));
      const ranking = await batchSemanticRanking({
        backend, audioPaths: paths,
        referenceTrackId: mode === "neighbors" ? reference?.id : undefined,
        shouldStop: () => request !== revision.current,
        onProgress: setStatus,
        runBatch: (batchPaths) => mode === "neighbors" && reference && representation
          ? rankSemanticReference({ backendId: backend.id, referenceTrackId: reference.id, audioPaths: batchPaths, representation })
          : rankSemanticAudio({ backendId: backend.id, label: query.trim(), audioPaths: batchPaths }),
      });
      if (request !== revision.current) return;
      setResult({ ranking, name: mode === "neighbors" ? `More like ${reference?.name}` : query.trim(), source });
      setStatus("Audition your matches, then use this order in the playlist preview.");
    } catch (reason) {
      if (request === revision.current) setStatus(reason instanceof Error ? reason.message : "Discovery failed. Try again.");
    } finally { if (request === revision.current) setBusy(false); }
  }
  const measurement = journeyParameter === "arousal" ? "arousal" : "energy";
  const scalar = mode === "journey" || mode === "crates";
  return <section className="music-discovery" aria-labelledby="discovery-heading">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="eyebrow">Find your next listen</p><h2 id="discovery-heading" className="mt-1 font-display text-2xl font-semibold">What do you want to play?</h2></div>
      <button className="secondary-button" type="button" onClick={onAdvanced}>Open model tools</button>
    </header>
    <div className="discovery-modes" role="group" aria-label="Listening mode">
      {MODES.map((item) => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => setMode(item.id)} className={`discovery-mode ${mode === item.id ? "active" : ""}`}><strong>{item.title}</strong><span>{item.detail}</span><small>{item.model}</small></button>)}
    </div>
    <div className="discovery-workbench">
      {scalar ? <>
        <h3 className="font-display text-lg">{mode === "journey" ? "One playlist. A steady rise in energy." : "Three moods. Two energy sections in each."}</h3>
        <p>{mode === "journey" ? `Keep all selected songs together and sort from low to high ${measurement}.` : `Split by valence (musical positivity), subgroup by ${measurement}, then sort each section by tempo.`} Every track stays inspectable, including tracks with missing measurements.</p>
        {journeyParameter === "arousal" && <p>Uses Essentia arousal: calm or sleepy → alert or excited. This is a mood estimate, distinct from loudness.</p>}
        <p>{fixture ? "Uses fictional demo measurements." : "Uses the selected tracks’ existing measurements. Select Essentia in Analysis & advanced controls and analyze first for local audio measurements."}</p>
        <button type="button" className="primary-button" disabled={mode === "journey" ? !canJourney : !canCrates} onClick={() => { onPreset(mode); setStatus("Recipe applied. Inspect the output preview below before export."); }}>Preview {mode === "journey" ? "energy journey" : "mood crates"}</button>
        {!(mode === "journey" ? canJourney : canCrates) && <p role="note">{tracks.length ? "Analyze your tracks first: this recipe needs " + (mode === "journey" ? "energy or arousal." : "valence, energy or arousal, and tempo.") : "Choose a source playlist below to begin."}</p>}
      </> : <>
        {fixture ? <p role="note">Demo playlists have fictional measurements, not audio for ML discovery. Try the energy journey or mood crates, or choose local sources below.</p> : <>
          <label className="control-field"><span>{mode === "neighbors" ? "Sound similarity model" : "Text-to-music model"}</span><select value={backend?.id ?? ""} onChange={(event) => setBackendId(event.target.value)} aria-label="Discovery model">{!candidates.length && <option value="">{checkingModels ? "Checking models…" : "No compatible model available"}</option>}{candidates.map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.available ? "" : " · setup needed"}</option>)}</select></label>
          {mode === "neighbors" ? <ReferenceTrackPicker tracks={authorized} audioPaths={audioPaths} value={referenceId} onChange={setReferenceId} /> : <>
            <label className="control-field"><span>Describe the music</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Warm, hazy synths for a late-night drive" /></label>
            <div className="flex flex-wrap gap-2">{["Hypnotic sunrise", "Warm acoustic afternoon", "Dark driving bass"].map((example) => <button className="secondary-button" type="button" key={example} onClick={() => setQuery(example)}>{example}</button>)}</div>
          </>}
          <div className="flex flex-wrap items-center gap-3"><button type="button" className="primary-button" disabled={!ready || busy} onClick={discover}>{busy ? "Finding matches…" : "Find matches"}</button>{busy && <button type="button" className="secondary-button" onClick={() => { revision.current += 1; setBusy(false); setStatus("Stopped. The current batch may finish caching, but no more batches will start."); }}>Stop</button>}<span>{authorized.length} of {tracks.length} selected tracks have local audio</span></div>
          {!tracks.length && <p><a className="text-acid underline" href="#sources-heading">Choose a source playlist</a> below to begin.</p>}
          {backend && !backend.available && <p role="note">{backend.display_name} needs setup. {backend.detail} Open model tools for setup options.</p>}
          {oversized && batchReference && <p role="note">Search all {authorized.length} tracks in small batches. {mode === "neighbors" ? "The reference stays the same throughout." : "Every batch uses the same description."} Cached analysis is reused; new audio may take several minutes.</p>}
          {oversized && !batchReference && <p role="alert">Select at most {backend?.max_tracks} tracks for {backend?.display_name}; {authorized.length} have audio.</p>}
        </>}
      </>}
      {status && <p role="status">{status}</p>}
      {(status.startsWith("Recipe applied.") || status.startsWith("Match order applied")) && <a className="text-sm text-acid underline" href="#outputs-heading">Review output preview</a>}
    </div>
    {result && rows.length > 0 && <section className="discovery-results" aria-label="Discovery matches">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-display text-lg">{result.name}</h3><p>{result.ranking.backend.display_name} · {rows.filter(({ score }) => score != null).length}/{tracks.length} scored · closest matches first</p></div><button type="button" className="primary-button" disabled={!rows.some(({ score }) => score != null)} onClick={() => { onApplyRanking(result.ranking, result.name); setStatus("Match order applied to one playlist. All source tracks retained. Review the output preview before export."); }}>Use this order</button></header>
      <p className="mt-2 text-xs text-mist/65">Similarity is a model score, not a probability or a guarantee of a smooth transition. Unscored songs stay visible.</p>
      {rows.length > 50 && <nav aria-label="Match pages" className="flex items-center gap-3 my-3"><button className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous matches</button><span>{page * 50 + 1}–{Math.min(rows.length, (page + 1) * 50)} of {rows.length}</span><button className="secondary-button" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}>Next matches</button></nav>}
      <ol start={page * 50 + 1} className="discovery-track-list">{rows.slice(page * 50, (page + 1) * 50).map(({ track, score }) => <li key={track.id}><div><strong>{track.name}</strong><span>{track.artist}{track.id === referenceId ? " · Reference song" : ""}</span></div><span>{score == null ? "Not scored" : score.toFixed(3)}</span>{audioPaths[track.id] ? <audio aria-label={`Listen to ${track.name}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[track.id])} /> : <span>No local audio</span>}</li>)}</ol>
    </section>}
  </section>;
}
