# ADR 0006: Music and DJ delivery targets

- Status: Accepted
- Date: 2026-07-19

## Context

One-file M3U8 export works, but repeated exports can have ambiguous numbered filenames and target
applications do not display subgroup metadata consistently. Apple Music is a useful bridge to
djay Pro, while Rekordbox can consume either playlist files or its collection XML format. No
target should silently omit a track whose path or codec it cannot handle.

## Decision

Sequence uses `RecipeOutput.tracks` as the one canonical ordered sequence for every export.
Subgroup ranges annotate that sequence but never reconstruct it.

The Mac app provides:

1. A filesystem-only Apple Music import plan. A second explicit action creates one uniquely named
   folder and child playlists through Music's local automation dictionary. Tracks are added one at
   a time in canonical order. The importer captures each added track's Music database ID, reads the
   completed playlist IDs back, and reports whether the sequences match. Existing Music playlists
   are never deleted, renamed, or replaced.
2. A DJ bundle containing ordered M3U8 files, a multi-playlist Rekordbox XML file, a JSON manifest,
   and a text compatibility report. Each playlist position remains visible in the manifest.
3. The existing single and batch M3U8 paths as a portable fallback.
4. A separate opt-in portable MP3-folder workflow whose numbered hierarchy carries playlist and
   track order into filename-sorted tools. Its copy/transcode, recovery, and packaging contract is
   defined in [ADR 0007](0007-portable-mp3-folder-export.md).

Missing or non-local paths are blocking because an export would otherwise be incomplete.
Extensions absent from a target's published compatibility list are warnings: they remain in the
playlist/XML, and the target application decides whether it can load them. This reflects the
observed reality that installed app versions can accept more formats than their current manuals
enumerate.

## Consequences

- Apple Music library mutation is always preceded by a dry run and confirmation.
- A live Music import returns per-playlist accepted and rejected counts plus explicit order
  verification; missing IDs or mismatches are warnings rather than silent success.
- DJ bundles are written into a new numbered folder and never overwrite earlier exports.
- Rekordbox and djay compatibility can be audited without comparing opaque library databases.
- Audio transcoding is never implicit in these three path-referencing/library-mutation targets.
  The explicit portable-MP3 destination uses the separately reviewed contract in ADR 0007 and
  preserves all originals.
