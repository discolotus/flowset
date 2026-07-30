# Essentia evaluation: Minimalism Vol. 14

- Date: 2026-07-16
- Status: Initial local-library smoke test
- Source: a 13-track evaluation M3U on an external drive
- Playlist entries imported: 13
- Import skips: 0
- Tracks analyzed in foreground sample: 3
- Essentia version: `2.1-beta6-dev` (`essentia==2.1b6.dev1389`)

## Method

The API was configured with the external music library as `ESSENTIA_AUDIO_ROOT`. The local
import endpoint read this root-relative M3U:

```text
evaluation-library/album-folder/
  00-va-minimalism_vol._14-(vmcomp1128)-web-2023.m3u
```

All 13 relative MP3 entries resolved beneath the configured root. Mutagen supplied title, artist,
album, and duration metadata without audio analysis. The first three imported tracks and their
relative-path map were then sent to the actual Essentia resolution endpoint.

The containing directory was also imported directly as a folder playlist and produced the same
13 tracks with no skips, confirming both local source modes on real files.

All 13 files contained release-year tags, but none exposed an ISRC through their embedded tags.
Matching these files to Spotify would therefore need title, artist, version qualifier, and duration
evidence rather than an ISRC shortcut.

## Results

| Track | BPM | Key | Mode | Normalized danceability | Integrated loudness |
| --- | ---: | --- | --- | ---: | ---: |
| Peron (Extended Mix) | 123.00 | F-sharp | Minor | 0.579 | -8.87 LUFS |
| Days Like These (Original Mix) | 126.03 | G | Major | 0.695 | -8.47 LUFS |
| Stringecho (Original Mix) | 124.40 | F | Minor | 0.612 | -8.11 LUFS |

- HTTP result: `200`, status `complete`
- Analyzed tracks: `3/3`
- API warnings: none
- Foreground analysis time: 67.9 seconds, approximately 22.6 seconds per track
- `energy`: unavailable for all three by design

Essentia emitted recoverable invalid-MP3-frame warnings while decoding these files, but completed
all three analyses. This smoke test confirms integration and descriptor flow; it is not an
accuracy benchmark against independently verified BPM, key, or danceability labels.

## Expanded native-descriptor check

After exposing the wider descriptor set, `Peron (Extended Mix)` was analyzed again through the
production adapter. Every newly mapped base-extractor field was present:

| Dynamic range | Onset rate | Beat strength | Dynamic complexity | Brightness | Spectral flux | Key strength |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4.8063 LU | 5.3128/s | 0.02641 raw | 4.0558 dB-scale | 1445.94 Hz | 0.12033 raw | 0.77996 raw |

`arousal`, `valence`, `aggressiveness`, `party`, and `relaxed` remained null, as expected without
the optional TensorFlow model tier. These nulls are exposed as unavailable values rather than
being filled from unrelated base descriptors.

## TensorFlow model-tier smoke test

On 2026-07-17 the environment was changed from plain `essentia` to
`essentia-tensorflow==2.1b6.dev1389`, and the five required inference algorithms imported on the
same Apple-silicon/Python 3.12 environment. The official MusiCNN embedding graph plus DEAM,
aggressive, party, and relaxed heads were provisioned outside version control. The production
adapter then analyzed `Peron (Extended Mix)` end to end:

| Arousal | Valence | Aggressiveness | Party | Relaxed |
| ---: | ---: | ---: | ---: | ---: |
| 0.6230 | 0.6126 | 0.3632 | 0.6989 | 0.1210 |

The full native-plus-model analysis completed in 13.3 seconds in this smoke run. Every graph
loaded successfully. The adapter left Spotify-shaped `energy` null, normalized only DEAM's 1-9
arousal/valence outputs to 0-1, and selected mood probabilities using each metadata file's class
order. This first implementation retained TensorFlow graph sessions across tracks; repeated native
inference later exposed an Essentia network-lifecycle loop, so graph reuse was removed.

## Isolated-worker regression and real-audio check

On 2026-07-18 the five mood models were moved behind a supervised, single-use process boundary.
`Forget The Memories.opus` from the 92-track `June 26` local folder completed native plus full-model
analysis with these values:

| BPM | Danceability | Arousal | Valence | Aggressiveness | Party | Relaxed |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 125.008 | 0.6552 | 0.5219 | 0.6029 | 0.9580 | 0.9073 | 0.0584 |

The model-only analysis was then run twice in succession from the same API parent. Both calls
returned identical values from distinct worker PIDs (`53718` and `53726`), and both workers exited.
Deterministic tests also verify fresh PIDs, result-then-hang termination, timeout recovery, crash
recovery, malformed-result rejection, and preservation of native values after model failure.

## Implications

Local metadata discovery is fast enough for interactive playlist selection. Full audio analysis
now persists completed batches in the playlist-local cache and reports the current track, elapsed
time, estimated remaining time, and per-track timings while a request runs. The progress contract
separates the combined native decode/DSP extractor from the isolated TensorFlow mood worker; it
does not claim timing for internal native operations that Essentia does not expose separately.

Essentia danceability is useful for within-provider ranking but is not calibrated to ReccoBeats or
Spotify. Energy-adjacent organization should use the explicitly labeled arousal model output, not
raw spectral energy.
