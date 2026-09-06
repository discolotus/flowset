import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FolderNavigation } from "./FolderNavigation";
import { LocalLibraryPicker } from "./LocalLibraryPicker";
const location = { root_id: "test-root", root_name: "Music", current_path: "DJ/Set", current_name: "Set", parent_path: "DJ", folders: [{ path: "DJ/Set/Deep", name: "Deep" }], audio_files: [{ path: "DJ/Set/one.mp3", name: "one.mp3" }] };
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
});
afterEach(() => { cleanup(); });
it("saves favorites across remounts, navigates breadcrumbs, and removes favorites", async () => {
  const browse = vi.fn(); const user = userEvent.setup();
  const view = render(<FolderNavigation location={location} disabled={false} onBrowse={browse} />);
  await user.click(screen.getByRole("button", { name: "Save folder favorite" }));
  view.unmount();
  render(<FolderNavigation location={{ ...location, current_path: "", current_name: "Music" }} disabled={false} onBrowse={browse} />);
  await user.click(screen.getByRole("button", { name: "Set" }));
  expect(browse).toHaveBeenCalledWith("DJ/Set");
  await user.click(screen.getByRole("button", { name: "Remove favorite Set" }));
  expect(screen.queryByRole("button", { name: "Set" })).toBeNull();
});
it("filters folders, offers current-folder import, and displays real file previews", async () => {
  const user = userEvent.setup(); const onImport = vi.fn();
  render(<LocalLibraryPicker browser={location} library={null} browsing={false} importingPaths={new Set()} importedPaths={new Set()} error={null} onBrowse={vi.fn()} onChooseLibrary={vi.fn()} onChangeLibrary={vi.fn()} onImport={onImport} />);
  await user.type(screen.getByRole("searchbox", { name: "Find a folder" }), "absent");
  expect(screen.queryByRole("button", { name: "Deep Open folder" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Add this folder as a playlist" }));
  expect(onImport).toHaveBeenCalledWith({ path: "DJ/Set", name: "Set" });
  expect(screen.getByLabelText("Preview file one.mp3")).toBeTruthy();
});
