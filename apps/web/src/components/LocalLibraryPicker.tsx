import { useState } from "react";
import { localAudioPreviewUrl } from "../lib/api";
import { FolderNavigation } from "./FolderNavigation";
import type {
  LocalLibraryBrowseResponse,
  LocalLibraryFolder,
  LocalPlaylistDiscoveryResponse,
  LocalPlaylistFile,
} from "../lib/types";

export type LocalSourceMethod = "folders" | "playlist-files";

interface LocalLibraryPickerProps {
  browser: LocalLibraryBrowseResponse | null;
  library: LocalLibraryBrowseResponse | null;
  sourceMethod?: LocalSourceMethod;
  playlistDiscovery?: LocalPlaylistDiscoveryResponse | null;
  discoveringPlaylistFiles?: boolean;
  browsing: boolean;
  importingPaths: Set<string>;
  importedPaths: Set<string>;
  error: string | null;
  nativeFolderSelection?: boolean;
  selectingNativeFolder?: boolean;
  recentLibraryRoots?: string[];
  disabled?: boolean;
  onBrowse: (path: string) => void;
  onSelectNativeFolder?: () => void;
  onSelectRecentRoot?: (path: string) => void;
  onChooseLibrary: () => void;
  onImport: (source: LocalLibraryFolder | LocalPlaylistFile) => void;
  onChangeLibrary: () => void;
}

