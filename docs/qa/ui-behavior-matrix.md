# UI behavior and utility QA matrix

Date: 2026-08-06 (America/Los_Angeles)
Branch: `codex/ui-behavior-qa`

This audit treats a feature as justified when it helps users complete the visible
`sources → split → subgroup → scoped sort → inspect → export` workflow, has a clear boundary,
and can be exercised without modifying source playlists. Demo data and generated fixtures are
fictional. No Spotify credentials or grants were created.

## Result

The core workflow is useful and internally coherent. The audit did not find a dead optimization
capability. It did find avoidable density and one duplicate action, which this branch removes by
making secondary controls contextual, progressive, or collapsed while preserving their paths and
data. Source playlists remain read-only and every proposed output retains its complete track list.

## Feature evidence

| Visible feature | Utility decision | Automated evidence | Live browser evidence | Native / downstream evidence |
| --- | --- | --- | --- | --- |
| Local folders / demo source boundary | Keep; users must know whether they are using real files or fictional fixtures | `App.interaction.test.tsx`, `LocalLibraryPicker.test.tsx`, API local-library tests | Empty/error/loading states; demo/local toggle; 3-source selection and dedup counts | Native picker selected the exact recorded QA root, imported both fictional crates, and restored that root after relaunch. |
| Source selection and deduplication | Keep; it makes the recipe input inspectable | `App.interaction.test.tsx` asserts 3 input tracks → 2 unique → 1 duplicate | Counts changed correctly as sources were toggled; 14 input → 12 unique in the full fixture set | Native app showed 2 sources, 4 input, 4 unique, and 0 duplicates. SHA-256 hashes for all four source files were unchanged after every export. |
| Audio-feature provider and progress | Keep the boundary; simplify demo mode | `AnalysisPipelineProgress.test.tsx`, provider/API tests, App demo assertion | Demo mode shows a compact fixture notice and no misleading live Analyze/provider chooser | Native Essentia DSP ran 4/4 with staged progress. TensorFlow mood analysis rejected all four intentionally tiny two-second sine fixtures, and the app correctly showed a 0-ready error state without writing incomplete results to the analysis cache. |
| Split factors | Keep; basis playlists are the primary operation | `App.interaction.test.tsx`, `SplitFactorGrid.test.tsx`, recipe/domain tests | Energy 3 × valence 3 rendered nine conserved basis outputs | Native/domain tests enforce playlist conservation and safety. |
| Subgroups | Keep; contiguous sections are useful and preserve basis membership | `App.interaction.test.tsx`, recipe/domain tests | Changed section count and observed output naming/count updates | Native/domain tests cover exported playlist ordering. |
| Scoped sort | Keep; order within each subgroup is the central set-building behavior | `App.interaction.test.tsx`, recipe/domain tests | Descending tempo rendered within groups without crossing boundaries | M3U8, Apple Music, MP3, and Rekordbox native tests preserve requested order. |
| Distribution parameter, glossary, and bins | Keep parameter and glossary; move bins under Advanced | `ParameterGuide.test.tsx`, `parameters.test.ts`, `UtilityControls.interaction.test.tsx` | Valence explanation/glossary opened; 10-bin control worked under Advanced | Provider-neutral values pass through the packaged API recipe preview. |
| Complete output track lists | Keep; required inspection surface before export | `App.interaction.test.tsx`, `OutputPlaylistCard.test.tsx` | All populated outputs expanded with complete track rows | Native export tests validate positions and ordered requests. |
| Compact rows and output metric | Keep as contextual inspection aids | `RowDensityToggle.test.tsx`, `UtilityControls.interaction.test.tsx` | Compact density and per-output valence metric both changed the rendered view | No native-only dependency. |
| Per-playlist M3U8 | Keep, but behind contextual overflow | `UtilityControls.interaction.test.tsx`, native M3U8 tests | Overflow action opened only on the chosen output | Native write tests reject non-M3U8 targets and preserve existing files. |
| Saved recipes: save / rename / mutate / apply / reload / delete | Keep; high value for repeated crates | `App.interaction.test.tsx`, `workspaceState.test.ts`, native workspace-state tests | Full lifecycle passed with an exact `[Sequence QA]` recipe and no residue | Native app saved and renamed the recorded recipe, restored subgroup 2 after a mutation to 3, and retained it after a full app rebuild/relaunch. The persistent recipe is intentionally retained for inspection. |
| Recent roots, cache, and history paths | Keep paths; collapse details by default | `UtilityControls.interaction.test.tsx`, cache/API tests | Disclosure opened and showed all exact paths | Recent root and recipe restored after relaunch. Local Data disclosed the app-data workspace path and analysis-cache convention without exposing them by default. |
| Export entry | Keep one fixed sidebar action; disable before preview | `App.interaction.test.tsx` | No header duplicate; empty preview had no enabled entry; ready preview enabled Export | Source playlists remain untouched by every native export test. |
| Export dialog keyboard/backdrop/scroll behavior | Keep; required modal accessibility | `ExportDialog.test.tsx` | Focus trap, Escape, trigger restoration, direct-backdrop dismissal, and body scroll lock passed | Native WebView opened the progressive export flow and its destination-specific review/configuration states. |
| Progressive export destination selection | Keep all five destinations; show configuration only after selection | `BatchDestinationPanel.test.tsx`, `BatchDestinationPanel.interaction.test.tsx` | All five destination states checked; choosing focused Back and returning restored the originating choice | Packaged/native command boundaries exist for every local destination. |
| DJ bundle and Rekordbox compatibility | Keep; solves a real receiver constraint | `djExport.test.ts`, `BatchDestinationPanel.interaction.test.tsx`, native Rekordbox tests | FLAC and MP3 request wiring checked; conversion controls appear only for DJ bundle | Native exports produced FLAC and 320 kbps MP3 compatibility bundles. Rekordbox imported the MP3 bundle M3U8 as a two-track playlist, loaded Alpha on deck 1, showed the fictional title/artist, played it, and stopped cleanly. Its XML Imported Library setting accepted the generated collection with four tracks and two playlists. |
| Apple Music review / confirm / cancel | Keep the review boundary; it prevents accidental library mutation | `appleMusicImport.test.ts`, native dry-run, script-compilation, order, report, and readiness-preflight tests | Browser correctly explains that review is native-only | Native Review and Cancel passed. Create found Music stuck on `Loading Cloud Library…`; no QA folder or playlist was created. That pass exposed and fixed an unbounded receiver wait: Flowset now performs a non-mutating 15-second readiness preflight and displays actionable recovery text. The fixed behavior was verified live. |
| Batch M3U8 | Keep; useful portable handoff | `playlistExport.test.ts`, `BatchDestinationPanel.interaction.test.tsx`, native tests | Destination-only configuration passed | Native save dialog wrote both playlists. Rekordbox imported the generated High Duration M3U8 and resolved both referenced files. |
| MP3 export progress/report | Keep; long transcoding needs visible progress and an auditable report | `mp3Export.test.ts`, `AnalysisPipelineProgress.test.tsx`, native MP3 tests | Native-only state and explanatory boundary rendered | Native UI completed 4/4 tracks with 2 copies, 2 transcodes, 0 failures, and a manifest. FFprobe decoded every result with the expected fictional metadata. |
| Spotify export | Keep as a separate confirmed operation | Spotify authorization/export tests; destination interaction test | Progressive setup screen appeared without initiating OAuth | No credentials, OAuth grants, or remote playlists were touched. |
| Independent scrolling and responsive reflow | Keep; necessary for dense recipes and long previews | CSS/build checks plus App behavior tests | Sidebar and preview scrolled independently; 640 px and 375 px / 200% reflow had no horizontal overflow | Rebuilt `.app` preserved the two-region desktop layout throughout the full local-library and export pass. |

