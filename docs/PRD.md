# Product Requirements Document: Flowset

- Version: 0.2
- Author: Disco Lotus (Concept)
- Status: Draft

## Vision

Create a web application that analyzes one or more playlists using musical features and lets
users build new, intentionally organized playlists through a clear split, subgroup, and sort
workflow.

Rather than simply sorting songs alphabetically or by BPM, the application should intelligently
organize tracks according to energy, tempo, key, danceability, valence, and genre. Users first
inspect the distribution of a selected feature, then decide whether to split tracks into
multiple basis playlists, retain them in one playlist as contiguous subgroups, and sort within
the resulting scope. Users preview and customize every full track list before writing new
playlists to Spotify.

The goal is to reduce the manual effort required to organize large music libraries into coherent
playlists with smooth musical progression.

## Problem

Spotify playlists often become collections of songs rather than thoughtfully organized listening
experiences. Users cannot easily combine several playlists into one working set, inspect how
their tracks are distributed across a musical feature, turn distribution levels into separate
playlists, or create visible chunks inside a playlist and sort only within those chunks. Existing
tools often collapse these distinct operations into a single opaque ordering strategy. These
workflows are currently manual or require professional DJ software.

## Goals

- Connect securely to Spotify.
- Read one or multiple playlists owned or collaboratively managed by the user.
- Import local folders, M3U, and M3U8 files as equivalent read-only playlist inputs.
- Retrieve Spotify metadata and musical features from a user-selected, approved source.
- Show feature-source availability, provenance, coverage, and missing values without hidden
  fallback or fabricated scores.
- Show the distribution of a user-selected organization parameter.
- Split a combined track pool into multiple basis playlists using distribution levels or bins.
- Optionally subgroup each basis playlist into contiguous chunks while retaining all its tracks.
- Sort each playlist or subgroup by a separately selected parameter.
- Support full-track-list preview, clear group boundaries, and manual adjustment.
- Export one or more new playlists to Spotify.
- Never modify the original playlist.

## Non-goals for V1

- Mixing, beatmatching, crossfading, or live DJ functions
- Downloading music or modifying audio files
- Claiming unavailable feature data comes from Spotify

## Target users

Primary users are Spotify listeners, hobby DJs, and party playlist creators. Secondary users are
professional DJs, music curators, and wedding or event DJs.

## Core user flow

1. Choose Spotify or the locally configured music library as an input source.
2. For Spotify, sign in with OAuth and see eligible owned or collaborative playlists.
3. For local music, select a folder, M3U, or M3U8 beneath the approved music root.
4. When a folder is selected as the music library, show each immediate subfolder as a selectable
   playlist candidate and import its tracks only after the user adds it.
5. Select one or multiple input playlists to form a working track pool.
6. Fetch Spotify or embedded local metadata while retaining source-playlist attribution.
7. When Spotify is a destination for local inputs, review local-file-to-catalog matches; keep
   ambiguous and unmatched tracks visible rather than guessing.
8. Select ReccoBeats catalog lookup or Essentia analysis and review expected requirements.
9. Resolve available features, including matched and unresolved track counts.
10. Choose a primary parameter, such as energy or danceability, and inspect its distribution.
11. Choose whether and how to split that distribution into basis playlists.
12. Optionally choose a subgroup parameter to form contiguous chunks inside each basis playlist.
13. Choose a sort parameter and direction for each playlist or for each subgroup.
14. Preview every proposed output as a full track list with its bin and subgroup boundaries.
15. Drag, pin, lock, add, remove, or regenerate tracks without violating locked boundaries.
16. Choose Apple Music, a DJ bundle, M3U8 files, portable MP3 folders, or Spotify as the delivery
    destination.
17. Review a complete dry run and compatibility report before any external music library changes.

## Track data

Basic metadata includes track, artist, album, artwork, duration, Spotify URI, explicit status, and
release year when available. Provider-neutral musical features include BPM, key, mode, energy,
danceability, valence, loudness, acousticness, instrumentalness, speechiness, liveness, and time
signature. Essentia-specific organization fields add arousal, aggressiveness, party probability,
relaxed probability, onset rate, beat strength, dynamic complexity, EBU R128 dynamic range,
brightness, spectral flux, and key strength. Optional enrichments include genre and
provider-specific popularity or familiarity signals.

