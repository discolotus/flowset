# ADR 0005: Package the local workflow with Tauri and a Python sidecar

## Status

Accepted for local macOS testing and an explicitly unsigned, non-commercial Homebrew preview.
Signed/notarized production distribution is not yet approved.

## Context

The local-library workflow needs native folder selection, filesystem access, and the Essentia
Python runtime. A hosted web application cannot safely obtain arbitrary absolute local paths, and
requiring users to install and start Node, Python, and uv would not feel like a desktop product.
The existing React and FastAPI boundaries are otherwise useful and should remain testable outside
the desktop shell.

## Decision

- Use Tauri 2 as the macOS application shell.
- Build the existing React application into the Tauri webview.
- Freeze FastAPI, the optimization domain, and Essentia into a PyInstaller one-file sidecar.
- Start the sidecar on loopback port `8001` when the app launches and stop it when the app exits.
- Keep the browser development stack on ports `5173` and `8000`.
- Set the desktop sidecar Spotify redirect to exactly
  `http://127.0.0.1:8001/api/v1/spotify/auth/callback`; browser development uses the equivalent
  callback on port `8000`. Both values must be registered separately in Spotify's dashboard.
- Hand the API-generated Spotify authorization URL to a native command that accepts only the exact
  HTTPS `accounts.spotify.com` origin and `/authorize` path before opening the system browser. Do
  not expose a general-purpose URL opener to the webview.
- Use Tauri's native dialog plugin to choose a music-library folder. Send that path only to the
  loopback sidecar, which makes it the active `ESSENTIA_AUDIO_ROOT` for the process.
- Stream explicitly requested track previews from the sidecar with byte-range support. Resolve
  every request beneath the active music root, and never preload audio merely to render a list.
- Let M3U8 and DJ-bundle batch export choose one destination directory, validate the complete batch
  before writing, preserve existing files with numbered names, and roll back files created by a
  failed batch. Portable MP3 export instead retains and explicitly reports successful tracks after
  an independent track fails, as defined in ADR 0007.
- Provision all nine pinned TensorFlow model and metadata artifacts during the desktop build, bundle
  them as Tauri resources, validate them at launch, and pass their resolved resource path to the
  sidecar as `ESSENTIA_MODEL_DIR`.
- For development, allow the opt-in portable-MP3 exporter to use an explicitly configured FFmpeg
  executable or local environment resolution. The unsigned Homebrew preview declares Homebrew
  FFmpeg as an explicit formula dependency. Before a notarized, self-contained distribution,
  select a pinned architecture-appropriate FFmpeg build, record its source/configuration/checksum
  and license obligations, sign it, and resolve it directly.
- Run TensorFlow mood inference in one fresh child process per track. Permit one model worker at a
  time, terminate it after its result, and enforce a configurable timeout. Native Essentia values
  remain usable if the child crashes, hangs, or returns an invalid result.

## Consequences

- Users can launch a normal `.app` and select an external-drive music library without uploading
  files or exposing the path to a remote service.
- Folder navigation remains metadata-light; tracks are read only after a folder is explicitly
  added as a playlist.
- Local playback remains on-demand and root-confined in both browser development and the Tauri
  webview. A future public build must move the fixed loopback sidecar to an authenticated channel;
  signed media capabilities alone would not replace that broader boundary.
- Installed desktop analysis has all five mood outputs available without downloading models or
  configuring an environment variable.
- The model resources add about 3.5 MB. Most bundle size comes from the TensorFlow-enabled Essentia
  runtime already frozen into the Python sidecar.
- The bundled Essentia/TensorFlow native libraries require macOS 15.2 or newer, so the package
  declares that actual minimum rather than promising compatibility its binaries cannot provide.
- The current `.app` is suitable for local testing and an explicitly unsigned, non-commercial
  preview, not a production release. Normal direct distribution requires Developer ID signing and
  notarization, and the bundled FFTW library's SDK metadata must be reconciled with
  hardened-runtime requirements. The selected FFmpeg build and codec configuration also require
  reproducible checksums, attribution, and a license/signing/notarization audit.
- The packaged preview must include the repository MIT license, Essentia's AGPLv3 text, and the
  model-license notice. Its release and cask must identify the non-commercial and unsigned limits.
- A fixed loopback port is simple for the first desktop slice but should become a dynamically
  allocated authenticated channel before multi-instance support.
- Spotify Authorization Code with PKCE needs only the public client ID; no Spotify client secret
  is bundled. The initial loopback API session keeps tokens in memory, so restarting the app
  requires the user to connect again.
