import type { SpotifyConnectionStatus } from "./types";

export type NativeSpotifyAuthorizationOpener = (authorizationUrl: string) => Promise<void>;

export function expiredSpotifyConnection(
  status: SpotifyConnectionStatus | null,
): SpotifyConnectionStatus | null {
  return status ? {
    ...status,
    authenticated: false,
    token_expires_at: null,
    pending_authorization: false,
    reauthorization_required: true,
    detail: "Spotify authorization expired. Connect Spotify again.",
  } : null;
}

export async function openSpotifyAuthorization({
  authorizationUrl,
  nativeApp,
  openNative,
  openBrowser = (url) => window.open(url, "spotify-authorization", "noopener,noreferrer"),
}: {
  authorizationUrl: string;
  nativeApp: boolean;
  openNative?: NativeSpotifyAuthorizationOpener;
  openBrowser?: (url: string) => Window | null | void;
}): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(authorizationUrl);
  } catch {
    throw new Error("Spotify returned an unexpected authorization address.");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "accounts.spotify.com"
    || (parsed.port !== "" && parsed.port !== "443")
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/authorize"
    || parsed.hash !== ""
  ) {
    throw new Error("Spotify returned an unexpected authorization address.");
  }
  if (nativeApp) {
    if (openNative) {
      await openNative(authorizationUrl);
      return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_spotify_authorization", { authorizationUrl });
    return;
  }
  // Browsers commonly return null when noopener is requested even when the tab opened.
  openBrowser(authorizationUrl);
}

export async function waitForSpotifyAuthentication({
  getStatus,
  onStatus,
  intervalMs = 750,
  maximumAttempts = 160,
  pause = (milliseconds) => new Promise<void>(
    (resolve) => globalThis.setTimeout(resolve, milliseconds),
  ),
}: {
  getStatus: () => Promise<SpotifyConnectionStatus>;
  onStatus?: (status: SpotifyConnectionStatus) => void;
  intervalMs?: number;
  maximumAttempts?: number;
  pause?: (milliseconds: number) => Promise<void>;
}): Promise<SpotifyConnectionStatus> {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    if (attempt > 0) await pause(intervalMs);
    const status = await getStatus();
    onStatus?.(status);
    if (status.authenticated) return status;
    if (!status.pending_authorization) {
      throw new Error("Spotify authorization was cancelled or rejected. Connect again to retry.");
    }
  }
  throw new Error("Spotify connection timed out. Finish authorization, then try Connect again.");
}
