import { useEffect, useState } from "react";
import {
  CaretRight,
  CaretDown,
  Folder,
  Star,
  Plus,
} from "@phosphor-icons/react";
import { browseLocalLibrary } from "../../lib/api";
import {
  readFavoriteFolders,
  writeFavoriteFolders,
  type FavoriteFolder,
} from "../../lib/favoriteFolders";
import { searchScore } from "../../lib/librarySearch";
import type {
  LocalLibraryBrowseResponse,
  LocalLibraryFolder,
} from "../../lib/types";

export function LibraryFolders({
  root,
  current,
  onOpen,
  onError,
  loaded,
  onToggle,
  selected,
  onAll,
}: {
  root: LocalLibraryBrowseResponse;
  current: string | null;
  onOpen: (folder: LocalLibraryFolder) => void;
  onError: (message: string) => void;
  loaded: LocalLibraryFolder[];
  onToggle: (path: string) => void;
  selected: Set<string>;
  onAll: (select: boolean) => void;
}) {
  const [nodes, setNodes] = useState<
    Record<string, LocalLibraryBrowseResponse>
  >({ "": root });
  const [expanded, setExpanded] = useState(new Set([""]));
  const [busy, setBusy] = useState(new Set<string>());
  const [favorites, setFavorites] = useState<FavoriteFolder[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    try {
      setFavorites(
        readFavoriteFolders(window.localStorage, root.root_id ?? ""),
      );
    } catch {
      setFavorites([]);
    }
  }, [root.root_id]);
  async function expand(folder: LocalLibraryFolder) {
    if (expanded.has(folder.path)) {
      setExpanded((old) => {
        const next = new Set(old);
        next.delete(folder.path);
        return next;
      });
      return;
    }
    setBusy((old) => new Set(old).add(folder.path));
    try {
      if (!nodes[folder.path]) {
        const result = await browseLocalLibrary(folder.path);
        setNodes((old) => ({ ...old, [folder.path]: result }));
      }
      setExpanded((old) => new Set(old).add(folder.path));
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy((old) => {
        const next = new Set(old);
        next.delete(folder.path);
        return next;
      });
    }
  }
  function favorite(folder: LocalLibraryFolder) {
    const next = favorites.some((f) => f.path === folder.path)
      ? favorites.filter((f) => f.path !== folder.path)
      : [...favorites, folder];
    if (next.length > 30) {
      onError("You can save up to 30 folder shortcuts.");
      return;
    }
    try {
      if (writeFavoriteFolders(window.localStorage, root.root_id ?? "", next))
        setFavorites(next);
      else onError("Favorites could not be saved in this browser.");
    } catch {
      onError("Favorites could not be saved in this browser.");
    }
  }
  const row = (folder: LocalLibraryFolder, depth: number): React.ReactNode => {
    const open = expanded.has(folder.path),
      children = nodes[folder.path]?.folders;
    return (
      <li key={folder.path}>
        <div
          className={`desk-folder ${current === folder.path ? "current" : ""}`}
          style={{ paddingLeft: depth * 14 + 6 }}
        >
          <button
            aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
            aria-expanded={open}
            disabled={busy.has(folder.path)}
            onClick={() => void expand(folder)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" && !open) {
                e.preventDefault();
                void expand(folder);
              }
              if (e.key === "ArrowLeft" && open) {
                e.preventDefault();
                void expand(folder);
              }
            }}
          >
            {open ? <CaretDown /> : <CaretRight />}
          </button>
          {loaded.some((f) => f.path === folder.path) && (
            <input
              type="checkbox"
              aria-label={`Include folder ${folder.name}`}
              checked={selected.has(folder.path)}
              onChange={() => onToggle(folder.path)}
            />
          )}
          <button
            className="folder-name"
            onClick={() => onOpen(folder)}
            title={folder.path}
          >
            <Folder />
            <span>{folder.name}</span>
          </button>
          <button
            className="folder-star"
            aria-label={`Favorite ${folder.name}`}
            aria-pressed={favorites.some((f) => f.path === folder.path)}
            onClick={() => favorite(folder)}
          >
            <Star
              weight={
                favorites.some((f) => f.path === folder.path)
                  ? "fill"
                  : "regular"
              }
            />
          </button>
        </div>
        {busy.has(folder.path) && (
          <p className="desk-muted">Reading folders…</p>
        )}
        {open && children && (
          <ul>
            {children
              .filter((f) => !query || searchScore(f.name, query) > 0)
              .map((f) => row(f, depth + 1))}
            {!children.length && (
              <li className="desk-muted folder-empty">No subfolders</li>
            )}
          </ul>
        )}
      </li>
    );
  };
  return (
    <aside className="desk-sidebar" aria-label="Library locations">
      <div className="desk-side-title">
        <Star /> Favorites
      </div>
      <div className="desk-favorites">
        {favorites.map((folder) => (
          <div key={folder.path}>
            <button onClick={() => onOpen(folder)}>
              <Folder />
              {folder.name}
            </button>
            <button
              aria-label={`Remove favorite ${folder.name}`}
              onClick={() => favorite(folder)}
            >
              <Star weight="fill" />
            </button>
          </div>
        ))}
        {!favorites.length && (
          <p className="desk-muted">Star a folder to keep a shortcut here.</p>
        )}
      </div>
      <div className="desk-side-title">Folders</div>
      <input
        type="search"
        aria-label="Find folders"
        placeholder="Find loaded folders…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <nav aria-label="Expandable music folders">
        <ul className="desk-tree">
          {row({ path: "", name: root.root_name }, 0)}
        </ul>
      </nav>
      <div className="desk-side-title">
        Loaded sources <span>{loaded.length}</span>
      </div>
      <div className="desk-source-actions">
        <button disabled={!loaded.length} onClick={() => onAll(true)}>
          Select all
        </button>
        <button disabled={!selected.size} onClick={() => onAll(false)}>
          Clear
        </button>
      </div>
      <ul className="desk-loaded">
        {loaded.map((f) => (
          <li key={f.path}>
            <input
              type="checkbox"
              checked={selected.has(f.path)}
              aria-label={`Select source ${f.name}`}
              onChange={() => onToggle(f.path)}
            />
            <button onClick={() => onOpen(f)}>{f.name}</button>
          </li>
        ))}
      </ul>
      <button
        className="desk-add-source"
        onClick={() => onOpen({ path: "", name: root.root_name })}
      >
        <Plus /> Browse music root
      </button>
      <p className="desk-muted">Source files stay unchanged.</p>
    </aside>
  );
}
