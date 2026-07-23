# ADR 0004: Treat local folders and M3U files as playlist inputs

- Status: Accepted
- Date: 2026-07-16

## Context

Essentia requires audio files that the user is authorized to analyze. A Spotify playlist supplies
identities but not audio, while this product may run beside a local DJ/music library containing
folders, M3U files, and overlapping copies of Spotify tracks.

The external test library contains valid folder crates and relative-path M3U playlists. Apple
Music's opaque database is not a suitable first integration, and some older DJ M3U8 files contain
stale absolute paths.

## Decision

Make a directory, `.m3u`, or `.m3u8` file beneath `ESSENTIA_AUDIO_ROOT` importable as an
`InputPlaylist` through `POST /api/v1/local-library/import`.

Local import is metadata-only and returns a track-ID-to-relative-path map. Essentia resolution is
a separate operation so discovery stays fast and repeated playlist organization can reuse cached
analysis later.

Security and data-integrity rules:

- The configured music root is the only readable namespace.
- Client source paths are relative to that root.
- Playlist entries and symlinks that resolve outside the root are rejected.
- Incomplete and unsupported files are skipped with explicit reasons.
- M3U order is preserved; duplicate file entries are reported rather than silently reanalyzed.
- Track metadata comes from embedded tags with filename/folder fallbacks.
- Stable local IDs are derived from root-relative paths; absolute paths are never returned.
- Local-library and Essentia routes accept loopback clients only until authenticated ownership
  exists.
- The frontend sends small Essentia batches and exposes live progress for the combined native DSP
  extractor and TensorFlow mood inference. It does not invent timing for internal extractor steps
  that Essentia does not report separately.

## Spotify-to-local matching

Matching is a second, reviewable workflow rather than part of folder import:

```text
Spotify playlist metadata
  → rank local candidates
  → review ambiguous or version-conflicting matches
  → confirm Spotify-track → local-file map
  → analyze confirmed files with Essentia
```

Automatic matches should prefer exact ISRC, then normalized title + artist + close duration.
Remix, extended, edit, live, and remaster qualifiers are identity-critical. Fuzzy matches require
a confidence margin over the runner-up and must expose their evidence to the user.

## Consequences

- A local folder or portable playlist can replace Spotify as an input source immediately.
- A local-only track cannot be exported to Spotify until a Spotify catalog identity is confirmed.
  The Web API cannot upload or add the local audio file itself; only the reviewed catalog URI is
  eligible for playlist creation.
- This workflow requires a locally running API or a future desktop/file-access bridge; a hosted
  web server cannot directly read the user's mounted drive.
- Essentia analysis is cached by file metadata and analyzer/profile provenance, with a content
  fingerprint fallback for files renamed inside the same playlist.
- Future domain work should separate internal track ID, Spotify ID, and local audio reference.

## Initial cache implementation

Completed Essentia batches are persisted in `.sequence/analysis-cache.json` inside a directory
playlist, or beside an imported M3U/M3U8 file. The cache contains no audio and no absolute paths.
Entries use the root-relative audio path plus file size, nanosecond modification time, analyzer
provenance, a pinned analysis-profile version, and—on new writes—a SHA-256 content fingerprint.
An exact path/size/mtime match remains the instant path and does not reread the audio file. When
that metadata no longer matches, same-size candidates in the playlist cache are fingerprinted so
a renamed or moved file can still reuse its measurements. A successful content match writes a new
path entry with corrected provenance, so later imports return to the instant metadata path. The
metadata shortcut deliberately trades detection of a same-size, same-mtime content replacement for
fast library startup. Same-size files with different content are otherwise rejected, and legacy
entries without a fingerprint retain their exact-metadata fast path. A file changed during analysis
is returned to the current session but is not cached.

Only analyses containing the complete TensorFlow mood set are stored under the full-model profile;
native-only results remain available for the current session and are retried later. Writes reload
and merge the existing document under a macOS/Linux filesystem lock, write a temporary file in the
same directory, flush it, and atomically replace the prior cache. This prevents two local app
instances from losing one another's entries. A corrupt, stale, unsafe, or unwritable cache degrades
to a warning without hiding tracks or discarding successful analysis.
The frontend retains every playlist cache directory for overlapping tracks, commits completed
five-track batches immediately, and skips measurements already restored for the selected provider.

While a batch runs, a short-lived in-memory progress record reports the current track, completed
count, elapsed time, estimated remaining time, and per-track timings. The only timed stages are the
two actual boundaries available to the application: native decode/DSP and the isolated TensorFlow
mood worker. Progress identifiers are client-generated opaque tokens, retained briefly after a run,
and do not expose file paths. Cache hashing is reported as an indeterminate finalization phase rather
than a completed bar with a zero-second estimate, and an over-average track drops its ETA instead of
displaying a misleading zero.

## Initial evidence

The importer loaded all 13 tracks from `Minimalism Vol. 14` on External4TB in M3U order with
embedded title, artist, album, and duration metadata and no skipped entries. The Essentia endpoint
then analyzed a three-track sample completely in 67.9 seconds. See the
[evaluation](../essentia-evaluation.md).
