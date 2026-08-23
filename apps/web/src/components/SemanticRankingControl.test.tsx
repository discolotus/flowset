import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SemanticRankingControl } from "./SemanticRankingControl";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const capability = (id: string, capabilities: string[]) => ({ id, display_name: id === "local-mert" ? "Local MERT" : "Local MuQ-MuLan", model: "local-v1", available: true, requires_local_audio: true, max_tracks: 100, max_labels: 20, capabilities });

it("uses a free-text query with MuQ-MuLan", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify([capability("local-muq-mulan", ["text_similarity", "embedding_extraction"])])))
    .mockResolvedValueOnce(new Response(JSON.stringify({ backend: {}, score_key: "semantic:local-muq-mulan:local-v1:hypnotic", results: [{ track_id: "one", status: "complete", scores: [] }], missing_track_ids: [] })));
  const onRanked = vi.fn();
  render(<SemanticRankingControl audioPaths={{ one: "one.wav" }} onRanked={onRanked} />);
  await userEvent.type(await screen.findByLabelText("Text-to-music query"), "hypnotic");
  await userEvent.click(screen.getByRole("button", { name: "Rank by text" }));
  expect(onRanked).toHaveBeenCalledOnce();
  expect(onRanked.mock.calls[0][1]).toEqual({ distribution: true, split: false, subgroup: false, sort: false });
});

it("lets each recipe scope be selected independently", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify([capability("local-muq-mulan", ["text_similarity"])])))
    .mockResolvedValueOnce(new Response(JSON.stringify({ backend: {}, score_key: "semantic:key", results: [], missing_track_ids: [] })));
  const onRanked = vi.fn();
  render(<SemanticRankingControl audioPaths={{ one: "one.wav" }} onRanked={onRanked} />);
  await userEvent.type(await screen.findByLabelText("Text-to-music query"), "warm");
  await userEvent.click(screen.getByLabelText("distribution"));
  await userEvent.click(screen.getByLabelText("subgroup"));
  await userEvent.click(screen.getByLabelText("ordering / sort"));
  await userEvent.click(screen.getByRole("button", { name: "Rank by text" }));
  expect(onRanked.mock.calls[0][1]).toEqual({ distribution: false, split: false, subgroup: true, sort: true });
});

it("clears active recipe assignments without ranking or changing stored scores", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([capability("local-muq-mulan", ["text_similarity"])])));
  const onRanked = vi.fn();
  const onClearScopes = vi.fn();
  render(<SemanticRankingControl audioPaths={{ one: "one.wav" }} hasActiveScopes onRanked={onRanked} onClearScopes={onClearScopes} />);
  await screen.findByLabelText("Text-to-music query");
  await userEvent.click(screen.getByRole("button", { name: "Clear recipe assignments" }));
  expect(onClearScopes).toHaveBeenCalledOnce();
  expect(onRanked).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});

it("prevents a request beyond the selected backend track limit", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([{ ...capability("local-muq-mulan", ["text_similarity"]), max_tracks: 1 }])));
  render(<SemanticRankingControl audioPaths={{ one: "one.wav", two: "two.wav" }} onRanked={vi.fn()} />);
  await userEvent.type(await screen.findByLabelText("Text-to-music query"), "warm");
  expect(screen.getByRole("alert").textContent).toContain("at most 1 tracks");
  expect((screen.getByRole("button", { name: "Rank by text" }) as HTMLButtonElement).disabled).toBe(true);
});

it("routes reference scoring to Semantic Lab instead of applying it directly", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([
    capability("local-muq-mulan", ["text_similarity"]),
    capability("local-mert", ["reference_similarity", "embedding_extraction"]),
  ])));
  render(<SemanticRankingControl audioPaths={{ one: "one.wav", two: "two.wav" }} onRanked={vi.fn()} />);
  expect((await screen.findByText(/Reference-track scoring is available in Semantic Lab/)).textContent).toContain("explicit promotion");
  expect(screen.queryByRole("option", { name: "Local MERT" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Rank by sonic similarity" })).toBeNull();
});