function FolderCandidates({
  library,
  importingPaths,
  importedPaths,
  error,
  onImport,
  onChangeLibrary,
  onBrowse,
  disabled = false,
}: Pick<
  LocalLibraryPickerProps,
  | "library"
  | "importingPaths"
  | "importedPaths"
  | "error"
  | "onImport"
  | "onChangeLibrary"
  | "onBrowse"
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
      {error && <div className="notice" role="alert">{error}</div>}
      <button type="button" className="primary-button mt-4" disabled={disabled || importingPaths.has(library.current_path) || importedPaths.has(library.current_path)} onClick={() => onImport({ path: library.current_path, name: library.current_name })}>
        {importingPaths.has(library.current_path) ? "Importing…" : importedPaths.has(library.current_path) ? "Folder added" : "Add this folder as a playlist"}
      </button>
      {library.folders.length === 0 ? (
        <p className="library-empty">No subfolders here. Add this folder to import the songs it contains.</p>
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
                <button type="button" className="compact-button" disabled={disabled} aria-label={`Open ${folder.name}`} onClick={() => { onChangeLibrary(); onBrowse(folder.path); }}>Open</button>
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

function PlaylistFileCandidates({
  library,
  playlistDiscovery,
  discoveringPlaylistFiles = false,
  importingPaths,
  importedPaths,
  error,
  onImport,
  onChangeLibrary,
  disabled = false,
}: Pick<
  LocalLibraryPickerProps,
  | "library"
  | "playlistDiscovery"
  | "discoveringPlaylistFiles"
  | "importingPaths"
  | "importedPaths"
  | "error"
  | "onImport"
  | "onChangeLibrary"
  | "disabled"
>) {
  if (!library) return null;
  const playlists = playlistDiscovery?.playlists ?? [];
  return (
    <section className="library-candidates" aria-labelledby="playlist-file-candidates-heading">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Playlist files</p>
          <h3 id="playlist-file-candidates-heading" className="mt-1 font-display text-lg font-semibold">
            {playlistDiscovery?.search_name ?? library.current_name}
          </h3>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-mist/55">
            M3U and M3U8 files are found recursively at every nesting level. Choose a common parent that also contains their referenced audio files.
          </p>
        </div>
        <button type="button" className="secondary-button" disabled={disabled} onClick={onChangeLibrary}>
          Change folder
        </button>
      </header>
      {error && <div className="notice" role="alert">{error}</div>}
      {discoveringPlaylistFiles ? (
        <p className="library-empty" aria-live="polite">Searching for playlist files…</p>
      ) : playlistDiscovery && playlists.length === 0 ? (
        <p className="library-empty">No .m3u or .m3u8 playlist files were found under this folder.</p>
      ) : playlistDiscovery ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {playlists.map((playlist) => {
            const importing = importingPaths.has(playlist.path);
            const imported = importedPaths.has(playlist.path);
            return (
              <article key={playlist.path} className={`library-playlist ${imported ? "imported" : ""}`}>
                <span className="library-folder-icon" aria-hidden="true">♫</span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate font-display text-sm text-white/85">{playlist.name}</strong>
                  <small className="mt-1 block truncate font-mono text-[10px] text-mist/45" title={playlist.path}>
                    {playlist.source_kind.toUpperCase()} · {playlist.path}
                  </small>
                </span>
                <button
                  type="button"
                  className="compact-button"
                  disabled={disabled || importing || imported}
                  onClick={() => onImport(playlist)}
                >
                  {importing ? "Importing…" : imported ? "Added" : "Add playlist"}
                </button>
              </article>
            );
          })}
        </div>
      ) : !error ? (
        <p className="library-empty" aria-live="polite">Preparing playlist search…</p>
      ) : null}
    </section>
  );
}

export function LocalLibraryPicker(props: LocalLibraryPickerProps) {
  const {
    browser,
    library,
    sourceMethod = "folders",
    browsing,
    error,
    nativeFolderSelection = false,
    selectingNativeFolder = false,
    recentLibraryRoots = [],
    disabled = false,
    onBrowse,
    onSelectNativeFolder,
    onSelectRecentRoot,
    onChooseLibrary,
    onChangeLibrary,
  } = props;
  const [folderFilter, setFolderFilter] = useState("");
  const location = library ?? browser;
  const navigation = location && <FolderNavigation location={location} disabled={disabled || browsing} onBrowse={(path) => { onChangeLibrary(); onBrowse(path); setFolderFilter(""); }} />;
  if (library) {
    return <>{navigation}{sourceMethod === "playlist-files"
      ? <PlaylistFileCandidates {...props} />
      : <FolderCandidates {...props} />}</>;
  }

  const selectingPlaylistFiles = sourceMethod === "playlist-files";

  return (
    <>{navigation}<section className="library-browser" aria-labelledby="library-browser-heading">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Local source</p>
          <h3 id="library-browser-heading" className="mt-1 font-display text-lg font-semibold">
            {selectingPlaylistFiles ? "Select a parent folder" : "Select a music library folder"}
          </h3>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-mist/55">
            {selectingPlaylistFiles
              ? "Playlist files will be found recursively beneath this folder. It should also contain the audio paths referenced by those files."
              : "Browse inside the server-approved music root. Absolute paths remain private and inaccessible to the browser."}
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
          {browser && sourceMethod === "folders" && <button type="button" className="secondary-button" disabled={disabled || browsing || props.importingPaths.has(browser.current_path) || props.importedPaths.has(browser.current_path)} onClick={() => props.onImport({ path: browser.current_path, name: browser.current_name })}>{props.importingPaths.has(browser.current_path) ? "Importing…" : props.importedPaths.has(browser.current_path) ? "Folder added" : "Add this folder as a playlist"}</button>}
          {browser && (
            <button type="button" className="primary-button" disabled={disabled || browsing} onClick={onChooseLibrary}>
              {selectingPlaylistFiles ? "Search" : "Use"} “{browser.current_name}”
            </button>
          )}
        </div>
      </header>

      {nativeFolderSelection && recentLibraryRoots.length > 0 && onSelectRecentRoot && (
        <label className="control-field mt-4 max-w-2xl">
          <span>Recent parent folders</span>
          <select
            defaultValue=""
            disabled={disabled || selectingNativeFolder}
            onChange={(event) => {
              if (event.target.value) onSelectRecentRoot(event.target.value);
              event.currentTarget.value = "";
            }}
          >
            <option value="">Choose a recent folder…</option>
            {recentLibraryRoots.map((path) => (
              <option key={path} value={path}>{path}</option>
            ))}
          </select>
        </label>
      )}

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
          <label className="control-field m-3"><span>Find a folder</span><input type="search" value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} placeholder="Filter folders by name" /></label>
          <div className="divide-y divide-line max-h-80 overflow-y-auto">
            {browser.folders.filter((folder) => folder.name.toLocaleLowerCase().includes(folderFilter.trim().toLocaleLowerCase())).map((folder) => (
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
            {browser.folders.length > 0 && !browser.folders.some((folder) => folder.name.toLocaleLowerCase().includes(folderFilter.trim().toLocaleLowerCase())) && <p className="library-empty">No folders match “{folderFilter}”.</p>}
            {browser.folders.length === 0 && (
              <p className="library-empty">
                No subfolders found. You can still {selectingPlaylistFiles ? "search" : "use"} this folder.
              </p>
            )}
          </div>
        </div>
      ) : nativeFolderSelection ? (
        <p className="library-empty">
          {selectingPlaylistFiles
            ? "Choose a parent folder to search for playlist files."
            : "Choose a folder to use as your local music library."}
        </p>
      ) : null}
      {browser && (browser.audio_files?.length ?? 0) > 0 && <details className="mt-4"><summary className="cursor-pointer text-sm">Audio files in this folder ({browser.audio_files?.length})</summary><div className="folder-audio-files">{browser.audio_files?.map((file) => <div key={file.path}><span>{file.name}</span><audio controls preload="none" aria-label={`Preview file ${file.name}`} src={localAudioPreviewUrl(file.path)} /></div>)}</div></details>}
    </section></>
  );
}
