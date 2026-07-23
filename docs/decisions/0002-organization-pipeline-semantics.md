# ADR 0002: Use explicit split, subgroup, and scoped-sort semantics

- Status: Accepted
- Date: 2026-07-16

## Context

Playlist organization can mean several materially different operations: combining input
playlists, dividing tracks into separate outputs, arranging all tracks into chunks within one
playlist, or ordering tracks. A strategy label such as "Energy → BPM → key" hides those
differences and makes it difficult for a user to predict how many playlists will be created or
whether a track can cross a group boundary.

The preview also cannot be evaluated from aggregate statistics alone. Users need to inspect the
actual membership and order of every proposed playlist before export.

## Decision

The product models organization as an ordered pipeline:

1. Select one or multiple input playlists and form a working track pool.
2. Inspect the distribution of a selected parameter.
3. Optionally split the pool into separate basis playlists using a full-factorial grid of one to
   three independently binned parameters.
4. Optionally subgroup each basis playlist into contiguous chunks using another parameter.
5. Sort within the smallest active scope.
6. Preview complete track lists before a separate export action.

The following terms are invariants:

- **Split** partitions tracks into separate proposed output playlists. With multiple factors,
  every factor is binned over the same full source pool and tracks are assigned by their Cartesian
  coordinate; factors are not applied as nested, conditional splits.
- **Basis playlist** is an output of the split stage, or the unsplit working playlist when the
  split stage is skipped.
- **Subgroup** is a contiguous section inside a basis playlist. It retains all tracks in that
  playlist and does not create another output playlist.
- **Scoped sort** orders tracks within a basis playlist when no subgroups exist, or independently
  inside each subgroup when they do. It never moves tracks across subgroup boundaries.
- **Preview** includes the full track list for every proposed output, not only aggregate cards or
  charts.

Presets may configure these stages, but must expose their configuration and resulting boundaries
to the user.

## Consequences

- The UI can explain both output count and track placement before optimization runs.
- The configured factor product, populated-cell count, and empty-cell count remain distinct; only
  populated cells become exportable basis playlists.
- Split membership, subgroup membership, and position are separate pieces of state.
- Reordering within a subgroup is different from explicitly moving a track between groups.
- Statistics and visualizations supplement the track-list preview rather than replacing it.
- The API and persistence model will need stable identifiers for working sets, basis playlists,
  subgroups, and track memberships.
- Tests must assert a maximum of three split factors, global factor boundaries, deterministic
  Cartesian membership, track conservation, and preservation of group boundaries during sorting.

## Related decision

Musical-feature availability and provenance remain governed by
[ADR 0001](0001-audio-feature-provider.md). The organization pipeline may only use fields that
are available from an approved provider and must surface missing values rather than invent them.