Every non-Spotify value must retain provider provenance and must not be presented as Spotify data.
Feature fields are independently optional: unresolved tracks remain in the working set, and a
provider returning BPM does not imply that energy, valence, or any other descriptor is available.

### Musical-feature providers

V1 exposes two explicit provider choices rather than silently combining incompatible sources:

- **ReccoBeats** resolves catalog features from Spotify track IDs or ISRCs. The product reports
  partial coverage, retains misses, handles rate limits, and stores source provenance.
- **Essentia** analyzes only separately supplied audio that the user is authorized to use. Local
  paths are restricted to a configured analysis root. The product never downloads, captures, or
  analyzes Spotify streams.

Feature resolution is separate from playlist preview. Recalculating split, subgroup, or sort
settings reuses resolved values and must not trigger another provider request. Automatic fallback
between providers is out of scope until descriptor scales and conflict handling are defined.

Essentia's base extractor provides BPM, key/mode and key strength, native danceability, integrated
loudness, EBU R128 dynamic range, onset rate, beat strength, dynamic complexity,
spectral-centroid brightness, and spectral flux. Its danceability scale is not calibrated to
Spotify, and several native descriptors have raw unbounded scales. Model-backed arousal, valence,
aggressiveness, party, and relaxed fields remain nullable. They are populated only when the
TensorFlow-enabled Essentia package and complete, separately licensed model bundle are explicitly
configured. Desktop packages include and configure that complete bundle from first launch. Each
track's mood inference runs in a fresh supervised process so a TensorFlow crash or timeout cannot
take down the API or erase native descriptors already measured for the track.
Raw spectral energy is not Spotify energy, and arousal must remain explicitly labeled rather than
being substituted into the `energy` field. See the [feature map](essentia-feature-map.md).

### Analysis visibility and recovery

Long-running local analysis must expose the two real execution phases rather than appearing
frozen. The progress experience reports the current file, completed and total tracks, elapsed
time, estimated remaining time, and a compact per-track timing table. It distinguishes the
combined native decode/DSP extractor from the isolated TensorFlow mood worker. Beat, key, and
spectral work may be named as contents of the native phase, but the UI must not fabricate
individual substage timings when Essentia exposes only one combined extractor call.

Completed results are persisted after each small batch. The cache's instant path uses relative
path, size, modification time, and analysis-profile version. Newly written entries also retain a
content fingerprint so a renamed file inside the same playlist can reuse a prior analysis. The
cache never stores audio bytes or absolute paths, and a cache failure remains a warning rather
than hiding analyzed tracks.

## Organization model

The product uses a composable organization pipeline rather than asking the user to select one
opaque generation strategy.

```text
one or more inputs
  → combined working track pool
  → distribution analysis
  → optional split into basis playlists
  → optional contiguous subgroups inside each basis playlist
  → sort each smallest resulting scope
  → full track-list preview
  → confirmed export
```

### Input playlists

Users can select one or multiple source playlists. The selected tracks form a working pool for
analysis; the originals remain read-only. Every track retains its source-playlist attribution so
the preview can explain where it came from. Duplicate-track handling must be visible and
configurable before export rather than silently discarding or multiplying tracks.

A source may be a Spotify playlist, a local directory, or a portable M3U/M3U8 file. Local import
is restricted to a configured root, reads metadata before analysis, preserves playlist-file order,
and reports unsafe or unreadable entries. Spotify-to-local matching is separate and reviewable:
exact ISRC is preferred, followed by title + artist + duration, while remix/live/edit/remaster
qualifiers must prevent unsafe automatic matches.

The inverse local-to-Spotify workflow is also identity matching, not file upload. Spotify's Web API
cannot add a local audio file to a playlist. A local track can be included in a Spotify export only
after it has a reviewed Spotify catalog URI. Ambiguous and unmatched files stay visible in the dry
run and block confirmation until the user resolves them or explicitly excludes those positions.

### Distribution analysis

