const KEY = "flowset-favorite-folders-v1";
export interface FavoriteFolder { path: string; name: string }
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const validPath = (path: unknown): path is string => typeof path === "string" && path.length <= 4096 && !path.startsWith("/") && !path.split("/").includes("..") && !path.includes("\\");
export function readFavoriteFolders(storage: Storage | null, rootId: string): FavoriteFolder[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY) ?? "{}");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, rootId)) return [];
    const rows: unknown = (value as Record<string, unknown>)[rootId];
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    return rows.filter((row): row is FavoriteFolder => {
      if (!row || typeof row !== "object" || !validPath(row.path) || typeof row.name !== "string" || !row.name.trim() || seen.has(row.path)) return false;
      seen.add(row.path); return true;
    }).map(({ path, name }) => ({ path, name: name.slice(0, 200) })).slice(0, 30);
  } catch { return []; }
}
export function writeFavoriteFolders(storage: Storage | null, rootId: string, rows: FavoriteFolder[]): boolean {
  if (!storage || !rootId) return false;
  try {
    let value: unknown;
    try { value = JSON.parse(storage.getItem(KEY) ?? "{}"); } catch { value = {}; }
    const roots = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    storage.setItem(KEY, JSON.stringify({ ...roots, [rootId]: rows.slice(0, 30) }));
    return true;
  } catch { return false; }
}
