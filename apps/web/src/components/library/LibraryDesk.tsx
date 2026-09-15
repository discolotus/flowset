import { useEffect, useMemo, useRef, useState } from "react";
import {
  MagnifyingGlass,
  MusicNotes,
  Play,
  Pause,
  CaretLeft,
  CaretRight,
  X,
  Sliders,
  ListChecks,
} from "@phosphor-icons/react";
import {
  browseLocalLibrary,
  importLocalPlaylist,
  localAudioPreviewUrl,
  getSemanticCapabilities,
} from "../../lib/api";
import { camelot, duration, runtime } from "../../lib/format";
import { searchScore } from "../../lib/librarySearch";
import {
  createLibraryJob,
  listLibraryJobs,
  readLibraryJob,
  controlLibraryJob,
  rankedJobIds,
  combineJobIds,
  type LibraryJob,
} from "../../lib/libraryJobs";
import { readLibrary, saveLibrary } from "../../lib/libraryPersistence";
import type {
  Track,
  LocalLibraryBrowseResponse,
  LocalLibraryFolder,
  LocalPlaylistImportResponse,
  SemanticBackendCapabilities,
} from "../../lib/types";
import { LibraryFolders } from "./LibraryFolders";
import "./library.css";

const PAGE = 50;
const names: Record<string, string> = {
  "local-clap": "CLAP",
  "local-muq-mulan": "MuQ-MuLan",
  "local-mert": "MERT",
  essentia: "Essentia",
};
const numeric = (value: number | null | undefined, digits = 2) =>
  value == null ? "—" : value.toFixed(digits);
const active = (j: LibraryJob) =>
  ["queued", "running", "stopping"].includes(j.status);
function scoreKeys(job: LibraryJob | null) {
  return [
    ...new Map(
      Object.values(job?.results ?? {}).flatMap((r) =>
        (r.scores ?? []).map((s) => [s.key, s.label] as const),
      ),
    ).entries(),
  ];
}

