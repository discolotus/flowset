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

`VERSION` contains the next SemVer and `CHANGELOG.md` contains a matching level-two section. For a
preview, the version uses a prerelease suffix such as `0.2.0-preview.1`. The shared release workflow
creates the matching `v<version>` tag after the version and changelog contract passes. The GitHub
prerelease contains:

- `Flowset-<tag-without-v>-arm64.zip`
- the matching `.sha256` file
- a generated `playlist-optimizer.rb` Homebrew cask

The zip contains exactly one `Flowset.app`. Its bundle identifier remains
`com.discolotus.playlist-optimizer` so existing installs, permissions, and app data continue to
resolve to the same application. Its minimum macOS version is 15.2. The Homebrew cask token also
remains `playlist-optimizer` for upgrade compatibility.

## Local release rehearsal

From a clean checkout on an Apple-silicon Mac:

```bash
make setup
make test
make lint
make build
make test-api-runtime-smoke
make test-audio-export-smoke
./scripts/package_shared_release.sh
python3 scripts/smoke_test_api_runtime.py \
  --sidecar "src-tauri/target/release/bundle/macos/Flowset.app/Contents/MacOS/playlist-optimizer-api" \
  --model-dir "src-tauri/target/release/bundle/macos/Flowset.app/Contents/Resources/models/essentia"
./scripts/validate_macos_release.sh \
  dist/release/Flowset-0.2.0-preview.2-arm64.zip \
  --allow-unsigned
```

The package command builds the sidecar and app, copies the repository and Essentia license notices
into the app, applies an internally consistent ad-hoc signature without hardened runtime,
validates it, creates a deterministic release filename, and writes its SHA-256 checksum. Hardened
runtime is reserved for the future Developer ID path because a PyInstaller one-file sidecar must
have its extracted native libraries signed consistently before library validation can be enabled.

## CI release

Pull requests run the reusable
`discolotus/release-workflows/.github/workflows/validate-release.yml@v1` contract in addition to the
app-specific CI matrix. It requires an increased `VERSION`, matching non-empty changelog notes, and
an unused tag. After merge, the thin `.github/workflows/release.yml` caller invokes
`release-macos-app.yml@v1` on the Apple-silicon runner. The shared workflow validates the contract
again, runs Flowset's full web/API/native/codec verification, packages and validates the app,
checks the generated cask, creates the tag, and publishes the prerelease and its artifacts.

Release orchestration lives in `discolotus/release-workflows`; this repository retains only its
app-specific dependency setup, verification commands, and package construction.

## Homebrew tap update

The separate public repository `discolotus/homebrew-tap` owns
`Casks/playlist-optimizer.rb`. After a GitHub prerelease is available:

```bash
./scripts/generate_homebrew_cask.sh \
  --version 0.2.0-preview.2 \
  --sha256 "$(cut -d ' ' -f 1 \
    dist/release/Flowset-0.2.0-preview.2-arm64.zip.sha256)" \
  --output /path/to/homebrew-tap/Casks/playlist-optimizer.rb

brew audit --cask --strict /path/to/homebrew-tap/Casks/playlist-optimizer.rb
brew install --cask /path/to/homebrew-tap/Casks/playlist-optimizer.rb
```

The `discolotus/homebrew-tap` scheduled reusable workflow imports the published
`playlist-optimizer.rb` asset listed in `release-sources.json`. Once that tap update is pushed,
users install this explicitly unsigned preview with:

```bash
brew tap discolotus/tap
brew install --cask playlist-optimizer
```

Because the app has no Developer ID signature, macOS will block its first launch. Users should
verify that the cask URL points to `discolotus/spotify-playlist-optimizer`, confirm Homebrew's
downloaded SHA-256 matches the release checksum, and then use **System Settings → Privacy &
Security → Open Anyway** for Flowset. That explicit Gatekeeper exception should never
be used for an unverified artifact.

## Clean-install verification

The release is not complete until a fresh cask installation proves all of the following:

1. Homebrew downloads the public GitHub artifact and verifies its checksum.
2. `/Applications/Flowset.app` passes `codesign --verify --deep --strict`.
3. The packaged API handles health, capabilities, recipe preview, local-folder import, ranged audio
   preview, and traversal rejection over its real loopback HTTP boundary.
4. The real FFmpeg smoke tests export MP3 from MP3, FLAC, Opus, and DFF inputs and transcode Opus
   to both FLAC and MP3 for Rekordbox compatibility.
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
