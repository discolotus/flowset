# Changelog

## [0.2.0-preview.7] - 2026-08-21

- Add a dedicated Semantic Lab workspace while preserving Playlist Builder state across navigation.
- Run bounded, authorized semantic experiments with immutable session history, sortable results,
  backend provenance, visible partial failures, and explicit promotion into recipe scopes.

## [0.2.0-preview.6] - 2026-08-21

- Add local CLAP and MuQ-MuLan text-to-music ranking with independently selectable recipe scopes.
- Add bounded MuQ-MuLan and MERT embedding experiments, including MERT reference-track similarity.
- Keep semantic analysis local, model-provenanced, explicitly configured, and offline-only.

## [0.2.0-preview.4] - 2026-08-06

- Add recursive `.m3u` and `.m3u8` discovery beneath a user-selected parent folder and feed
  imported playlist files into the existing multi-playlist analysis workflow.
- Keep discovery root-relative and read-only, ignore hidden and symlinked entries, and prevent
  stale searches from replacing results for a newer folder choice.

## [0.2.0-preview.3] - 2026-08-03

- Simplify the workspace by removing the duplicate export action and moving secondary controls
  into contextual or collapsed surfaces.
- Make export destination selection progressive and add complete modal keyboard, focus,
  backdrop, and scroll-lock behavior.
- Add App-level behavioral coverage for recipe construction and persistence, every export
  destination, responsive behavior, and a durable feature utility evidence matrix.

## [0.2.0-preview.2] - 2026-08-03

- Rename the user-facing application to Flowset and ship the selected Flowset icon while retaining
  the existing bundle ID, Homebrew token, saved state, caches, and integration identifiers.
- Add reusable recipes, recent-library history, independent workspace scrolling, parameter
  explanations, and a focused export dialog.
- Add opt-in Rekordbox-compatible FLAC or MP3 conversion for unsupported local formats.
- Expand real-process, packaged-sidecar, and FFmpeg smoke coverage.
- Install the Rust formatting and lint components required by the shared release runner.

## [0.2.0-preview.1] - 2026-08-03

- Rename the user-facing application to Flowset and ship the selected Flowset icon while retaining
  the existing bundle ID, Homebrew token, saved state, caches, and integration identifiers.
- Add reusable recipes, recent-library history, independent workspace scrolling, parameter
  explanations, and a focused export dialog.
- Add opt-in Rekordbox-compatible FLAC or MP3 conversion for unsupported local formats.
- Expand real-process, packaged-sidecar, and FFmpeg smoke coverage.

## [0.1.0-preview.2] - 2026-07-30

- Pin preview packaging to Python 3.12 and publish the existing unsigned Apple-silicon preview.
