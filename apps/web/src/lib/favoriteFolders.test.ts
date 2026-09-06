import { describe, expect, it } from "vitest";
import { readFavoriteFolders, writeFavoriteFolders } from "./favoriteFolders";
describe("favorite folders", () => {
  it("persists relative favorites independently for roots with the same display name", () => {
    let raw: string | null = null;
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
    expect(writeFavoriteFolders(storage, "root-a", [{ path: "", name: "Music" }, { path: "DJ", name: "DJ" }])).toBe(true);
    writeFavoriteFolders(storage, "root-b", [{ path: "Albums", name: "Albums" }]);
    expect(readFavoriteFolders(storage, "root-a")).toHaveLength(2);
    expect(readFavoriteFolders(storage, "root-b")[0].path).toBe("Albums");
    writeFavoriteFolders(storage, "root-a", []);
    expect(readFavoriteFolders(storage, "root-a")).toEqual([]);
    expect(readFavoriteFolders(storage, "root-b")).toHaveLength(1);
  });
  it("rejects unsafe or malformed saved paths and tolerates corrupt storage", () => {
    const storage = { getItem: () => JSON.stringify({ a: [{ path: "../secret", name: "no" }, { path: "/private", name: "no" }, { path: "DJ", name: "yes" }, { path: "DJ", name: "duplicate" }] }), setItem: () => undefined };
    expect(readFavoriteFolders(storage, "a")).toEqual([{ path: "DJ", name: "yes" }]);
    expect(readFavoriteFolders({ ...storage, getItem: () => "bad json" }, "a")).toEqual([]);
    expect(writeFavoriteFolders(null, "a", [])).toBe(false);
  });
});
