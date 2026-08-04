# UI behavior and utility QA matrix

Date: 2026-08-03 (America/Los_Angeles)
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
| Local folders / demo source boundary | Keep; users must know whether they are using real files or fictional fixtures | `App.interaction.test.tsx`, `LocalLibraryPicker.test.tsx`, API local-library tests | Empty/error/loading states; demo/local toggle; 3-source selection and dedup counts | Rebuilt `.app` rendered the native folder picker. Input is blocked by Computer Use approval for the worktree-local unsigned bundle. |
| Source selection and deduplication | Keep; it makes the recipe input inspectable | `App.interaction.test.tsx` asserts 3 input tracks → 2 unique → 1 duplicate | Counts changed correctly as sources were toggled; 14 input → 12 unique in the full fixture set | Packaged sidecar imported recursive fictional folders over real loopback HTTP. |
| Audio-feature provider and progress | Keep the boundary; simplify demo mode | `AnalysisPipelineProgress.test.tsx`, provider/API tests, App demo assertion | Demo mode shows a compact fixture notice and no misleading live Analyze/provider chooser | Rebuilt app exposed ReccoBeats vs Essentia availability. Packaged-sidecar smoke verifies capabilities; actual native analysis awaits input approval. |
| Split factors | Keep; basis playlists are the primary operation | `App.interaction.test.tsx`, `SplitFactorGrid.test.tsx`, recipe/domain tests | Energy 3 × valence 3 rendered nine conserved basis outputs | Native/domain tests enforce playlist conservation and safety. |
| Subgroups | Keep; contiguous sections are useful and preserve basis membership | `App.interaction.test.tsx`, recipe/domain tests | Changed section count and observed output naming/count updates | Native/domain tests cover exported playlist ordering. |
| Scoped sort | Keep; order within each subgroup is the central set-building behavior | `App.interaction.test.tsx`, recipe/domain tests | Descending tempo rendered within groups without crossing boundaries | M3U8, Apple Music, MP3, and Rekordbox native tests preserve requested order. |
| Distribution parameter, glossary, and bins | Keep parameter and glossary; move bins under Advanced | `ParameterGuide.test.tsx`, `parameters.test.ts`, `UtilityControls.interaction.test.tsx` | Valence explanation/glossary opened; 10-bin control worked under Advanced | Provider-neutral values pass through the packaged API recipe preview. |
| Complete output track lists | Keep; required inspection surface before export | `App.interaction.test.tsx`, `OutputPlaylistCard.test.tsx` | All populated outputs expanded with complete track rows | Native export tests validate positions and ordered requests. |
| Compact rows and output metric | Keep as contextual inspection aids | `RowDensityToggle.test.tsx`, `UtilityControls.interaction.test.tsx` | Compact density and per-output valence metric both changed the rendered view | No native-only dependency. |
| Per-playlist M3U8 | Keep, but behind contextual overflow | `UtilityControls.interaction.test.tsx`, native M3U8 tests | Overflow action opened only on the chosen output | Native write tests reject non-M3U8 targets and preserve existing files. |
| Saved recipes: save / rename / mutate / apply / reload / delete | Keep; high value for repeated crates | `App.interaction.test.tsx`, `workspaceState.test.ts`, native workspace-state tests | Full lifecycle passed with an exact `[Sequence QA]` recipe and no residue | Native persistence wiring is automated; live app-data round trip awaits Computer Use input approval. |
| Recent roots, cache, and history paths | Keep paths; collapse details by default | `UtilityControls.interaction.test.tsx`, cache/API tests | Disclosure opened and showed all exact paths | Packaged-sidecar smoke exercised local files and traversal rejection. No recent-root entry was written during the blocked native pass. |
| Export entry | Keep one fixed sidebar action; disable before preview | `App.interaction.test.tsx` | No header duplicate; empty preview had no enabled entry; ready preview enabled Export | Source playlists remain untouched by every native export test. |
| Export dialog keyboard/backdrop/scroll behavior | Keep; required modal accessibility | `ExportDialog.test.tsx` | Focus trap, Escape, trigger restoration, direct-backdrop dismissal, and body scroll lock passed | WebView behavior is browser-equivalent; worktree native input awaits approval. |
| Progressive export destination selection | Keep all five destinations; show configuration only after selection | `BatchDestinationPanel.test.tsx`, `BatchDestinationPanel.interaction.test.tsx` | All five destination states checked; choosing focused Back and returning restored the originating choice | Packaged/native command boundaries exist for every local destination. |
| DJ bundle and Rekordbox compatibility | Keep; solves a real receiver constraint | `djExport.test.ts`, `BatchDestinationPanel.interaction.test.tsx`, native Rekordbox tests | FLAC and MP3 request wiring checked; conversion controls appear only for DJ bundle | Real FFmpeg smoke converted Opus to valid FLAC and 320 kbps MP3; Rekordbox launched with collection, format, metadata, and deck surfaces visible. Import/playback awaits Flowset input approval. |
| Apple Music review / confirm / cancel | Keep the review boundary; it prevents accidental library mutation | `appleMusicImport.test.ts`, native dry-run, script-compilation, order, and report tests | Browser correctly explains that review is native-only | Apple Music launched and exposed library/playlist surfaces. No playlist was created because Flowset input was not authorized. |
| Batch M3U8 | Keep; useful portable handoff | `playlistExport.test.ts`, `BatchDestinationPanel.interaction.test.tsx`, native tests | Destination-only configuration passed | Native tests validate paths, uniqueness, and existing-file preservation. |
| MP3 export progress/report | Keep; long transcoding needs visible progress and an auditable report | `mp3Export.test.ts`, `AnalysisPipelineProgress.test.tsx`, native MP3 tests | Native-only state and explanatory boundary rendered | Real FFmpeg smoke exported MP3 from MP3, FLAC, Opus, and DFF fixtures; UI progress/report awaits input approval. |
| Spotify export | Keep as a separate confirmed operation | Spotify authorization/export tests; destination interaction test | Progressive setup screen appeared without initiating OAuth | No credentials, OAuth grants, or remote playlists were touched. |
| Independent scrolling and responsive reflow | Keep; necessary for dense recipes and long previews | CSS/build checks plus App behavior tests | Sidebar and preview scrolled independently; 640 px and 375 px / 200% reflow had no horizontal overflow | Rebuilt `.app` rendered at desktop size before the native input gate. |

