import type { SplitFactor } from "./factorGrid";
import { NUMERIC_PARAMETERS, SORT_PARAMETERS } from "./parameters";
import { normalizeSemanticPrompt } from "./semantic/prompts";
import { MAX_RECENT_SEMANTIC_RUNS } from "./semantic/runs";
import type { SemanticExperimentRunV1 } from "./semantic/types";
import type { NumericParameter, SemanticBackendCapabilities, SemanticRepresentationIdentity, SemanticScore, SortDirection, SortParameter } from "./types";

export const WORKSPACE_STATE_STORAGE_KEY = "sequence.workspace-state.v2";
export const LEGACY_WORKSPACE_STATE_STORAGE_KEY = "sequence.workspace-state.v1";
export const MAX_RECENT_LIBRARY_ROOTS = 6;
export const MAX_SAVED_RECIPES = 30;
export const MAX_PERSISTED_SEMANTIC_TRACKS = 200;
export const MAX_PERSISTED_SEMANTIC_PROMPTS = 20;

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
  schemaVersion: 2;
  savedRecipes: SavedRecipe[];
  recentLibraryRoots: string[];
  lastMp3Export: LastMp3Export | null;
  semanticRuns: SemanticExperimentRunV1[];
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
  schemaVersion: 2,
  savedRecipes: [],
  recentLibraryRoots: [],
  lastMp3Export: null,
  semanticRuns: [],
};

const NUMERIC_PARAMETER_VALUES = new Set(NUMERIC_PARAMETERS.map(({ value }) => value));
const SORT_PARAMETER_VALUES = new Set(SORT_PARAMETERS.map(({ value }) => value));
const DISTRIBUTION_BIN_COUNTS = new Set([5, 6, 8, 10, 12]);
const RECIPE_LEVEL_COUNTS = new Set([2, 3, 4, 5, 6]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedString(value: unknown, maximum: number): string | null {
  return nonEmptyString(value) && value.length <= maximum ? value : null;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function normalizeRepresentation(value: unknown): SemanticRepresentationIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SemanticRepresentationIdentity>;
  const layer = boundedString(candidate.layer, 200);
  const pooling = boundedString(candidate.pooling, 100);
  const segment = boundedString(candidate.segment, 100);
  return layer && pooling && segment ? { layer, pooling, segment } : null;
}

function normalizeSemanticBackend(value: unknown): SemanticBackendCapabilities | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SemanticBackendCapabilities>;
  const id = boundedString(candidate.id, 100);
  const displayName = boundedString(candidate.display_name, 200);
  const model = boundedString(candidate.model, 200);
  const maxTracks = boundedInteger(candidate.max_tracks, 1, MAX_PERSISTED_SEMANTIC_TRACKS);
  const maxLabels = boundedInteger(candidate.max_labels, 1, MAX_PERSISTED_SEMANTIC_PROMPTS);
  const maxEmbeddingBatch = boundedInteger(candidate.max_embedding_batch, 1, MAX_PERSISTED_SEMANTIC_TRACKS);
  const allowedCapabilities = new Set(["text_similarity", "reference_similarity", "embedding_extraction"]);
  const capabilities = Array.isArray(candidate.capabilities)
    ? [...new Set(candidate.capabilities.filter((item): item is SemanticBackendCapabilities["capabilities"][number] => typeof item === "string" && allowedCapabilities.has(item)))]
    : [];
  if (!id || !displayName || !model || maxTracks == null || maxLabels == null || maxEmbeddingBatch == null || !capabilities.length || typeof candidate.available !== "boolean" || typeof candidate.requires_local_audio !== "boolean") return null;
  const backend: SemanticBackendCapabilities = {
    id,
    display_name: displayName,
    model,
    available: candidate.available,
    requires_local_audio: candidate.requires_local_audio,
    max_tracks: maxTracks,
    max_labels: maxLabels,
    max_embedding_batch: maxEmbeddingBatch,
    capabilities,
  };
  if (typeof candidate.detail === "string" && candidate.detail.length <= 2_000) backend.detail = candidate.detail;
  if (typeof candidate.license_note === "string" && candidate.license_note.length <= 2_000) backend.license_note = candidate.license_note;
  if (candidate.embedding_dimension == null) backend.embedding_dimension = null;
  else {
    const dimension = boundedInteger(candidate.embedding_dimension, 1, 100_000);
    if (dimension == null) return null;
    backend.embedding_dimension = dimension;
  }
  if (candidate.embedding_representation == null) backend.embedding_representation = null;
  else {
    const embeddingRepresentation = boundedString(candidate.embedding_representation, 300);
    if (!embeddingRepresentation) return null;
    backend.embedding_representation = embeddingRepresentation;
  }
  if (candidate.default_representation == null) backend.default_representation = null;
  else {
    const representation = normalizeRepresentation(candidate.default_representation);
    if (!representation) return null;
    backend.default_representation = representation;
  }
  return backend;
}

