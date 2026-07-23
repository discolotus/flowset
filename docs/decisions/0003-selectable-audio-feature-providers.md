# ADR 0003: Make audio-feature providers explicit and selectable

- Status: Accepted
- Date: 2026-07-16

## Context

Spotify playlist metadata remains useful, but new Spotify applications cannot request the Audio
Features or Audio Analysis endpoints. The product needs a concrete way to enrich Spotify track
identities without implying that externally produced values came from Spotify.

ReccoBeats offers catalog lookup using Spotify track IDs or ISRCs. Essentia can analyze audio
files that the user is authorized to supply. They have different inputs, coverage, descriptors,
scales, operational risks, and licensing considerations, so they cannot be hidden behind an
undisclosed automatic substitution.

## Decision

Expose `reccobeats` and `essentia` as explicit audio-feature provider choices behind a common
provider registry and resolution response.

Feature resolution is a separate step before recipe preview. The optimization domain continues
to consume provider-neutral tracks and does not make external requests while recalculating a
split, subgroup, or sort.

Every resolved track retains provider provenance. Individual descriptors are nullable because a
provider may legitimately return BPM and key without returning valence or time signature. Missing
values remain unavailable; the system does not manufacture defaults.

### ReccoBeats

- Resolve Spotify IDs in batches of no more than 40.
- Reconcile out-of-order responses using the Spotify ID in each returned `href`.
- Retain omitted/unmatched tracks and report coverage.
- Cache successful results when persistence is added.
- Retry a limited number of `429` responses using `Retry-After`.

### Essentia

- Analyze only separately supplied, user-authorized audio.
- Never download, capture, or analyze Spotify audio.
- Load the optional Essentia dependency lazily.
- Restrict file resolution to relative paths beneath a configured `ESSENTIA_AUDIO_ROOT`.
- Return only descriptors the configured extractor actually produced.
- Expose native descriptor names and units without pretending raw scores are percentages.
- Reserve nullable 0–1 fields for model-backed arousal, valence, aggressiveness, party, and
  relaxed scores. Populate them only when the TensorFlow-enabled package and complete,
  separately licensed model bundle are explicitly configured.
- Run configured TensorFlow mood inference in a fresh supervised process for every track. Kill and
  reap workers after their result or timeout, and retain native descriptors when a worker fails.
- Never place raw spectral energy or arousal in the Spotify-shaped `energy` field.

## Consequences

- The UI can disclose provider requirements and availability before analysis.
- A playlist can retain unresolved tracks without falsely assigning values to them.
- Scores from different providers remain distinguishable and should not be compared as if their
  absolute scales were identical.
- ReccoBeats coverage must be measured on representative libraries before it is treated as a
  primary product dependency.
- Automatic provider fallback is deferred. A future fallback chain must remain visible and define
  how provider-specific scales are normalized before combining results.

## Initial evidence

The first ReccoBeats evaluation matched 47 of 90 unique tracks in the supplied `Set June 26`
playlist. See [the evaluation](../reccobeats-evaluation.md).

## References

- <https://reccobeats.com/docs/documentation/request-and-response>
- <https://reccobeats.com/docs/documentation/rate-limiting>
- <https://essentia.upf.edu/tutorial_extractors_musicextractor.html>
- <https://developer.spotify.com/policy>
