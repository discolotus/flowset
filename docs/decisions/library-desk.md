# Library desk and durable analysis jobs

Implemented from the approved library-first design (option 1) with the jobs ledger and result combination workflow from option 3.

## User stories

- Browse music before choosing analysis: expand folders without importing them, click a folder to load its tracks, save favorites, and refresh changed folders. Loaded folders can be selected together; track selection spans every matching page.
- Find an imperfectly remembered song: search title, artist, and album with accent folding, unordered words, prefixes, and bounded typo tolerance. Turn fuzzy matching off for literal matching.
- Listen while exploring: a single persistent local player accompanies a sortable, paginated track table and a provenance-aware inspector. Unknown measurements stay blank.
- Run a listening question: save the selected tracks into a named CLAP/MuQ multi-description job, a MERT reference job, or an Essentia measurement job. Navigate elsewhere while the server works.
- Reuse findings: inspect each job, choose a score and top count, intersect/union/exclude another semantic result, or add available Essentia measurements by track ID. Raw scores from different models are never averaged.
- Build a playlist: send the exact selected results and available measurements to Playlist Builder. Its existing split, subgroup, scoped sort, preview, and separate export operations remain authoritative.

## Implementation boundaries

Browser IndexedDB stores imported metadata. Favorites retain the existing root-scoped storage format. Metadata refresh and measurement application are explicit. Source audio and playlists are never written by these operations.

The API stores immutable job input snapshots and incremental results in SQLite (`FLOWSET_JOBS_PATH`, default `.flowset/jobs.sqlite3` relative to the API working directory). A single worker shares the existing inference gate with interactive model tools. Jobs accept up to 5,000 tracks; batches contain five text-model tracks, four MERT candidates plus its reference, or one Essentia track. Cancellation takes effect between batches, retaining finished results. An interrupted server leaves resumable jobs; it does not silently restart costly inference. File size/mtime, root identity, model identity, and semantic representation are checked before reuse and around each batch. Changed sources cannot be promoted as current results.

Polling strips large track snapshots inside SQLite. The UI renders 50 table rows per page and uses one audio element. Per-job snapshots still occupy space proportional to selected tracks; no claim of unlimited library size or unbounded history is made.

Legacy Semantic Lab experiments remain accessible in Semantic Lab; they are not migrated into the new job ledger. Browser/library metadata and server jobs have separate persistence. Jobs are not background OS services: the local API must remain running.

## Verification

Real browser QA loaded 126 tracks from two local folders, searched a misspelling, auditioned audio, saved a favorite, and ran two real audio files through each of CLAP, MuQ-MuLan, MERT, and Essentia. All four jobs completed. CLAP scores plus Essentia measurements produced an inspectable two-track playlist preview; no export was performed. Measurement application updated the loaded library.

Deterministic tests cover selection beyond the visible page, fuzzy matching, set membership composition, missing scores, bounded job batches, partial results, stop/resume, restart recovery, and changed-file rejection. This is not a real 5,000-file inference soak test.
