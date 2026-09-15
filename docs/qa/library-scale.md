# Large-library search QA — 2026-09-06

## Changes

- CLAP and MuQ-MuLan text ranking and MERT reference ranking share sequential batches of at most five tracks. Reference requests reserve one slot for the same reference song.
- Discovery and Semantic Lab use the same queue. Stop invalidates results and prevents subsequent batches. A stopped in-flight request finishes before another queued ranking starts.
- The local API rejects concurrent inference requests with HTTP 429 across text ranking, reference ranking, embedding extraction, cached neighbor search, and audio feature resolution. Health and metadata remain available. The guard releases even after failure. This is a single-process guard, matching the local app deployment.
- Model identity, score keys, and representation must remain consistent across merged batches. Request errors fail visibly; incomplete batch aggregates are never presented as complete. Completed embeddings remain reusable through the existing persistent cache.
- Discovery, reference picker, neighbor results, and prompt matrix use pages of 50 rows. Every result remains inspectable. Applying a ranking includes the complete result, not just the visible page.
- Semantic history accepts 5,000-track runs (previously silently rejected above 200). Browser quota failures are surfaced; results remain in the active session.

## Verification

- Deterministic 5,000-song scheduling test: 1,000 bounded text requests, maximum concurrency one, 5,000 unique results. This is a simulated provider test, not 5,000 real audio inferences.
- Cancellation/restart test verifies no overlapping inference and no stale result publication. Mismatched model scores, failed later batches, full-membership pagination, 5,000-track history normalization, and storage exhaustion tested.
- Real browser: restored the same 12 External4TB source folders, 707 unique tracks.
- CLAP and MuQ-MuLan each advanced to batch 3 (10 real candidates completed), then were stopped through the UI. No complete 707-track text ranking is claimed.
- MERT completed all 177 batches: 707/707 scored against Adrian Hour's IWANNA (6:33). Existing cached embeddings may be reused. Results showed the reference at 1.000; all four IWANNA copies near the top.
- Browser confirmed 50 result audio elements, navigation to rows 51–100 and back. Complete MERT matches left open; no ranking promoted or export performed.

## Practical boundaries

Playlist previews and saved semantic runs remain capped at 5,000 tracks. The embedding projection/clustering map remains a bounded subset tool (normally 100 tracks), separate from full-pool ranking. Cold model analysis can be slow; the queue does not continue after closing the browser, but cached audio analysis survives when persistent caching is configured. A bad request stops with an error and retains completed cached work; it does not automatically skip unknown failures. Native model crashes or operating-system memory exhaustion are not made impossible by these guards. The change bounds request concurrency and browser result rendering; it is not a claim of exhaustive memory profiling on every library.
