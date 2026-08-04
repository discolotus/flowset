import type { SplitFactor } from "./factorGrid";
import { NUMERIC_PARAMETERS, SORT_PARAMETERS } from "./parameters";
import type { NumericParameter, SortDirection, SortParameter } from "./types";

export const WORKSPACE_STATE_STORAGE_KEY = "sequence.workspace-state.v1";
export const MAX_RECENT_LIBRARY_ROOTS = 6;
export const MAX_SAVED_RECIPES = 30;

export interface RecipeSettings {
  name: string;
  distributionParameter: NumericParameter;
  distributionBinCount: number;
  splitEnabled: boolean;
  splitFactors: SplitFactor[];
  subgroupEnabled: boolean;
  subgroupParameter: NumericParameter;
  subgroupBinCount: number;
  sortEnabled: boolean;
  sortParameter: SortParameter;
  sortDirection: SortDirection;
}

export interface SavedRecipe extends RecipeSettings {
  id: string;
  savedAt: string;
}

export interface LastMp3Export {
  directory: string;
  manifestPath: string;
  exportedAt: string;
}

export interface WorkspaceState {
  schemaVersion: 1;
  savedRecipes: SavedRecipe[];
  recentLibraryRoots: string[];
  lastMp3Export: LastMp3Export | null;
}

export interface LoadedWorkspaceState {
  state: WorkspaceState;
  path: string | null;
}

interface StateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EMPTY_WORKSPACE_STATE: WorkspaceState = {
  schemaVersion: 1,
  savedRecipes: [],
  recentLibraryRoots: [],
  lastMp3Export: null,
};

const NUMERIC_PARAMETER_VALUES = new Set(NUMERIC_PARAMETERS.map(({ value }) => value));
const SORT_PARAMETER_VALUES = new Set(SORT_PARAMETERS.map(({ value }) => value));
const DISTRIBUTION_BIN_COUNTS = new Set([5, 6, 8, 10, 12]);
const RECIPE_LEVEL_COUNTS = new Set([2, 3, 4, 5, 6]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validRecipe(value: unknown): value is SavedRecipe {
  if (!value || typeof value !== "object") return false;
  const recipe = value as Partial<SavedRecipe>;
  const splitFactors = recipe.splitFactors;
  return nonEmptyString(recipe.id)
    && recipe.id.length <= 200
    && nonEmptyString(recipe.name)
    && recipe.name.length <= 100
    && nonEmptyString(recipe.savedAt)
    && Number.isFinite(Date.parse(recipe.savedAt))
    && nonEmptyString(recipe.distributionParameter)
    && NUMERIC_PARAMETER_VALUES.has(recipe.distributionParameter as NumericParameter)
    && DISTRIBUTION_BIN_COUNTS.has(recipe.distributionBinCount ?? 0)
    && typeof recipe.splitEnabled === "boolean"
    && Array.isArray(splitFactors)
    && splitFactors.length > 0
    && splitFactors.length <= 3
    && new Set(splitFactors.map((factor) => factor.parameter)).size === splitFactors.length
    && splitFactors.every((factor) => (
      factor
      && nonEmptyString(factor.id)
      && nonEmptyString(factor.parameter)
      && NUMERIC_PARAMETER_VALUES.has(factor.parameter)
      && RECIPE_LEVEL_COUNTS.has(factor.binCount)
    ))
    && typeof recipe.subgroupEnabled === "boolean"
    && nonEmptyString(recipe.subgroupParameter)
    && NUMERIC_PARAMETER_VALUES.has(recipe.subgroupParameter as NumericParameter)
    && RECIPE_LEVEL_COUNTS.has(recipe.subgroupBinCount ?? 0)
    && typeof recipe.sortEnabled === "boolean"
    && nonEmptyString(recipe.sortParameter)
    && SORT_PARAMETER_VALUES.has(recipe.sortParameter as SortParameter)
    && (recipe.sortDirection === "ascending" || recipe.sortDirection === "descending");
}

export function normalizeWorkspaceState(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object") return { ...EMPTY_WORKSPACE_STATE };
  const candidate = value as Partial<WorkspaceState>;
  const recentLibraryRoots = Array.isArray(candidate.recentLibraryRoots)
    ? [...new Set(candidate.recentLibraryRoots.filter(nonEmptyString).map((path) => path.trim()))]
      .slice(0, MAX_RECENT_LIBRARY_ROOTS)
    : [];
  const savedRecipes = Array.isArray(candidate.savedRecipes)
    ? candidate.savedRecipes.filter(validRecipe).slice(0, MAX_SAVED_RECIPES)
    : [];
  const last = candidate.lastMp3Export;
  const lastMp3Export = last
    && nonEmptyString(last.directory)
    && nonEmptyString(last.manifestPath)
    && nonEmptyString(last.exportedAt)
    ? {
        directory: last.directory,
        manifestPath: last.manifestPath,
        exportedAt: last.exportedAt,
      }
    : null;
  return { schemaVersion: 1, savedRecipes, recentLibraryRoots, lastMp3Export };
}

export function readBrowserWorkspaceState(storage: StateStorage | null): WorkspaceState {
  if (!storage) return { ...EMPTY_WORKSPACE_STATE };
  try {
    const raw = storage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    return raw ? normalizeWorkspaceState(JSON.parse(raw)) : { ...EMPTY_WORKSPACE_STATE };
  } catch {
    return { ...EMPTY_WORKSPACE_STATE };
  }
}

export async function loadWorkspaceState({
  nativeApp,
  storage,
}: {
  nativeApp: boolean;
  storage: StateStorage | null;
}): Promise<LoadedWorkspaceState> {
  if (!nativeApp) return { state: readBrowserWorkspaceState(storage), path: null };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke("load_workspace_state") as { state?: unknown; path?: unknown };
    return {
      state: normalizeWorkspaceState(result.state),
      path: typeof result.path === "string" ? result.path : null,
    };
  } catch {
    return { state: readBrowserWorkspaceState(storage), path: null };
  }
}

