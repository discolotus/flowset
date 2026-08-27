# Flowset API

FastAPI application containing the provider-neutral track model and deterministic V1
playlist strategies. Run it from the repository root with `npm run dev:api`.

Interactive API documentation is available at <http://127.0.0.1:8000/docs>.

## Optional semantic runtimes

Flowset does not bundle these multi-gigabyte experimental models, but it now provides explicit,
reproducible installation commands that download pinned revisions, verify the primary weight files,
provision every nested Hugging Face dependency for offline use, and write a local manifest:

```bash
make setup-clap-models
make setup-muq-mulan-models ACCEPT_RESTRICTED_WEIGHTS=1
make setup-mert-models ACCEPT_RESTRICTED_WEIGHTS=1 ACCEPT_TRUSTED_CODE=1
```

Use `make setup-semantic-models ACCEPT_RESTRICTED_WEIGHTS=1 ACCEPT_TRUSTED_CODE=1` to provision all
three. Artifacts are installed beneath the gitignored `apps/api/.models/semantic` directory, which
is also the API's default checkpoint location. `CLAP_CHECKPOINT`, `MUQ_MULAN_CHECKPOINT`, and
`MERT_CHECKPOINT` remain available as deployment overrides. Dependency-only commands
`make setup-clap`, `make setup-muq-mulan`, and `make setup-mert` do not download weights.

CLAP uses the pinned `630k-audioset-best.pt` HTSAT-tiny checkpoint and separately caches the BERT,
RoBERTa, and BART resources that `laion-clap` resolves at import/model-construction time.
MuQ-MuLan uses the pinned official top-level weights plus its MuQ audio encoder and XLM-RoBERTa
text encoder. The provisioning helper verifies expected byte sizes and SHA-256 digests for every
primary and nested model weight, records that integrity data in local manifests, and loads the
top-level MuQ state dict with strict key validation while forcing all nested resolution offline.
MERT uses the pinned 95M checkpoint, executes its audited local custom Python files through
`trust_remote_code=True`, and rejects missing, unexpected, or mismatched weights instead of
accepting a partially initialized model.

The current local artifact set is approximately 7.3 GB. Published MuQ-MuLan and MERT weights are
CC-BY-NC-4.0, so their setup commands require explicit non-commercial-use acknowledgement. MERT's
setup command separately requires acknowledgement of trusted checkpoint code. Run real audio/text
inference—not mocks—with:

```bash
make test-semantic-models-smoke
```

Each runtime is loaded once per backend instance and remains offline during API requests.

`POST /api/v1/semantic/embeddings` accepts only root-relative paths beneath the configured
semantic audio root. Each backend advertises a bounded `max_embedding_batch`, a checkpoint-derived
model identity, and an embedding representation identity. The web client acquires larger selected
sets in sequential chunks and rejects chunks whose model, representation, or dimension differs.

Successful per-track embeddings are reused from a bounded process-local LRU cache. Concurrent
requests for the same key share one inference. Responses report per-track `hit`, `miss`, or
`deduplicated` state plus aggregate cache counts; decode and malformed-vector failures stay visible
beside the affected track. Raw vectors are returned only by the explicit loopback embedding API and
are not added to tracks, workspace state, browser storage, playlist exports, or remote calls.
`SEMANTIC_EMBEDDING_CACHE_ENTRIES` controls the LRU bound and defaults to 128.

The LRU is backed by a content-addressed SQLite artifact index. It persists CLAP, MuQ-MuLan, and
MERT embeddings across API restarts and reuses identical content after a rename or across multiple
playlist locations. Embedding spaces include the backend, checkpoint-derived model identity,
representation, preprocessing version, segment policy, and dimension. Raw vectors remain local to
the API and are still excluded from workspace state, browser storage, playlists, and exports.

The source API defaults to
`~/Library/Application Support/Flowset/semantic-index-v1.sqlite3` on macOS, while the desktop app
places it in its bundle-specific Application Support directory. Set `SEMANTIC_CACHE_PATH` to place
a portable index on an external volume. Flowset uses `sqlite-vec`
cosine KNN tables when the extension can load and reports `python-exact` when it falls back to its
portable exact search. `POST /api/v1/semantic/neighbors` searches all compatible cached vectors in
the authorized library without rerunning inference for previously indexed tracks.

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
