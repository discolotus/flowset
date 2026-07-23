# Essentia feature map

- Date: 2026-07-16
- TensorFlow package: `essentia-tensorflow==2.1b6.dev1389`
- Test platform: Apple silicon, Python 3.12

Essentia analyzes audio supplied by the user. Its values are independent measurements, not
recovered Spotify Audio Features. Descriptor provenance and scale must remain visible.

## Base extractor: implemented now

The current adapter uses `MusicExtractor`. These descriptors are selectable in the distribution,
split, subgroup, sort, and track-inspection controls:

| Product value | Essentia descriptor | Product representation |
| --- | --- | --- |
| BPM | `rhythm.bpm` | BPM |
| Key | `tonal.key_edma.key` | Pitch class 0–11 |
| Mode | `tonal.key_edma.scale` | Minor `0`, major `1` |
| Key strength | `tonal.key_edma.strength` | Raw, unitless key-profile strength |
| Danceability | `rhythm.danceability` | Heuristically divided by 3 and clamped to 0–1 |
| Loudness | `lowlevel.loudness_ebu128.integrated` | Integrated LUFS |
| Dynamic range | `lowlevel.loudness_ebu128.loudness_range` | EBU R128 loudness range in LU |
| Onset rate | `rhythm.onset_rate` | Detected onsets per second |
| Beat strength | `rhythm.beats_loudness.mean` | Raw mean beat-segment spectrum energy |
| Dynamic complexity | `lowlevel.dynamic_complexity` | Native loudness-deviation value on a dB scale |
| Brightness | `lowlevel.spectral_centroid.mean` | Mean spectral centroid in Hz |
| Spectral flux | `lowlevel.spectral_flux.mean` | Raw mean frame-to-frame spectral change |

Essentia's danceability is not calibrated to Spotify's danceability. The normalized value is
useful for ranking tracks analyzed with the same extractor version, but cross-provider thresholds
must not assume that `0.7` means the same thing in Essentia and ReccoBeats. Beat strength,
dynamic complexity, spectral flux, and key strength are also native scores rather than
percentages; the UI preserves their raw values and does not imply a 0–1 scale.

"Rhythmic drive" is not stored as a fabricated composite. Onset rate and beat strength are
exposed separately so users can inspect and organize by the two observable components.

## Available without machine-learning models

The same extractor can also produce beat positions, a BPM histogram, chord estimates, tuning,
HPCP, MFCC/GFCC, spectral contrast, dissonance, entropy, and many other time-domain, rhythm,
tonal, and timbral descriptors. Those lower-level descriptors remain
available for future transition scoring and clustering, but are not all useful as direct playlist
organization controls.

These are useful for confidence display, clustering, transition scoring, and a future custom
intensity model. Raw spectral energy is signal power, however, and must not be placed directly in
the Spotify-shaped `energy` field.

## Optional TensorFlow model tier: implemented

The adapter populates `arousal`, `valence`, `aggressiveness`, `party`, and `relaxed` as nullable
0–1 fields when `ESSENTIA_MODEL_DIR` contains the complete model bundle. Without that explicit
configuration, native extraction remains available and model fields stay visibly unavailable;
the app never guesses values or substitutes a lower-level descriptor.

The intended model mapping is:

| Product value | Essentia model output | Product representation |
| --- | --- | --- |
| Arousal | `deam-msd-musicnn-2.pb`, output index 1 | Raw 1–9 result rescaled with `(value - 1) / 8` |
| Valence | `deam-msd-musicnn-2.pb`, output index 0 | Raw 1–9 result rescaled with `(value - 1) / 8` |
| Aggressiveness | `mood_aggressive-msd-musicnn-1.pb`, class `aggressive` | 0–1 |
| Party | `mood_party-msd-musicnn-1.pb`, class `party` | 0–1 |
| Relaxed | `mood_relaxed-msd-musicnn-1.pb`, class `relaxed` | 0–1 |

The class order is read from each model's metadata rather than assumed: the published mood heads
do not use a consistent positive-class position. Party and relaxed are separate probabilities,
not opposite ends of one slider. Arousal is a useful energy-adjacent measure but remains labeled
**arousal**, never Spotify energy.

Those heads share one `msd-musicnn-1.pb` embedding pass at 16 kHz. The adapter uses
`TensorflowPredictMusiCNN` once, feeds its 200-dimensional patch embeddings to four
`TensorflowPredict2D` heads, and averages predictions over time. Output nodes and class positions
are read from the official JSON metadata. Each track gets a fresh supervised model process, which
is terminated after returning all five values or after a configurable timeout. A failure leaves the
track's native Essentia measurements intact. The adapter feature-detects the required algorithms
and reports precise configuration or inference failures. Persistent caching by audio and model
digest remains part of the background-job milestone.

Other model families can later add acoustic/non-acoustic and voice/instrumental probabilities,
genre/style probabilities, embeddings for similarity, and audio-event probabilities. There is no
direct, drop-in Spotify equivalent for energy, speechiness, liveness, or time signature in the
base extractor. Any future proxy must show its name, model, scale, and version explicitly.

## Installation and licensing

The API pins the tested TensorFlow-enabled macOS ARM64 wheel. It replaces plain `essentia`; do not
install both distributions into the same environment. Install it and explicitly provision the
official model artifacts with:

```bash
cd apps/api
UV_CACHE_DIR=.uv-cache uv sync --extra essentia
python3 scripts/download_essentia_models.py
```

Then set `ESSENTIA_MODEL_DIR` to the resulting `.models/essentia` directory for browser development.
The desktop build performs those provisioning steps, bundles the directory as an app resource, and
sets the resolved path automatically. Installed apps never download weights during startup or
analysis. The pinned extra supports the current CPython 3.12 Apple-silicon development environment;
other Python/platform combinations depend on the wheels published for that exact release.

Essentia and its model artifacts have non-commercial/open-source licensing restrictions that must
be reviewed before a hosted or commercial release; a proprietary license may be required.

## References

- [Music extractor descriptors](https://essentia.upf.edu/streaming_extractor_music.html)
- [MusicExtractor tutorial](https://essentia.upf.edu/tutorial_extractors_musicextractor.html)
- [Danceability algorithm](https://essentia.upf.edu/reference/std_Danceability.html)
- [Essentia model catalog](https://essentia.upf.edu/models.html)
- [Using Essentia models](https://essentia.upf.edu/machine_learning.html)
- [Essentia licensing](https://essentia.upf.edu/licensing_information.html)
