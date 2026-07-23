# ADR 0001: Decouple musical features from Spotify metadata

- Status: Accepted
- Date: 2026-07-16

## Context

The product depends on tempo, key, energy, danceability, valence, loudness, and related values.
Spotify's November 2024 platform change removed Audio Features and Audio Analysis access for
new Web API use cases and development-mode apps. Spotify's February 2026 development-mode
changes further reduced available endpoints and fields.

Building the domain model directly around a Spotify audio-features response would make the
product impossible to run for most new app registrations and would hide a material product risk.

## Decision

The optimization core consumes a provider-neutral `AudioFeatures` model. Spotify integration is
responsible for identity, owned/collaborative playlist metadata, and eventual playlist export.
Musical features enter through a separate provider adapter.

The first milestone began with fictional, checked-in fixture data. Production work must choose
one of:

1. Verify that the developer already has a qualifying legacy extended-quota Spotify app.
2. Contract with a lawful music-analysis/catalog provider whose identifiers can be reconciled.
3. Run analysis only on audio the user is authorized to supply, without downloading Spotify audio.
4. Reduce the product scope to metadata-only ordering if no compliant feature source exists.

## Consequences

- Optimizer and preview work can proceed before provider procurement.
- The UI must disclose the source and availability of features.
- Track identity reconciliation becomes a first-class integration concern.
- Spotify OAuth alone does not make the core PRD feasible.
- Feature values should retain provenance, confidence, and provider version when persistence lands.

ADR 0003 implements this boundary with explicit ReccoBeats and Essentia options. Demo fixtures
remain available for UI development but are labeled as fixtures and never passed off as provider
results.

## References

- <https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api>
- <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- [ADR 0003: Make audio-feature providers explicit and selectable](0003-selectable-audio-feature-providers.md)
