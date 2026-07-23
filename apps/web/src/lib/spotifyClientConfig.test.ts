import { describe, expect, it, vi } from "vitest";

import {
  SPOTIFY_CLIENT_ID_STORAGE_KEY,
  readStoredSpotifyClientId,
  storeSpotifyClientId,
} from "./spotifyClientConfig";

describe("Spotify public client configuration", () => {
  it("persists and restores the non-secret client ID", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    } as unknown as Storage;

    storeSpotifyClientId(storage, "  public-client-id  ");

    expect(values.get(SPOTIFY_CLIENT_ID_STORAGE_KEY)).toBe("public-client-id");
    expect(readStoredSpotifyClientId(storage)).toBe("public-client-id");
  });

  it("clears the stored value when the setup field is cleared", () => {
    const storage = {
      getItem: vi.fn().mockReturnValue("old-client-id"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    } as unknown as Storage;

    storeSpotifyClientId(storage, "  ");

    expect(storage.removeItem).toHaveBeenCalledWith(SPOTIFY_CLIENT_ID_STORAGE_KEY);
  });
});
