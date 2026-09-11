import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryDesk } from "./LibraryDesk";
import * as api from "../../lib/api";
import * as jobs from "../../lib/libraryJobs";
import * as persistence from "../../lib/libraryPersistence";
import type { LocalPlaylistImportResponse, Track } from "../../lib/types";
vi.mock("../../lib/libraryPersistence", () => ({
  readLibrary: vi.fn(),
  saveLibrary: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("selects all 125 tracks beyond the visible page, narrows with fuzzy search, and hands off exactly the selection", async () => {
  const tracks: Track[] = Array.from({ length: 125 }, (_, i) => ({
    id: String(i),
    name: `Track ${i}`,
    artist: "André Wurhme",
    album: "Test fixture",
    duration_ms: 180000,
    explicit: false,
    genres: [],
  }));
  const imported: LocalPlaylistImportResponse = {
    source_kind: "directory",
    playlist: { id: "fixture", name: "Fixture folder", tracks },
    local_audio_paths: Object.fromEntries(
      tracks.map((t) => [t.id, `${t.id}.mp3`]),
    ),
    analysis_cache_directory: "",
    cached_track_count: 0,
    skipped_files: [],
    warnings: [],
  };
  vi.spyOn(api, "browseLocalLibrary").mockResolvedValue({
    root_id: "test",
    root_name: "Fixture root",
    current_path: "",
    current_name: "Fixture root",
    folders: [],
  });
  vi.spyOn(api, "getSemanticCapabilities").mockResolvedValue([]);
  vi.spyOn(jobs, "listLibraryJobs").mockResolvedValue([]);
  vi.mocked(persistence.readLibrary).mockResolvedValue({ fixture: imported });
  const draft = vi.fn();
  const user = userEvent.setup();
  render(<LibraryDesk visible onDraft={draft} onTools={() => {}} />);
  await user.click(
    await screen.findByRole("button", { name: "Select all 125" }),
  );
  expect(screen.getByText("125 selected")).toBeTruthy();
  expect(
    within(
      screen.getByRole("table", { name: "Music library tracks" }),
    ).getAllByRole("row"),
  ).toHaveLength(51);
  await user.click(screen.getByRole("button", { name: "Next track page" }));
  expect(screen.getByText("2 / 3")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Create playlist" }));
  expect(draft.mock.calls[0][0]).toHaveLength(125);
  await user.type(
    screen.getByRole("searchbox", { name: "Search library tracks" }),
    "andre wruhme",
  );
  expect(
    screen.getByRole("button", { name: "Select all matching 125" }),
  ).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "Fuzzy" }));
  expect(
    screen.getByRole("button", { name: "Select all matching 0" }),
  ).toBeTruthy();
});
