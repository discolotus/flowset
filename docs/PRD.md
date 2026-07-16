# Product Requirements Document: Spotify Playlist Optimizer

- Version: 0.2
- Author: Tanner (Concept)
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
- Retrieve available metadata and musical features from an approved source.
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

1. Sign in with Spotify OAuth.
2. See eligible owned or collaborative playlists.
3. Select one or multiple input playlists to form a working track pool.
4. Fetch metadata and available musical features while retaining source-playlist attribution.
5. Choose a primary parameter, such as energy or danceability, and inspect its distribution.
6. Choose whether and how to split that distribution into basis playlists.
7. Optionally choose a subgroup parameter to form contiguous chunks inside each basis playlist.
8. Choose a sort parameter and direction for each playlist or for each subgroup.
9. Preview every proposed output as a full track list with its bin and subgroup boundaries.
10. Drag, pin, lock, add, remove, or regenerate tracks without violating locked boundaries.
11. Confirm export to one or more new Spotify playlists.

## Track data

Basic metadata includes track, artist, album, artwork, duration, Spotify URI, explicit status, and
release year when available. Musical features include BPM, key, mode, energy, danceability,
valence, loudness, acousticness, instrumentalness, speechiness, liveness, and time signature.
Optional enrichments include genre and provider-specific popularity or familiarity signals.

Every non-Spotify value must retain provider provenance and must not be presented as Spotify data.

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

### Distribution analysis

Before organizing tracks, users select a parameter such as energy, danceability, BPM, valence,
release year, popularity, or another available field. The workspace shows the actual
distribution, missing-value count, range, and proposed bin boundaries. Users can adjust the
number of levels and their thresholds before applying the split.

V1 should support equal-width bins, equal-count levels, and manually adjusted thresholds where
the underlying parameter permits them. No split is applied merely by viewing a distribution.

### Split into basis playlists

A split partitions the working pool by the selected distribution levels. Each track is assigned
to one level and each non-empty level becomes a separate proposed basis playlist. Splitting is
the operation that increases the number of output playlists.

Example: split the combined energy distribution into Low, Medium, High, and Peak basis
playlists. Each basis playlist can then be subgrouped and sorted independently.

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
energy, danceability, valence, or any other available sortable field. The UI must make direction
and special ordering semantics explicit; for example, numeric ascending/descending differs from
harmonic Camelot order.

### Worked example

1. Combine a Road Trip playlist and a Favorites playlist.
2. Inspect the combined energy distribution.
3. Split it into three equal-count basis playlists: Low, Medium, and High Energy.
4. Within each basis playlist, subgroup tracks into four danceability levels.
5. Sort tracks by ascending BPM inside each danceability subgroup.
6. Preview three complete output track lists. Each list contains four visible chunks, and every
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
Users can drag, pin, lock, remove, add, and regenerate tracks.

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

V1 defaults to creating a new private playlist. Append, public, collaborative, and explicit
overwrite options may follow. Overwrite is always off by default. Export requires a separate user
confirmation and should be idempotent and recoverable.

## Technology

- Frontend: React, TypeScript, Tailwind CSS
- Visualization: Recharts first; D3 for specialized visualizations
- Backend: FastAPI and Python
- Optimization: NumPy, SciPy, scikit-learn, and NetworkX as complexity requires
- Database: SQLite for lightweight local development; PostgreSQL for shared environments
- Spotify: Web API and OAuth 2.0 Authorization Code with PKCE

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
