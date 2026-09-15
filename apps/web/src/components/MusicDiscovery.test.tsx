import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MusicDiscovery } from "./MusicDiscovery";
import * as api from "../lib/api";
import type { SemanticBackendCapabilities, SemanticRankResponse, Track } from "../lib/types";

const textBackend: SemanticBackendCapabilities = { id: "local-clap", display_name: "CLAP", model: "test", available: true, requires_local_audio: true, max_tracks: 10, max_labels: 1, max_embedding_batch: 10, capabilities: ["text_similarity"] };
const mert: SemanticBackendCapabilities = { ...textBackend, id: "local-mert", display_name: "MERT", capabilities: ["reference_similarity"], default_representation: { layer: "test", pooling: "mean", segment: "first_30s" } };
const tracks: Track[] = ["one", "two"].map((id) => ({ id, name: id, artist: "Fictional artist", album: "Fixture", duration_ms: 120000, explicit: false, genres: [] }));
const response = { backend: textBackend, score_key: "score", score_keys_by_normalized_label: {}, results: [{ track_id: "one", status: "complete", scores: [{ key: "score", score: .8 }] }], missing_track_ids: ["two"] } as SemanticRankResponse;
const props = () => ({ tracks, audioPaths: { one: "one.wav", two: "two.wav" }, fixture: false, canJourney: true, canCrates: true, onApplyRanking: vi.fn(), onPreset: vi.fn(), onAdvanced: vi.fn() });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function setup() { vi.spyOn(api, "getSemanticCapabilities").mockResolvedValue([textBackend, mert]); }
it("auditions matches, keeps missing tracks, and applies only on explicit action", async () => {
  setup(); vi.spyOn(api, "rankSemanticAudio").mockResolvedValue(response);
  const input = props(); render(<MusicDiscovery {...input} />);
  await userEvent.click(screen.getByRole("button", { name: "Hypnotic sunrise" }));
  await userEvent.click(screen.getByRole("button", { name: "Find matches" }));
  await screen.findByText("Not scored");
  expect(input.onApplyRanking).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Listen to one")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Use this order" }));
  expect(input.onApplyRanking).toHaveBeenCalledWith(response, "Hypnotic sunrise");
});
it("uses the MERT reference endpoint and advertised representation", async () => {
  setup(); const rank = vi.spyOn(api, "rankSemanticReference").mockResolvedValue({ ...response, backend: mert });
  render(<MusicDiscovery {...props()} />);
  await userEvent.click(screen.getByRole("button", { name: /More like this/ }));
  await userEvent.click(screen.getAllByRole("radio")[0]);
  await userEvent.click(screen.getByRole("button", { name: "Find matches" }));
  expect(rank).toHaveBeenCalledWith({ backendId: "local-mert", referenceTrackId: "one", audioPaths: { one: "one.wav", two: "two.wav" }, representation: mert.default_representation });
});
it("ignores an inference result when the selected source changes", async () => {
  setup(); let resolve!: (value: SemanticRankResponse) => void;
  vi.spyOn(api, "rankSemanticAudio").mockReturnValue(new Promise((done) => { resolve = done; }));
  const input = props(); const view = render(<MusicDiscovery {...input} />);
  await userEvent.click(screen.getByRole("button", { name: "Hypnotic sunrise" }));
  await userEvent.click(screen.getByRole("button", { name: "Find matches" }));
  view.rerender(<MusicDiscovery {...input} tracks={[tracks[1]]} audioPaths={{ two: "two.wav" }} />);
  await act(async () => resolve(response));
  expect(screen.queryByRole("button", { name: "Use this order" })).toBeNull();
});
it("explains batched inference and demo mode", async () => {
  vi.spyOn(api, "getSemanticCapabilities").mockResolvedValue([{ ...textBackend, max_tracks: 1 }]);
  const input = props(); const view = render(<MusicDiscovery {...input} />);
  await screen.findByRole("note");
  expect((screen.getByRole("button", { name: "Find matches" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<MusicDiscovery {...input} fixture />);
  expect(screen.getByRole("note").textContent).toContain("fictional");
});
it("gates measurement recipes and exposes an explicit preview action", async () => {
  setup(); const input = props(); render(<MusicDiscovery {...input} canCrates={false} />);
  await userEvent.click(screen.getByRole("button", { name: /Build an energy journey/ }));
  await userEvent.click(screen.getByRole("button", { name: "Preview energy journey" }));
  expect(input.onPreset).toHaveBeenCalledWith("journey");
  await userEvent.click(screen.getByRole("button", { name: /Make mood crates/ }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Preview mood crates" }) as HTMLButtonElement).disabled).toBe(true));
});
it("searches every candidate in bounded batches with the same reference and merges once", async () => {
  vi.spyOn(api, "getSemanticCapabilities").mockResolvedValue([{ ...mert, max_tracks: 3 }]);
  const pool = Array.from({ length: 5 }, (_, i) => ({ ...tracks[0], id: `t${i}`, name: `Track ${i}` }));
  const rank = vi.spyOn(api, "rankSemanticReference").mockImplementation(async ({ audioPaths }) => ({
    ...response, backend: mert, missing_track_ids: [],
    results: Object.keys(audioPaths).map((id) => ({ ...response.results[0], track_id: id })),
  }));
  const input = props(); render(<MusicDiscovery {...input} tracks={pool} audioPaths={Object.fromEntries(pool.map(({ id }) => [id, `${id}.wav`]))} />);
  await userEvent.click(screen.getByRole("button", { name: /More like this/ }));
  await userEvent.click(screen.getAllByRole("radio")[3]);
  expect((screen.getByRole("button", { name: "Find matches" }) as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Find matches" }));
  await screen.findByRole("button", { name: "Use this order" });
  expect(rank.mock.calls.map(([args]) => Object.keys(args.audioPaths))).toEqual([["t3", "t0", "t1"], ["t3", "t2", "t4"]]);
  expect(rank.mock.calls.every(([args]) => args.referenceTrackId === "t3" && args.representation === mert.default_representation)).toBe(true);
  expect(input.onApplyRanking).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Use this order" }));
  expect(input.onApplyRanking.mock.calls[0][0].results.map((row: { track_id: string }) => row.track_id).sort()).toEqual(pool.map(({ id }) => id));
});
it("stops scheduling batches and ignores the in-flight result after Stop", async () => {
  vi.spyOn(api, "getSemanticCapabilities").mockResolvedValue([{ ...mert, max_tracks: 2 }]);
  let finish!: (value: SemanticRankResponse) => void;
  const rank = vi.spyOn(api, "rankSemanticReference").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const pool = [...tracks, { ...tracks[0], id: "three" }];
  render(<MusicDiscovery {...props()} tracks={pool} audioPaths={{ one: "one.wav", two: "two.wav", three: "three.wav" }} />);
  await userEvent.click(screen.getByRole("button", { name: /More like this/ }));
  await userEvent.click(screen.getAllByRole("radio")[0]);
  await userEvent.click(screen.getByRole("button", { name: "Find matches" }));
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  await act(async () => finish(response));
  expect(rank).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Use this order" })).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Stopped");
});
it("does not present a failed multi-batch search as complete", async () => {
  vi.spyOn(api, "getSemanticCapabilities").mockResolvedValue([{ ...mert, max_tracks: 2 }]);
  vi.spyOn(api, "rankSemanticReference").mockResolvedValueOnce({ ...response, backend: mert }).mockRejectedValueOnce(new Error("Audio decode failed"));
  render(<MusicDiscovery {...props()} tracks={[...tracks, { ...tracks[0], id: "three" }]} audioPaths={{ one: "one.wav", two: "two.wav", three: "three.wav" }} />);
  await userEvent.click(screen.getByRole("button", { name: /More like this/ }));
  await userEvent.click(screen.getAllByRole("radio")[0]);
  await userEvent.click(screen.getByRole("button", { name: "Find matches" }));
  await screen.findByText("Audio decode failed");
  expect(screen.queryByRole("button", { name: "Use this order" })).toBeNull();
});
it("pages large match lists without dropping tracks from the applied ranking", async () => {
  setup();
  const pool = Array.from({ length: 121 }, (_, i) => ({ ...tracks[0], id: `large-${i}`, name: `Song ${i}` }));
  vi.spyOn(api, "rankSemanticAudio").mockImplementation(async ({ audioPaths }) => ({ ...response, missing_track_ids: [], results: Object.keys(audioPaths).map((id) => ({ ...response.results[0], track_id: id })) }));
  const input = props(); render(<MusicDiscovery {...input} tracks={pool} audioPaths={Object.fromEntries(pool.map(({ id }) => [id, `${id}.wav`]))} />);
  await userEvent.click(screen.getByRole("button", { name: "Dark driving bass" }));
  await userEvent.click(screen.getByRole("button", { name: "Find matches" }));
  await screen.findByRole("button", { name: "Use this order" });
  expect(document.querySelectorAll(".discovery-track-list audio")).toHaveLength(50);
  await userEvent.click(screen.getByRole("button", { name: "Next matches" }));
  await userEvent.click(screen.getByRole("button", { name: "Next matches" }));
  expect(document.querySelectorAll(".discovery-track-list audio")).toHaveLength(21);
  await userEvent.click(screen.getByRole("button", { name: "Use this order" }));
  expect(input.onApplyRanking.mock.calls[0][0].results).toHaveLength(121);
});
