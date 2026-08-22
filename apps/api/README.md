# Flowset API

FastAPI application containing the provider-neutral track model and deterministic V1
playlist strategies. Run it from the repository root with `npm run dev:api`.

Interactive API documentation is available at <http://127.0.0.1:8000/docs>.

## Optional semantic runtimes

Install only the local backend you intend to operate: `make setup-clap`, `make setup-muq-mulan`,
or `make setup-mert`. The extras leave direct runtime requirements broadly constrained while
`uv.lock` records the exact versions currently resolved for reproducible installs; checkpoint
compatibility must still be verified in the Python 3.12 environment. CLAP expects `laion-clap`;
MuQ-MuLan expects `muq`, PyTorch, and torchaudio; MERT expects librosa, PyTorch, and Transformers.
Model weights are never installed or downloaded by these commands, and desktop/default installs do
not include these heavy experimental extras.
CLAP also requires the `roberta-base` tokenizer to already exist in the local Hugging Face cache;
Flowset forces Hub/Transformers offline mode before loading CLAP or MuQ-MuLan and fails clearly when
a required nested artifact is missing.
MERT loads only an explicit local checkpoint, but its official model format requires
`trust_remote_code=True`; Python code stored in that trusted checkpoint directory may execute.

## Audio-feature providers

`GET /api/v1/audio-features/providers` reports the available providers and their setup
requirements. ReccoBeats is a catalog lookup and requires no API key. Essentia is optional and is
reported as unavailable until its Python package is installed and `ESSENTIA_AUDIO_ROOT` points to
an existing directory.

`POST /api/v1/audio-features/resolve` enriches provider-neutral tracks before recipe preview:

```json
{
  "provider": "reccobeats",
  "tracks": [
    {
      "id": "spotify-track-id",
      "name": "Example",
      "artist": "Example Artist",
      "album": "Example Album",
      "duration_ms": 180000,
      "isrc": "USRC12345678"
    }
  ]
}
```

ReccoBeats requests are sent in batches of at most 40. The response retains every input track,
reports matched and unresolved counts, and records ReccoBeats provenance on each match. Missing
tracks and descriptors remain null instead of receiving fabricated defaults.

For Essentia, set `provider` to `essentia`, provide `local_audio_paths` as a mapping from track ID
to a relative path beneath `ESSENTIA_AUDIO_ROOT`, and pass each track's imported playlist cache
directory in `analysis_cache_directories`. A track may name multiple cache directories when it
belongs to overlapping input playlists. Absolute paths and paths that escape the configured root
are rejected. Only separately supplied, user-authorized audio is supported; Spotify audio is
never downloaded.

Install the TensorFlow-enabled analyzer with `make setup-essentia`, then explicitly download the
official MusiCNN mood bundle with `make setup-essentia-models`. Set `ESSENTIA_MODEL_DIR` to
`apps/api/.models/essentia` (or the absolute equivalent). When configured, one shared MusiCNN
embedding pass supplies arousal, valence, aggressiveness, party, and relaxed predictions. Without
the bundle, native descriptors still work and those five values remain null. Each configured model
inference runs in a fresh child process with a default 180-second timeout. A crash or timeout cannot
take down the API and does not discard native features already measured for that track. The Tauri
desktop build provisions, bundles, and configures these artifacts automatically.

## Local playlist import

Set `ESSENTIA_AUDIO_ROOT` to the common ancestor of the local folders and playlist files the app
may read. `GET /api/v1/local-library/folders?path=...` lists safe immediate subfolders without
returning the host's absolute path. The frontend uses this endpoint to choose a parent and present
its immediate subfolders as folder-playlist candidates.

`GET /api/v1/local-library/playlists?path=...` searches that root-relative parent recursively for
`.m3u` and `.m3u8` files. The response contains stable, root-relative paths, display names, and
source kinds. Discovery ignores hidden directories and symlinks, inspects at most 100,000 entries,
and does not parse playlist contents. The configured root must also contain every audio file that
an imported playlist is allowed to reference.

`POST /api/v1/local-library/import` accepts a root-relative directory, `.m3u`, or
`.m3u8` path:

```json
{
  "source_path": "Playlists/July/set.m3u",
  "name": "July set",
  "recursive": false
}
```

The response contains an `InputPlaylist`, a `local_audio_paths` mapping keyed by track ID, the
root-relative `analysis_cache_directory`, `cached_track_count`, and explicit skipped-file
diagnostics. Directory imports include supported audio files in stable filename order; M3U imports
preserve playlist order. Import reads embedded metadata with Mutagen but does not run Essentia.
If a matching `.sequence/analysis-cache.json` exists beside the playlist, its valid measurements
and provenance are restored onto the imported tracks.

