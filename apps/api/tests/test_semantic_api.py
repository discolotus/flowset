import os
import sys
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from playlist_optimizer.main import app
from playlist_optimizer.semantic import (
    LocalClapBackend,
    LocalMertBackend,
    LocalMuqMulanBackend,
    SemanticBackendCapabilities,
    SemanticRankResult,
    get_semantic_backend,
    get_semantic_registry,
)


class FakeSemanticBackend:
    def capabilities(self) -> SemanticBackendCapabilities:
        return SemanticBackendCapabilities(
            id="fake-clap", display_name="Fake CLAP", model="fake/checkpoint-v1", available=True
        )

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        return [
            SemanticRankResult(relative_path=audio_paths[0].name, scores={labels[0]: 0.9}),
            SemanticRankResult(relative_path=audio_paths[1].name, scores={}),
        ]


class MalformedBackend(FakeSemanticBackend):
    def __init__(self, scores: dict[str, float]):
        self.scores = scores

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        return [SemanticRankResult(relative_path=str(audio_paths[0]), scores=self.scores)]


class FakeMuqBackend(FakeSemanticBackend):
    def capabilities(self) -> SemanticBackendCapabilities:
        return SemanticBackendCapabilities(
            id="local-muq-mulan",
            display_name="Local MuQ-MuLan",
            model="muq-local-v1",
            available=True,
            capabilities=["text_similarity", "embedding_extraction"],
        )

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        return [
            SemanticRankResult(relative_path=str(path), scores={labels[0]: 0.75})
            for path in audio_paths
        ]

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        return [[1.0, float(index)] for index, _ in enumerate(audio_paths)]


class FakeMertBackend(FakeSemanticBackend):
    def capabilities(self) -> SemanticBackendCapabilities:
        return SemanticBackendCapabilities(
            id="local-mert",
            display_name="Local MERT",
            model="mert-local-v1",
            available=True,
            capabilities=["reference_similarity", "embedding_extraction"],
            embedding_dimension=2,
        )

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        return [[1.0, 0.0], [0.0, 1.0], [0.6, 0.8]][: len(audio_paths)]


class FakeRegistry:
    def __init__(self, *backends: FakeSemanticBackend):
        self.backends = {backend.capabilities().id: backend for backend in backends}

    def infos(self):
        return [backend.capabilities() for backend in self.backends.values()]

    def get(self, backend_id: str):
        return self.backends.get(backend_id)


