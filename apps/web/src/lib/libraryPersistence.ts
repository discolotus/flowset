import type { LocalPlaylistImportResponse } from "./types";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("flowset-library-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("roots");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function readLibrary(
  root: string,
): Promise<Record<string, LocalPlaylistImportResponse>> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("roots").objectStore("roots").get(root);
      r.onsuccess = () => resolve(r.result ?? {});
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function saveLibrary(
  root: string,
  value: Record<string, LocalPlaylistImportResponse>,
): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("roots", "readwrite");
      tx.objectStore("roots").put(value, root);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
