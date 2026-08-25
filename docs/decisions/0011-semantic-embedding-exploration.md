# 0011: Keep embedding neighborhoods and clusters exploratory

Status: accepted

Persistence amendment: ADR 0012 adds API-owned durable semantic artifacts. Raw vectors remain
excluded from browser storage, workspace state, exports, and automatic recipe mutation.

## Context

MuQ-MuLan and MERT expose bounded local embeddings, but raw vectors are not meaningful to users
without neighborhood and projection tools. Clusters can suggest musically coherent regions, yet
silently converting a statistical cluster into a basis playlist would bypass Flowset's explicit
`sources → split → subgroup → scoped sort` organization model.

## Decision

- The Semantic Lab may hold one embedding response in component memory for the active selected
  subset. Changing the subset or backend invalidates the view. Raw vectors do not enter track,
  workspace, browser-storage, export, or Spotify payloads.
- Analysis is bounded to 100 complete vectors from one backend model, representation, and
  dimension. The typed acquisition client already rejects mixed embedding spaces.
- Nearest neighbors use cosine similarity with stable track-ID tie breaking.
- The two-dimensional map uses deterministic kernel PCA over the centered embedding Gram matrix,
  fixed iteration counts, and canonical eigenvector signs.
- Clusters use deterministic farthest-first initialization and k-means over L2-normalized vectors.
  The requested count is bounded to six; empty or indistinguishable clusters remain visibly
  unpopulated rather than being fabricated.
- Model revision, representation, dimension, algorithm configuration, cache hits/misses, complete
  coverage, and per-track failures remain visible in the explorer.
- Map selection changes only the reference used by the neighbor inspector. Changing cluster count,
  projection controls, or reference selection does not rerun model inference.
- Cluster membership is exploratory. It is not a split, subgroup, sort key, semantic score, or
  recipe mutation, and this initial slice exposes no cluster promotion action.

## Consequences

The browser can inspect cached acoustic neighborhoods without another backend contract or a
persistence migration. A later centroid/prototype-similarity feature may derive a scalar score,
but promotion must remain a separate explicit action with formula and model provenance. Direct
cluster-to-playlist organization requires its own product strategy and cannot be inferred from
this visualization.