function normalizeSemanticScore(
  value: unknown,
  backend: SemanticBackendCapabilities,
  scoreKeysByNormalizedLabel: Readonly<Record<string, string>>,
): SemanticScore | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SemanticScore>;
  const key = boundedString(candidate.key, 300);
  const label = boundedString(candidate.label, 100);
  const normalizedLabel = boundedString(candidate.normalized_label, 100);
  if (!key || !label || !normalizedLabel || !Number.isFinite(candidate.score) || scoreKeysByNormalizedLabel[normalizedLabel] !== key) return null;
  const provenanceCandidate = candidate.provenance;
  if (!provenanceCandidate || typeof provenanceCandidate !== "object" || provenanceCandidate.backend !== backend.id || provenanceCandidate.model !== backend.model) return null;
  const representation = provenanceCandidate.representation == null
    ? null
    : normalizeRepresentation(provenanceCandidate.representation);
  if (provenanceCandidate.representation != null && !representation) return null;
  return {
    key,
    label,
    normalized_label: normalizedLabel,
    score: Number(candidate.score),
    provenance: {
      backend: backend.id,
      model: backend.model,
      ...(representation ? { representation } : {}),
    },
  };
}

function normalizeSemanticRun(value: unknown): SemanticExperimentRunV1 | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SemanticExperimentRunV1>;
  const id = boundedString(candidate.id, 200);
  const createdAt = boundedString(candidate.createdAt, 100);
  const completedAt = boundedString(candidate.completedAt, 100);
  const durationMs = boundedInteger(candidate.durationMs, 0, 7 * 24 * 60 * 60 * 1_000);
  const query = boundedString(candidate.query, 300);
  const scoreKey = boundedString(candidate.scoreKey, 300);
  const trackSetFingerprint = boundedString(candidate.trackSetFingerprint, 200);
  const sourceTrackSetFingerprint = boundedString(candidate.sourceTrackSetFingerprint, 200);
  const backend = normalizeSemanticBackend(candidate.backend);
  if (candidate.schemaVersion !== 1 || !id || !createdAt || !completedAt || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(completedAt)) || durationMs == null || !query || !scoreKey || !trackSetFingerprint || !sourceTrackSetFingerprint || !backend || (candidate.kind !== "text-ranking" && candidate.kind !== "reference-ranking") || (candidate.status !== "complete" && candidate.status !== "partial" && candidate.status !== "failed")) return null;

  const prompts = Array.isArray(candidate.prompts)
    ? candidate.prompts.map((prompt) => boundedString(prompt, 100)).filter((prompt): prompt is string => Boolean(prompt))
    : [];
  if (!prompts.length || prompts.length > MAX_PERSISTED_SEMANTIC_PROMPTS || prompts.length !== candidate.prompts?.length) return null;
  if (!candidate.scoreKeysByNormalizedLabel || typeof candidate.scoreKeysByNormalizedLabel !== "object") return null;
  const scoreKeyEntries = Object.entries(candidate.scoreKeysByNormalizedLabel);
  if (!scoreKeyEntries.length || scoreKeyEntries.length > MAX_PERSISTED_SEMANTIC_PROMPTS) return null;
  const scoreKeysByNormalizedLabel: Record<string, string> = {};
  for (const [normalizedLabel, rawKey] of scoreKeyEntries) {
    const key = boundedString(rawKey, 300);
    if (!boundedString(normalizedLabel, 100) || normalizeSemanticPrompt(normalizedLabel) !== normalizedLabel || !key) return null;
    scoreKeysByNormalizedLabel[normalizedLabel] = key;
  }
  if (prompts.some((prompt) => !scoreKeysByNormalizedLabel[normalizeSemanticPrompt(prompt)]) || !Object.values(scoreKeysByNormalizedLabel).includes(scoreKey)) return null;

  const trackIds = Array.isArray(candidate.trackIds)
    ? candidate.trackIds.map((trackId) => boundedString(trackId, 300)).filter((trackId): trackId is string => Boolean(trackId))
    : [];
  if (!trackIds.length || trackIds.length > MAX_PERSISTED_SEMANTIC_TRACKS || trackIds.length !== candidate.trackIds?.length || new Set(trackIds).size !== trackIds.length) return null;
  const trackIdSet = new Set(trackIds);
  if (!Array.isArray(candidate.trackSnapshots) || candidate.trackSnapshots.length !== trackIds.length) return null;
  const snapshots = candidate.trackSnapshots.map((snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return null;
    const trackId = boundedString(snapshot.trackId, 300);
    const name = boundedString(snapshot.name, 500);
    const artist = boundedString(snapshot.artist, 500);
    const album = boundedString(snapshot.album, 500);
    const snapshotDuration = boundedInteger(snapshot.durationMs, 1, 24 * 60 * 60 * 1_000);
    return trackId && trackIdSet.has(trackId) && name && artist && album && snapshotDuration != null
      ? { trackId, name, artist, album, durationMs: snapshotDuration }
      : null;
  });
  if (snapshots.some((snapshot) => !snapshot) || new Set(snapshots.map((snapshot) => snapshot?.trackId)).size !== trackIds.length) return null;

  if (!Array.isArray(candidate.results) || candidate.results.length !== trackIds.length) return null;
  const results = candidate.results.map((result) => {
    if (!result || typeof result !== "object") return null;
    const trackId = boundedString(result.trackId, 300);
    if (!trackId || !trackIdSet.has(trackId) || (result.status !== "complete" && result.status !== "unavailable" && result.status !== "failed") || !Array.isArray(result.scores) || result.scores.length > MAX_PERSISTED_SEMANTIC_PROMPTS) return null;
    const scores: Array<SemanticScore | null> = result.scores.map((score: unknown) => normalizeSemanticScore(score, backend, scoreKeysByNormalizedLabel));
    if (scores.some((score: SemanticScore | null) => !score)) return null;
    const error = result.error == null ? null : boundedString(result.error, 2_000);
    if (result.error != null && !error) return null;
    return { trackId, status: result.status, scores: scores as SemanticScore[], ...(error ? { error } : {}) };
  });
  if (results.some((result) => !result) || new Set(results.map((result) => result?.trackId)).size !== trackIds.length) return null;

  const missingTrackIds = Array.isArray(candidate.missingTrackIds)
    ? candidate.missingTrackIds.filter((trackId): trackId is string => typeof trackId === "string" && trackIdSet.has(trackId)).slice(0, MAX_PERSISTED_SEMANTIC_TRACKS)
    : [];
  if (missingTrackIds.length !== candidate.missingTrackIds?.length || new Set(missingTrackIds).size !== missingTrackIds.length) return null;
  const warnings = Array.isArray(candidate.warnings)
    ? candidate.warnings.map((warning) => boundedString(warning, 2_000)).filter((warning): warning is string => Boolean(warning)).slice(0, 20)
    : [];
  if (warnings.length !== candidate.warnings?.length) return null;
  const representation = candidate.representation == null ? null : normalizeRepresentation(candidate.representation);
  if (candidate.representation != null && !representation) return null;
  const referenceTrackId = candidate.referenceTrackId == null ? null : boundedString(candidate.referenceTrackId, 300);
  if (candidate.kind === "reference-ranking" && (!referenceTrackId || !trackIdSet.has(referenceTrackId) || !representation)) return null;
  if (candidate.kind === "reference-ranking") {
    const serializedRepresentation = JSON.stringify(representation);
    if (JSON.stringify(backend.default_representation) !== serializedRepresentation || results.some((result) => result?.scores.some((score) => JSON.stringify(score.provenance.representation) !== serializedRepresentation))) return null;
  }

  return {
    schemaVersion: 1,
    id,
    createdAt,
    completedAt,
    durationMs,
    kind: candidate.kind,
    status: candidate.status,
    backend,
    prompts,
    scoreKeysByNormalizedLabel,
    query,
    ...(referenceTrackId ? { referenceTrackId } : {}),
    ...(representation ? { representation } : {}),
    scoreKey,
    trackIds,
    trackSetFingerprint,
    sourceTrackSetFingerprint,
    trackSnapshots: snapshots as SemanticExperimentRunV1["trackSnapshots"],
    results: results as SemanticExperimentRunV1["results"],
    missingTrackIds,
    warnings,
  };
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
  const seenRunIds = new Set<string>();
  const semanticRuns = Array.isArray(candidate.semanticRuns)
    ? candidate.semanticRuns.map(normalizeSemanticRun).filter((run): run is SemanticExperimentRunV1 => {
        if (!run || seenRunIds.has(run.id)) return false;
        seenRunIds.add(run.id);
        return true;
      }).slice(0, MAX_RECENT_SEMANTIC_RUNS)
    : [];
  return { schemaVersion: 2, savedRecipes, recentLibraryRoots, lastMp3Export, semanticRuns };
}

export function readBrowserWorkspaceState(storage: StateStorage | null): WorkspaceState {
  if (!storage) return { ...EMPTY_WORKSPACE_STATE };
  try {
    const raw = storage.getItem(WORKSPACE_STATE_STORAGE_KEY)
      ?? storage.getItem(LEGACY_WORKSPACE_STATE_STORAGE_KEY);
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
