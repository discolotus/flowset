# ADR 0009: Flowset product identity with stable compatibility identifiers

- Status: Accepted
- Date: 2026-08-03

## Decision

The user-facing product name is **Flowset**. The macOS bundle, window title, web title, API title,
export defaults, release notes, documentation, Homebrew display name, and app icon use Flowset.

The selected icon's committed canonical master is `src-tauri/icons/source/flowset-master.png`.
Every native icon size is generated from that exact file. The previous Sequence icon master remains
available under `src-tauri/icons/alternatives/`.

## Compatibility boundary

The following identifiers intentionally retain their pre-rebrand values:

- bundle identifier: `com.discolotus.playlist-optimizer`;
- repository URL: `discolotus/spotify-playlist-optimizer`;
- native binary, sidecar, Rust crate, Python package, and npm workspace identifiers;
- API health service identifier: `playlist-optimizer-api`;
- analysis cache directory: `.sequence`;
- native workspace-state filename: `sequence-workspace.json`;
- browser storage keys and export schema/placeholder identifiers;
- legacy `SEQUENCE_FFMPEG_PATH` and `PLAYLIST_OPTIMIZER_FFMPEG_PATH` environment aliases.

Flowset adds `FLOWSET_FFMPEG_PATH` as the preferred visible override without invalidating either
legacy alias.

The Homebrew cask token and filename are the one exception. They moved to `flowset` /
`flowset.rb`, because Homebrew already carries a supported rename path: the tap's
`cask_renames.json` maps `playlist-optimizer` onto `flowset`, which populates the cask's
`old_tokens` and migrates an existing Caskroom directory on the next `brew upgrade`. The install
command users are told is therefore `brew install --cask flowset`. Every other identifier above
stays frozen, because none of them has an equivalent supported migration.

## Consequences

Existing Homebrew users are migrated to the renamed cask by `brew upgrade` without reinstalling,
macOS continues resolving the app to the same permissions and app-data directory, saved recipes and
folder history remain readable, and existing analysis caches and export consumers do not require
migration. New release artifacts and the
installed application are named `Flowset`, while the stable installation channel remains intact.
