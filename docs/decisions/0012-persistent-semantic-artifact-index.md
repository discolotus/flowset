# 0012: Persist semantic artifacts in a model-bound local index

Status: accepted

## Context

CLAP, MuQ-MuLan, and MERT inference is expensive compared with cosine comparison. The original
embedding cache was a bounded process-local LRU, so application restart, another playlist, or a
second experiment repeated model inference. ADR 0011 correctly kept raw vectors out of browser
storage, workspace state, playlist files, and exports, but did not provide an API-owned durable
artifact boundary.

The same audio may appear at several root-relative locations. Files can also be renamed without
changing their content. Cached output must never cross a model checkpoint, representation,
preprocessing, or segment-policy boundary.

## Decision

- Keep the bounded in-memory cache as L1 and add an API-owned SQLite artifact store as L2.
- Store no audio and no absolute audio paths. Library roots are represented by a one-way identity;
  file locations remain root-relative.
- Resolve an unchanged location through root identity, relative path, size, and nanosecond mtime.
  Hash new or changed files with SHA-256 so identical content and renamed files share artifacts.
- Define an embedding space from backend, checkpoint-derived model identity, representation,
  preprocessing version, segment policy, and vector dimension. Incompatible spaces never mix.
- Store float32 vectors as compact SQLite BLOBs. Raw vectors remain available through the explicit
  loopback embedding response but excluded from browser storage, workspace persistence, playlist
  output, Spotify payloads, and remote services.
- Use the `sqlite-vec` extension and a cosine `vec0` virtual table per compatible embedding space.
  If the extension cannot load, exact Python cosine search remains available and the API reports
  the active search engine.
- Expose cached-library neighbor search only through the loopback API. SQLite is the source of
  truth; any future approximate index is rebuildable derived state.
- Expose loopback-only inventory and prune operations. Inventory reports model-bound spaces and
  timestamps. Pruning can filter by backend, model, representation, preprocessing, segment policy,
  creation time, or last-access time. It is dry-run by default; mutation requires an explicit flag
  plus a token binding the exact filters and matching embedding IDs. Clearing all spaces requires
  a separate selector, and a changed cache invalidates an earlier preview.
- Configure the database with `SEMANTIC_CACHE_PATH`. The default is Flowset's user Application
  Support directory on macOS. Set it to a location on an external volume when a portable index is
  desired.
- CLAP joins MuQ-MuLan and MERT as an embedding backend. Its existing prompt-ranking behavior
  remains available and reuses persisted audio embeddings; cached-library neighbor search accepts
  any embedding backend.

## Consequences

Model inference is reused across application restarts, playlist overlap, prompt changes, and file
renames. A checkpoint, representation, preprocessing, or segment-policy change creates a separate
space without deleting older results. The first encounter with new or changed content performs a
full-file hash; unchanged locations take the metadata fast path.

`sqlite-vec` is pre-1.0 and loadable SQLite extensions are not supported by every macOS Python
build. Packaging therefore includes the extension, tests exercise its KNN path, and runtime
correctness does not depend on it loading successfully.

This decision provides artifact persistence and exact vector retrieval. Resumable whole-library
job scheduling, pause/resume UI, explicit multi-segment extraction, and optional ANN indexes remain
separate implementation slices.

Model/date pruning deletes derived vectors, empty vector spaces, and optionally unreferenced
location metadata. It clears process-local L1 values after a committed deletion so removed rows
cannot remain usable until restart. Compaction is explicit because `VACUUM` can be comparatively
expensive on a large external-volume database.