def test_muq_text_ranking_is_selected_explicitly_and_model_bound(tmp_path: Path) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(FakeMuqBackend())
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path, muq_mulan_checkpoint=tmp_path / "muq.ckpt", _env_file=None
    )
    try:
        client = TestClient(app)
        capabilities = client.get("/api/v1/semantic/backends").json()
        response = client.post(
            "/api/v1/semantic/rank",
            json={
                "backend_id": "local-muq-mulan",
                "labels": ["hypnotic sunrise"],
                "audio_paths": {"track-1": "one.wav"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert capabilities[0]["capabilities"] == ["text_similarity", "embedding_extraction"]
    assert response.status_code == 200
    assert response.json()["score_key"] == "semantic:local-muq-mulan:muq-local-v1:hypnotic sunrise"


def test_mert_reference_similarity_is_deterministic_and_never_a_text_score(tmp_path: Path) -> None:
    for name in ("reference.wav", "other.wav", "near.wav"):
        (tmp_path / name).write_bytes(name.encode())
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(FakeMertBackend())
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path, _env_file=None
    )
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/semantic/reference-rank",
            json={
                "backend_id": "local-mert",
                "reference_track_id": "ref",
                "audio_paths": {"ref": "reference.wav", "other": "other.wav", "near": "near.wav"},
            },
        )
        rejected = client.post(
            "/api/v1/semantic/rank",
            json={
                "backend_id": "local-mert",
                "labels": ["warm"],
                "audio_paths": {"ref": "reference.wav"},
            },
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert [item["scores"][0]["score"] for item in response.json()["results"]] == [1.0, 0.0, 0.6]
    assert rejected.status_code == 422


def test_embedding_extraction_is_typed_model_bound_and_batch_bounded(tmp_path: Path) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(FakeMuqBackend())
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path,
        semantic_max_embeddings=1,
        semantic_max_embedding_dimension=4,
        _env_file=None,
    )
    try:
        response = TestClient(app).post(
            "/api/v1/semantic/embeddings",
            json={
                "backend_id": "local-muq-mulan",
                "audio_paths": {"one": "one.wav"},
            },
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert response.json()["dimension"] == 2
    assert response.json()["backend"]["model"] == "muq-local-v1"
    assert response.json()["embeddings"] == [{"track_id": "one", "values": [1.0, 0.0]}]


def test_semantic_rank_returns_provenance_bound_scores_and_missing_results(tmp_path: Path) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    (tmp_path / "two.wav").write_bytes(b"two")
    app.dependency_overrides[get_semantic_backend] = lambda: FakeSemanticBackend()
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path, clap_checkpoint="fake/checkpoint-v1", _env_file=None
    )
    try:
        response = TestClient(app).post(
            "/api/v1/semantic/rank",
            json={
                "labels": ["  Peak   Time  "],
                "audio_paths": {"track-1": "one.wav", "track-2": "two.wav"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["backend"]["model"] == "fake/checkpoint-v1"
    assert body["score_key"] == "semantic:fake-clap:fake/checkpoint-v1:peak time"
    assert body["results"][0]["scores"][0]["label"] == "Peak Time"
    assert body["results"][0]["scores"][0]["score"] == 0.9
    assert body["results"][1]["status"] == "unavailable"
    assert body["missing_track_ids"] == ["track-2"]


def test_semantic_rank_rejects_escaping_paths(tmp_path: Path) -> None:
    app.dependency_overrides[get_semantic_backend] = lambda: FakeSemanticBackend()
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path, clap_checkpoint="fake/checkpoint-v1", _env_file=None
    )
    try:
        response = TestClient(app).post(
            "/api/v1/semantic/rank",
            json={"labels": ["warm"], "audio_paths": {"track-1": "../secret.wav"}},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400


def test_semantic_rank_rejects_non_finite_backend_scores_as_502(tmp_path: Path) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    app.dependency_overrides[get_semantic_backend] = lambda: MalformedBackend(
        {"warm": float("nan")}
    )
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path, _env_file=None
    )
    try:
        response = TestClient(app).post(
            "/api/v1/semantic/rank", json={"labels": ["warm"], "audio_paths": {"one": "one.wav"}}
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 502


def test_checkpoint_without_required_runtime_is_not_available(tmp_path: Path, monkeypatch) -> None:
    checkpoint = tmp_path / "clap.pt"
    checkpoint.write_bytes(b"checkpoint")
    monkeypatch.setattr("playlist_optimizer.semantic.find_spec", lambda _name: None)
    capabilities = LocalClapBackend(checkpoint).capabilities()
    assert capabilities.available is False
    assert "laion_clap missing" in (capabilities.detail or "")


def test_muq_rank_loads_one_eval_model_offline_and_prefers_upstream_similarity(
    tmp_path: Path, monkeypatch
) -> None:
    checkpoint = tmp_path / "local-muq"
    checkpoint.mkdir()
    (checkpoint / "config.json").write_text('{"model": "test"}')
    (checkpoint / "pytorch_model.bin").write_bytes(b"weights")
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeModel:
        def load_state_dict(self, state, *, strict):
            calls.append(("load_state_dict", {"state": state, "strict": strict}))

        def eval(self):
            calls.append(("eval", {}))
            return self

        def __call__(self, *, wavs=None, texts=None):
            assert wavs is None
            return [[0.0, 1.0] for _ in texts]

        def calc_similarity(self, audio, text):
            calls.append(("calc_similarity", {"audio": audio, "text": text}))
            return [[0.75]]

    class FakeMuQMuLan(FakeModel):
        def __init__(self, config, *, hf_hub_cache_dir):
            calls.append(("init", {"config": config, "cache": hf_hub_cache_dir}))
            assert os.environ["HF_HUB_OFFLINE"] == "1"
            assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
            assert Path(hf_hub_cache_dir).resolve() == (checkpoint / "hf-cache").resolve()

    monkeypatch.setitem(sys.modules, "muq", SimpleNamespace(MuQMuLan=FakeMuQMuLan))
    monkeypatch.setitem(
        sys.modules,
        "torch",
        SimpleNamespace(
            inference_mode=nullcontext,
            as_tensor=lambda value: value,
            load=lambda path, **options: {"weight": 1},
        ),
    )
    backend = LocalMuqMulanBackend(checkpoint)
    monkeypatch.setattr(backend, "_embed_with_model", lambda model, paths: [[1.0, 0.0]])

    result = backend.rank([tmp_path / "audio.wav"], ["warm"])

    assert any(call[0] == "init" for call in calls)
    assert ("load_state_dict", {"state": {"weight": 1}, "strict": True}) in calls
    assert ("eval", {}) in calls
    assert any(call[0] == "calc_similarity" for call in calls)
    assert result[0].scores == {"warm": 0.75}


def test_muq_missing_nested_local_artifact_fails_without_download(
    tmp_path: Path, monkeypatch
) -> None:
    checkpoint = tmp_path / "local-muq"
    checkpoint.mkdir()
    (checkpoint / "config.json").write_text('{"model": "test"}')

    class FakeMuQMuLan:
        def __init__(self, config, *, hf_hub_cache_dir):
            assert config == {"model": "test"}
            assert Path(hf_hub_cache_dir).resolve() == (checkpoint / "hf-cache").resolve()
            assert os.environ["HF_HUB_OFFLINE"] == "1"
            assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
            raise OSError("OpenMuQ/MuQ-large-msd-iter is not cached")

    monkeypatch.setitem(sys.modules, "muq", SimpleNamespace(MuQMuLan=FakeMuQMuLan))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace())
    with pytest.raises(RuntimeError, match="absent or invalid"):
        _ = LocalMuqMulanBackend(checkpoint)._model


def test_mert_uses_trusted_local_checkpoint_and_extractor_sample_rate(
    tmp_path: Path, monkeypatch
) -> None:
    checkpoint = tmp_path / "local-mert"
    checkpoint.mkdir()
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")
    loads: list[tuple[str, str, dict[str, object]]] = []
    audio_loads: list[dict[str, object]] = []
    extractor_calls: list[dict[str, object]] = []

    class FakeHidden:
        def mean(self, dim):
            assert dim == 1
            return self

        def __getitem__(self, index):
            assert index == 0
            return self

        def detach(self):
            return self

        def cpu(self):
            return self

        def tolist(self):
            return [1.0, 2.0]

    class FakeExtractor:
        sampling_rate = 16000

        def __call__(self, audio, **options):
            extractor_calls.append(options)
            return {"input_values": audio}

    class FakeModel:
        def eval(self):
            return self

        def __call__(self, **inputs):
            return SimpleNamespace(last_hidden_state=FakeHidden())

    class FakeAutoFeatureExtractor:
        @classmethod
        def from_pretrained(cls, identifier, **options):
            loads.append(("extractor", identifier, options))
            return FakeExtractor()

    class FakeAutoModel:
        @classmethod
        def from_pretrained(cls, identifier, **options):
            loads.append(("model", identifier, options))
            return FakeModel(), {
                "missing_keys": [],
                "unexpected_keys": [],
                "mismatched_keys": [],
            }

    def fake_load(path, **options):
        audio_loads.append({"path": path, **options})
        return [0.0], options["sr"]

    monkeypatch.setitem(sys.modules, "librosa", SimpleNamespace(load=fake_load))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(inference_mode=nullcontext))
    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            AutoFeatureExtractor=FakeAutoFeatureExtractor,
            AutoModel=FakeAutoModel,
        ),
    )

    assert LocalMertBackend(checkpoint).embed([audio_path]) == [[1.0, 2.0]]
    assert loads == [
        ("extractor", str(checkpoint), {"local_files_only": True}),
        (
            "model",
            str(checkpoint),
            {
                "local_files_only": True,
                "trust_remote_code": True,
                "output_loading_info": True,
            },
        ),
    ]
    assert audio_loads == [{"path": audio_path, "sr": 16000, "mono": True, "duration": 30}]
    assert extractor_calls == [{"sampling_rate": 16000, "return_tensors": "pt"}]