Before organizing tracks, users select a parameter such as energy, arousal, danceability, BPM,
onset rate, beat strength, dynamic complexity, dynamic range, brightness, spectral flux, key
strength, valence, aggressiveness, party, relaxed, release year, popularity, or another available
field. The workspace shows the actual distribution, missing-value count, range, and proposed bin
boundaries. Users can adjust the number of levels and their thresholds before applying the split.

V1 should support equal-width bins, equal-count levels, and manually adjusted thresholds where
the underlying parameter permits them. No split is applied merely by viewing a distribution.

### Split into basis playlists with a factor grid

A split partitions the working pool using between one and three selected factors. Each factor
has its own parameter and level count. Boundaries for every factor are calculated independently
against the same complete, deduplicated source pool; later factors are never recalculated inside
the outputs of earlier factors.

Tracks are assigned to Cartesian coordinates in the resulting full-factorial grid. For example,
three arousal levels and two danceability levels define `3 × 2 = 6` possible basis playlists:
Low Arousal × Low Danceability, Low Arousal × High Danceability, and the other four combinations.
Adding two valence levels would define `3 × 2 × 2 = 12` possible combinations. Three factors is
the maximum.

Only populated grid cells become proposed playlists, so empty combinations do not create empty
exports. The preview reports both the configured product and how many cells are populated. A
track missing any selected factor remains conserved in one playlist labeled **Factor data
unavailable** rather than being silently dropped. Each populated basis playlist can then
be subgrouped and sorted independently.

### Subgroup inside a playlist

A subgroup operation creates contiguous chunks inside a basis playlist using another selected
parameter and its distribution bins. It does **not** create additional output playlists and it
does **not** remove tracks: all tracks assigned to the basis playlist stay in that playlist.

The preview must show subgroup headers, ranges, track counts, and boundaries. Users can reorder
the subgroup sequence, but a subsequent sort cannot move tracks from one subgroup to another.

Example: inside the High Energy basis playlist, form Low, Medium, and High Danceability chunks.
Those chunks remain sections of one High Energy playlist.

### Scoped sorting

Sorting chooses the order of tracks at the smallest active scope:

- If no subgroups exist, sort the entire basis playlist.
- If subgroups exist, sort each subgroup independently.
- Never apply a global sort that moves tracks across subgroup boundaries.

Sort parameters can include BPM, Camelot/harmonic key, track or artist metadata, release year,
energy, arousal, danceability, onset rate, beat strength, dynamic complexity, dynamic range,
brightness, spectral flux, key strength, valence, aggressiveness, party, relaxed, or any other
available sortable field. The UI must make direction and special ordering semantics explicit; for
example, numeric ascending/descending differs from harmonic Camelot order.

### Worked example

1. Combine a Road Trip playlist and a Favorites playlist.
2. Inspect the combined energy distribution.
3. Build a factor grid with three Energy levels and two Valence levels, defining up to six basis
   playlists.
4. Within each populated basis playlist, subgroup tracks into four Danceability levels.
5. Sort tracks by ascending BPM inside each Danceability subgroup.
6. Preview every populated output track list. Each list contains four visible chunks, and every
   sort is constrained to its chunk.

## Presets and progression strategies

The original generation strategies remain useful as optional presets built on top of the
organization model. They must expose the split, subgroup, and sort choices they configure so the
user can understand and edit the result.

### Energy buckets

Generate separate Very Chill (0.0–0.2), Relaxed (0.2–0.4), Medium (0.4–0.6), High (0.6–0.8),
and Peak (0.8–1.0) basis playlists. Sort each basis playlist independently unless it contains
subgroups, in which case sort inside each subgroup.

### Energy progression

Create one playlist whose energy gradually rises. This suits workouts, road trips, and DJ warmups.

### Energy pyramid

Create a complete journey from low to medium to high to peak, then return to medium and low.

### BPM first

Group tracks into 10-BPM windows and sort by harmonic key within each window.

### Key first

Group tracks around the Camelot wheel and sort by BPM within each key.

### Energy → BPM → key preset

Split or subgroup by energy, then sort by BPM with harmonic key as a tie-breaker. The workspace
must show those operations explicitly instead of presenting them as an unexplained composite
sort.

## Preview workspace

