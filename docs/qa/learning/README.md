# Learning workspace QA — 2026-09-05

Implemented and verified in the local web app at `localhost:5173`, using Chrome through the computer-use browser interface. The subagent’s browser surface did not include the in-app browser. The local dev server was restarted because its ports were initially inactive.

## Browser checks

- Primary **Learn** navigation opens the dedicated workspace; all four package guides switch correctly.
- CLAP’s fictional query slider changes ranking; moving it to 180° ranks Fictional Cobalt first.
- MERT’s illustrative reference selection ranks Fictional Cobalt at 1.000 when it is the reference.
- Essentia’s synthetic amplitude slider changes RMS from 0.3536 at amplitude 0.5 to 0.7071 at amplitude 1.
- Algorithm search for MFCC finds 4 entries, including extractor parameters that reference it. Expanding MFCC shows standard and streaming input/output/parameter interfaces and correct official links.
- At a 390 × 844 viewport override, the page reflows into two package columns with no horizontal document overflow (client width and scroll width both 380). Override reset afterward.
- “Choose local source tracks” returns to Playlist Builder. Imported the existing `Music Library/toolcrate-library/Latin` folder (one track), then returned to Learn → Essentia and inspected **Porro bonito — Orquesta Ritmo de Sabanas**.
- That real track displayed all 17 cached fields with `essentia` provider and `2.1-beta6-dev` analyzer provenance. Examples: tempo 100.4038 BPM, loudness −10.4264 LUFS, arousal 0.6555, valence 0.6547. Opening the page and inspector ran no new inference.
- No warnings or errors appeared in the browser console during these checks. No music, playlists, model configuration, or export destinations were modified.

Screenshots: [catalog](catalog.png), [mobile](mobile.png), [cached measurements](measurements.png), [desktop guide](desktop.png).

## Automated verification

Four new Learning tests cover capability scope/filter reset, no implicit network inference, actual callback navigation, fictional ranking arithmetic, complete catalog search/category behavior, official algorithm link construction, all 17 cached fields, missing-value handling, fixture provenance, and non-preloading audio.

Full repository verification: `make test`, `make lint`, and `make build`. The separate catalog generator also passes Ruff. All passed: 215 web tests, 172 API tests, and 37 native tests (3 environment-dependent native smoke tests ignored).

## Limits

This page documents upstream features beyond Flowset’s runnable controls. The illustrations intentionally do not emulate neural model outputs. Actual model inference remains in existing Playlist Builder and Semantic Lab flows. This QA checks the new learning surface and cached-data readback; it does not re-run every model or every upstream Essentia algorithm.
