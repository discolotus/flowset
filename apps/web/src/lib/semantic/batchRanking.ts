import type { SemanticBackendCapabilities, SemanticRankResponse } from "../types";

// One inference request at a time across discovery and the lab in this window.
// Cancellation never abandons a running request and starts another on top of it.
let queue: Promise<unknown> = Promise.resolve();
export async function batchSemanticRanking(input: {
  backend: SemanticBackendCapabilities;
  audioPaths: Record<string, string>;
  referenceTrackId?: string;
  runBatch: (paths: Record<string, string>) => Promise<SemanticRankResponse>;
  onProgress?: (message: string) => void;
  shouldStop?: () => boolean;
}): Promise<SemanticRankResponse> {
  const check = () => { if (input.shouldStop?.()) throw new Error("Search stopped. Completed audio analysis remains cached."); };
  const operation = async () => {
    check();
    const limit = Math.min(5, input.backend.max_tracks);
    const reference = input.referenceTrackId;
    if (!Number.isInteger(limit) || limit < (reference ? 2 : 1)) throw new Error("Invalid model batch limit.");
    if (reference && !input.audioPaths[reference]) throw new Error("The reference song needs local audio.");
    const entries = Object.entries(input.audioPaths);
    if (!entries.length) throw new Error("Select local audio first.");
    const candidates = entries.filter(([id]) => id !== reference);
    const size = limit - (reference ? 1 : 0);
    const count = Math.max(1, Math.ceil(candidates.length / size));
    let aggregate: SemanticRankResponse | undefined;
    const results = new Map<string, SemanticRankResponse["results"][number]>();
    for (let index = 0; index < count; index++) {
      check();
      input.onProgress?.(`${input.backend.display_name}: batch ${index + 1}/${count} · ${Math.min(index * size, candidates.length)}/${candidates.length} candidates checked. New audio takes longer; cached analysis is reused.`);
      const batch = candidates.slice(index * size, (index + 1) * size);
      if (reference) batch.unshift([reference, input.audioPaths[reference]]);
      const response = await input.runBatch(Object.fromEntries(batch));
      check();
      if (aggregate && (response.backend.id !== aggregate.backend.id || response.backend.model !== aggregate.backend.model || response.score_key !== aggregate.score_key || JSON.stringify(response.score_keys_by_normalized_label) !== JSON.stringify(aggregate.score_keys_by_normalized_label) || JSON.stringify(response.representation) !== JSON.stringify(aggregate.representation))) {
        throw new Error("Model or score definitions changed during the search. Please retry.");
      }
      aggregate ??= response;
      for (const row of response.results) results.set(row.track_id, row);
    }
    if (!aggregate) throw new Error("No ranking was returned.");
    // Preserve the unmodified response for a single request, including provider error details.
    if (count === 1) return aggregate;
    return { ...aggregate, results: [...results.values()], missing_track_ids: entries.filter(([id]) => results.get(id)?.status !== "complete").map(([id]) => id) };
  };
  input.onProgress?.("Waiting for the current search to finish…");
  const task = queue.then(operation);
  queue = task.catch(() => undefined);
  return task;
}
