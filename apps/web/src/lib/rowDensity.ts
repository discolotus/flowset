export const ROW_DENSITY_STORAGE_KEY = "sequence.output-row-density";

export type RowDensity = "comfortable" | "compact";

interface DensityStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function readRowDensity(storage?: Pick<DensityStorage, "getItem"> | null): RowDensity {
  if (!storage) return "comfortable";
  try {
    return storage.getItem(ROW_DENSITY_STORAGE_KEY) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}

export function saveRowDensity(
  storage: Pick<DensityStorage, "setItem"> | null | undefined,
  density: RowDensity,
) {
  if (!storage) return;
  try {
    storage.setItem(ROW_DENSITY_STORAGE_KEY, density);
  } catch {
    // The layout still works when local storage is unavailable.
  }
}