## Automated and runtime gates

- `make test`: 143 web tests, 123 API tests, 31 native tests passed; 3 opt-in codec smokes ignored by the default native lane.
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

Browser console warnings/errors were empty. The page, sidebar, and preview scroll positions were
measured independently. Focus was inspected after destination selection, Back, Escape, backdrop,
and trigger restoration.

## Native blocker and artifacts

Computer Use launched the rebuilt worktree app and read its full accessibility tree. The native
folder picker opened, proving the native dialog boundary rather than a browser fallback. The
Computer Use service then rejected further input with `Computer Use was not approved to use
Flowset` because the target is a worktree-local unsigned app bundle. The installed
`/Applications/Flowset.app` is `0.2.0-preview.2`; it did not expose a usable window to Computer Use
and timed out separately. No permission prompts were bypassed.

The pre-creation artifact manifest is `/private/tmp/sequence-qa-artifact-manifest.md`. Fictional
audio fixtures currently exist only in the exact recorded `/private/tmp` and Downloads QA folders.
No Apple Music playlist, Rekordbox collection item, recent-root entry, saved native recipe, OAuth
grant, or remote playlist was created. The fixtures are intentionally retained so the native pass
can resume at the blocked folder-selection step after approval; they can then be removed by exact
path.

## Remaining acceptance step

Authorize Computer Use input for the rebuilt Flowset bundle, then resume at the already-open native
folder-selection step. The remaining live-only checks are: native recent roots and persistence;
Apple Music review/cancel/confirm; native save dialogs; DJ bundle and M3U8 handoff; MP3 progress and
report; and importing the generated Rekordbox bundle to verify receiver metadata and playback.
