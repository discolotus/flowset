# Changelog

## [0.2.0-preview.16] - 2026-08-26

- Persist CLAP, MuQ-MuLan, and MERT embeddings in a content-addressed, model-bound SQLite index
  that survives restarts and accelerates compatible cosine searches with sqlite-vec.
- Add loopback-only cache inventory, neighbor search, and preview-confirm pruning controls with
  backend, model, representation, preprocessing, segment-policy, and timestamp filters.
- Preserve explicit MERT representation identity from requests through persisted Semantic Lab
  runs so incompatible embeddings and reference scores cannot silently mix.

## [0.2.0-preview.15] - 2026-08-25

- Ship CLAP, MuQ-MuLan, and MERT runtime support in the macOS sidecar and add an explicit-consent
  desktop installer for their pinned, checksum-verified model assets.
- Store semantic checkpoints under Flowset's Application Support directory, keep partial downloads
  unavailable, and activate the models only after all three pass real generated-audio inference.
- Preserve the non-commercial-weight and trusted MERT code gates while making Semantic Lab setup
  actionable from the deployed desktop app.

## [0.2.0-preview.14] - 2026-08-22

- Migrate browser and native workspace history to a bounded schema v2 that restores recent
  Semantic Lab scalar runs without storing embeddings, audio material, paths, or secrets.
- Keep playlist selection and customized recipe state intact while moving between Builder and Lab,
  and allow older persisted runs to be selected for inspection.

## [0.2.0-preview.13] - 2026-08-22

- Compare two completed scalar Semantic Lab runs without rerunning inference, with deterministic
  rank correlation, score coverage, and stable agreement/disagreement inspection.
- Pin left and right score columns, audition authorized local tracks, and explicitly promote a
  selected winner while preserving both source runs.

## [0.2.0-preview.12] - 2026-08-22

- Add a bounded cached-embedding explorer with deterministic cosine neighbors, PCA coordinates,
  and normalized-vector clusters.
- Keep model provenance, algorithm configuration, cache coverage, and failed tracks visible while
  ensuring exploratory clusters never mutate recipes or become playlist splits.

## [0.2.0-preview.11] - 2026-08-22

- Add per-score coverage, range, histogram, and low-separation diagnostics to Semantic Lab.
- Derive explicit positive-minus-negative contrast scores with typed Flowset provenance.
- Promote selected raw or derived scores through the same guarded recipe scopes.

## [0.2.0-preview.10] - 2026-08-22

- Add a searchable MERT reference-track explorer with readable metadata, authorized local preview,
  nearest-neighbor inspection, and explicit promotion into recipe scopes.
- Bind MERT similarity scores to the fixed model, layer, pooling, and whole-track representation
  identity so future representation controls cannot silently mix incompatible results.

## [0.2.0-preview.9] - 2026-08-22

- Add bounded, model- and representation-aware in-memory embedding reuse with visible per-track
  cache and failure diagnostics.
- Add typed, chunked frontend embedding acquisition that rejects incompatible model spaces while
  keeping raw vectors out of persisted workspace and track data.

## [0.2.0-preview.8] - 2026-08-22

- Add a bounded multi-prompt composer and accessible track-by-prompt Semantic Lab score matrix.
- Keep matrix exploration isolated from recipes and promote only the explicitly selected raw score.
- Bind every returned semantic score to a requested normalized prompt, backend, and model revision.

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
