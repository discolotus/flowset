export const SPOTIFY_CLIENT_ID_STORAGE_KEY = "sequence.spotify-client-id";

export function readStoredSpotifyClientId(storage: Storage | null): string {
  if (!storage) return "";
  try {
    return storage.getItem(SPOTIFY_CLIENT_ID_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function storeSpotifyClientId(storage: Storage | null, clientId: string): void {
  if (!storage) return;
  try {
    const value = clientId.trim();
    if (value) storage.setItem(SPOTIFY_CLIENT_ID_STORAGE_KEY, value);
    else storage.removeItem(SPOTIFY_CLIENT_ID_STORAGE_KEY);
  } catch {
    // Spotify setup remains usable when browser storage is disabled.
  }
}
