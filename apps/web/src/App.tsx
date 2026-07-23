import { useEffect, useMemo, useRef, useState } from "react";

import { DistributionChart, DistributionLegend } from "./components/DistributionChart";
import {
  BatchDestinationPanel,
  type AppleMusicActionState,
  type BatchActionState,
  type Mp3ExportActionState,
} from "./components/BatchDestinationPanel";
import { FeatureProviderPicker } from "./components/FeatureProviderPicker";
import {
  AnalysisPipelineProgress,
  type AnalysisPipelineStage,
} from "./components/AnalysisPipelineProgress";
import { LocalLibraryPicker } from "./components/LocalLibraryPicker";
import { OutputPlaylistCard } from "./components/OutputPlaylistCard";
import { RowDensityToggle } from "./components/RowDensityToggle";
import { SplitFactorGrid } from "./components/SplitFactorGrid";
import { SourcePlaylistPicker } from "./components/SourcePlaylistPicker";
import {
  browseLocalLibrary,
  getAudioFeatureProgress,
  getAudioFeatureProviders,
  getDemoPlaylists,
  importLocalPlaylist,
  localAudioPreviewUrl,
  previewRecipe,
  resolveAudioFeatures,
  selectLocalLibraryRoot,
} from "./lib/api";
import {
  completeAnalysisProgress,
  createAnalysisProgressToken,
  createInitialAnalysisProgress,
  mergeAnalysisBatchProgress,
  reconcileAnalysisProgressRows,
  type AnalysisProgressView,
} from "./lib/analysisProgress";
import {
  DEFAULT_AUDIO_FEATURE_PROVIDERS,
  markProviderStatusUnknown,
} from "./lib/featureProviders";
import {
  addPlaylistCacheDirectory,
  trackReadyForProvider,
  tracksNeedingAnalysis,
  type AnalysisCacheDirectories,
} from "./lib/analysisCache";
import {
  buildLocalDistribution,
  NUMERIC_PARAMETERS,
  parameterCoverage,
  parameterLabel,
  parameterOptionLabel,
  SORT_PARAMETERS,
  type ParameterCoverage,
} from "./lib/parameters";
import { exportPlaylistM3u8, exportPlaylistsM3u8 } from "./lib/playlistExport";
import {
  buildAppleMusicImportRequest,
  planAppleMusicImport,
  runAppleMusicImport,
  type AppleMusicImportRequest,
} from "./lib/appleMusicImport";
import { buildExportCompatibilityManifest, exportDjBundle } from "./lib/djExport";
import {
  estimateMp3Export,
  exportMp3Folders,
  runForCurrentMp3ExportRevision,
} from "./lib/mp3Export";
import {
  MAX_SPLIT_FACTORS,
  addSplitFactor,
  hasSplitFactorParameter,
  removeSplitFactor,
  splitFactorProduct,
  updateSplitFactor,
  type SplitFactor,
  type SplitFactorChanges,
} from "./lib/factorGrid";
import { readRowDensity, saveRowDensity, type RowDensity } from "./lib/rowDensity";
import type {
  AudioFeatureProviderId,
  AudioFeatureProviderOption,
  InputPlaylist,
  LocalLibraryBrowseResponse,
  LocalLibraryFolder,
  NumericParameter,
  RecipePreviewResponse,
  SortDirection,
  SortParameter,
  Track,
} from "./lib/types";

const LEVEL_OPTIONS = [2, 3, 4, 5, 6];
const PREFERRED_FACTOR_PARAMETERS: NumericParameter[] = [
  "energy",
  "arousal",
  "danceability",
  "valence",
  "tempo",
];
const SPLIT_FACTOR_PARAMETER_ORDER: NumericParameter[] = [
  ...PREFERRED_FACTOR_PARAMETERS,
  ...NUMERIC_PARAMETERS
    .map(({ value }) => value)
    .filter((value) => !PREFERRED_FACTOR_PARAMETERS.includes(value)),
];
const ANALYSIS_PROGRESS_POLL_MS = 350;
const ANALYSIS_PROGRESS_TIMEOUT_MS = 1_500;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function watchAnalysisProgress({
  progressToken,
  isSettled,
  onProgress,
}: {
  progressToken: string;
  isSettled: () => boolean;
  onProgress: (snapshot: Awaited<ReturnType<typeof getAudioFeatureProgress>>) => void;
}): Promise<void> {
  const readProgress = async () => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(),
      ANALYSIS_PROGRESS_TIMEOUT_MS,
    );
    try {
      onProgress(await getAudioFeatureProgress(progressToken, controller.signal));
    } finally {
      globalThis.clearTimeout(timeout);
    }
  };
  while (!isSettled()) {
    try {
      await readProgress();
    } catch {
      // The resolve request may not have registered its token yet. Text status remains available.
    }
    if (!isSettled()) await wait(ANALYSIS_PROGRESS_POLL_MS);
  }
  try {
    await readProgress();
  } catch {
    // A completed analysis remains valid even if its short-lived progress snapshot is unavailable.
  }
}

const waitingAnalysisStages = (): AnalysisPipelineStage[] => [
  { id: "decode", label: "Decode + native DSP", state: "waiting" },
  { id: "tensorflow", label: "TensorFlow moods", state: "waiting" },
];

function deduplicateTracks(playlists: InputPlaylist[]): Track[] {
  const seen = new Set<string>();
  return playlists.flatMap((playlist) =>
    playlist.tracks.filter((track) => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    }),
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`toggle ${checked ? "enabled" : ""}`}
    >
      <span />
    </button>
  );
}

