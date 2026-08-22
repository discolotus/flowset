# Third-party notices

Flowset's original source code is licensed under the MIT License. The packaged macOS
preview also contains third-party components whose licenses continue to apply.

## Optional local CLAP semantic ranking

Flowset does not bundle CLAP software or model weights. The explicit setup command downloads the
pinned `lukewys/laion_clap` `630k-audioset-best.pt` checkpoint, whose model card declares CC0-1.0,
and its required tokenizer/encoder artifacts. Operators must still review the selected package and
transitive dependency terms.

- LAION-AI CLAP source: <https://github.com/LAION-AI/CLAP>
- Provisioned checkpoint: <https://huggingface.co/lukewys/laion_clap>

## Optional local MuQ-MuLan and MERT experiments

Flowset bundles neither MuQ-MuLan nor MERT software, runtime dependencies, nor model weights. Their
explicit setup commands download pinned artifacts only after the operator accepts the applicable
restrictions. MuQ code is MIT licensed; published MuQ and MuQ-MuLan weights are CC-BY-NC-4.0. MERT
weights are also CC-BY-NC-4.0. Operators must review all applicable code, dataset, and checkpoint
terms. MERT is exposed only for music embeddings and reference-track similarity, not text-language
scoring; its checksummed local `configuration_MERT.py` and `modeling_MERT.py` execute when loaded.

- MuQ official source: <https://github.com/tencent-ailab/MuQ>
- MuQ-MuLan model card: <https://huggingface.co/OpenMuQ/MuQ-MuLan-large>
- MERT official source: <https://github.com/yizhilll/MERT>
- Provisioned MERT model card: <https://huggingface.co/m-a-p/MERT-v1-95M>

## Essentia and model files

The frozen API sidecar includes `essentia-tensorflow` 2.1 beta 6 dev 1389. Essentia is distributed
under the GNU Affero General Public License version 3 for non-commercial applications. The release
packager copies the license text shipped by the installed Python distribution into
`Flowset.app/Contents/Resources/licenses/ESSENTIA-AGPL-3.0.txt`.

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
