# Product Requirements Document: Spotify Playlist Optimizer

- Version: 0.1
- Author: Tanner (Concept)
- Status: Draft

## Vision

Create a web application that analyzes playlists using musical features and automatically
generates optimized playlists for DJing, listening, and music discovery.

Rather than simply sorting songs alphabetically or by BPM, the application should intelligently
organize tracks according to energy, tempo, key, danceability, valence, and genre. Users can
preview and customize every result before writing a new playlist to Spotify.

The goal is to reduce the manual effort required to organize large music libraries into coherent
playlists with smooth musical progression.

## Problem

Spotify playlists often become collections of songs rather than thoughtfully organized listening
experiences. Users cannot easily organize them by energy, create DJ-friendly levels, arrange them
harmonically, maintain a smooth tempo progression, compare ordering strategies, or generate
multiple playlists from one source. These workflows are currently manual or require professional
DJ software.

## Goals

- Connect securely to Spotify.
- Read playlists owned or collaboratively managed by the user.
- Retrieve available metadata and musical features from an approved source.
- Analyze musical similarity and generate optimized orderings.
- Support interactive preview and manual adjustment.
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
3. Select a source playlist.
4. Fetch metadata and available features.
5. Select an optimization strategy and constraints.
6. Preview the proposed ordering and statistics.
7. Drag, pin, lock, add, remove, or regenerate tracks.
8. Confirm export to one or more new Spotify playlists.

## Track data

Basic metadata includes track, artist, album, artwork, duration, Spotify URI, explicit status, and
release year when available. Musical features include BPM, key, mode, energy, danceability,
valence, loudness, acousticness, instrumentalness, speechiness, liveness, and time signature.
Optional enrichments include genre and provider-specific popularity or familiarity signals.

Every non-Spotify value must retain provider provenance and must not be presented as Spotify data.

## Generation strategies

### Energy buckets

Generate separate Very Chill (0.0–0.2), Relaxed (0.2–0.4), Medium (0.4–0.6), High (0.6–0.8),
and Peak (0.8–1.0) playlists. Sort each bucket independently.

### Energy progression

Create one playlist whose energy gradually rises. This suits workouts, road trips, and DJ warmups.

### Energy pyramid

Create a complete journey from low to medium to high to peak, then return to medium and low.

### BPM first

Group tracks into 10-BPM windows and sort by harmonic key within each window.

### Key first

Group tracks around the Camelot wheel and sort by BPM within each key.

### Energy → BPM → key

Use energy as the primary dimension, BPM as the secondary dimension, and key as the tertiary
dimension. This is the initial default.

## Preview workspace

The application never creates playlists immediately. Preview rows show album art, track, artist,
energy, BPM, key, danceability, valence, and a transition-flow score. Users can drag, pin, lock,
remove, add, and regenerate tracks.

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
Cool Down, Sunset Drive, and Late Night. Each template adjusts strategy weights and constraints.

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
