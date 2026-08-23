// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { SemanticEmbeddingExplorer } from "./SemanticEmbeddingExplorer";

const backend = {
  id: "local-muq-mulan",
  display_name: "Local MuQ-MuLan",
  model: "muq-v1",
  available: true,
  requires_local_audio: true,
  max_tracks: 10,
  max_labels: 20,
  max_embedding_batch: 20,
  capabilities: ["text_similarity", "embedding_extraction"] as const,
  embedding_representation: "muq-mean-v1",
};
const tracks = [
  { id: "alpha", name: "Alpha", artist: "Artist A", album: "Set", duration_ms: 1_000, explicit: false, genres: [] },
  { id: "beta", name: "Beta", artist: "Artist B", album: "Set", duration_ms: 1_000, explicit: false, genres: [] },
  { id: "gamma", name: "Gamma", artist: "Artist C", album: "Set", duration_ms: 1_000, explicit: false, genres: [] },
  { id: "failed", name: "Failed", artist: "Artist D", album: "Set", duration_ms: 1_000, explicit: false, genres: [] },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("explores cached embeddings without rerunning inference or exposing recipe actions", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      backend: { ...backend, embedding_dimension: 3 },
      representation: "muq-mean-v1",
      dimension: 3,
      embeddings: [
        { track_id: "alpha", status: "complete", values: [1, 0, 0], cache_status: "hit" },
        { track_id: "beta", status: "complete", values: [0.9, 0.1, 0], cache_status: "hit" },
        { track_id: "gamma", status: "complete", values: [0, 0, 1], cache_status: "miss" },
        { track_id: "failed", status: "failed", values: [], cache_status: null, error: "Decode failed" },
      ],
      failed_track_ids: ["failed"],
      cache: { hits: 2, misses: 1, deduplicated: 0, evictions: 0, entries: 3, capacity: 128 },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<SemanticEmbeddingExplorer
    tracks={tracks}
    audioPaths={{ alpha: "alpha.mp3", beta: "beta.mp3", gamma: "gamma.mp3", failed: "failed.mp3" }}
    backends={[backend]}
  />);

  await user.click(screen.getByRole("button", { name: "Run embedding explorer" }));
  expect(await screen.findByText("Coverage 3/4")).not.toBeNull();
  expect(screen.getByText(/muq-mean-v1 · 3 dimensions/)).not.toBeNull();
  expect(screen.getByText(/Unavailable: Failed/)).not.toBeNull();
  expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
  expect(screen.getByText(/never become playlist splits/)).not.toBeNull();

  await user.selectOptions(screen.getByLabelText("Cluster count"), "2");
  await waitFor(() => expect(screen.getByText("2 populated clusters")).not.toBeNull());
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Use Beta as reference, cluster 1" }));
  expect(await screen.findByRole("heading", { name: "Beta" })).not.toBeNull();
  expect(screen.getByText(/similarity 0\.9939/)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
