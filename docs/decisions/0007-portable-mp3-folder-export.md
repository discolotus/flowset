# ADR 0007: Export portable, ordered MP3 folders

- Status: Accepted for the local macOS workflow
- Date: 2026-07-20

## Context

Playlist files and collection XML preserve an ordered list, but the destination application must
still be able to read the original audio paths. A portable handoff instead needs to carry the audio
itself. Filesystems do not have a dependable user-visible item order, and importing a folder into a
DJ or music application commonly falls back to filename order. The exported hierarchy therefore
has to encode both playlist order and track order without changing the source library.

Source playlists may contain MP3, lossless audio, or already-lossy formats such as AAC and Opus.
Blindly transcoding every file wastes time and reduces the quality of MP3 sources, while copying
every format does not produce a uniform, broadly compatible destination.

## Decision

Flowset adds an explicit **Portable MP3 folders** export destination in the native Mac app. It is
separate from Apple Music import, DJ-bundle export, and M3U8 export.

### Ordered hierarchy

- `RecipeOutput[]` is the playlist-order authority. The app creates one child folder per output,
  with a zero-padded ordinal and sanitized playlist name, for example
  `01 - Low Arousal` and `02 - Medium Arousal`.
- `RecipeOutput.tracks[]` is the track-order authority. Each child folder receives one file per
  playlist entry with a zero-padded ordinal and readable sanitized name, for example
  `001 - Artist - Track.mp3`.
- Padding is at least two digits for playlists and three digits for tracks, and expands when a
  collection is larger. Ordering depends on the numeric prefix, not directory enumeration.
- Repeated playlist entries remain repeated exported files. Equal or colliding display names get
  deterministic unique suffixes without changing their ordinal positions.
- The exporter creates a uniquely named top-level directory. It never overwrites an existing file
  or folder.

### Copy and transcode policy

- A source whose extension is `.mp3`, compared case-insensitively, has its encoded audio
  stream-copied without decoding or re-encoding. Its exported container is new so Flowset can
  write canonical title, artist, album, and playlist-position tags from the inspected preview.
- Supported inputs with absent embedded title/artist tags use a conservative filename fallback:
  an optional numeric prefix is removed and `Artist - Title` is split once. Export never puts the
  numbered delivery filename into the ID3 title field.
- Supported non-MP3 sources are converted with FFmpeg/libmp3lame using a 320 kbps CBR target and
  LAME algorithm quality `0`, its highest and slowest analysis mode. Standard MP3 permits 320 kbps
  for MPEG-1 sample rates; lower-rate inputs use their highest legal tier, so output is up to
  320 kbps. This is an output compatibility and quality setting, not a claim that conversion
  improves the source.
- The accepted boundary includes AAC/ADTS, AC-3/E-AC-3, AIFF/AIFC, APE, DFF/DSDIFF, DSF, FLAC,
  M4A/M4B, MP2, Musepack, Ogg/Opus/Speex, TAK, TTA, WAV, WMA, and WavPack. Other extensions are
  rejected before the exporter creates output. Import/export support is separate from WebKit
  playback and Essentia-analysis support.
- Source audio is always read-only: no source is moved, renamed, retagged, deleted, or replaced.
- FFmpeg is invoked directly with a structured argument list, never through a command shell. The
  preflight performs a tiny in-memory encode with the same libmp3lame quality settings rather than
  accepting any executable that merely reports an FFmpeg version. FFmpeg receives no interactive
  input, treats decode errors as fatal, and may write only the new destination selected for this
  export.
- Each stream copy or transcode first writes a temporary file in its destination folder and becomes
  the final numbered MP3 only after successful completion. A failed temporary file is not presented
  as a playable result.

### Validation, progress, and reporting

- Before starting, the native app canonicalizes the library, destination, and every source path;
  rejects missing files, symlink escapes, and destinations inside the active library; and validates
  generated path components, output-count limits, and case-insensitive filename uniqueness.
- Generated components are sanitized for portable filename characters and capped by UTF-8 byte
  length below the macOS filesystem limit.
- The UI uses the 320 kbps ceiling to estimate the converted portion at approximately 2.4 MB per
  minute and separately states how many existing MP3s retain their current sizes. It does not
  present that conversion-only value as a complete destination-size or free-space check.
- Export reports current playlist and track progress.
- One track failure does not erase successful work or prevent independent later tracks from being
  attempted. The export root contains a machine-readable manifest with every requested
  playlist/track position, operation, outcome, and failure reason. The UI labels any missing result
  as a partial export, never success.
- A retry creates a new uniquely numbered top-level folder. It does not mutate or merge into the
  partial attempt.

### FFmpeg dependency and packaging

- The current local build resolves an explicitly configured or app-resource `ffmpeg` first, then
  checks the common Apple Silicon and Intel Homebrew locations and finally the launch environment.
  Existing MP3 exports also invoke FFmpeg to normalize their containers and tags without
  re-encoding audio. If no working executable is available, preflight stops before creating an
  export root and explains how to configure it.
- The unsigned Homebrew preview declares Homebrew FFmpeg as a formula dependency, but the built
  `.app` is not a self-contained transcoding package.

## Release follow-ups

- Before a notarized, self-contained release, select a pinned architecture-appropriate FFmpeg
  executable and resolve it directly rather than assuming a shell `PATH`. If it is dynamically
  linked, bundle and repair the complete library dependency closure rather than copying the
  executable alone. Include every shipped binary in signing and notarization, record reproducible
  checksums, and audit codec configuration, upstream notices, and LGPL/GPL or other applicable
  obligations.
- Extend the existing copy/transcode counts and transcode-size estimate into a complete total-size
  preflight by reading copied-MP3 sizes, counting unknown sizes or durations, and warning when
  destination free space appears insufficient.
- Persist the manifest incrementally and add cancellation. The current final report covers normal
  per-track failures, but a force-quit or process crash can interrupt final report creation.

## Consequences

- Playlist and track order survives copying through ordinary filename sorting, even in tools that
  ignore M3U8 order.
- Existing MP3 audio keeps its encoded frames and quality while its exported ID3 metadata is
  normalized. Other formats gain a consistent, broadly compatible MP3 representation at the
  highest legal tier up to 320 kbps.
- Lossless-to-MP3 conversion is intentionally lossy. Lossy-to-MP3 conversion can add generation
  loss and cannot recover information absent from the source; users who prioritize fidelity should
  retain the DJ bundle or M3U8 workflow against original files.
- The export can require substantial temporary and final disk space and take roughly the combined
  audio duration scaled by available CPU. Size estimation is advisory, not a free-space guarantee.
- Partial work remains inspectable and auditable, while source audio and earlier exports remain
  untouched.