## Automated and runtime gates

- `make test`: 145 web tests, 123 API tests, 32 native tests passed; 3 opt-in codec smokes ignored by the default native lane.
- `make lint`: TypeScript and Ruff passed.
- `make build`: production TypeScript/Vite build passed.
- `make test-api-runtime-smoke`: source API process passed health, capabilities, recipe preview, local-folder import, ranged audio, and traversal rejection over loopback HTTP.
- `make test-audio-export-smoke`: two real MP3-export smokes and the real Rekordbox Opus→FLAC/MP3 smoke passed.
- Packaged-sidecar smoke: the frozen executable inside `Flowset.app` passed the same real HTTP boundary scenario.

## Browser evidence

Evidence directory:
`/Users/tleo/.codex/visualizations/2026/08/04/019fcb01-643f-75c0-8675-1eb6225e90c0/flowset-ui-qa`

- `01-demo-workflow.png`: source/dedup, split/group/sort, distribution, and rendered outputs.
- `02-progressive-dj-export.png`: destination-first export followed by DJ-only configuration.
- `03-responsive-200-percent.png`: compact one-column workspace with no horizontal overflow.
- `04-responsive-export.png`: responsive export dialog.
- `05-local-empty-error.png`: local-library empty/error state.
- `06-apple-music-target.png`: installed Apple Music receiver surface.
- `07-rekordbox-target.png`: installed Rekordbox collection/deck/metadata surface.
- `10-rekordbox-import-playback.png`: generated M3U8 imported with exact fictional metadata and loaded on deck 1.
- `11-rekordbox-xml-handoff.png`: generated XML selected as Rekordbox's Imported Library.

Browser console warnings/errors were empty. The page, sidebar, and preview scroll positions were
measured independently. Focus was inspected after destination selection, Back, Escape, backdrop,
and trigger restoration.

## Native results, blockers, and artifacts

Computer Use exercised the actual rebuilt worktree `.app`, native folder/save dialogs, Apple Music,
and Rekordbox. No permission prompt was bypassed, no credential or OAuth grant was created, and no
existing playlist was modified. Source files remained byte-identical.

The pre-creation artifact manifest is `/private/tmp/sequence-qa-artifact-manifest.md`. The retained,
exactly named QA artifacts are:

- source fixtures: `/Users/tleo/Downloads/[Sequence QA] Flowset Library 2026-08-03 2310`
- export parent: `/Users/tleo/Downloads/[Sequence QA] Flowset Exports 2026-08-03 2310`
- saved recipe: `[Sequence QA] Native recipe renamed 2026-08-03 2310`
- Rekordbox playlist imported from M3U8: `[Sequence QA] Native recipe renamed 2026-08-03 2310 — High Duration`
- Rekordbox Imported Library XML: the generated `Flowset — … - Rekordbox.xml` in the MP3-compatibility bundle

These are retained because Rekordbox's verified playlist and XML bridge reference them. Removing the
files would deliberately break that receiver evidence. The saved recipe and Rekordbox playlist are
persistent app data and were not permanently deleted without a separate action-time confirmation.
Apple Music created no QA artifact because its own cloud library never became ready. Spotify was
not authenticated and no remote object was created.

The only external blocker is Apple Music's persistent `Loading Cloud Library…` receiver state. The
app now handles it deterministically and safely, but a successful Apple Music creation cannot be
claimed until Music itself becomes ready. The tiny synthetic audio fixtures are also unsuitable for
TensorFlow mood inference; this is retained as verified error-state evidence rather than represented
as a successful mood analysis.
