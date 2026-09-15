import { useEffect, useState } from "react";
import type { LocalLibraryBrowseResponse } from "../lib/types";
import { readFavoriteFolders, writeFavoriteFolders, type FavoriteFolder } from "../lib/favoriteFolders";

export function FolderNavigation({ location, disabled, onBrowse }: { location: LocalLibraryBrowseResponse; disabled: boolean; onBrowse: (path: string) => void }) {
  const rootId = location.root_id ?? "";
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* Browser persistence may be unavailable. */ }
  const [favorites, setFavorites] = useState<FavoriteFolder[]>(() => readFavoriteFolders(storage, rootId));
  const [message, setMessage] = useState("");
  const [path, setPath] = useState(location.current_path);
  useEffect(() => { setFavorites(readFavoriteFolders(storage, rootId)); setMessage(""); }, [rootId, storage]);
  useEffect(() => setPath(location.current_path), [location.current_path]);
  const starred = favorites.some((item) => item.path === location.current_path);
  function save(next: FavoriteFolder[]) {
    if (writeFavoriteFolders(storage, rootId, next)) {
      setFavorites(next); setMessage("Favorite locations saved in this browser.");
    } else { setMessage("This browser could not save favorites. Check local storage availability."); }
  }
  const parts = location.current_path.split("/").filter(Boolean);
  return <div className="folder-navigation">
    <nav aria-label="Folder breadcrumbs" className="folder-breadcrumbs">
      <button type="button" disabled={disabled} onClick={() => onBrowse("")}>{location.root_name}</button>
      {parts.map((part, index) => <span key={parts.slice(0, index + 1).join("/")}><span aria-hidden="true"> / </span><button type="button" disabled={disabled} aria-current={index === parts.length - 1 ? "location" : undefined} onClick={() => onBrowse(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}
    </nav>
    <div className="folder-location-actions">
      <form onSubmit={(event) => { event.preventDefault(); onBrowse(path.trim()); }} className="folder-path-form">
        <label className="control-field"><span>Go to folder within {location.root_name}</span><input value={path} onChange={(event) => setPath(event.target.value)} placeholder="e.g. DJ/Warmup" disabled={disabled} /></label>
        <button className="secondary-button" type="submit" disabled={disabled}>Go</button>
      </form>
      <button type="button" className="secondary-button" disabled={disabled || !rootId || (!starred && favorites.length >= 30)} aria-pressed={starred} onClick={() => save(starred ? favorites.filter((item) => item.path !== location.current_path) : [...favorites, { path: location.current_path, name: location.current_name }])}>{starred ? "Remove folder favorite" : "Save folder favorite"}</button>
    </div>
    <div aria-label="Favorite locations" className="folder-favorites">
      <span>Favorites</span>
      {favorites.length ? favorites.map((item) => <div key={item.path} className="folder-favorite"><button type="button" title={item.path || location.root_name} disabled={disabled} onClick={() => onBrowse(item.path)}>{item.name}</button><button type="button" aria-label={`Remove favorite ${item.name}`} disabled={disabled} onClick={() => save(favorites.filter(({ path }) => path !== item.path))}>×</button></div>) : <p>Save folders you return to. Favorites stay on this browser and are separate for each music root.</p>}
    </div>
    {message && <p role="status" className="text-xs text-mist/65">{message}</p>}
  </div>;
}
