import { useEffect, useMemo, useState } from "react";

import { DistributionChart, DistributionLegend } from "./components/DistributionChart";
import { OutputPlaylistCard } from "./components/OutputPlaylistCard";
import { SourcePlaylistPicker } from "./components/SourcePlaylistPicker";
import { getDemoPlaylists, previewRecipe } from "./lib/api";
import {
  buildLocalDistribution,
  NUMERIC_PARAMETERS,
  parameterLabel,
  SORT_PARAMETERS,
} from "./lib/parameters";
import type {
  InputPlaylist,
  NumericParameter,
  RecipePreviewResponse,
  SortDirection,
  SortParameter,
  Track,
} from "./lib/types";

const LEVEL_OPTIONS = [2, 3, 4, 5, 6];

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

export default function App() {
  const [playlists, setPlaylists] = useState<InputPlaylist[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recipeName, setRecipeName] = useState("Night Drive Levels");
  const [distributionParameter, setDistributionParameter] =
    useState<NumericParameter>("energy");
  const [distributionBinCount, setDistributionBinCount] = useState(8);
  const [splitEnabled, setSplitEnabled] = useState(true);
  const [splitParameter, setSplitParameter] = useState<NumericParameter>("energy");
  const [splitBinCount, setSplitBinCount] = useState(3);
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDemoPlaylists()
      .then((demoPlaylists) => {
        setPlaylists(demoPlaylists);
        setSelectedIds(new Set(demoPlaylists.map((playlist) => playlist.id)));
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not load source playlists."),
      )
      .finally(() => setLoading(false));
  }, []);

  const selectedPlaylists = useMemo(
    () => playlists.filter((playlist) => selectedIds.has(playlist.id)),
    [playlists, selectedIds],
  );
  const combinedTracks = useMemo(
    () => selectedPlaylists.flatMap((playlist) => playlist.tracks),
    [selectedPlaylists],
  );
  const uniqueTracks = useMemo(() => deduplicateTracks(selectedPlaylists), [selectedPlaylists]);
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
    if (selectedPlaylists.length === 0) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    let stale = false;
    const timer = window.setTimeout(() => {
      setPreviewing(true);
      setError(null);
      previewRecipe({
        name: recipeName.trim() || "Organized playlist",
        inputPlaylists: selectedPlaylists,
        distributionParameter,
        distributionBinCount,
        split: splitEnabled
          ? { parameter: splitParameter, binCount: splitBinCount }
          : null,
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
    splitBinCount,
    splitEnabled,
    splitParameter,
    subgroupBinCount,
    subgroupEnabled,
    subgroupParameter,
  ]);

  const recipeSentence = [
    splitEnabled
      ? `Split into ${splitBinCount} ${parameterLabel(splitParameter).toLowerCase()} levels`
      : "Keep one basis playlist",
    subgroupEnabled
      ? `group each into ${subgroupBinCount} ${parameterLabel(subgroupParameter).toLowerCase()} sections`
      : null,
    sortEnabled
      ? `sort ${subgroupEnabled ? "inside each section" : "the playlist"} by ${parameterLabel(sortParameter).toLowerCase()} ${sortDirectionLabels[sortDirection === "ascending" ? 0 : 1].toLowerCase()}`
      : null,
  ].filter(Boolean).join(" → ");

  const toggleSource = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  if (error && playlists.length === 0) {
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
            <span className="hidden text-[10px] uppercase tracking-[0.16em] text-acid/65 sm:block">Fixture workspace</span>
            <button className="connect-button" disabled>Spotify connection pending</button>
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
          <SourcePlaylistPicker playlists={playlists} selectedIds={selectedIds} onToggle={toggleSource} />
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
                title="Split into playlists"
                description="Create separate basis playlists from distribution levels."
                enabled={splitEnabled}
                onToggle={() => setSplitEnabled((value) => !value)}
              >
                <SelectField label="Parameter" value={splitParameter} onChange={(value) => setSplitParameter(value as NumericParameter)}>
                  {NUMERIC_PARAMETERS.map((parameter) => <option key={parameter.value} value={parameter.value}>{parameter.label}</option>)}
                </SelectField>
                <SelectField label="Levels" value={splitBinCount} onChange={(value) => setSplitBinCount(Number(value))}>
                  {LEVEL_OPTIONS.map((count) => <option key={count} value={count}>{count} levels</option>)}
                </SelectField>
              </RecipeStep>

              <RecipeStep
                number="2"
                title="Group into sections"
                description="Keep every track, but arrange each playlist into visible chunks."
                enabled={subgroupEnabled}
                onToggle={() => setSubgroupEnabled((value) => !value)}
              >
                <SelectField label="Parameter" value={subgroupParameter} onChange={(value) => setSubgroupParameter(value as NumericParameter)}>
                  {NUMERIC_PARAMETERS.map((parameter) => <option key={parameter.value} value={parameter.value}>{parameter.label}</option>)}
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
                  {SORT_PARAMETERS.map((parameter) => <option key={parameter.value} value={parameter.value}>{parameter.label}</option>)}
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
                      {NUMERIC_PARAMETERS.map((parameter) => <option key={parameter.value} value={parameter.value}>{parameter.label}</option>)}
                    </SelectField>
                    <SelectField label="Histogram bins" value={distributionBinCount} onChange={(value) => setDistributionBinCount(Number(value))}>
                      {[5, 6, 8, 10, 12].map((count) => <option key={count} value={count}>{count} bins</option>)}
                    </SelectField>
                  </div>
                </header>
                <div className="px-5 pb-5 pt-2">
                  <DistributionChart distribution={distribution} splitBinCount={splitEnabled && splitParameter === distributionParameter ? splitBinCount : null} />
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
                  </div>
                  <div className="flex items-center gap-2 text-xs text-mist/55" aria-live="polite">
                    <span className={`status-dot ${previewing ? "working" : ""}`} />
                    {previewing ? "Updating preview" : `${preview?.deduplicated_track_count ?? uniqueTracks.length} unique tracks`}
                  </div>
                </header>

                {(error || preview?.warnings.length) && (
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
                      splitParameter={splitEnabled ? splitParameter : null}
                      subgroupParameter={subgroupEnabled ? subgroupParameter : null}
                      sortParameter={sortEnabled ? sortParameter : null}
                      sortDirection={sortDirection}
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
        <span>Source playlists remain read-only · Fixture features are clearly labeled</span>
      </footer>
    </div>
  );
}
