# Learning studio

The **Learn** workspace is a dedicated reference and practice page for Flowset’s four music-analysis packages. It opens from primary navigation and loads its large reference catalog only when requested.

## User stories

- As a listener, I can understand why CLAP and MuQ-MuLan may rank the same songs differently, then run the same prompts on the same source pool in Semantic Lab.
- As a curious user, I can see each package’s documented music-facing capabilities, filter features by availability, and distinguish upstream APIs from Flowset workflows.
- As a developer, I can search every registered algorithm in the pinned Essentia Python runtime by algorithm, category, input, output, or parameter name, expand its interface, and open its official reference.
- As a learner, I can manipulate fictional vector directions and a synthetic waveform to understand similarity and RMS without installing models or triggering inference.
- As a library owner, I can inspect all 17 Essentia fields on an already selected track, see missing values and provider provenance, and audition local audio explicitly.
- As a researcher, I can follow official README, source API, paper, checkpoint/model-card, tutorial, and license links instead of relying only on a short in-app explanation.

## Inventory scope

The page covers CLAP (`laion-clap==1.1.7`), MuQ and MuQ-MuLan (`muq==0.1.0`), MERT-v1-95M, and Essentia (`essentia-tensorflow==2.1b6.dev1389`). It is not a list of every transitive software dependency. Generic inherited PyTorch/Transformers methods and private helper implementations are outside the curated music-facing capability inventory.

Essentia is unusually broad: the shipped JSON indexes **272 unique registered Python algorithms**, with **262 standard** and **256 streaming** registrations, across **20 categories**. It includes mode-specific input/output/parameter names and types. It excludes C++-only templates and separately distributed checkpoint weights, which have links to their complete upstream references. Registration in this snapshot does not claim each algorithm has a Flowset UI or that every model-zoo checkpoint is installed.

The source of the registry is the installed pinned Essentia package’s `algorithmNames()` and `__struct__` interfaces. Regenerate it from the repo root with:

```sh
apps/api/.venv/bin/python scripts/generate_learning_catalog.py
```

The generator refuses a different package version. It runs no inference and reads no music. Catalog prose is not copied from upstream; only technical identifiers and interface types are included. Individual documentation links go to Essentia’s current online development reference, which may differ from the pinned version.

## Primary references

- [CLAP README](https://github.com/LAION-AI/CLAP), [public inference API](https://github.com/LAION-AI/CLAP/blob/main/src/laion_clap/hook.py), and [paper](https://arxiv.org/abs/2211.06687).
- [MuQ and MuQ-MuLan README](https://github.com/tencent-ailab/MuQ), [MuLan API](https://github.com/tencent-ailab/MuQ/blob/main/src/muq/muq_mulan/muq_mulan.py), and [paper](https://arxiv.org/abs/2501.01108).
- [MERT README](https://github.com/yizhilll/MERT), [95M model card](https://huggingface.co/m-a-p/MERT-v1-95M), and [paper](https://arxiv.org/abs/2306.00107).
- [Essentia overview](https://essentia.upf.edu/documentation.html), [algorithm reference](https://essentia.upf.edu/algorithms_reference.html), [model zoo](https://essentia.upf.edu/models.html), and [interactive demos](https://essentia.upf.edu/demos.html).

These were checked on 2026-09-05. Flowset-specific preprocessing and exposed fields were checked against `semantic.py` and `providers/essentia.py`: MuQ-MuLan and MERT consume at most the first 30 seconds, MERT mean-pools its final hidden state, and Essentia exposes 12 DSP-derived descriptors plus 5 model estimates. The misleading breadth of MERT’s existing `whole_track` identity is explained rather than silently claiming full-song inference.

## Demo boundaries

- Similarity visualization: real cosine arithmetic on explicitly fictional 2D vectors, not model inference.
- Signal visualization: real RMS arithmetic on a synthetic sine wave in the browser, not Essentia inference.
- Measurement inspector: real existing selected-track data with explicit provenance, unavailable-value states, and `preload="none"` local playback.
- Guided experiments: navigation into existing real local workflows; the user chooses sources, backend, batch, and run action there. No automatic inference, uploads, model provisioning, playlist promotion, or export occurs on the Learning page.
- Upstream features without Flowset controls have source/reference links, not fabricated runnable demos.