export async function saveWorkspaceState({
  nativeApp,
  storage,
  state,
}: {
  nativeApp: boolean;
  storage: StateStorage | null;
  state: WorkspaceState;
}): Promise<string | null> {
  const normalized = normalizeWorkspaceState(state);
  try {
    storage?.setItem(WORKSPACE_STATE_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // The native JSON file remains the primary desktop persistence surface.
  }
  if (!nativeApp) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const path = await invoke("save_workspace_state", { state: normalized });
  return typeof path === "string" ? path : null;
}

export function rememberLibraryRoot(state: WorkspaceState, path: string): WorkspaceState {
  const normalized = path.trim();
  if (!normalized) return state;
  return {
    ...state,
    recentLibraryRoots: [
      normalized,
      ...state.recentLibraryRoots.filter((candidate) => candidate !== normalized),
    ].slice(0, MAX_RECENT_LIBRARY_ROOTS),
  };
}

export function saveRecipe(
  state: WorkspaceState,
  settings: RecipeSettings,
  now = new Date(),
): WorkspaceState {
  const normalizedName = settings.name.trim() || "Untitled recipe";
  const existing = state.savedRecipes.find(
    (recipe) => recipe.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
  );
  const baseId = `recipe-${now.getTime()}`;
  let availableId = baseId;
  for (let copyNumber = 2; state.savedRecipes.some(({ id }) => id === availableId); copyNumber += 1) {
    availableId = `${baseId}-${copyNumber}`;
  }
  const recipe: SavedRecipe = {
    ...settings,
    name: normalizedName,
    splitFactors: settings.splitFactors.map((factor) => ({ ...factor })),
    id: existing?.id ?? availableId,
    savedAt: now.toISOString(),
  };
  return {
    ...state,
    savedRecipes: [recipe, ...state.savedRecipes.filter((item) => item.id !== recipe.id)]
      .slice(0, MAX_SAVED_RECIPES),
  };
}

export function forgetRecipe(state: WorkspaceState, id: string): WorkspaceState {
  return { ...state, savedRecipes: state.savedRecipes.filter((recipe) => recipe.id !== id) };
}

export function renameRecipe(
  state: WorkspaceState,
  id: string,
  name: string,
): WorkspaceState {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Recipe names cannot be empty.");
  if (normalizedName.length > 100) throw new Error("Recipe names cannot exceed 100 characters.");
  const selected = state.savedRecipes.find((recipe) => recipe.id === id);
  if (!selected) throw new Error("That saved recipe no longer exists.");
  const duplicate = state.savedRecipes.some(
    (recipe) => recipe.id !== id
      && recipe.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
  );
  if (duplicate) throw new Error(`A saved recipe named “${normalizedName}” already exists.`);
  return {
    ...state,
    savedRecipes: state.savedRecipes.map((recipe) => (
      recipe.id === id ? { ...recipe, name: normalizedName } : recipe
    )),
  };
}
