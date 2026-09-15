# Listening-first Flowset

## Stocktake

Flowset has four complementary local ML families: CLAP and MuQ-MuLan text/audio similarity, MERT audio representations and reference similarity, and Essentia measurements (including optional TensorFlow mood models). ReccoBeats is a separate catalog feature provider, not a fifth local ML model. Spotify metadata is not Spotify Audio Features. Availability is reported by the running API, not assumed from an installed app or an old model smoke test.

The existing builder exposes source selection, a factor grid, contiguous subgrouping, scoped sorting, full track previews, and separate export. The Lab adds multi-prompt matrices, contrasts, embeddings, neighbors, clustering, and comparison. Its research controls are useful, but ordinary listening previously required understanding the implementation.

## Implemented user stories

1. **Find the feeling.** As a listener planning a late-night drive, I describe warm, hazy synths, choose CLAP or MuQ-MuLan, and hear the matching songs in my selected library. Example prompts are editable starting points. Results identify the model and show unscored songs. Only “Use this order” changes the recipe; export remains separate.
2. **Rediscover a favorite's neighbors.** As a listener with one song in mind, I search by title, artist, or album, audition it, and use MERT to inspect similar songs. The request uses the backend's advertised representation. Reference and unscored tracks remain visible. Applying the result keeps the entire source membership in one playlist, highest similarity first.
3. **Start gently, finish stronger.** As a listener planning a session, I choose Energy journey to keep one playlist and order it by increasing energy. The action requires measured energy and previews the recipe without exporting. This is an energy progression, not a beatmatching or transition optimizer.
4. **Give a large crate useful moods.** As a collector, I create three valence ranges, divide each into two energy sections, and order songs by tempo inside those sections. Required measurements must exist in the pool. Missing measurements retain the existing unavailable-track handling. Every resulting playlist remains inspectable.
5. **Keep experimenting.** As a curious listener, I open model tools for the existing Lab: compare prompts, derive contrasts, inspect clusters, and promote scores deliberately. Experimental clustering remains exploratory; it does not silently replace playlist splits.

## Interaction contract

- Main flow: choose listening intent → select sources → run or preview → audition/inspect → apply → separate export.
- Analysis and low-level score assignments are under “Analysis & advanced controls.” Existing controls remain accessible.
- Demo mode labels fictional data and does not run semantic inference. Measurement presets can use it.
- Changing query, model, mode, reference, source IDs, or audio paths invalidates pending discovery. Late results cannot be applied to another selection.
- Backend track limits are enforced before requesting inference. Failed/missing results do not masquerade as matches.
- Model scores are not probabilities or guarantees of transition quality. The four model families are complementary, not blended into an unexplained aggregate.
- Measurement presets consume existing provider-attributed data; they do not silently trigger a paid/external provider or claim Essentia ran.

## Follow-on opportunities

Preference feedback and a learned personal taste profile, duration-limited selections, multi-seed discovery, and transition-aware sequencing are not implemented by this change. Each needs a separate selection/ordering contract and evaluation on real listening examples.
