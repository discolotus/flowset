import { useEffect, useMemo, useRef, useState } from "react";

import { extractSemanticEmbeddings, localAudioPreviewUrl } from "../lib/api";
import {
  analyzeEmbeddingSpace,
  cosineNeighbors,
  prototypeSimilarities,
  type EmbeddingSpaceAnalysis,
} from "../lib/semantic/embeddingExplorer";
import type {
  SemanticBackendCapabilities,
  SemanticEmbeddingResponse,
  Track,
} from "../lib/types";

const CLUSTER_COLORS = ["#b7ff4a", "#5eead4", "#a78bfa", "#fb7185", "#fbbf24", "#60a5fa"];

function axisPosition(value: number, minimum: number, maximum: number, start: number, size: number) {
  return maximum === minimum ? start + size / 2 : start + ((value - minimum) / (maximum - minimum)) * size;
}

export function SemanticEmbeddingExplorer({ tracks, audioPaths, backends }: {
  tracks: readonly Track[];
  audioPaths: Record<string, string>;
  backends: readonly SemanticBackendCapabilities[];
}) {
  const embeddingBackends = backends.filter(({ capabilities }) =>
    capabilities.includes("embedding_extraction"));
  const [backendId, setBackendId] = useState("");
  const [response, setResponse] = useState<SemanticEmbeddingResponse | null>(null);
  const [clusterCount, setClusterCount] = useState(3);
  const [referenceTrackId, setReferenceTrackId] = useState("");
  const [mode, setMode] = useState<"neighbors" | "prototype">("neighbors");
  const [prototypeAnchorIds, setPrototypeAnchorIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Choose an embedding backend and run this selected subset.");
  const latestRequest = useRef(0);
  const selectedFingerprint = tracks.map(({ id }) => `${id.length}:${id}:${audioPaths[id] ?? ""}`).join("|");

  useEffect(() => {
    setBackendId((current) => embeddingBackends.some(({ id }) => id === current)
      ? current
      : embeddingBackends.find(({ available }) => available)?.id ?? embeddingBackends[0]?.id ?? "");
  }, [backends]);

  useEffect(() => {
    latestRequest.current += 1;
    setResponse(null);
    setReferenceTrackId("");
    setPrototypeAnchorIds(new Set());
    setBusy(false);
    setStatus("Choose an embedding backend and run this selected subset.");
  }, [backendId, selectedFingerprint]);

  const backend = embeddingBackends.find(({ id }) => id === backendId);
  const oversized = Boolean(backend && tracks.length > backend.max_tracks);
  const analysisResult = useMemo<{ analysis: EmbeddingSpaceAnalysis | null; error: string | null }>(() => {
    if (!response) return { analysis: null, error: null };
    try {
      return { analysis: analyzeEmbeddingSpace(response, clusterCount), error: null };
    } catch (reason) {
      return {
        analysis: null,
        error: reason instanceof Error ? reason.message : "Embedding space could not be analyzed.",
      };
    }
  }, [clusterCount, response]);
  const analysis = analysisResult.analysis;
  const metadata = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);

  useEffect(() => {
    if (!analysis?.points.length) {
      setReferenceTrackId("");
      return;
    }
    setReferenceTrackId((current) =>
      analysis.points.some(({ trackId }) => trackId === current) ? current : analysis.points[0].trackId);
  }, [analysis]);

  const neighbors = useMemo(() =>
    analysis && referenceTrackId ? cosineNeighbors(analysis.points, referenceTrackId) : [],
  [analysis, referenceTrackId]);
  const prototypeRanking = useMemo(() => {
    if (!analysis || prototypeAnchorIds.size === 0) return [];
    return prototypeSimilarities(analysis.points, [...prototypeAnchorIds]);
  }, [analysis, prototypeAnchorIds]);
  const referenceTrack = metadata.get(referenceTrackId);
  const xs = analysis?.points.map(({ x }) => x) ?? [];
  const ys = analysis?.points.map(({ y }) => y) ?? [];
  const xMinimum = xs.length ? Math.min(...xs) : 0;
  const xMaximum = xs.length ? Math.max(...xs) : 0;
  const yMinimum = ys.length ? Math.min(...ys) : 0;
  const yMaximum = ys.length ? Math.max(...ys) : 0;

  async function runExplorer() {
    if (!backend || !backend.available || tracks.length === 0 || oversized) return;
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setBusy(true);
    setResponse(null);
    try {
      const next = await extractSemanticEmbeddings({
        backend,
        audioPaths: Object.fromEntries(tracks.map(({ id }) => [id, audioPaths[id]])),
      });
      if (latestRequest.current !== requestId) return;
      setResponse(next);
      const complete = next.embeddings.filter(({ status }) => status === "complete").length;
      setStatus(`${complete}/${next.embeddings.length} embeddings available. Exploration only; recipe unchanged.`);
    } catch (reason) {
      if (latestRequest.current !== requestId) return;
      setStatus(reason instanceof Error ? reason.message : "Embedding extraction failed.");
    } finally {
      if (latestRequest.current === requestId) setBusy(false);
    }
  }

  return <section className="rounded-lg border border-line p-5" aria-labelledby="embedding-explorer-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow">Embedding space</p>
        <h2 id="embedding-explorer-heading" className="mt-1 font-display text-xl font-semibold">Neighborhood & cluster explorer</h2>
        <p className="mt-2 max-w-3xl text-xs text-mist/60">Cached local embeddings power deterministic cosine neighbors, PCA coordinates, and normalized-vector clusters. Clusters are exploratory and never become playlist splits or recipe state.</p>
      </div>
      {response && <div className="text-right font-mono text-[10px] text-mist/50">
        <p>{response.backend.id} · {response.backend.model}</p>
        <p>{response.representation} · {response.dimension ?? "unknown"} dimensions</p>
      </div>}
    </div>

    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end">
      <label>Embedding backend<select aria-label="Embedding backend" className="mt-1 w-full rounded border border-line bg-ink p-2" value={backendId} onChange={(event) => setBackendId(event.target.value)}>
        {embeddingBackends.map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.available ? "" : " (unavailable)"}</option>)}
      </select></label>
      <label>Clusters<select aria-label="Cluster count" className="mt-1 w-full rounded border border-line bg-ink p-2" value={clusterCount} onChange={(event) => setClusterCount(Number(event.target.value))}>
        {[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count}</option>)}
      </select></label>
      <button type="button" className="primary-button" disabled={busy || !backend?.available || tracks.length === 0 || oversized} onClick={runExplorer}>{busy ? "Extracting…" : "Run embedding explorer"}</button>
    </div>
    {embeddingBackends.length === 0 && <p className="mt-3 text-amber-200">No backend exposes local embeddings.</p>}
    {oversized && <p role="alert" className="mt-3 text-amber-200">Select at most {backend?.max_tracks} tracks for this embedding space.</p>}
    <p role="status" className="mt-3 text-xs text-mist/60">{status}</p>
    {analysisResult.error && <p role="alert" className="mt-3 text-amber-200">{analysisResult.error}</p>}

    {analysis && response && <>
      <div className="mt-5 flex flex-wrap gap-3 text-xs">
        <span className="rounded-full border border-line px-3 py-1">Coverage {analysis.completeCount}/{analysis.requestedCount}</span>
        <span className="rounded-full border border-line px-3 py-1">{analysis.clusterCount} populated clusters</span>
        <span className="rounded-full border border-line px-3 py-1">Cache {response.cache.hits} hits · {response.cache.misses} misses · {response.cache.deduplicated} shared</span>
      </div>
      <p className="mt-2 font-mono text-[10px] text-mist/45">Centered Gram PCA · 64 deterministic iterations · cosine neighbors · normalized-vector k-means k={clusterCount} · bounded to 100 tracks</p>
      <div className="mt-4 flex gap-2" role="group" aria-label="Embedding exploration mode"><button type="button" className="compact-button" aria-pressed={mode === "neighbors"} onClick={() => setMode("neighbors")}>Nearest neighbors</button><button type="button" className="compact-button" aria-pressed={mode === "prototype"} onClick={() => setMode("prototype")}>Prototype similarity</button></div>
      {mode === "prototype" && <fieldset className="mt-4 rounded-lg border border-line p-3"><legend>Positive anchors ({prototypeAnchorIds.size})</legend><p className="mt-1 text-xs text-mist/55">The prototype is the normalized centroid of the selected embeddings. This ranking remains exploratory and does not create a split or recipe score.</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{analysis.points.map(({ trackId }) => { const track = metadata.get(trackId); return <label key={trackId} className="rounded border border-line p-2 text-xs"><input type="checkbox" checked={prototypeAnchorIds.has(trackId)} onChange={(event) => setPrototypeAnchorIds((current) => { const next = new Set(current); event.target.checked ? next.add(trackId) : next.delete(trackId); return next; })} /> {track?.name ?? trackId} · {track?.artist ?? "Metadata unavailable"}</label>; })}</div></fieldset>}
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <figure className="rounded-xl border border-line bg-black/15 p-3" aria-labelledby="embedding-map-caption">
          <figcaption id="embedding-map-caption" className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist/60"><span>Deterministic PCA projection</span><span>Click a point to inspect its neighborhood</span></figcaption>
          <svg className="mt-3 h-auto w-full" viewBox="0 0 640 360" role="img" aria-label="Embedding PCA cluster map">
            <rect x="0" y="0" width="640" height="360" rx="16" fill="rgba(255,255,255,0.015)" />
            {analysis.points.map((point) => {
              const track = metadata.get(point.trackId);
              const selected = mode === "prototype" ? prototypeAnchorIds.has(point.trackId) : point.trackId === referenceTrackId;
              return <circle
                key={point.trackId}
                role="button"
                tabIndex={0}
                aria-label={mode === "prototype" ? `${selected ? "Remove" : "Add"} ${track?.name ?? point.trackId} ${selected ? "from" : "to"} prototype anchors, cluster ${point.cluster + 1}` : `Use ${track?.name ?? point.trackId} as reference, cluster ${point.cluster + 1}`}
                cx={axisPosition(point.x, xMinimum, xMaximum, 42, 556)}
                cy={axisPosition(point.y, yMinimum, yMaximum, 42, 276)}
                r={selected ? 11 : 8}
                className="cursor-pointer focus:outline-none"
                fill={CLUSTER_COLORS[point.cluster % CLUSTER_COLORS.length]}
                stroke={selected ? "#ffffff" : "#111827"}
                strokeWidth={selected ? 4 : 2}
                onClick={() => mode === "prototype" ? setPrototypeAnchorIds((current) => { const next = new Set(current); next.has(point.trackId) ? next.delete(point.trackId) : next.add(point.trackId); return next; }) : setReferenceTrackId(point.trackId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (mode === "prototype") setPrototypeAnchorIds((current) => { const next = new Set(current); next.has(point.trackId) ? next.delete(point.trackId) : next.add(point.trackId); return next; });
                    else setReferenceTrackId(point.trackId);
                  }
                }}
              ><title>{track ? `${track.name} · ${track.artist}` : point.trackId}</title></circle>;
            })}
          </svg>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-mist/55">{Array.from({ length: analysis.clusterCount }, (_, cluster) => <span key={cluster}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[cluster] }} />Cluster {cluster + 1} · {analysis.points.filter((point) => point.cluster === cluster).length}</span>)}</div>
        </figure>

        {mode === "neighbors" ? <aside className="rounded-xl border border-line p-4" aria-labelledby="neighbor-heading">
          <p className="eyebrow">Reference track</p>
          <h3 id="neighbor-heading" className="mt-1 font-display text-lg font-semibold">{referenceTrack?.name ?? referenceTrackId}</h3>
          {referenceTrack && <p className="text-xs text-mist/60">{referenceTrack.artist} · {referenceTrack.album}</p>}
          {referenceTrackId && audioPaths[referenceTrackId] && <audio className="mt-3 w-full" aria-label={`Preview ${referenceTrack?.name ?? referenceTrackId}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[referenceTrackId])} />}
          <ol className="mt-4 grid gap-2">{neighbors.map((neighbor, index) => {
            const track = metadata.get(neighbor.trackId);
            return <li key={neighbor.trackId} className="rounded-lg border border-line p-3 text-xs">
              <button type="button" className="w-full text-left" onClick={() => setReferenceTrackId(neighbor.trackId)}><strong>{index + 1}. {track?.name ?? neighbor.trackId}</strong><br/><span className="text-mist/55">{track?.artist ?? "Metadata unavailable"} · similarity {neighbor.similarity.toFixed(4)} · distance {neighbor.distance.toFixed(4)}</span></button>
            </li>;
          })}</ol>
        </aside> : <aside className="rounded-xl border border-line p-4" aria-labelledby="prototype-heading"><p className="eyebrow">Centroid ranking</p><h3 id="prototype-heading" className="mt-1 font-display text-lg font-semibold">Prototype similarity</h3>{prototypeAnchorIds.size === 0 ? <p className="mt-3 text-xs text-mist/60">Choose one or more positive anchors to build the prototype.</p> : <ol className="mt-4 grid gap-2">{prototypeRanking.map((item, index) => { const track = metadata.get(item.trackId); return <li key={item.trackId} className="rounded-lg border border-line p-3 text-xs"><strong>{index + 1}. {track?.name ?? item.trackId}{item.isAnchor ? " · anchor" : ""}</strong><br/><span className="text-mist/55">{track?.artist ?? "Metadata unavailable"} · similarity {item.similarity.toFixed(4)} · distance {item.distance.toFixed(4)}</span>{audioPaths[item.trackId] && <audio className="mt-2 w-full" aria-label={`Prototype preview ${track?.name ?? item.trackId}`} controls preload="none" src={localAudioPreviewUrl(audioPaths[item.trackId])} />}</li>; })}</ol>}</aside>}
      </div>
      {analysis.failedTrackIds.length > 0 && <div className="mt-4 rounded-lg border border-amber-300/25 p-3 text-xs text-amber-100" role="alert"><strong>Partial embedding coverage</strong><p className="mt-1">Unavailable: {analysis.failedTrackIds.map((trackId) => metadata.get(trackId)?.name ?? trackId).join(", ")}. These tracks are excluded from projection, clusters, and neighbors.</p></div>}
    </>}
  </section>;
}
