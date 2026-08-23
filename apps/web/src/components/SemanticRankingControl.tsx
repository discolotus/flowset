import { useEffect, useMemo, useState } from "react";

import { getSemanticCapabilities, rankSemanticAudio } from "../lib/api";
import type { SemanticBackendCapabilities, SemanticRankResponse } from "../lib/types";

export function SemanticRankingControl({ audioPaths, onRanked, hasActiveScopes = false, onClearScopes }: {
  audioPaths: Record<string, string>;
  onRanked: (response: SemanticRankResponse, scopes: SemanticScopes) => void;
  hasActiveScopes?: boolean;
  onClearScopes?: () => void;
}) {
  const [scopes, setScopes] = useState<SemanticScopes>({ distribution: true, split: false, subgroup: false, sort: false });
  const [backends, setBackends] = useState<SemanticBackendCapabilities[]>([]);
  const [backendId, setBackendId] = useState("local-clap");
  const [label, setLabel] = useState("");
  const trackIds = Object.keys(audioPaths);
  const [status, setStatus] = useState("Checking local semantic backends…");
  const [busy, setBusy] = useState(false);
  const backend = useMemo(() => backends.find((item) => item.id === backendId), [backends, backendId]);
  const hasReferenceBackend = backends.some((item) => item.capabilities.includes("reference_similarity"));

  useEffect(() => {
    getSemanticCapabilities().then((items) => {
      setBackends(items);
      const textBackends = items.filter((item) => item.capabilities.includes("text_similarity"));
      const first = textBackends.find((item) => item.available) ?? textBackends[0];
      if (first) setBackendId(first.id);
      setStatus(first ? first.detail ?? `${first.display_name} · ${first.model}` : "No text-ranking backend configured");
    }).catch(() => setStatus("Local semantic backends unavailable"));
  }, []);

  const rank = async () => {
    if (!backend) return;
    setBusy(true);
    try {
      const response = await rankSemanticAudio({ backendId, label, audioPaths });
      onRanked(response, scopes);
      setStatus(`${response.results.length - response.missing_track_ids.length} ranked · ${response.missing_track_ids.length} unavailable`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Semantic ranking failed");
    } finally { setBusy(false); }
  };

  const oversized = Boolean(backend && trackIds.length > backend.max_tracks);
  const ready = Boolean(backend?.available && trackIds.length && !oversized && Object.values(scopes).some(Boolean) && label.trim());
  return <section aria-label="Semantic ranking" className="mt-4 grid gap-2">
    <label className="text-xs text-mist/70">Semantic backend
      <select aria-label="Semantic backend" value={backendId} onChange={(event) => setBackendId(event.target.value)} className="mt-1 w-full rounded border border-line bg-ink p-2">
        {backends.filter((item) => item.capabilities.includes("text_similarity")).map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.available ? "" : " (unavailable)"}</option>)}
      </select>
    </label>
    <label className="text-xs text-mist/70">Text-to-music query
      <input aria-label="Text-to-music query" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. hypnotic sunrise" className="mt-1 w-full rounded border border-line bg-black/20 p-2" />
    </label>
    <fieldset className="grid grid-cols-2 gap-1" aria-label="Apply semantic score to">
      <legend className="text-xs text-mist/70">Apply this score to</legend>
      {(["distribution", "split", "subgroup", "sort"] as const).map((scope) => <label key={scope} className="text-xs capitalize">
        <input type="checkbox" checked={scopes[scope]} onChange={(event) => setScopes((current) => ({ ...current, [scope]: event.target.checked }))} /> {scope === "sort" ? "ordering / sort" : scope}
      </label>)}
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={!ready || busy} onClick={rank} className="button-secondary">{busy ? "Ranking…" : "Rank by text"}</button>
      <button type="button" disabled={!hasActiveScopes || busy} onClick={onClearScopes} className="button-secondary">Clear recipe assignments</button>
    </div>
    {oversized && <p role="alert" className="text-xs text-amber-300">Select at most {backend?.max_tracks} tracks for this backend ({trackIds.length} selected).</p>}
    {hasReferenceBackend && <p className="text-xs text-mist/60">Reference-track scoring is available in Semantic Lab, where neighbors remain inspectable until explicit promotion.</p>}
    {backend?.license_note && <p className="text-[10px] text-mist/40">{backend.license_note}</p>}
    <p role="status" className="text-xs text-mist/50">{status}</p>
  </section>;
}

export interface SemanticScopes { distribution: boolean; split: boolean; subgroup: boolean; sort: boolean }
