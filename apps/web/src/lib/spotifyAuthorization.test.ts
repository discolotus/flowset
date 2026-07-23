import { describe, expect, it, vi } from "vitest";

import {
  expiredSpotifyConnection,
  openSpotifyAuthorization,
  waitForSpotifyAuthentication,
} from "./spotifyAuthorization";
import type { SpotifyConnectionStatus } from "./types";

const disconnected = (): SpotifyConnectionStatus => ({
  configured: true,
  authenticated: false,
  client_id: "client-id",
  redirect_uri: "http://127.0.0.1:8001/api/v1/spotify/auth/callback",
  scopes: [],
  token_expires_at: null,
  pending_authorization: true,
  reauthorization_required: false,
  detail: null,
});

describe("Spotify authorization", () => {
  it("clears expired authentication state without losing setup", () => {
    expect(expiredSpotifyConnection({
      ...disconnected(),
      authenticated: true,
      token_expires_at: "2026-07-20T20:00:00Z",
      pending_authorization: true,
    })).toEqual({
      ...disconnected(),
      authenticated: false,
      token_expires_at: null,
      pending_authorization: false,
      reauthorization_required: true,
      detail: "Spotify authorization expired. Connect Spotify again.",
    });
  });
  it("uses the injected native opener in the desktop app", async () => {
    const openNative = vi.fn().mockResolvedValue(undefined);
    const openBrowser = vi.fn();

    await openSpotifyAuthorization({
      authorizationUrl: "https://accounts.spotify.com/authorize?client_id=test",
      nativeApp: true,
      openNative,
      openBrowser,
    });

    expect(openNative).toHaveBeenCalledWith(
      "https://accounts.spotify.com/authorize?client_id=test",
    );
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("opens a new browser window outside the desktop app", async () => {
    const openBrowser = vi.fn().mockReturnValue({});

    await openSpotifyAuthorization({
      authorizationUrl: "https://accounts.spotify.com/authorize?client_id=test",
      nativeApp: false,
      openBrowser,
    });

    expect(openBrowser).toHaveBeenCalledTimes(1);
  });

  it("does not treat a null noopener return as proof that the tab was blocked", async () => {
    await expect(openSpotifyAuthorization({
      authorizationUrl: "https://accounts.spotify.com/authorize?client_id=test",
      nativeApp: false,
      openBrowser: vi.fn().mockReturnValue(null),
    })).resolves.toBeUndefined();
  });

  it("rejects authorization URLs outside Spotify Accounts", async () => {
    await expect(openSpotifyAuthorization({
      authorizationUrl: "https://example.com/authorize",
      nativeApp: false,
      openBrowser: vi.fn(),
    })).rejects.toThrow(/unexpected authorization/i);
  });

  it("rejects lookalike Spotify URLs and non-authorize paths", async () => {
    const invalidUrls = [
      "https://accounts.spotify.com.example.com/authorize",
      "https://accounts.spotify.com/not-authorize",
      "https://user@accounts.spotify.com/authorize",
      "https://accounts.spotify.com/authorize#fragment",
      "https://accounts.spotify.com:444/authorize",
    ];
    for (const authorizationUrl of invalidUrls) {
      await expect(openSpotifyAuthorization({
        authorizationUrl,
        nativeApp: false,
        openBrowser: vi.fn(),
      })).rejects.toThrow(/unexpected authorization/i);
    }
  });

  it("polls until the callback has authenticated the local service", async () => {
    const connected = { ...disconnected(), authenticated: true, pending_authorization: false };
    const getStatus = vi.fn()
      .mockResolvedValueOnce(disconnected())
      .mockResolvedValueOnce(connected);
    const pause = vi.fn().mockResolvedValue(undefined);

    await expect(waitForSpotifyAuthentication({
      getStatus,
      intervalMs: 1,
      maximumAttempts: 3,
      pause,
    })).resolves.toEqual(connected);
    expect(getStatus).toHaveBeenCalledTimes(2);
  });

  it("stops promptly when Spotify authorization is cancelled", async () => {
    const cancelled = { ...disconnected(), pending_authorization: false };
    const getStatus = vi.fn().mockResolvedValue(cancelled);

    await expect(waitForSpotifyAuthentication({
      getStatus,
      intervalMs: 1,
      maximumAttempts: 100,
      pause: vi.fn().mockResolvedValue(undefined),
    })).rejects.toThrow(/cancelled or rejected/i);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});
