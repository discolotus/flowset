# Third-party notices

Playlist Optimizer's original source code is licensed under the MIT License. The packaged macOS
preview also contains third-party components whose licenses continue to apply.

## Essentia and model files

The frozen API sidecar includes `essentia-tensorflow` 2.1 beta 6 dev 1389. Essentia is distributed
under the GNU Affero General Public License version 3 for non-commercial applications. The release
packager copies the license text shipped by the installed Python distribution into
`Playlist Optimizer.app/Contents/Resources/licenses/ESSENTIA-AGPL-3.0.txt`.

The nine bundled Essentia model and metadata files are provided by the Music Technology Group,
Universitat Pompeu Fabra. Their published terms are Creative Commons
Attribution-NonCommercial-NoDerivatives 4.0 for non-commercial use. Commercial use requires a
separate proprietary license from UPF.

- Essentia licensing: <https://essentia.upf.edu/licensing_information.html>
- Essentia source: <https://github.com/MTG/essentia>
- Model source: <https://essentia.upf.edu/models/>

The unsigned preview is therefore offered for personal and non-commercial evaluation. Anyone
planning commercial distribution or use must independently clear Essentia, its models, and its
transitive native-library obligations.

## FFmpeg

FFmpeg is not copied into the current preview app. The Homebrew cask declares Homebrew's `ffmpeg`
formula as a runtime dependency. FFmpeg and its enabled codecs remain subject to their own license
terms:

- <https://ffmpeg.org/legal.html>

## Full dependency inventory

The lockfiles in this repository are the reproducible inventory for JavaScript, Rust, and Python
dependencies. Their own copyright and license notices remain in force. This notice is not legal
advice and does not replace a dependency-specific review before a commercial or notarized release.
