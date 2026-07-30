# macOS and Homebrew release protocol

## Current release class

The available package is an **unsigned, non-commercial preview for Apple silicon**. It is not an
Apple-notarized production release:

- no Apple Developer Program signing identity is available;
- Gatekeeper will not recognize an ad-hoc signature as an identified developer;
- Essentia is AGPLv3 for non-commercial applications and the bundled models are
  CC BY-NC-ND 4.0 for non-commercial use;
- FFmpeg is installed by Homebrew instead of being embedded in the app;
- the Essentia wheel's bundled FFTW library still emits a hardened-runtime SDK warning.

The repository source remains MIT-licensed. See `THIRD_PARTY_NOTICES.md` for the packaged
dependencies that carry additional terms.

## Version and artifact contract

A preview tag uses `v<app-version>-preview.<number>`, for example `v0.1.0-preview.1`. The GitHub
prerelease contains:

- `Playlist-Optimizer-<tag-without-v>-arm64.zip`
- the matching `.sha256` file
- a generated `playlist-optimizer.rb` Homebrew cask

The zip contains exactly one `Playlist Optimizer.app`. Its bundle identifier is
`com.discolotus.playlist-optimizer`; its minimum macOS version is 15.2.

## Local release rehearsal

From a clean checkout on an Apple-silicon Mac:

```bash
make setup
make test
make lint
make build
make test-mp3-export-smoke
./scripts/package_macos_release.sh --version 0.1.0-preview.1 --unsigned
./scripts/validate_macos_release.sh \
  dist/release/Playlist-Optimizer-0.1.0-preview.1-arm64.zip \
  --allow-unsigned
```

The package command builds the sidecar and app, copies the repository and Essentia license notices
into the app, applies an internally consistent ad-hoc signature without hardened runtime,
validates it, creates a deterministic release filename, and writes its SHA-256 checksum. Hardened
runtime is reserved for the future Developer ID path because a PyInstaller one-file sidecar must
have its extracted native libraries signed consistently before library validation can be enabled.

## CI release

`.github/workflows/release.yml` runs on an Apple-silicon `macos-15` runner. A tag matching
`v*-preview.*` runs the full web, API, native, and real FFmpeg MP3-export checks before publishing a
GitHub prerelease. The job also generates and uploads the cask.

The workflow deliberately refuses to publish any other tag while Apple signing is unavailable.
This prevents an unsigned artifact from being presented as stable.

## Homebrew tap update

The separate public repository `discolotus/homebrew-tap` owns
`Casks/playlist-optimizer.rb`. After a GitHub prerelease is available:

```bash
./scripts/generate_homebrew_cask.sh \
  --version 0.1.0-preview.1 \
  --sha256 "$(cut -d ' ' -f 1 \
    dist/release/Playlist-Optimizer-0.1.0-preview.1-arm64.zip.sha256)" \
  --output /path/to/homebrew-tap/Casks/playlist-optimizer.rb

brew audit --cask --strict /path/to/homebrew-tap/Casks/playlist-optimizer.rb
brew install --cask /path/to/homebrew-tap/Casks/playlist-optimizer.rb
```

Once the tap is pushed, users install this explicitly unsigned preview with:

```bash
brew tap discolotus/tap
brew install --cask playlist-optimizer
```

Because the app has no Developer ID signature, macOS will block its first launch. Users should
verify that the cask URL points to `discolotus/spotify-playlist-optimizer`, confirm Homebrew's
downloaded SHA-256 matches the release checksum, and then use **System Settings → Privacy &
Security → Open Anyway** for Playlist Optimizer. That explicit Gatekeeper exception should never
be used for an unverified artifact.

## Clean-install verification

The release is not complete until a fresh cask installation proves all of the following:

1. Homebrew downloads the public GitHub artifact and verifies its checksum.
2. `/Applications/Playlist Optimizer.app` passes `codesign --verify --deep --strict`.
3. The app launches and its packaged API answers `/api/v1/health`.
4. The real FFmpeg smoke test exports MP3 from MP3, FLAC, Opus, and DFF inputs.
5. FFprobe and Mutagen confirm audio validity and canonical title, artist, album, disc, and track
   tags in the exported files.
6. The app is uninstalled and reinstalled once to catch hidden local-build dependencies.

Record the exact release URL, cask commit, Homebrew output, test counts, and any Gatekeeper
exception in the GitHub release notes.

## Future signed and notarized release

Apple Developer Program access is the remaining external prerequisite. Once available:

1. Create a Developer ID Application certificate and a dedicated notarization credential.
2. Import the certificate into a temporary CI keychain.
3. Resolve the bundled FFTW SDK/hardened-runtime warning.
4. Decide whether to bundle a pinned FFmpeg build; if so, publish its source, configuration,
   checksum, licenses, and architecture provenance.
5. Replace the fixed loopback port with a dynamically allocated authenticated channel.
6. Sign every nested executable and native library with hardened runtime and a trusted timestamp,
   then sign the outer app.
7. Verify with `codesign --verify --deep --strict` and
   `codesign -dv --verbose=4`.
8. Submit the zip with `xcrun notarytool`, wait for `Accepted`, staple the ticket, and verify with
   `xcrun stapler validate` and `spctl --assess --type execute`.
9. Run the complete clean-install loop without any Gatekeeper exception.
10. Publish a stable tag only after all nine checks pass.

Commercial distribution additionally requires appropriate Essentia/model licensing and a complete
native dependency audit. Apple signing does not resolve those licensing requirements.