The local import and portable-MP3 path accepts AAC/ADTS, AC-3/E-AC-3, AIFF/AIFC, APE,
DFF/DSDIFF, DSF, FLAC, M4A/M4B, MP2/MP3, Musepack, Ogg/Opus/Speex, TAK, TTA, WAV, WMA, and
WavPack. This is an explicit import/export boundary, not a promise that every browser can play
every codec or that every Essentia build can analyze it. Metadata or decoder failures remain
visible per-file failures.

To analyze the result, send `playlist.tracks` and `local_audio_paths` to
`POST /api/v1/audio-features/resolve` with `provider` set to `essentia`. The importer and analyzer
both reject paths or symlinks that escape `ESSENTIA_AUDIO_ROOT`.

For live progress, add a client-generated `progress_token` of 16–128 URL-safe characters to the
resolution request, then poll `GET /api/v1/audio-features/progress/{progress_token}` from the same
loopback client. The short-lived snapshot reports the current track, per-track and overall timing,
ETA, errors, and only the two execution stages the analyzer can prove: `native_dsp` and
`tensorflow`. A 404 means the token is unknown or its completed snapshot has expired.

Both local-library import and Essentia resolution reject non-loopback clients. Do not place these
endpoints behind a proxy or expose them on a LAN until authenticated ownership is implemented.
Synchronous Essentia resolution is capped at five tracks per request. The local frontend submits
explicit user-started analysis in sequential five-track batches. Each successful batch is merged
atomically into the playlist's hidden `.sequence` cache, so a stopped run resumes with only stale
or missing tracks. Exact path/size/mtime matches remain hash-free; new cache writes retain a
SHA-256 content fingerprint that allows same-content rename recovery inside that playlist cache.
A cancellable background-job flow remains planned for large playlists.

## Composable recipe preview

`POST /api/v1/recipes/preview` combines one or more input playlists and returns the full
track list for every proposed output. Repeated track IDs are deduplicated in input order;
the first occurrence wins.

A recipe has four independent stages:

1. `distribution_parameter` and `distribution_bin_count` describe the combined library.
2. Optional `split` creates separate output playlists from equal-width bins across the
   observed range.
3. Optional `subgroup` creates contiguous bin-based groups inside each output without
   removing tracks from that output.
4. Optional `sort` orders tracks inside each subgroup, or across an entire output when no
   subgroup is configured.

```json
{
  "name": "Dance levels",
  "input_playlists": [
    {
      "id": "source-1",
      "name": "Favorites",
      "tracks": [{
        "id": "track-1",
        "name": "Example",
        "artist": "Example Artist",
        "album": "Example Album",
        "duration_ms": 180000,
        "audio_features": {
          "tempo": 120,
          "key": 0,
          "mode": 1,
          "energy": 0.7,
          "danceability": 0.8,
          "valence": 0.6,
          "loudness": -7,
          "acousticness": 0.1,
          "instrumentalness": 0.2,
          "speechiness": 0.04,
          "liveness": 0.1,
          "time_signature": 4
        }
      }]
    }
  ],
  "distribution_parameter": "energy",
  "distribution_bin_count": 5,
  "split": {"parameter": "energy", "bin_count": 3},
  "subgroup": {"parameter": "danceability", "bin_count": 2},
  "sort": {"parameter": "tempo", "direction": "asc"}
}
```

Numeric distribution, split, and subgroup parameters are `energy`, `arousal`,
`aggressiveness`, `party`, `relaxed`, `danceability`, `valence`, `tempo`, `onset_rate`,
`beat_strength`, `dynamic_complexity`, `loudness_range`, `brightness`, `spectral_flux`,
`key_strength`, `acousticness`, `instrumentalness`, `speechiness`, `liveness`, `loudness`,
`release_year`, and `duration` (`duration` values are milliseconds). Sort also supports
`duration_ms`, `key` (Camelot order), `name`, `artist`, and `album`.

Essentia's base extractor populates tempo, key/mode and key strength, danceability, loudness,
EBU R128 dynamic range, onset rate, beat strength, dynamic complexity, brightness, and spectral
flux. The optional TensorFlow tier populates arousal, valence, aggressiveness, party, and relaxed
as 0–1 model outputs from explicitly provisioned, separately licensed model files. Raw native
descriptors are not silently normalized or relabeled as Spotify values. TensorFlow graph sessions
are deliberately not reused across tracks; a disposable worker provides the lifecycle boundary.

Sort direction accepts either `asc` / `desc` or `ascending` / `descending`.

The response includes distribution counts and ranges, all deduplicated output tracks, and
group track lists with zero-based `start_index` and exclusive `end_index_exclusive`
boundaries. Tracks without a selected parameter are retained in an `unavailable` output or
group instead of being dropped.

Use `GET /api/v1/demo/playlists` for three selectable source fixtures. Two fixtures overlap
so clients can demonstrate deduplication; the third is non-overlapping. The original
`GET /api/v1/demo` and `POST /api/v1/optimize` endpoints remain available.