function RecipeStep({
  number,
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  number: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`recipe-step ${enabled ? "enabled" : ""}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="step-number">{number}</span>
          <div>
            <h3 className="font-display text-base font-semibold text-white/90">{title}</h3>
            <p className="mt-1 text-xs leading-5 text-mist/55">{description}</p>
          </div>
        </div>
        <Toggle checked={enabled} onChange={onToggle} label={`${enabled ? "Disable" : "Enable"} ${title}`} />
      </header>
      {enabled && <div className="mt-4 grid grid-cols-2 gap-3 pl-10">{children}</div>}
    </section>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="control-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function SourceSummary({
  selectedCount,
  inputTrackCount,
  uniqueTrackCount,
}: {
  selectedCount: number;
  inputTrackCount: number;
  uniqueTrackCount: number;
}) {
  const duplicates = inputTrackCount - uniqueTrackCount;
  return (
    <div className="source-summary" aria-label="Combined source summary">
      <span><strong>{selectedCount}</strong> sources</span>
      <span><strong>{inputTrackCount}</strong> input tracks</span>
      <span><strong>{uniqueTrackCount}</strong> unique</span>
      <span className={duplicates ? "text-acid" : ""}><strong>{duplicates}</strong> duplicates removed</span>
    </div>
  );
}

function NumericParameterOptions({
  coverage,
}: {
  coverage: Map<NumericParameter, ParameterCoverage>;
}) {
  return NUMERIC_PARAMETERS.map((parameter) => {
    const parameterCoverage = coverage.get(parameter.value) ?? { available: 0, total: 0 };
    return (
      <option
        key={parameter.value}
        value={parameter.value}
        disabled={parameterCoverage.available === 0}
      >
        {parameterOptionLabel(parameter.value, parameterCoverage)}
      </option>
    );
  });
}

function SortParameterOptions({
  coverage,
}: {
  coverage: Map<SortParameter, ParameterCoverage>;
}) {
  return SORT_PARAMETERS.map((parameter) => {
    const parameterCoverage = coverage.get(parameter.value) ?? { available: 0, total: 0 };
    return (
      <option
        key={parameter.value}
        value={parameter.value}
        disabled={parameterCoverage.available === 0}
      >
        {parameterOptionLabel(parameter.value, parameterCoverage)}
      </option>
    );
  });
}

export default function App() {
  const nativeApp = "__TAURI_INTERNALS__" in window;
  const localStorage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const [sourceMode, setSourceMode] = useState<"local" | "demo">("local");
  const [demoPlaylists, setDemoPlaylists] = useState<InputPlaylist[]>([]);
  const [localPlaylists, setLocalPlaylists] = useState<InputPlaylist[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [folderBrowser, setFolderBrowser] = useState<LocalLibraryBrowseResponse | null>(null);
  const [library, setLibrary] = useState<LocalLibraryBrowseResponse | null>(null);
  const [libraryRootPath, setLibraryRootPath] = useState<string | null>(null);
  const [browsingFolders, setBrowsingFolders] = useState(false);
  const [selectingNativeFolder, setSelectingNativeFolder] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [importingPaths, setImportingPaths] = useState<Set<string>>(new Set());
  const [importedPaths, setImportedPaths] = useState<Set<string>>(new Set());
  const [localAudioPaths, setLocalAudioPaths] = useState<Record<string, string>>({});
  const [analysisCacheDirectories, setAnalysisCacheDirectories] =
    useState<AnalysisCacheDirectories>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgressView | null>(null);
  const [featureProvider, setFeatureProvider] =
    useState<AudioFeatureProviderId>("reccobeats");
  const [featureProviders, setFeatureProviders] = useState<AudioFeatureProviderOption[]>(
    DEFAULT_AUDIO_FEATURE_PROVIDERS,
  );
  const [recipeName, setRecipeName] = useState("Night Drive Levels");
  const [distributionParameter, setDistributionParameter] =
    useState<NumericParameter>("energy");
  const [distributionBinCount, setDistributionBinCount] = useState(8);
  const [splitEnabled, setSplitEnabled] = useState(true);
  const [splitFactors, setSplitFactors] = useState<SplitFactor[]>([
    { id: "factor-1", parameter: "energy", binCount: 3 },
  ]);
  const [subgroupEnabled, setSubgroupEnabled] = useState(true);
  const [subgroupParameter, setSubgroupParameter] =
    useState<NumericParameter>("danceability");
  const [subgroupBinCount, setSubgroupBinCount] = useState(2);
  const [sortEnabled, setSortEnabled] = useState(true);
  const [sortParameter, setSortParameter] = useState<SortParameter>("tempo");
  const [sortDirection, setSortDirection] = useState<SortDirection>("ascending");
  const [preview, setPreview] = useState<RecipePreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(false);
  const [batchExportState, setBatchExportState] = useState<BatchActionState>({ status: "idle" });
  const [djBundleState, setDjBundleState] = useState<BatchActionState>({ status: "idle" });
  const [mp3ExportState, setMp3ExportState] = useState<Mp3ExportActionState>({ status: "idle" });
  const [appleMusicState, setAppleMusicState] = useState<AppleMusicActionState>({ status: "idle" });
  const [reviewedAppleMusicRequest, setReviewedAppleMusicRequest] =
    useState<AppleMusicImportRequest | null>(null);
  const analysisRunRevision = useRef(0);
  const previewRevision = useRef(0);
  const [spotifyPreviewRevision, setSpotifyPreviewRevision] = useState(0);
  const reviewedAppleMusicRevision = useRef<number | null>(null);
  const [rowDensity, setRowDensity] = useState<RowDensity>(() => readRowDensity(localStorage));
  const [error, setError] = useState<string | null>(null);

  const changeRowDensity = (density: RowDensity) => {
    setRowDensity(density);
    saveRowDensity(localStorage, density);
  };

  useEffect(() => {
    getAudioFeatureProviders()
      .then((providers) => {
        if (providers.length > 0) {
          setFeatureProviders(providers);
          setFeatureProvider((current) => {
            const currentProvider = providers.find(({ id }) => id === current);
            return currentProvider?.status === "available"
              ? current
              : providers.find(({ status }) => status === "available")?.id ?? current;
          });
        }
      })
      .catch(() => {
        setFeatureProviders(markProviderStatusUnknown(DEFAULT_AUDIO_FEATURE_PROVIDERS));
      });
  }, []);

  useEffect(() => {
    getDemoPlaylists()
      .then((demoPlaylists) => {
        setDemoPlaylists(demoPlaylists);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not load source playlists."),
      )
      .finally(() => setLoading(false));
  }, []);

  const browseFolders = (path: string) => {
    setBrowsingFolders(true);
    setLibraryError(null);
    browseLocalLibrary(path)
      .then(setFolderBrowser)
      .catch((reason: unknown) => {
        setLibraryError(
          reason instanceof Error ? reason.message : "Could not browse the local music library.",
        );
      })
      .finally(() => setBrowsingFolders(false));
  };

  useEffect(() => {
    if (!nativeApp) browseFolders("");
  }, [nativeApp]);

  useEffect(() => {
    analysisRunRevision.current += 1;
    setAnalysisProgress(null);
  }, [featureProvider, selectedIds, sourceMode]);

  const playlists = sourceMode === "local" ? localPlaylists : demoPlaylists;

  const selectedPlaylists = useMemo(
    () => playlists.filter((playlist) => selectedIds.has(playlist.id)),
    [playlists, selectedIds],
  );
  const combinedTracks = useMemo(
    () => selectedPlaylists.flatMap((playlist) => playlist.tracks),
    [selectedPlaylists],
  );
  const uniqueTracks = useMemo(() => deduplicateTracks(selectedPlaylists), [selectedPlaylists]);
  const numericParameterCoverage = useMemo(
    () => new Map<NumericParameter, ParameterCoverage>(
      NUMERIC_PARAMETERS.map(({ value }) => [value, parameterCoverage(uniqueTracks, value)]),
    ),
    [uniqueTracks],
  );
  const sortParameterCoverage = useMemo(
    () => new Map<SortParameter, ParameterCoverage>(
      SORT_PARAMETERS.map(({ value }) => [value, parameterCoverage(uniqueTracks, value)]),
    ),
    [uniqueTracks],
  );
  const featureCoverage = useMemo(() => {
    const hasProviderResults = uniqueTracks.some(
      (track) =>
        track.audio_feature_provenance != null &&
        track.audio_feature_provenance.provider !== "fixture",
    );
    if (!hasProviderResults) return null;
    const matched = uniqueTracks.filter(
      (track) =>
        track.audio_features && track.audio_feature_provenance?.provider === featureProvider,
    ).length;
    return { matched, unresolved: uniqueTracks.length - matched };
  }, [featureProvider, uniqueTracks]);
  const matchingDistributionFactor = splitEnabled
    ? splitFactors.find((factor) => factor.parameter === distributionParameter)
    : undefined;
  const localDistribution = useMemo(
    () => buildLocalDistribution(uniqueTracks, distributionParameter, distributionBinCount),
    [uniqueTracks, distributionParameter, distributionBinCount],
  );
  const distribution =
    preview?.distribution.parameter === distributionParameter &&
    preview.distribution.requested_bin_count === distributionBinCount
      ? preview.distribution
      : localDistribution;
  const sortDirectionLabels = sortParameter === "key"
    ? ["Camelot order", "Reverse Camelot"]
    : ["name", "artist", "album"].includes(sortParameter)
      ? ["A to Z", "Z to A"]
      : ["Low to high", "High to low"];

  useEffect(() => {
    const numericFallback = NUMERIC_PARAMETERS.find(
      ({ value }) => (numericParameterCoverage.get(value)?.available ?? 0) > 0,
    )?.value;
    if (numericFallback) {
      setDistributionParameter((current) =>
        (numericParameterCoverage.get(current)?.available ?? 0) > 0
          ? current
          : numericFallback,
      );
      setSplitFactors((current) => {
        const claimed = new Set<NumericParameter>();
        let changed = false;
        const next = current.map((factor) => {
          const currentAvailable =
            (numericParameterCoverage.get(factor.parameter)?.available ?? 0) > 0;
          if (currentAvailable && !claimed.has(factor.parameter)) {
            claimed.add(factor.parameter);
            return factor;
          }
          const replacement = SPLIT_FACTOR_PARAMETER_ORDER.find(
            (value) =>
              !claimed.has(value)
              && (numericParameterCoverage.get(value)?.available ?? 0) > 0,
          );
          if (!replacement) return factor;
          claimed.add(replacement);
          if (replacement === factor.parameter) return factor;
          changed = true;
          return { ...factor, parameter: replacement };
        });
        return changed ? next : current;
      });
      setSubgroupParameter((current) =>
        (numericParameterCoverage.get(current)?.available ?? 0) > 0
          ? current
          : numericFallback,
      );
    }

    const sortFallback = SORT_PARAMETERS.find(
      ({ value }) => (sortParameterCoverage.get(value)?.available ?? 0) > 0,
    )?.value;
    if (sortFallback) {
      setSortParameter((current) =>
        (sortParameterCoverage.get(current)?.available ?? 0) > 0
          ? current
          : sortFallback,
      );
    }
  }, [numericParameterCoverage, sortParameterCoverage]);

  useEffect(() => {
    previewRevision.current += 1;
    setSpotifyPreviewRevision(previewRevision.current);
    setReviewedAppleMusicRequest(null);
    reviewedAppleMusicRevision.current = null;
    setAppleMusicState((current) =>
      current.status === "importing" ? current : { status: "idle" },
    );
    setDjBundleState({ status: "idle" });
    setMp3ExportState((current) => current.status === "working" ? current : { status: "idle" });
    if (selectedPlaylists.length === 0) {
      setPreview(null);
      setPreviewing(false);
      setBatchExportState({ status: "idle" });
      return;
    }
    let stale = false;
    setPreviewing(true);
    setBatchExportState({ status: "idle" });
    const timer = window.setTimeout(() => {
      setError(null);
      previewRecipe({
        name: recipeName.trim() || "Organized playlist",
        inputPlaylists: selectedPlaylists,
        distributionParameter,
        distributionBinCount,
        splitFactors: splitEnabled ? splitFactors : [],
        subgroup: subgroupEnabled
          ? { parameter: subgroupParameter, binCount: subgroupBinCount }
          : null,
        sort: sortEnabled
          ? { parameter: sortParameter, direction: sortDirection }
          : null,
      })
        .then((result) => {
          if (!stale) setPreview(result);
        })
        .catch((reason: unknown) => {
          if (!stale) {
            setError(reason instanceof Error ? reason.message : "Could not build this preview.");
          }
        })
        .finally(() => {
          if (!stale) setPreviewing(false);
        });
    }, 220);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [
    distributionBinCount,
    distributionParameter,
    recipeName,
    selectedPlaylists,
    sortDirection,
    sortEnabled,
    sortParameter,
    splitEnabled,
    splitFactors,
    subgroupBinCount,
    subgroupEnabled,
    subgroupParameter,
  ]);

  const configuredFactorCombinations = splitFactorProduct(splitFactors);
  const factorGridDescription = splitFactors
    .map((factor) => `${factor.binCount}-level ${parameterLabel(factor.parameter).toLowerCase()}`)
    .join(" × ");
  const recipeSentence = [
    splitEnabled
      ? `Build the full ${factorGridDescription} grid (up to ${configuredFactorCombinations} playlists)`
      : "Keep one basis playlist",
    subgroupEnabled
      ? `group each into ${subgroupBinCount} ${parameterLabel(subgroupParameter).toLowerCase()} sections`
      : null,
    sortEnabled
      ? `sort ${subgroupEnabled ? "inside each section" : "the playlist"} by ${parameterLabel(sortParameter).toLowerCase()} ${sortDirectionLabels[sortDirection === "ascending" ? 0 : 1].toLowerCase()}`
      : null,
  ].filter(Boolean).join(" → ");
  const outputTrackCount = preview?.outputs.reduce(
    (count, output) => count + output.tracks.length,
    0,
  ) ?? 0;
  const exportCompatibility = useMemo(() => (
    preview?.outputs.length
      ? buildExportCompatibilityManifest({
        outputs: preview.outputs,
        localAudioPaths,
        libraryRootPath,
      })
      : null
  ), [libraryRootPath, localAudioPaths, preview]);

  const addFactorToGrid = () => {
    setSplitFactors((current) => {
      if (current.length >= MAX_SPLIT_FACTORS) return current;
      const parameter = SPLIT_FACTOR_PARAMETER_ORDER.find(
        (value) =>
          !hasSplitFactorParameter(current, value)
          && (numericParameterCoverage.get(value)?.available ?? 0) > 0,
      );
      if (!parameter) return current;
      const nextOrdinal = current.reduce((highest, factor) => {
        const ordinal = Number(factor.id.replace(/^factor-/, ""));
        return Number.isFinite(ordinal) ? Math.max(highest, ordinal) : highest;
      }, 0) + 1;
      return addSplitFactor(current, {
        id: `factor-${nextOrdinal}`,
        parameter,
        binCount: 2,
      });
    });
  };

  const removeFactorFromGrid = (factorId: string) => {
    setSplitFactors((current) => (
      current.length > 1 ? removeSplitFactor(current, factorId) : current
    ));
  };

  const changeFactorInGrid = (factorId: string, changes: SplitFactorChanges) => {
    setSplitFactors((current) => updateSplitFactor(current, factorId, changes));
  };

  const exportAllPlaylists = async () => {
    if (!preview || preview.outputs.length === 0 || previewing) return;
    setBatchExportState({ status: "working", message: "Exporting ordered M3U8 playlists…" });
    try {
      const result = await exportPlaylistsM3u8({
        outputs: preview.outputs,
        localAudioPaths,
        libraryRootPath,
        nativeApp,
      });
      if (result.cancelled) {
        setBatchExportState({ status: "idle" });
        return;
      }
      setBatchExportState({
        status: "success",
        message: `Saved ${result.playlistCount} ${result.playlistCount === 1 ? "playlist" : "playlists"} with ${result.trackCount} tracks${result.directory ? ` to ${result.directory}` : ""}.`,
      });
    } catch (reason: unknown) {
      setBatchExportState({
        status: "error",
        message: reason instanceof Error ? reason.message : "Could not export these playlists.",
      });
    }
  };

  const exportAllDjFormats = async () => {
    if (!preview || preview.outputs.length === 0 || previewing) return;
    setDjBundleState({ status: "working", message: "Building the DJ bundle…" });
    try {
      const result = await exportDjBundle({
        outputs: preview.outputs,
        localAudioPaths,
        libraryRootPath,
        bundleName: `Sequence — ${recipeName}`,
        nativeApp,
      });
      if (result.cancelled) {
        setDjBundleState({ status: "idle" });
        return;
      }
      const warningCopy = result.warningCount
        ? ` ${result.warningCount} compatibility warning${result.warningCount === 1 ? " is" : "s are"} detailed in the report.`
        : "";
      const blockedBundleTargets = result.blockedTargets.filter(
        (target) => target === "m3u8" || target === "rekordbox",
      );
      if (blockedBundleTargets.length > 0) {
        const labels = blockedBundleTargets.map((target) =>
          target === "m3u8" ? "M3U8 playlists" : "Rekordbox XML",
        ).join(" and ");
        setDjBundleState({
          status: "error",
          message: `Saved diagnostic files${result.directory ? ` to ${result.directory}` : ""}, but ${labels} were omitted because one or more tracks have missing or invalid local paths. Review the compatibility report.`,
        });
        return;
      }
      setDjBundleState({
        status: "success",
        message: `Saved ${result.fileCount} files for ${result.playlistCount} playlists${result.directory ? ` to ${result.directory}` : ""}.${warningCopy}`,
      });
    } catch (reason: unknown) {
      setDjBundleState({
        status: "error",
        message: reason instanceof Error ? reason.message : "Could not export the DJ bundle.",
      });
    }
  };

  const exportAllMp3Folders = async () => {
    if (!nativeApp || !preview || preview.outputs.length === 0 || previewing) return;
    const revision = previewRevision.current;
    const totalTracks = preview.outputs.reduce(
      (count, output) => count + output.tracks.length,
      0,
    );
    setMp3ExportState({
      status: "working",
      message: `Preparing ${totalTracks} ordered tracks. MP3 files will be copied and other formats converted at up to 320 kbps with the highest-quality LAME mode…`,
      progress: null,
    });
    try {
      const report = await exportMp3Folders({
        exportName: `Sequence — ${recipeName}`,
        outputs: preview.outputs,
        localAudioPaths,
        libraryRootPath,
        nativeApp,
        onProgress: (progress) => {
          runForCurrentMp3ExportRevision(
            revision,
            previewRevision.current,
            () => setMp3ExportState({
              status: "working",
              message: "Exporting ordered MP3 folders…",
              progress,
            }),
          );
        },
      });
      if (!report) {
        setMp3ExportState({ status: "idle" });
        return;
      }
      const committed = runForCurrentMp3ExportRevision(
        revision,
        previewRevision.current,
        () => setMp3ExportState({ status: "complete", report }),
      );
      if (!committed) setMp3ExportState({ status: "idle" });
    } catch (reason: unknown) {
      const rawMessage = reason instanceof Error
        ? reason.message
        : "Could not export the MP3 folders.";
      const message = libraryRootPath
        ? rawMessage.split(libraryRootPath).join("the selected music library")
        : rawMessage;
      const committed = runForCurrentMp3ExportRevision(
        revision,
        previewRevision.current,
        () => setMp3ExportState({
          status: "error",
          message,
        }),
      );
      if (!committed) setMp3ExportState({ status: "idle" });
    }
  };

  const reviewAppleMusicImport = async () => {
    if (!nativeApp || !preview || preview.outputs.length === 0 || previewing) return;
    const revision = previewRevision.current;
    setAppleMusicState({ status: "planning" });
    setReviewedAppleMusicRequest(null);
    reviewedAppleMusicRevision.current = null;
    try {
      const request = buildAppleMusicImportRequest({
        folderName: `Sequence — ${recipeName}`,
        outputs: preview.outputs,
        localAudioPaths,
        libraryRootPath,
      });
      const plan = await planAppleMusicImport(request);
      if (revision !== previewRevision.current) return;
      if (!plan.ready) {
        const details = [
          ...plan.errors,
          ...plan.playlists.flatMap((playlist) => playlist.errors),
        ].join(" ");
        throw new Error(details || "The Apple Music import is not ready.");
      }
      setReviewedAppleMusicRequest(request);
      reviewedAppleMusicRevision.current = revision;
      setAppleMusicState({
        status: "review",
        plan,
        warningCount: exportCompatibility?.issues.filter(
          (issue) => issue.target === "apple_music" && issue.severity === "warning",
        ).length ?? 0,
      });
    } catch (reason: unknown) {
      if (revision !== previewRevision.current) return;
      setAppleMusicState({
        status: "error",
        message: reason instanceof Error ? reason.message : "Could not prepare the Music import.",
      });
    }
  };

  const confirmAppleMusicImport = async () => {
    if (!reviewedAppleMusicRequest || appleMusicState.status !== "review") return;
    if (reviewedAppleMusicRevision.current !== previewRevision.current) {
      setReviewedAppleMusicRequest(null);
      reviewedAppleMusicRevision.current = null;
      setAppleMusicState({
        status: "error",
        message: "The playlist order changed after this review. Review the Music import again.",
      });
      return;
    }
    setAppleMusicState({ status: "importing" });
    try {
      const report = await runAppleMusicImport(reviewedAppleMusicRequest);
      setAppleMusicState({ status: "imported", report });
      setReviewedAppleMusicRequest(null);
      reviewedAppleMusicRevision.current = null;
    } catch (reason: unknown) {
      setAppleMusicState({
        status: "error",
        message: reason instanceof Error ? reason.message : "Could not import playlists into Music.",
      });
    }
  };

  const cancelAppleMusicImport = () => {
    setReviewedAppleMusicRequest(null);
    reviewedAppleMusicRevision.current = null;
    setAppleMusicState({ status: "idle" });
  };

  const toggleSource = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chooseSourceMode = (mode: "local" | "demo") => {
    setSourceMode(mode);
    setSelectedIds(
      new Set(
        (mode === "local" ? localPlaylists : demoPlaylists).map((playlist) => playlist.id),
      ),
    );
    setError(null);
  };

  const chooseLibrary = () => {
    if (!folderBrowser) return;
    setLibrary(folderBrowser);
    setLibraryError(null);
  };

  const chooseNativeLibrary = async () => {
    setSelectingNativeFolder(true);
    setLibraryError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose your music library",
      });
      if (typeof selected !== "string") return;
      const listing = await selectLocalLibraryRoot(selected);
      setLibraryRootPath(selected);
      setFolderBrowser(listing);
      setLibrary(listing);
      const providers = await getAudioFeatureProviders();
      setFeatureProviders(providers);
    } catch (reason: unknown) {
      setLibraryError(
        reason instanceof Error ? reason.message : "Could not select the music library.",
      );
    } finally {
      setSelectingNativeFolder(false);
    }
  };

  const changeLibrary = () => {
    setLibrary(null);
    setLibraryRootPath(null);
    setLocalPlaylists([]);
    setSelectedIds(new Set());
    setImportedPaths(new Set());
    setImportingPaths(new Set());
    setLocalAudioPaths({});
    setAnalysisCacheDirectories({});
    setAnalysisStatus(null);
  };

  const importFolder = (folder: LocalLibraryFolder) => {
    setImportingPaths((current) => new Set(current).add(folder.path));
    setLibraryError(null);
    importLocalPlaylist({ sourcePath: folder.path, recursive: true })
      .then((result) => {
        setLocalPlaylists((current) => [
          ...current.filter((playlist) => playlist.id !== result.playlist.id),
          {
            ...result.playlist,
            description: `${folder.path} · Local folder${
              result.cached_track_count
                ? ` · ${result.cached_track_count} cached`
                : ""
            }`,
          },
        ]);
        setSelectedIds((current) => new Set(current).add(result.playlist.id));
        setImportedPaths((current) => new Set(current).add(folder.path));
        setLocalAudioPaths((current) => ({ ...current, ...result.local_audio_paths }));
        setAnalysisCacheDirectories((current) =>
          addPlaylistCacheDirectory(
            current,
            result.playlist.tracks.map((track) => track.id),
            result.analysis_cache_directory,
          ),
        );
        setAnalysisStatus(
          result.cached_track_count > 0
            ? `Restored ${result.cached_track_count} cached track ${
                result.cached_track_count === 1 ? "analysis" : "analyses"
              } from ${folder.name}/.sequence.`
            : `${folder.name} is ready. New analysis will be cached in its .sequence folder.`,
        );
        const essentia = featureProviders.find(({ id }) => id === "essentia");
        if (essentia?.status === "available") setFeatureProvider("essentia");
        if (result.warnings.length > 0) setLibraryError(result.warnings.join(" "));
      })
      .catch((reason: unknown) => {
        setLibraryError(
          reason instanceof Error ? reason.message : `Could not import ${folder.name}.`,
        );
      })
      .finally(() => {
        setImportingPaths((current) => {
          const next = new Set(current);
          next.delete(folder.path);
          return next;
        });
      });
  };

  const analyzeSelectedTracks = async () => {
    const localTracks = uniqueTracks.filter((track) => localAudioPaths[track.id] != null);
    if (localTracks.length === 0) {
      setAnalysisStatus("Import and select at least one local playlist first.");
      return;
    }
    const runRevision = analysisRunRevision.current + 1;
    analysisRunRevision.current = runRevision;
    const isActiveRun = () => analysisRunRevision.current === runRevision;
    const tracks = tracksNeedingAnalysis(localTracks, featureProvider);
    const alreadyReadyCount = localTracks.length - tracks.length;
    let progressView = featureProvider === "essentia"
      ? createInitialAnalysisProgress(
          localTracks,
          new Set(tracks.map(({ id }) => id)),
        )
      : null;
    if (isActiveRun()) setAnalysisProgress(progressView);
    const providerName =
      featureProviders.find(({ id }) => id === featureProvider)?.display_name ??
      featureProvider;
    if (tracks.length === 0) {
      if (isActiveRun()) setAnalysisStatus(
        `All ${localTracks.length} selected tracks are already ready with ${providerName}.`,
      );
      return;
    }
    setAnalyzing(true);
    setError(null);
    if (isActiveRun()) setAnalysisStatus(
      `Preparing ${tracks.length} missing ${tracks.length === 1 ? "track" : "tracks"}…`,
    );
    const resolvedTracks = new Map<string, Track>();
    const warnings: string[] = [];
    const batchSize = featureProvider === "essentia" ? 5 : 40;
    let completedBeforeBatch = alreadyReadyCount;
    let successfulBeforeBatch = alreadyReadyCount;
    let failedBeforeBatch = 0;
    let elapsedBeforeBatch = 0;
    try {
      for (let offset = 0; offset < tracks.length; offset += batchSize) {
        const batch = tracks.slice(offset, offset + batchSize);
        if (isActiveRun()) setAnalysisStatus(
          `Preparing ${Math.min(offset + batch.length, tracks.length)} of ${tracks.length} missing tracks…`,
        );
        if (progressView) {
          progressView = {
            ...progressView,
            phase: "waiting",
            currentTrackName: null,
            currentTrackDurationSeconds: null,
            currentTrackElapsedSeconds: null,
            stages: waitingAnalysisStages(),
          };
          if (isActiveRun()) setAnalysisProgress(progressView);
        }
        const progressToken = featureProvider === "essentia"
          ? createAnalysisProgressToken()
          : undefined;
        let requestSettled = false;
        const monitor = progressToken
          ? watchAnalysisProgress({
              progressToken,
              isSettled: () => requestSettled,
              onProgress: (snapshot) => {
                if (!progressView || !isActiveRun()) return;
                progressView = mergeAnalysisBatchProgress({
                  current: progressView,
                  snapshot,
                  completedBeforeBatch,
                  successfulBeforeBatch,
                  failedBeforeBatch,
                  elapsedBeforeBatch,
                });
                setAnalysisProgress(progressView);
              },
            })
          : Promise.resolve();
        const resolution = resolveAudioFeatures({
          provider: featureProvider,
          tracks: batch,
          localAudioPaths: Object.fromEntries(
            batch.map((track) => [track.id, localAudioPaths[track.id]!]),
          ),
          analysisCacheDirectories: Object.fromEntries(
            batch.map((track) => [track.id, analysisCacheDirectories[track.id] ?? []]),
          ),
          progressToken,
        });
        let result: Awaited<ReturnType<typeof resolveAudioFeatures>>;
        try {
          result = await resolution;
        } finally {
          requestSettled = true;
          await monitor;
        }
        result.tracks.forEach((track) => resolvedTracks.set(track.id, track));
        const batchTracks = new Map(result.tracks.map((track) => [track.id, track]));
        setLocalPlaylists((current) =>
          current.map((playlist) => ({
            ...playlist,
            tracks: playlist.tracks.map((track) => batchTracks.get(track.id) ?? track),
          })),
        );
        warnings.push(...result.warnings);
        const successfulInBatch = result.tracks.filter(
          (track) => trackReadyForProvider(track, featureProvider),
        ).length;
        completedBeforeBatch += batch.length;
        successfulBeforeBatch += successfulInBatch;
        failedBeforeBatch += batch.length - successfulInBatch;
        elapsedBeforeBatch = progressView?.elapsedSeconds ?? elapsedBeforeBatch;
        if (result.status === "failed" || result.status === "unavailable") {
          throw new Error(
            result.warnings.join(" ") || `${providerName} could not analyze this batch.`,
          );
        }
      }
      const resolvedCount = [...resolvedTracks.values()].filter(
        (track) => trackReadyForProvider(track, featureProvider),
      ).length;
      const readyCount = alreadyReadyCount + resolvedCount;
      let finalReadyCount = readyCount;
      let finalIssueCount = localTracks.length - readyCount;
      if (progressView) {
        progressView = reconcileAnalysisProgressRows(progressView, {
          attemptedTrackIds: new Set(tracks.map(({ id }) => id)),
          readyTrackIds: new Set(
            [...resolvedTracks.values()]
              .filter((track) => trackReadyForProvider(track, featureProvider))
              .map(({ id }) => id),
          ),
        });
        progressView = completeAnalysisProgress(progressView, {
          successful: readyCount,
          failed: localTracks.length - readyCount,
          elapsedSeconds: elapsedBeforeBatch,
        });
        finalReadyCount = progressView.successful ?? readyCount;
        finalIssueCount = progressView.failed ?? localTracks.length - readyCount;
        if (isActiveRun()) setAnalysisProgress(progressView);
      }
      if (isActiveRun()) setAnalysisStatus(
        `${finalReadyCount} of ${localTracks.length} tracks ready with ${providerName}. ${
          alreadyReadyCount > 0
            ? `${alreadyReadyCount} reused; ${resolvedCount} newly analyzed.`
            : `${resolvedCount} newly analyzed and cached.`
        }${finalIssueCount > 0
          ? ` ${finalIssueCount} ${finalIssueCount === 1 ? "track needs" : "tracks need"} another analysis attempt.`
          : ""}`,
      );
      if (warnings.length > 0 && isActiveRun()) {
        setError([...new Set(warnings)].join(" "));
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Audio feature analysis failed.";
      if (isActiveRun()) setAnalysisStatus(message);
      if (progressView && isActiveRun()) {
        setAnalysisProgress({ ...progressView, phase: "error", errorMessage: message });
      }
    } finally {
      setAnalyzing(false);
    }
  };

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink px-6 text-center text-mist">
        <div className="w-full max-w-sm">
          <div className="mx-auto h-8 w-8 animate-pulse rounded-md bg-acid/30" />
          <p className="mt-4 text-sm">Loading the source crate…</p>
        </div>
      </main>
    );
  }

  if (error && demoPlaylists.length === 0 && libraryError) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink p-8 text-center text-white">
        <div>
          <p className="text-acid">The local API is not available.</p>
          <p className="mt-2 text-sm text-mist">Run `npm run dev`, then reload this page.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-white selection:bg-acid selection:text-ink">
      <a href="#workspace" className="skip-link">Skip to workspace</a>
      <header className="sticky top-0 z-30 border-b border-line/80 bg-ink/90 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-4 lg:px-8" aria-label="Primary navigation">
          <div className="flex items-center gap-3">
            <span className="brand-mark" aria-hidden="true">S</span>
            <div>
              <p className="font-display text-sm font-semibold tracking-tight">Sequence</p>
              <p className="text-[9px] uppercase tracking-[0.2em] text-mist/45">Playlist laboratory</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-[10px] uppercase tracking-[0.16em] text-acid/65 sm:block">
              {sourceMode === "local" ? "Local library workspace" : "Fixture workspace"}
            </span>
            <a className="connect-button" href="#spotify-destination">Spotify destination</a>
          </div>
        </nav>
      </header>

      <main id="workspace" className="mx-auto max-w-[1480px] px-5 pb-16 pt-9 lg:px-8 lg:pt-12">
        <section className="max-w-4xl">
          <p className="eyebrow">Organization recipe 01</p>
          <h1 className="mt-3 max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-white sm:text-5xl lg:text-6xl">
            Turn a crate into a set of usable playlists.
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-sm leading-6 text-mist/65 sm:text-base sm:leading-7">
            Combine one or more sources, inspect the shape of the music, split it into basis playlists,
            then group and sort tracks without crossing the boundaries you created.
          </p>
        </section>

        <section className="mt-10 border-y border-line py-6" aria-labelledby="sources-heading">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">Source pool</p>
              <h2 id="sources-heading" className="mt-1 font-display text-xl font-semibold">Choose one or several playlists</h2>
            </div>
            <SourceSummary
              selectedCount={selectedPlaylists.length}
              inputTrackCount={combinedTracks.length}
              uniqueTrackCount={uniqueTracks.length}
            />
          </div>

          <div className="source-mode-tabs" role="group" aria-label="Playlist source">
            <button
              type="button"
              disabled={analyzing}
              className={sourceMode === "local" ? "active" : ""}
              aria-pressed={sourceMode === "local"}
              onClick={() => chooseSourceMode("local")}
            >
              Local folders
            </button>
            <button
              type="button"
              disabled={analyzing}
              className={sourceMode === "demo" ? "active" : ""}
              aria-pressed={sourceMode === "demo"}
              onClick={() => chooseSourceMode("demo")}
            >
              Demo playlists
            </button>
          </div>

          {sourceMode === "local" ? (
            <div className="mt-4 space-y-5">
              <LocalLibraryPicker
                browser={folderBrowser}
                library={library}
                browsing={browsingFolders}
                importingPaths={importingPaths}
                importedPaths={importedPaths}
                error={libraryError}
                nativeFolderSelection={nativeApp}
                selectingNativeFolder={selectingNativeFolder}
                disabled={analyzing}
                onBrowse={browseFolders}
                onSelectNativeFolder={chooseNativeLibrary}
                onChooseLibrary={chooseLibrary}
                onImport={importFolder}
                onChangeLibrary={changeLibrary}
              />
              {localPlaylists.length > 0 && (
                <div>
                  <p className="mb-3 text-[10px] uppercase tracking-[0.14em] text-mist/45">
                    Imported playlists · select one or several
                  </p>
                  <SourcePlaylistPicker
                    playlists={localPlaylists}
                    selectedIds={selectedIds}
                    disabled={analyzing}
                    onToggle={toggleSource}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <SourcePlaylistPicker
                playlists={demoPlaylists}
                selectedIds={selectedIds}
                disabled={analyzing}
                onToggle={toggleSource}
              />
            </div>
          )}

          <div className="feature-provider-panel">
            <div className="max-w-xl">
              <p className="eyebrow">Audio feature backend</p>
              <h3 className="mt-1 font-display text-lg font-semibold">
                Choose where musical measurements come from
              </h3>
              <p className="mt-2 text-xs leading-5 text-mist/55">
                {sourceMode === "local"
                  ? "Import folders first, then analyze the selected tracks. Measurements are reused from a hidden .sequence cache inside each playlist folder; changed files are analyzed again."
                  : "Demo playlists remain on clearly labeled fixture values and are never presented as provider measurements."}
              </p>
              {sourceMode === "local" && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={analyzing || selectedPlaylists.length === 0}
                    onClick={analyzeSelectedTracks}
                  >
                    {analyzing ? "Analyzing…" : "Analyze selected tracks"}
                  </button>
                  {analysisStatus && (
                    <span className="text-[10px] leading-4 text-mist/50" aria-live="polite">
                      {analysisStatus}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="min-w-0 lg:w-[38rem]">
              <FeatureProviderPicker
                providers={featureProviders}
                selectedId={featureProvider}
                disabled={analyzing}
                onChange={setFeatureProvider}
                coverage={featureCoverage}
              />
            </div>
          </div>
          {sourceMode === "local" && analysisProgress && (
            <div className="mt-5">
              <AnalysisPipelineProgress {...analysisProgress} />
            </div>
          )}
        </section>

        {selectedPlaylists.length === 0 ? (
          <section className="empty-state">
            <p className="eyebrow">Nothing selected</p>
            <h2 className="mt-2 font-display text-2xl font-semibold">Choose at least one source playlist.</h2>
            <p className="mt-3 text-sm text-mist/60">The distribution and recipe preview will appear here.</p>
          </section>
        ) : (
          <div className="mt-8 grid items-start gap-7 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="recipe-builder lg:sticky lg:top-24" aria-labelledby="recipe-heading">
              <div className="border-b border-line px-5 pb-5 pt-6">
                <p className="eyebrow">Recipe builder</p>
                <h2 id="recipe-heading" className="mt-1 font-display text-xl font-semibold">Order of operations</h2>
                <label className="control-field mt-5">
                  <span>Output name</span>
                  <input value={recipeName} onChange={(event) => setRecipeName(event.target.value)} maxLength={100} />
                </label>
              </div>

              <RecipeStep
                number="1"
                title="Split by factor grid"
                description="Create a playlist for every populated combination of up to three factors."
                enabled={splitEnabled}
                onToggle={() => setSplitEnabled((value) => !value)}
              >
                <SplitFactorGrid
                  factors={splitFactors}
                  coverage={numericParameterCoverage}
                  onAddFactor={addFactorToGrid}
                  onRemoveFactor={removeFactorFromGrid}
                  onChangeFactor={changeFactorInGrid}
                />
              </RecipeStep>

              <RecipeStep
                number="2"
                title="Group into sections"
                description="Keep every track, but arrange each playlist into visible chunks."
                enabled={subgroupEnabled}
                onToggle={() => setSubgroupEnabled((value) => !value)}
              >
                <SelectField label="Parameter" value={subgroupParameter} onChange={(value) => setSubgroupParameter(value as NumericParameter)}>
                  <NumericParameterOptions coverage={numericParameterCoverage} />
                </SelectField>
                <SelectField label="Sections" value={subgroupBinCount} onChange={(value) => setSubgroupBinCount(Number(value))}>
                  {LEVEL_OPTIONS.map((count) => <option key={count} value={count}>{count} sections</option>)}
                </SelectField>
              </RecipeStep>

              <RecipeStep
                number="3"
                title="Sort within scope"
                description={subgroupEnabled ? "Sort inside each section; section order stays intact." : "Sort each basis playlist independently."}
                enabled={sortEnabled}
                onToggle={() => setSortEnabled((value) => !value)}
              >
                <SelectField label="Parameter" value={sortParameter} onChange={(value) => setSortParameter(value as SortParameter)}>
                  <SortParameterOptions coverage={sortParameterCoverage} />
                </SelectField>
                <SelectField label="Direction" value={sortDirection} onChange={(value) => setSortDirection(value as SortDirection)}>
                  <option value="ascending">{sortDirectionLabels[0]}</option>
                  <option value="descending">{sortDirectionLabels[1]}</option>
                </SelectField>
              </RecipeStep>

              <div className="recipe-sentence">
                <span className="block text-[10px] uppercase tracking-[0.16em] text-mist/45">Live recipe</span>
                <p className="mt-2 text-sm leading-6 text-white/75">{recipeSentence}.</p>
              </div>
            </aside>

            <div className="min-w-0">
              <section className="distribution-panel" aria-labelledby="distribution-heading">
                <header className="flex flex-col justify-between gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-end">
                  <div>
                    <p className="eyebrow">Analyze the source pool</p>
                    <h2 id="distribution-heading" className="mt-1 font-display text-xl font-semibold">Distribution</h2>
                    <p className="mt-2"><DistributionLegend parameter={distributionParameter} /></p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:w-[22rem]">
                    <SelectField label="Parameter" value={distributionParameter} onChange={(value) => setDistributionParameter(value as NumericParameter)}>
                      <NumericParameterOptions coverage={numericParameterCoverage} />
                    </SelectField>
                    <SelectField label="Histogram bins" value={distributionBinCount} onChange={(value) => setDistributionBinCount(Number(value))}>
                      {[5, 6, 8, 10, 12].map((count) => <option key={count} value={count}>{count} bins</option>)}
                    </SelectField>
                  </div>
                </header>
                <div className="px-5 pb-5 pt-2">
                  <DistributionChart
                    distribution={distribution}
                    splitBinCount={matchingDistributionFactor?.binCount ?? null}
                  />
                  <div className="distribution-table" aria-label="Distribution bin values">
                    {distribution.bins.map((bin) => (
                      <div key={bin.id}>
                        <span>{bin.label}</span>
                        <strong>{bin.track_count}</strong>
                        <small>{bin.percentage.toFixed(1)}%</small>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mt-10" aria-labelledby="outputs-heading">
                <header className="flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-end">
                  <div>
                    <p className="eyebrow">Output preview</p>
                    <h2 id="outputs-heading" className="mt-1 font-display text-2xl font-semibold">
                      {preview?.outputs.length ?? 0} basis playlist{preview?.outputs.length === 1 ? "" : "s"}
                    </h2>
                    <p className="mt-2 text-sm text-mist/55">Every playlist and every track stays visible below.</p>
                    {splitEnabled && preview && (
                      <p className="mt-2 font-mono text-[10px] text-mist/45" aria-live="polite">
                        Full factor grid · {preview.populated_combination_count}/{preview.factorial_combination_count} populated
                        {preview.empty_combination_count
                          ? ` · ${preview.empty_combination_count} empty omitted`
                          : ""}
                        {preview.factor_unavailable_track_count
                          ? ` · ${preview.factor_unavailable_track_count} tracks missing factor data`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    <div className="flex items-center gap-2 text-xs text-mist/55" aria-live="polite">
                      <span className={`status-dot ${previewing ? "working" : ""}`} />
                      {previewing ? "Updating preview" : `${preview?.deduplicated_track_count ?? uniqueTracks.length} unique tracks`}
                    </div>
                    <div className="flex items-center gap-2">
                      <RowDensityToggle density={rowDensity} onChange={changeRowDensity} />
                    </div>
                  </div>
                </header>

                <BatchDestinationPanel
                  playlistCount={preview?.outputs.length ?? 0}
                  trackCount={outputTrackCount}
                  nativeApp={nativeApp}
                  disabled={previewing || !preview?.outputs.length}
                  appleMusicState={appleMusicState}
                  djBundleState={djBundleState}
                  m3u8State={batchExportState}
                  mp3ExportState={mp3ExportState}
                  mp3Estimate={estimateMp3Export({
                    outputs: preview?.outputs ?? [],
                    localAudioPaths,
                    libraryRootPath,
                  })}
                  spotifyOutputs={preview?.outputs ?? []}
                  spotifyRevision={spotifyPreviewRevision}
                  spotifyLocalSource={sourceMode === "local"}
                  rekordboxWarningCount={exportCompatibility?.issues.filter(
                    (issue) => issue.target === "rekordbox" && issue.severity === "warning",
                  ).length ?? 0}
                  onPlanAppleMusic={reviewAppleMusicImport}
                  onConfirmAppleMusic={confirmAppleMusicImport}
                  onCancelAppleMusic={cancelAppleMusicImport}
                  onExportDjBundle={exportAllDjFormats}
                  onExportM3u8={exportAllPlaylists}
                  onExportMp3={exportAllMp3Folders}
                />

                {(error || (preview?.warnings.length ?? 0) > 0) && (
                  <div className="notice" role={error ? "alert" : "status"}>
                    {error ?? preview?.warnings.join(" ")}
                  </div>
                )}

                <div className={`mt-5 space-y-6 transition-opacity ${previewing ? "opacity-55" : "opacity-100"}`}>
                  {preview?.outputs.map((output, index) => (
                    <OutputPlaylistCard
                      key={output.id}
                      output={output}
                      outputIndex={index}
                      splitParameters={splitEnabled
                        ? splitFactors.map((factor) => factor.parameter)
                        : []}
                      subgroupParameter={subgroupEnabled ? subgroupParameter : null}
                      sortParameter={sortEnabled ? sortParameter : null}
                      sortDirection={sortDirection}
                      rowDensity={rowDensity}
                      exportDisabled={previewing}
                      previewUrlForTrack={(track) => {
                        const path = localAudioPaths[track.id];
                        return path ? localAudioPreviewUrl(path) : null;
                      }}
                      onExport={(output) => exportPlaylistM3u8({
                        output,
                        localAudioPaths,
                        libraryRootPath,
                        nativeApp,
                      })}
                    />
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      <footer className="mx-auto flex max-w-[1480px] flex-col justify-between gap-3 border-t border-line px-5 py-7 text-[11px] text-mist/45 sm:flex-row lg:px-8">
        <span>Sequence · V0.2 organization pipeline</span>
        <span>
          Source playlists remain read-only · {featureProviders.find(({ id }) => id === featureProvider)?.display_name ?? featureProvider} selected
        </span>
      </footer>
    </div>
  );
}
