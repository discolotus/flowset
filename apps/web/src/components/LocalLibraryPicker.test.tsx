import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { LocalLibraryBrowseResponse } from "../lib/types";
import { LocalLibraryPicker } from "./LocalLibraryPicker";

const listing: LocalLibraryBrowseResponse = {
  root_name: "Music Library",
  current_path: "DJ Sets",
  current_name: "DJ Sets",
  parent_path: "",
  folders: [
    {
      path: "DJ Sets/Warmup",
      name: "Warmup",
    },
  ],
};

const handlers = {
  onBrowse: () => undefined,
  onChooseLibrary: () => undefined,
  onImport: () => undefined,
  onChangeLibrary: () => undefined,
};

describe("LocalLibraryPicker", () => {
  it("lets the user select the currently browsed folder as a library", () => {
    const markup = renderToStaticMarkup(
      <LocalLibraryPicker
        browser={listing}
        library={null}
        browsing={false}
        importingPaths={new Set()}
        importedPaths={new Set()}
        error={null}
        {...handlers}
      />,
    );

    expect(markup).toContain("Select a music library folder");
    expect(markup).toContain("Use “DJ Sets”");
    expect(markup).toContain("Warmup");
  });

  it("presents immediate subfolders as addable playlists", () => {
    const markup = renderToStaticMarkup(
      <LocalLibraryPicker
        browser={listing}
        library={listing}
        browsing={false}
        importingPaths={new Set()}
        importedPaths={new Set()}
        error={null}
        {...handlers}
      />,
    );

    expect(markup).toContain("Each immediate subfolder is available as a playlist");
    expect(markup).toContain("Tracks are read only when added");
    expect(markup).toContain("Add playlist");
  });

  it("offers the native folder picker inside the desktop app", () => {
    const markup = renderToStaticMarkup(
      <LocalLibraryPicker
        browser={null}
        library={null}
        browsing={false}
        importingPaths={new Set()}
        importedPaths={new Set()}
        error={null}
        nativeFolderSelection
        recentLibraryRoots={["/Volumes/External4TB/Music", "/Users/test/Music"]}
        onSelectNativeFolder={() => undefined}
        onSelectRecentRoot={() => undefined}
        {...handlers}
      />,
    );

    expect(markup).toContain("Choose folder…");
    expect(markup).toContain("Recent parent folders");
    expect(markup).toContain("/Volumes/External4TB/Music");
    expect(markup).toContain("Choose a folder to use as your local music library");
  });
});