export function LibraryDesk({
  visible,
  onDraft,
  onTools,
}: {
  visible: boolean;
  onDraft: (
    tracks: Track[],
    paths: Record<string, string>,
    name: string,
  ) => void;
  onTools: () => void;
}) {
  const [root, setRoot] = useState<LocalLibraryBrowseResponse | null>(null);
  const [imports, setImports] = useState<
    Record<string, LocalPlaylistImportResponse>
  >({});
  const [folderSelection, setFolderSelection] = useState(new Set<string>());
  const [current, setCurrent] = useState<string | null>(null);
  const [location, setLocation] = useState<LocalLibraryBrowseResponse | null>(
    null,
  );
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [fuzzy, setFuzzy] = useState(true);
  const [selected, setSelected] = useState(new Set<string>());
  const [focused, setFocused] = useState<Track | null>(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState("name");
  const [descending, setDescending] = useState(false);
  const [view, setView] = useState<"library" | "results">("library");
  const [composer, setComposer] = useState(false);
  const [backend, setBackend] = useState("local-clap");
  const [capabilities, setCapabilities] = useState<
    SemanticBackendCapabilities[]
  >([]);
  const [jobName, setJobName] = useState("Deep rolling bass");
  const [prompts, setPrompts] = useState(
    "Minimal techno with deep rolling bass\nComplex syncopated bass groove",
  );
  const [reference, setReference] = useState("");
  const [jobs, setJobs] = useState<LibraryJob[]>([]);
  const [left, setLeft] = useState<LibraryJob | null>(null),
    [right, setRight] = useState<LibraryJob | null>(null);
  const [leftKey, setLeftKey] = useState(""),
    [rightKey, setRightKey] = useState("");
  const [top, setTop] = useState(100);
  const [combine, setCombine] = useState<"both" | "either" | "exclude">("both");
  const [combining, setCombining] = useState(false);
  const [resultLoading, setResultLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const audio = useRef<HTMLAudioElement>(null),
    lastSelection = useRef<string | null>(null),
    importBusy = useRef(false);
  const requestRevision = useRef(0),
    jobRevision = useRef(0),
    saveQueue = useRef(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    void browseLocalLibrary()
      .then(async (value) => {
        if (cancelled) return;
        setRoot(value);
        setLocation(value);
        try {
          const saved = await readLibrary(value.root_id ?? value.root_name);
          if (!cancelled) {
            setImports(saved);
            setFolderSelection(new Set(Object.keys(saved)));
          }
        } catch {
          if (!cancelled)
            setError(
              "Saved library could not be read. You can reload folders.",
            );
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    void getSemanticCapabilities()
      .then(setCapabilities)
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await listLibraryJobs();
        if (!cancelled) setJobs(value);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2500);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  function persist(next: Record<string, LocalPlaylistImportResponse>) {
    if (!root) return;
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => saveLibrary(root.root_id ?? root.root_name, next))
      .catch(() =>
        setError(
          "Library is available this session, but browser storage could not save it.",
        ),
      );
  }
  async function openFolder(folder: LocalLibraryFolder, refresh = false) {
    if (importBusy.current) {
      setError("Wait for the current folder read to finish.");
      return;
    }
    const rev = ++requestRevision.current;
    setLoading(`Reading ${folder.name}…`);
    setError("");
    importBusy.current = true;
    try {
      const loc = await browseLocalLibrary(folder.path);
      if (rev !== requestRevision.current) return;
      setLocation(loc);
      setCurrent(folder.path);
      setView("library");
      setQuery("");
      setPage(0);
      // The root is navigation-only. Loading all descendants is always an explicit action.
      if (folder.path === "") {
        return;
      }
      const value =
        (!refresh && imports[folder.path]) ||
        (await importLocalPlaylist({ sourcePath: folder.path }));
      if (rev !== requestRevision.current) return;
      const next = { ...imports, [folder.path]: value };
      setImports(next);
      persist(next);
      setFolderSelection((old) => new Set(old).add(folder.path));
      setSelected(new Set(value.playlist.tracks.map((t) => t.id)));
      if (value.warnings.length) setError(value.warnings.join(" "));
    } catch (e) {
      setError(String(e));
    } finally {
      importBusy.current = false;
      setLoading("");
    }
  }
  async function loadChildren() {
    if (!location || importBusy.current) return;
    importBusy.current = true;
    setError("");
    let next = { ...imports };
    const loaded = new Set(folderSelection);
    try {
      for (const f of location.folders) {
        setLoading(`Loading ${f.name}…`);
        if (!next[f.path])
          next = {
            ...next,
            [f.path]: await importLocalPlaylist({ sourcePath: f.path }),
          };
        loaded.add(f.path);
        setImports(next);
        setFolderSelection(new Set(loaded));
      }
      persist(next);
      setCurrent(null);
      setSelected(
        new Set(
          Object.entries(next)
            .filter(([path]) => loaded.has(path))
            .flatMap(([, v]) => v.playlist.tracks.map((t) => t.id)),
        ),
      );
    } catch (e) {
      persist(next);
      setError(`Some folders were not loaded. ${String(e)}`);
    } finally {
      importBusy.current = false;
      setLoading("");
    }
  }
  const paths = useMemo(
    () =>
      Object.assign(
        {},
        ...Object.values(imports).map((x) => x.local_audio_paths),
        left?.audio_paths ?? {},
        right?.audio_paths ?? {},
      ) as Record<string, string>,
    [imports, left, right],
  );
  const loaded = useMemo(
    () =>
      Object.entries(imports).map(([path, value]) => ({
        path,
        name: value.playlist.name,
      })),
    [imports],
  );
  const pool = useMemo(() => {
    const map = new Map<string, Track>();
    Object.entries(imports)
      .filter(([path]) =>
        current === null ? folderSelection.has(path) : path === current,
      )
      .forEach(([, value]) =>
        value.playlist.tracks.forEach((t) => map.set(t.id, t)),
      );
    return [...map.values()];
  }, [imports, folderSelection, current]);
  const candidates = useMemo(() => {
    if (view !== "results" || !left) return pool;
    let ids =
      left.backend === "essentia"
        ? new Set(
            Object.entries(left.results ?? {})
              .filter(([, r]) => r.status === "complete")
              .map(([id]) => id),
          )
        : new Set(rankedJobIds(left, leftKey, top));
    if (combining && right && right.backend !== "essentia")
      ids = combineJobIds(
        [...ids],
        rankedJobIds(right, rightKey, top),
        combine,
      );
    const tracks = new Map(
      [...(left.tracks ?? []), ...(combining ? (right?.tracks ?? []) : [])].map(
        (t) => [t.id, t],
      ),
    );
    return [...ids].flatMap((id) => {
      const track =
        left.results?.[id]?.track ??
        (combining && right?.results?.[id]?.status === "complete"
          ? right.results[id].track
          : undefined) ??
        tracks.get(id);
      return track
        ? [
            {
              ...track,
              semantic_scores: [
                ...(left.results?.[id]?.scores ?? []),
                ...(combining ? (right?.results?.[id]?.scores ?? []) : []),
              ],
            },
          ]
        : [];
    });
  }, [pool, view, left, right, leftKey, rightKey, top, combine, combining]);
  const rows = useMemo(
    () =>
      candidates
        .map((t) => ({
          track: t,
          match: searchScore(`${t.name} ${t.artist} ${t.album}`, query, fuzzy),
        }))
        .filter((x) => x.match > 0)
        .sort((a, b) => {
          if (query && a.match !== b.match) return b.match - a.match;
          const av =
            sort === "name"
              ? a.track.name
              : sort === "artist"
                ? a.track.artist
                : sort === "duration"
                  ? a.track.duration_ms
                  : a.track.audio_features?.[sort as "tempo"];
          const bv =
            sort === "name"
              ? b.track.name
              : sort === "artist"
                ? b.track.artist
                : sort === "duration"
                  ? b.track.duration_ms
                  : b.track.audio_features?.[sort as "tempo"];
          if (av == null) return bv == null ? 0 : 1;
          if (bv == null) return -1;
          return (
            (typeof av === "string"
              ? av.localeCompare(String(bv))
              : Number(av) - Number(bv)) * (descending ? -1 : 1)
          );
        })
        .map((x) => x.track),
    [candidates, query, fuzzy, sort, descending],
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE)),
    safePage = Math.min(page, pageCount - 1);
  const selection = useMemo(
    () => candidates.filter((t) => selected.has(t.id)),
    [candidates, selected],
  );
  const previewTrack =
    candidates.find((t) => t.id === focused?.id) ?? focused ?? rows[0] ?? null;
  const previewPath = previewTrack ? paths[previewTrack.id] : undefined;
  const arousalCount = rows.filter(
    (t) => t.audio_features?.arousal != null,
  ).length;
  const tempoValues = rows.flatMap((t) =>
    t.audio_features?.tempo == null ? [] : [t.audio_features.tempo],
  );
  function toggleTrack(id: string, shift: boolean) {
    setSelected((old) => {
      const next = new Set(old);
      const from = rows.findIndex((t) => t.id === lastSelection.current),
        to = rows.findIndex((t) => t.id === id);
      const ids =
        shift && from >= 0
          ? rows
              .slice(Math.min(from, to), Math.max(from, to) + 1)
              .map((t) => t.id)
          : [id];
      const remove = next.has(id);
      ids.forEach((key) => (remove ? next.delete(key) : next.add(key)));
      return next;
    });
    lastSelection.current = id;
  }
  async function openJob(id: string, side: "left" | "right" = "left") {
    const rev = ++jobRevision.current;
    setResultLoading(true);
    setSelected(new Set());
    try {
      const job = await readLibraryJob(id);
      if (rev !== jobRevision.current) return;
      if (root && job.root_id.slice(0, 24) !== root.root_id)
        throw new Error(
          "This result belongs to another music root. Reconnect its drive first.",
        );
      if (side === "right" && left && job.root_id !== left.root_id)
        throw new Error("These jobs belong to different music roots.");
      if (job.stale)
        setError(
          "This result is stale: source files or model changed. It can be inspected, but start a new job before creating playlists.",
        );
      if (side === "left") {
        setLeft(job);
        setLeftKey(scoreKeys(job)[0]?.[0] ?? "");
        setCombining(false);
      } else {
        setRight(job);
        setRightKey(scoreKeys(job)[0]?.[0] ?? "");
        setCombining(true);
      }
      setView("results");
      setQuery("");
      setPage(0);
      setSelected(new Set());
    } catch (e) {
      setError(String(e));
    } finally {
      if (rev === jobRevision.current) setResultLoading(false);
    }
  }
  async function runJob() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      if (!selection.length) throw new Error("Select tracks to analyze first.");
      if (selection.some((t) => !paths[t.id]))
        throw new Error("Some selected tracks have no local audio.");
      const job = await createLibraryJob({
        name: jobName.trim(),
        backend,
        tracks: selection,
        audio_paths: Object.fromEntries(
          selection.map((t) => [t.id, paths[t.id]]),
        ),
        labels:
          backend === "essentia" || backend === "local-mert"
            ? []
            : prompts
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
        reference_id: backend === "local-mert" ? reference : undefined,
      });
      setJobs((old) => [job, ...old]);
      setComposer(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }
  async function action(job: LibraryJob, type: "stop" | "resume") {
    try {
      await controlLibraryJob(job.id, type);
      setJobs(await listLibraryJobs());
    } catch (e) {
      setError(String(e));
    }
  }
  async function draft() {
    if (!selection.length) return;
    if (view === "results" && (left?.stale || (combining && right?.stale))) {
      setError(
        "Run a new analysis for changed sources before creating a playlist.",
      );
      return;
    }
    try {
      if (view === "results") {
        const snapshots = await Promise.all(
          [left, ...(combining ? [right] : [])]
            .filter((j): j is LibraryJob => !!j)
            .map((j) => readLibraryJob(j.id)),
        );
        if (snapshots.some((j) => j.stale))
          throw new Error(
            "Sources changed. Refresh the analysis before creating this playlist.",
          );
      }
    } catch (e) {
      setError(String(e));
      return;
    }
    onDraft(
      selection,
      Object.fromEntries(
        selection.flatMap((t) => (paths[t.id] ? [[t.id, paths[t.id]]] : [])),
      ),
      view === "results" && left ? left.name : "Library selection",
    );
  }
  async function applyMeasurements(job: LibraryJob) {
    try {
      const fresh = await readLibraryJob(job.id);
      if (fresh.stale)
        throw new Error(
          "Sources changed. Run measurements again before updating the library.",
        );
      let count = 0;
      const next = Object.fromEntries(
        Object.entries(imports).map(([path, value]) => [
          path,
          {
            ...value,
            playlist: {
              ...value.playlist,
              tracks: value.playlist.tracks.map((track) => {
                const result = fresh.results?.[track.id];
                if (result?.status !== "complete" || !result.track)
                  return track;
                count++;
                return {
                  ...track,
                  audio_features: result.track.audio_features,
                  audio_feature_provenance:
                    result.track.audio_feature_provenance,
                };
              }),
            },
          },
        ]),
      );
      setImports(next);
      persist(next);
      setError(
        `Updated measurements for ${count} loaded track entries. Source files are unchanged.`,
      );
    } catch (e) {
      setError(String(e));
    }
  }
  function sortBy(key: string) {
    if (sort === key) setDescending(!descending);
    else {
      setSort(key);
      setDescending(false);
    }
    setPage(0);
  }
  async function audition(track: Track) {
    setFocused(track);
    setPlayerError("");
    setPlaying(false);
  }
  useEffect(() => {
    if (!visible && audio.current && !audio.current.paused)
      audio.current.pause();
  }, [visible]);
  useEffect(() => {
    setPlaying(false);
    setPlayerError("");
  }, [previewPath]);
  return (
    <section
      id="library-workspace"
      tabIndex={-1}
      className="library-desk"
      hidden={!visible}
      aria-label="Library desk"
    >
      {root ? (
        <LibraryFolders
          key={root.root_id}
          root={root}
          current={current}
          onOpen={(f) => void openFolder(f)}
          onError={setError}
          loaded={loaded}
          selected={folderSelection}
          onToggle={(path) => {
            setFolderSelection((old) => {
              const next = new Set(old);
              next.has(path) ? next.delete(path) : next.add(path);
              return next;
            });
            setCurrent(null);
            setView("library");
            setSelected(new Set());
          }}
          onAll={(all) => {
            setFolderSelection(new Set(all ? Object.keys(imports) : []));
            setCurrent(null);
            setView("library");
            setSelected(new Set());
          }}
        />
      ) : (
        <aside className="desk-sidebar">
          <h2>Music sources</h2>
          <p>{error || "Connecting to your music root…"}</p>
        </aside>
      )}
      <div
        className={`desk-main ${view === "results" ? "desk-results-mode" : ""}`}
      >
        <header className="desk-toolbar">
          <div>
            <p className="desk-breadcrumb">
              {root?.root_name ?? "Local music"} /{" "}
              {current ?? "Selected sources"}
            </p>
            <h1>
              {view === "results"
                ? "Jobs & results"
                : current === null
                  ? "Your library"
                  : (location?.current_name ?? "Your library")}
            </h1>
          </div>
          <div className="desk-tabs">
            <button
              aria-pressed={view === "library"}
              onClick={() => {
                setView("library");
                setPage(0);
                setSelected(new Set());
              }}
            >
              Library
            </button>
            <button
              aria-pressed={view === "results"}
              onClick={() => setView("results")}
            >
              Jobs & results <span>{jobs.length}</span>
            </button>
            <button aria-label="Advanced model tools" onClick={onTools}>
              <Sliders />
            </button>
          </div>
        </header>
        {error && (
          <div role="alert" className="desk-notice">
            {error}
            <button aria-label="Dismiss message" onClick={() => setError("")}>
              <X />
            </button>
          </div>
        )}
        {view === "results" && (
          <section className="desk-ledger" aria-label="Analysis jobs">
            <table>
              <thead>
                <tr>
                  <th>Job name</th>
                  <th>Model</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.name}</td>
                    <td>{names[job.backend]}</td>
                    <td>
                      {job.completed}/{job.total}
                    </td>
                    <td>
                      {job.status}
                      {job.error && <p className="desk-muted">{job.error}</p>}
                    </td>
                    <td>
                      <button
                        disabled={job.completed === 0}
                        onClick={() => void openJob(job.id)}
                      >
                        Open
                      </button>
                      {active(job) ? (
                        <button
                          disabled={job.status === "stopping"}
                          onClick={() => void action(job, "stop")}
                        >
                          Stop
                        </button>
                      ) : (
                        [
                          "failed",
                          "cancelled",
                          "interrupted",
                          "partial",
                        ].includes(job.status) && (
                          <button onClick={() => void action(job, "resume")}>
                            Resume
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!jobs.length && (
              <p className="desk-empty">
                Select music in Library, then start an analysis. Each job keeps
                its own results here.
              </p>
            )}
          </section>
        )}
        {view === "results" && left && (
          <section className="desk-result-tools">
            <div>
              <h2>{left.name}</h2>
              <p className="desk-muted">
                {names[left.backend]} · {left.completed}/{left.total} processed
                · {left.status}
              </p>
            </div>
            {scoreKeys(left).length > 0 && (
              <label>
                Score
                <select
                  aria-label="Result score"
                  value={leftKey}
                  onChange={(e) => setLeftKey(e.target.value)}
                >
                  {scoreKeys(left).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(left.backend !== "essentia" ||
              (combining && right?.backend !== "essentia")) && (
              <label>
                Top tracks
                <input
                  aria-label="Top result tracks"
                  type="number"
                  min="1"
                  max="5000"
                  value={top}
                  onChange={(e) =>
                    setTop(
                      Math.max(1, Math.min(5000, Number(e.target.value) || 1)),
                    )
                  }
                />
              </label>
            )}
            <label>
              Combine with
              <select
                aria-label="Combine with job"
                value={combining ? (right?.id ?? "") : ""}
                onChange={(e) =>
                  e.target.value
                    ? void openJob(e.target.value, "right")
                    : setCombining(false)
                }
              >
                <option value="">No second result</option>
                {jobs
                  .filter((j) => j.id !== left.id && j.completed > 0)
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name} · {names[j.backend]}
                    </option>
                  ))}
              </select>
            </label>
            {combining && right && right.backend !== "essentia" && (
              <>
                <select
                  aria-label="Second result score"
                  value={rightKey}
                  onChange={(e) => setRightKey(e.target.value)}
                >
                  {scoreKeys(right).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Combine results"
                  value={combine}
                  onChange={(e) => setCombine(e.target.value as typeof combine)}
                >
                  <option value="both">Match both</option>
                  <option value="either">Match either</option>
                  <option value="exclude">Exclude second result</option>
                </select>
              </>
            )}
            {combining && right?.backend === "essentia" && (
              <p className="desk-muted">
                Available measurements are added by track identity; result
                membership stays unchanged.
              </p>
            )}
            {(left.backend === "essentia" ||
              (combining && right?.backend === "essentia")) && (
              <button
                onClick={() =>
                  void applyMeasurements(
                    left.backend === "essentia" ? left : right!,
                  )
                }
              >
                Use measurements in library
              </button>
            )}
            <p className="desk-muted">
              Only available scores enter ranked results. Each model stays
              separate; missing analysis is never treated as zero.
            </p>
          </section>
        )}
        <div className="desk-search">
          <MagnifyingGlass />
          <input
            aria-label="Search library tracks"
            type="search"
            placeholder="Search title, artist, album…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={fuzzy}
              onChange={(e) => setFuzzy(e.target.checked)}
            />{" "}
            Fuzzy
          </label>
        </div>
        <div className="desk-selection" aria-busy={resultLoading}>
          {resultLoading && <span role="status">Opening results…</span>}
          {current && view === "library" && (
            <button
              disabled={!!loading}
              onClick={() =>
                void openFolder(
                  { path: current, name: location?.current_name ?? current },
                  true,
                )
              }
            >
              Refresh folder
            </button>
          )}
          <button
            disabled={resultLoading || !rows.length}
            onClick={() =>
              setSelected((old) => new Set([...old, ...rows.map((t) => t.id)]))
            }
          >
            Select all {query ? "matching " : ""}
            {rows.length}
          </button>
          <button
            disabled={!selected.size}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
          <span>{selection.length} selected</span>
          <div className="desk-selection-end">
            <button
              disabled={resultLoading || !selection.length}
              onClick={draft}
            >
              Create playlist
            </button>
            <button
              className="desk-primary"
              disabled={resultLoading || !selection.length}
              onClick={() => {
                setComposer(!composer);
                setReference(
                  previewTrack && selected.has(previewTrack.id)
                    ? previewTrack.id
                    : (selection[0]?.id ?? ""),
                );
              }}
            >
              Analyze selection
            </button>
          </div>
        </div>
        {composer && (
          <section className="desk-composer" aria-label="New analysis job">
            <div className="desk-form-grid">
              <label>
                Job name
                <input
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  maxLength={120}
                />
              </label>
              <label>
                Model
                <select
                  value={backend}
                  onChange={(e) => setBackend(e.target.value)}
                >
                  <option value="essentia">Essentia · measurements</option>
                  {capabilities.map((c) => (
                    <option key={c.id} value={c.id} disabled={!c.available}>
                      {c.display_name}
                      {!c.available ? " · unavailable" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {backend === "local-mert" ? (
              <label>
                Reference song
                <select
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                >
                  {selection.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.artist}
                    </option>
                  ))}
                </select>
              </label>
            ) : backend !== "essentia" ? (
              <label>
                Descriptions · one per line
                <textarea
                  value={prompts}
                  onChange={(e) => setPrompts(e.target.value)}
                  rows={3}
                />
              </label>
            ) : (
              <p>
                Measure tempo, key, rhythm and available mood models. Existing
                analysis is reused.
              </p>
            )}
            <p className="desk-muted">
              {selection.length} tracks · saved selection · small sequential
              batches · safe to navigate away
            </p>
            <button
              className="desk-primary"
              disabled={submitting || !jobName.trim()}
              onClick={() => void runJob()}
            >
              {submitting ? "Saving…" : "Start job"}
            </button>
            <button onClick={() => setComposer(false)}>Cancel</button>
          </section>
        )}
        {loading && (
          <p className="desk-notice" role="status">
            {loading}
          </p>
        )}
        {!rows.length && view === "library" && (
          <div className="desk-empty">
            <FolderIntro />
            <h2>
              {query ? "No tracks match your search" : "Start with your music"}
            </h2>
            <p>
              {query
                ? "Try a shorter name or enable fuzzy search."
                : "Expand a folder on the left, then click its name to read its tracks. Star your favorite locations for next time."}
            </p>
            {!query && location && location.folders.length > 0 && (
              <button
                className="desk-primary"
                disabled={!!loading}
                onClick={() => void loadChildren()}
              >
                Load all {location.folders.length} folders here
              </button>
            )}
            <p className="desk-muted">
              Folder reads are sequential. Audio analysis only starts when you
              create a job.
            </p>
          </div>
        )}
        <div className="desk-table-wrap">
          <table className="desk-track-table" aria-label="Music library tracks">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all matching tracks"
                    checked={
                      rows.length > 0 && rows.every((t) => selected.has(t.id))
                    }
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          rows.some((t) => selected.has(t.id)) &&
                          !rows.every((t) => selected.has(t.id));
                    }}
                    onChange={(e) =>
                      setSelected((old) => {
                        const next = new Set(old);
                        rows.forEach((t) =>
                          e.target.checked ? next.add(t.id) : next.delete(t.id),
                        );
                        return next;
                      })
                    }
                  />
                </th>
                <th
                  aria-sort={
                    sort === "name"
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button onClick={() => sortBy("name")}>Title</button>
                </th>
                <th
                  aria-sort={
                    sort === "artist"
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button onClick={() => sortBy("artist")}>Artist</button>
                </th>
                <th
                  aria-sort={
                    sort === "tempo"
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button onClick={() => sortBy("tempo")}>BPM</button>
                </th>
                <th>Key</th>
                <th
                  aria-sort={
                    sort === "arousal"
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button onClick={() => sortBy("arousal")}>Arousal</button>
                </th>
                <th
                  aria-sort={
                    sort === "duration"
                      ? descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <button onClick={() => sortBy("duration")}>Time</button>
                </th>
                {view === "results" && left && leftKey ? (
                  <th>{names[left.backend]} score</th>
                ) : (
                  <th>Analysis</th>
                )}
                {combining &&
                  right &&
                  right.backend !== "essentia" &&
                  view === "results" && <th>{names[right.backend]} score</th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(safePage * PAGE, (safePage + 1) * PAGE).map((t) => (
                <tr
                  key={t.id}
                  className={previewTrack?.id === t.id ? "focused" : ""}
                  onDoubleClick={() => void audition(t)}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select track ${t.name} ${t.artist}`}
                      checked={selected.has(t.id)}
                      onClick={(e) => toggleTrack(t.id, e.shiftKey)}
                      onChange={() => {}}
                    />
                  </td>
                  <td>
                    <button
                      className="desk-track-name"
                      onClick={() => void audition(t)}
                    >
                      <span>{t.name}</span>
                      <small>{t.album}</small>
                    </button>
                  </td>
                  <td>{t.artist}</td>
                  <td>{numeric(t.audio_features?.tempo, 1)}</td>
                  <td>{camelot(t)}</td>
                  <td>{numeric(t.audio_features?.arousal)}</td>
                  <td>{duration(t.duration_ms)}</td>
                  {view === "results" && left && leftKey ? (
                    <td>
                      {numeric(
                        left.results?.[t.id]?.scores?.find(
                          (s) => s.key === leftKey,
                        )?.score,
                        3,
                      )}
                    </td>
                  ) : (
                    <td className="desk-muted">
                      {t.audio_feature_provenance?.provider ?? "Not analyzed"}
                    </td>
                  )}
                  {combining &&
                    right &&
                    right.backend !== "essentia" &&
                    view === "results" && (
                      <td>
                        {numeric(
                          right.results?.[t.id]?.scores?.find(
                            (s) => s.key === rightKey,
                          )?.score,
                          3,
                        )}
                      </td>
                    )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="desk-table-footer">
          <span>
            {rows.length} tracks ·{" "}
            {runtime(rows.reduce((sum, t) => sum + t.duration_ms, 0))} ·{" "}
            {tempoValues.length
              ? `${Math.min(...tempoValues).toFixed(0)}–${Math.max(...tempoValues).toFixed(0)} BPM`
              : "Tempo unavailable"}{" "}
            · arousal {arousalCount}/{rows.length}
          </span>
          <div>
            <button
              aria-label="Previous track page"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <CaretLeft />
            </button>
            <span>
              {safePage + 1} / {pageCount}
            </span>
            <button
              aria-label="Next track page"
              disabled={safePage + 1 >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              <CaretRight />
            </button>
          </div>
        </div>
        <section className="desk-job-drawer" aria-label="Job progress">
          <button onClick={() => setView("results")}>
            <ListChecks /> Jobs · {jobs.filter(active).length} running or queued
            · {jobs.filter((j) => j.status === "complete").length} ready
          </button>
          {jobs.find(active) && (
            <div>
              <span>
                {jobs.find(active)!.name} · {names[jobs.find(active)!.backend]}
              </span>
              <progress
                max={jobs.find(active)!.total}
                value={jobs.find(active)!.completed}
              />
              <span>
                {jobs.find(active)!.completed}/{jobs.find(active)!.total}
              </span>
              <button onClick={() => void action(jobs.find(active)!, "stop")}>
                Stop
              </button>
            </div>
          )}
        </section>
      </div>
      <aside className="desk-inspector" aria-label="Track inspector">
        <MusicNotes size={40} />
        <h2>{previewTrack?.name ?? "Select a track"}</h2>
        <p>{previewTrack?.artist ?? "Listen and inspect your library."}</p>
        <p className="desk-muted">{previewTrack?.album}</p>
        <h3>Musical measurements</h3>
        <dl>
          <dt>BPM</dt>
          <dd>{numeric(previewTrack?.audio_features?.tempo, 1)}</dd>
          <dt>Key</dt>
          <dd>{previewTrack ? camelot(previewTrack) : "—"}</dd>
          <dt>Arousal</dt>
          <dd>{numeric(previewTrack?.audio_features?.arousal)}</dd>
          <dt>Danceability</dt>
          <dd>{numeric(previewTrack?.audio_features?.danceability)}</dd>
          <dt>Duration</dt>
          <dd>{previewTrack ? duration(previewTrack.duration_ms) : "—"}</dd>
        </dl>
        <h3>Analysis source</h3>
        <p>
          {previewTrack?.audio_feature_provenance?.provider ??
            "No measurements yet"}
        </p>
        <p className="desk-muted">
          {previewTrack?.audio_feature_provenance?.analyzer_version}
        </p>
        <p className="desk-muted">
          Arousal estimates calm to excited. Similarity scores describe model
          matches, not transition quality.
        </p>
      </aside>
      <footer className="desk-player">
        <MusicNotes size={26} />
        <div>
          <strong>{previewTrack?.name ?? "Choose a song to preview"}</strong>
          <small>
            {previewTrack?.artist ?? "Local audio · source files unchanged"}
          </small>
        </div>
        <button
          aria-label={playing ? "Pause preview" : "Play preview"}
          disabled={!previewPath}
          onClick={() => {
            if (!audio.current) return;
            if (playing) audio.current.pause();
            else
              void audio.current
                .play()
                .catch(() =>
                  setPlayerError(
                    "Audio preview could not start. Check that the drive and file are available.",
                  ),
                );
          }}
        >
          {playing ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <audio
          ref={audio}
          controls
          preload="none"
          src={previewPath ? localAudioPreviewUrl(previewPath) : undefined}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() =>
            setPlayerError(
              "Audio file unavailable. Reopen the folder to refresh it.",
            )
          }
          aria-label="Local track player"
        />
        {playerError && <span role="alert">{playerError}</span>}
      </footer>
    </section>
  );
}
function FolderIntro() {
  return <MusicNotes size={36} />;
}