The application never creates playlists immediately. Every proposed output playlist displays its
complete track list; summary-only playlist cards are insufficient. Rows show album art, track,
artist, source playlist, energy, BPM, key, danceability, valence, and a transition-flow score.
Users can switch the complete preview between comfortable two-line rows and compact single-line
rows; the selected density applies to every output playlist and persists across app relaunches.
For local-library tracks, each row also offers an on-demand play/pause preview that reads no audio
until the user presses Play. Only one preview plays at a time, and a per-track decode or file error
does not interrupt the rest of the workspace. Users can drag, pin, lock, remove, add, and
regenerate tracks.

The workspace must keep these relationships visible:

- which source playlists contribute to the working pool;
- the selected distribution and bin boundaries;
- which basis playlist contains each track;
- subgroup headers and boundaries inside each basis playlist;
- which field and direction sort each playlist or subgroup; and
- tracks with missing values that require review.

Collapsed output playlists may show summary metrics, but a user must be able to expand and
inspect every row without navigating away. Manual moves across a split or subgroup boundary
require an explicit membership change; ordinary reordering remains scoped to the current group.

Summary metrics include average energy, energy distribution, average BPM, BPM distribution, key
distribution, danceability, genre, runtime, and song count. Visualizations include energy and BPM
timelines, harmonic distribution, and an energy-versus-BPM scatter plot.

## Smart constraints

Users can set maximum BPM and energy jumps, avoid adjacent artists or albums, exclude explicit
songs, and set a minimum spacing before an artist repeats. A later global solver will minimize
energy and BPM discontinuities, harmonic incompatibility, artist repetition, and genre switching
subject to those constraints.

Candidate solvers include beam search, simulated annealing, dynamic programming, genetic
algorithms, and traveling-salesperson heuristics. Evaluation must compare quality, determinism,
runtime, and explainability.

## Templates

Initial templates are Morning Coffee, Workout, Road Trip, House Party, Warm-Up DJ, Peak Hour DJ,
Cool Down, Sunset Drive, and Late Night. Each template preconfigures distribution, split,
subgroup, sort, weight, and constraint choices while leaving them visible and editable.

## Export

Outputs support five initial delivery targets:

- **Spotify catalog playlists:** connect through Authorization Code with PKCE using only the public
  client ID. A non-mutating review identifies exact, ambiguous, and unmatched local-to-catalog
  mappings. Every unresolved position must be matched or explicitly excluded before confirmation.
  After explicit confirmation, create new playlists that are private by default (or public only
  when explicitly selected), append reviewed catalog URIs in chunks of at most 100, and read them
  back to verify count and order. The Web API cannot add local files
  or create playlist folders, so playlist order is represented by zero-padded names such as
  `01 -`, `02 -`, and `03 -`. Per-playlist exclusions and API failures remain explicit; no partial
  export is reported as complete. Bind the exact confirmed plan to a UUID idempotency key so a
  concurrent or lost-response retry replays the first result instead of creating a duplicate
  batch. Support all 216 outputs available from the maximum three-factor, six-level grid, and
  truncate the numbered destination names deterministically to Spotify's 100-character limit.

- **Apple Music batch import:** a non-mutating dry run validates every ordered local path. After a
  second explicit confirmation, the native app creates a uniquely named Music folder and adds
  each output playlist sequentially. It never replaces existing Music data and reports accepted
  and rejected tracks per playlist, then compares the requested and resulting Music database-ID
  sequences to verify order. These playlists provide a convenient bridge into djay Pro.
- **DJ bundle:** one newly created folder contains a multi-playlist Rekordbox XML document,
  one UTF-8 M3U8 per output, a JSON manifest with every expected position and path, and a readable
  compatibility report. Unverified codecs remain represented and are surfaced as warnings;
  missing paths block the affected target instead of producing a silently incomplete export.
- **M3U8 folder:** each output references the existing audio in optimized order. Group labels are
  retained as M3U8 metadata, and no source audio is copied, moved, or modified.
- **Portable MP3 folders:** the app creates one new export root containing zero-padded, numbered
  playlist folders in recipe-output order. Each folder contains zero-padded, numbered MP3 files in
  canonical preview order. Every exported file receives explicit title, artist, album, and
  playlist-position tags from the preview. Existing MP3 audio is stream-copied without re-encoding;
  other supported local formats, including FLAC, Opus, and DFF/DSDIFF, are converted with the
  highest-quality LAME algorithm mode and a target of 320 kbps.
  The output uses the highest legal standard MP3 bitrate for the source sample-rate tier, up to
  320 kbps. Repeated entries remain repeated files. Source audio is never moved, renamed, replaced,
  retagged, or deleted.

