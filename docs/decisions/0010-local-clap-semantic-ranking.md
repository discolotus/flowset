# 0010: Optional local semantic ranking

Status: accepted

## Context

Users want both open-ended text-to-music ranking and musically useful similarity without pretending every embedding model understands language. A semantic score is meaningful only with its query or reference and the exact backend/model that produced it.

## Decision

- Semantic analysis is a typed provider boundary separate from catalog metadata and musical-feature providers.
- Local CLAP is disabled unless `CLAP_CHECKPOINT` is explicitly set. Flowset does not download or redistribute checkpoints.
- MuQ-MuLan is disabled unless `MUQ_MULAN_CHECKPOINT` points to an explicit local checkpoint. It supports text similarity and bounded embedding extraction.
- MERT is disabled unless `MERT_CHECKPOINT` points to an explicit local checkpoint. MERT does not produce text-label scores; cosine similarity to a selected reference track provides its deterministic recipe score.
- The HTTP ranking surface is loopback-only, accepts at most the advertised track/label bounds, and resolves only relative paths beneath `CLAP_AUDIO_ROOT` (falling back to `ESSENTIA_AUDIO_ROOT`). Absolute paths, traversal, missing files, and directories are rejected.
- Labels are whitespace-normalized and case-folded for identity while retaining a cleaned display label. Score keys have the form `semantic:<backend>:<model>:<normalized-label>`.
- Each score carries backend/model provenance. Missing results remain explicit and tracks remain inspectable.
- A selected semantic score can drive distribution, split, subgroup, and scoped sort.
- Capability metadata distinguishes `text_similarity`, `reference_similarity`, and `embedding_extraction`. Extraction is a separate bounded response and embeddings are never added to normal `Track` export objects.

## Setup

Install only the optional runtime needed, obtain its checkpoint separately, review its license, and set the corresponding checkpoint path. Set `CLAP_AUDIO_ROOT` to the smallest directory containing authorized audio. The capabilities list reports each backend truthfully until configured. Runtime loaders are invoked lazily and in local-only mode; incompatible runtimes are rejected rather than allowed to fetch weights.

## Security and privacy

Audio is read locally and is not uploaded by this backend. Binding to loopback is still required in deployment; endpoint checks are defense in depth, not a substitute for a loopback listener. Checkpoint loading executes parser/runtime code, so use only trusted checkpoint files.

Flowset forces Hugging Face Hub and Transformers offline mode before loading CLAP or MuQ-MuLan.
The LAION CLAP runtime also needs its `roberta-base` tokenizer in the local Hugging Face cache, and
MuQ-MuLan may reference nested audio/text foundation models; missing artifacts fail rather than
being downloaded implicitly.

## Licensing

Flowset's MIT license does not grant rights to CLAP, MuQ-MuLan, or MERT code, model weights, training data, or analyzed audio. No optional package or checkpoint is bundled. Operators are responsible for reviewing dependency and checkpoint licenses and for having permission to analyze their audio.
