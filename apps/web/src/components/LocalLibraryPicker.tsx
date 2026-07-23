import type { LocalLibraryBrowseResponse, LocalLibraryFolder } from "../lib/types";

interface LocalLibraryPickerProps {
  browser: LocalLibraryBrowseResponse | null;
  library: LocalLibraryBrowseResponse | null;
  browsing: boolean;
  importingPaths: Set<string>;
  importedPaths: Set<string>;
  error: string | null;
  nativeFolderSelection?: boolean;
  selectingNativeFolder?: boolean;
  disabled?: boolean;
  onBrowse: (path: string) => void;
  onSelectNativeFolder?: () => void;
  onChooseLibrary: () => void;
  onImport: (folder: LocalLibraryFolder) => void;
  onChangeLibrary: () => void;
}

function FolderCandidates({
  library,
  importingPaths,
  importedPaths,
  onImport,
  onChangeLibrary,
  disabled = false,
}: Pick<
  LocalLibraryPickerProps,
  | "library"
  | "importingPaths"
  | "importedPaths"
  | "onImport"
  | "onChangeLibrary"
  | "disabled"
>) {
  if (!library) return null;
  return (
    <section className="library-candidates" aria-labelledby="library-playlists-heading">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Music library</p>
          <h3 id="library-playlists-heading" className="mt-1 font-display text-lg font-semibold">
            {library.current_name}
          </h3>
          <p className="mt-2 text-xs leading-5 text-mist/55">
            Each immediate subfolder is available as a playlist. Importing reads its track metadata recursively.
          </p>
        </div>
        <button type="button" className="secondary-button" disabled={disabled} onClick={onChangeLibrary}>
          Change folder
        </button>
      </header>
      {library.folders.length === 0 ? (
        <p className="library-empty">This folder has no subfolders to use as playlists.</p>
      ) : (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {library.folders.map((folder) => {
            const importing = importingPaths.has(folder.path);
            const imported = importedPaths.has(folder.path);
            return (
              <article key={folder.path} className={`library-playlist ${imported ? "imported" : ""}`}>
                <span className="library-folder-icon" aria-hidden="true">♪</span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-display text-sm text-white/85">{folder.name}</strong>
                  <small className="mt-1 block text-[10px] text-mist/45">
                    Tracks are read only when added
                  </small>
                </span>
                <button
                  type="button"
                  className="compact-button"
                  disabled={disabled || importing || imported}
                  onClick={() => onImport(folder)}
                >
                  {importing ? "Importing…" : imported ? "Added" : "Add playlist"}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function LocalLibraryPicker(props: LocalLibraryPickerProps) {
  const {
    browser,
    library,
    browsing,
    error,
    nativeFolderSelection = false,
    selectingNativeFolder = false,
    disabled = false,
    onBrowse,
    onSelectNativeFolder,
    onChooseLibrary,
  } = props;
  if (library) return <FolderCandidates {...props} />;

  return (
    <section className="library-browser" aria-labelledby="library-browser-heading">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Local source</p>
          <h3 id="library-browser-heading" className="mt-1 font-display text-lg font-semibold">
            Select a music library folder
          </h3>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-mist/55">
            Browse inside the server-approved music root. Absolute paths remain private and inaccessible to the browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {nativeFolderSelection && onSelectNativeFolder && (
            <button
              type="button"
              className="primary-button"
              disabled={disabled || selectingNativeFolder}
              onClick={onSelectNativeFolder}
            >
              {selectingNativeFolder ? "Opening…" : "Choose folder…"}
            </button>
          )}
          {browser && (
            <button type="button" className="primary-button" disabled={disabled} onClick={onChooseLibrary}>
              Use “{browser.current_name}”
            </button>
          )}
        </div>
      </header>

      {error && <div className="notice" role="alert">{error}</div>}
      {browsing && !browser ? (
        <p className="library-empty" aria-live="polite">Reading folders…</p>
      ) : browser ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-line">
          <div className="library-pathbar">
            <button
              type="button"
              className="compact-button"
              disabled={disabled || browser.parent_path == null || browsing}
              onClick={() => onBrowse(browser.parent_path ?? "")}
            >
              ↑ Up
            </button>
            <span className="truncate font-mono text-[10px] text-mist/55">
              {browser.root_name}{browser.current_path ? ` / ${browser.current_path}` : ""}
            </span>
            {browsing && <small className="ml-auto text-[10px] text-acid/60">Loading…</small>}
          </div>
          <div className="divide-y divide-line">
            {browser.folders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                className="library-browser-row"
                disabled={disabled || browsing}
                onClick={() => onBrowse(folder.path)}
              >
                <span className="library-folder-icon" aria-hidden="true">↳</span>
                <span className="min-w-0 flex-1 text-left">
                  <strong className="block truncate text-xs font-medium text-white/80">{folder.name}</strong>
                  <small className="mt-1 block text-[10px] text-mist/40">
                    Open folder
                  </small>
                </span>
                <span className="text-mist/35" aria-hidden="true">→</span>
              </button>
            ))}
            {browser.folders.length === 0 && (
              <p className="library-empty">No subfolders found. You can still use this folder as the library.</p>
            )}
          </div>
        </div>
      ) : nativeFolderSelection ? (
        <p className="library-empty">Choose a folder to use as your local music library.</p>
      ) : null}
    </section>
  );
}