At the 320 kbps ceiling, converted audio is approximately 2.4 MB per minute before metadata and
filesystem overhead. The app estimates this conservative upper bound and separately counts
stream-copied MP3s, whose existing sizes are not yet included in the estimate. A complete
total/free-space preflight remains release hardening. The interface states that transcoding is
lossy, that a high output bitrate cannot restore missing source detail, and that converting an
already-lossy format may add generation loss.

Portable export continues past independent per-track failures, retains successful outputs, and
writes a machine-readable manifest with every requested position and outcome. Any missing result
is labeled as a partial export. Every attempt uses a new uniquely named export root; earlier and
partial exports are never overwritten or merged. Bundled FFmpeg, free-space preflight,
incremental crash recovery, and cancellation are release-hardening follow-ups. See
[ADR 0007](decisions/0007-portable-mp3-folder-export.md).

Existing files and folders are never overwritten; name collisions receive a numbered name. The
canonical preview track array is the ordering authority for every target, while group boundaries
are annotations over that same sequence.

V1 defaults to creating a new private playlist and offers an explicit public visibility choice.
Append, collaborative, and explicit overwrite options may follow. Overwrite is always off by
default. Export requires a separate user confirmation and should be idempotent and recoverable.

Spotify-source playlist import remains follow-up scope. When implemented, discovery must use the
current `GET /me/playlists` endpoint and playlist contents must use
`GET /playlists/{playlist_id}/items`; only owned or collaborative playlist contents are eligible
under Spotify's February 2026 Development Mode behavior. The implemented catalog-delivery session
holds access and refresh tokens in API memory only, so a backend or desktop-app restart requires
reconnection. The browser development callback is exactly
`http://127.0.0.1:8000/api/v1/spotify/auth/callback`; the desktop sidecar callback is exactly
`http://127.0.0.1:8001/api/v1/spotify/auth/callback`. Before handing authorization to macOS, the
native shell rejects any request that does not contain the expected single-valued OAuth/PKCE query,
including `response_type=code`, the exact desktop callback, a valid client-ID shape, bounded
URL-safe `state` and code-challenge values, and `code_challenge_method=S256`. The callback and
sidecar-held one-time `state`, rather than URL shape alone, bind the response to the pending login.
New Development Mode apps require a Premium owner and are normally limited to five authorized
users. See
[ADR 0008](decisions/0008-spotify-catalog-playlist-delivery.md).

## Technology

- Frontend: React, TypeScript, Tailwind CSS
- Visualization: Recharts first; D3 for specialized visualizations
- Backend: FastAPI and Python
- Optimization: NumPy, SciPy, scikit-learn, and NetworkX as complexity requires
- Database: SQLite for lightweight local development; PostgreSQL for shared environments
- Spotify: Web API and OAuth 2.0 Authorization Code with PKCE
- Musical features: selectable ReccoBeats catalog lookup or optional Essentia local analysis

## Success metrics

- A 500-track playlist generates in under 10 seconds at p95 in the target environment.
- Multi-input analysis produces deterministic membership counts with no unexplained track loss.
- Every proposed output exposes a complete track list before export.
- Subgrouping retains all tracks in its basis playlist, and sorting preserves subgroup membership.
- Generated playlists need minimal manual adjustment.
- A user can save a confirmed optimized playlist in one export action.
- Users report strong perceived flow and return to optimize more playlists.
- No source playlist is modified without an explicit future overwrite flow.

## Future directions

Automatic DJ set generation, transition suggestions, richer genre and mood modeling, authorized
waveform analysis, Rekordbox and Serato integrations, cue sheets, missing-transition
recommendations, library-wide optimization, and collaborative optimization.

## Long-term vision

Become a playlist intelligence layer on top of streaming libraries. The product does not replace
Spotify's recommendation engine; it helps users reshape music they already chose into intentional
experiences for listening, travel, exercise, parties, and DJ-style sets.
