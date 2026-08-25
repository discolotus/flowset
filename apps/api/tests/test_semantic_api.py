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
from playlist_optimizer.semantic_artifacts import PersistentSemanticArtifactStore
from playlist_optimizer.semantic_embedding_cache import (
    EmbeddingInferenceCache,
    get_semantic_embedding_cache,
)


class FakeSemanticBackend:
    def capabilities(self) -> SemanticBackendCapabilities:
        return SemanticBackendCapabilities(
            id="fake-clap", display_name="Fake CLAP", model="fake/checkpoint-v1", available=True
        )

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        return [
            SemanticRankResult(
                relative_path=audio_paths[0].name,
                scores={label: 0.9 - index * 0.1 for index, label in enumerate(labels)},
            ),
            SemanticRankResult(relative_path=audio_paths[1].name, scores={}),
        ]


class MalformedBackend(FakeSemanticBackend):
    def __init__(self, scores: dict[str, float]):
        self.scores = scores

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        return [SemanticRankResult(relative_path=str(audio_paths[0]), scores=self.scores)]


class FakeMuqBackend(FakeSemanticBackend):
    def __init__(self):
        self.embed_calls = 0
        self.model = "muq-local-v1"
        self.representation = "muq-test-mean-v1"

    def capabilities(self) -> SemanticBackendCapabilities:
        return SemanticBackendCapabilities(
            id="local-muq-mulan",
            display_name="Local MuQ-MuLan",
            model=self.model,
            available=True,
            capabilities=["text_similarity", "embedding_extraction"],
            embedding_representation=self.representation,
        )

    def rank(self, audio_paths: list[Path], labels: list[str]) -> list[SemanticRankResult]:
        return [
            SemanticRankResult(relative_path=str(path), scores={labels[0]: 0.75})
            for path in audio_paths
        ]

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        self.embed_calls += 1
        return [[1.0, float(index)] for index, _ in enumerate(audio_paths)]


class PartiallyFailingMuqBackend(FakeMuqBackend):
    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        self.embed_calls += 1
        if audio_paths[0].name == "broken.wav":
            raise RuntimeError("could not decode /private/authorized/broken.wav")
        return [[1.0, 0.0]]


class FakeMertBackend(FakeSemanticBackend):
    def capabilities(self) -> SemanticBackendCapabilities:
        return SemanticBackendCapabilities(
            id="local-mert",
            display_name="Local MERT",
            model="mert-local-v1",
            available=True,
            capabilities=["reference_similarity", "embedding_extraction"],
            embedding_dimension=2,
            default_representation={
                "layer": "last_hidden_state",
                "pooling": "mean",
                "segment": "whole_track",
            },
            supported_representations=[{
                "layer": "last_hidden_state",
                "pooling": "mean",
                "segment": "whole_track",
            }],
        )

    def embed(self, audio_paths: list[Path]) -> list[list[float]]:
        values = {
            "reference.wav": [1.0, 0.0],
            "other.wav": [0.0, 1.0],
            "near.wav": [0.6, 0.8],
        }
        return [values[path.name] for path in audio_paths]


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


def test_text_ranking_reuses_persisted_audio_embedding_after_l1_restart(tmp_path: Path) -> None:
    class CacheableMuq(FakeMuqBackend):
        def rank_embeddings(self, audio_paths, audio, labels):
            return [
                SemanticRankResult(
                    relative_path=str(audio_paths[0]), scores={labels[0]: audio[0][0]}
                )
            ]

    audio = tmp_path / "one.wav"
    audio.write_bytes(b"one")
    backend = CacheableMuq()
    persistent = PersistentSemanticArtifactStore(tmp_path / "semantic.sqlite3")
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(backend)
    app.dependency_overrides[get_semantic_embedding_cache] = lambda: EmbeddingInferenceCache(
        2, persistent
    )
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path,
        semantic_cache_path=None,
        _env_file=None,
    )
    payload = {
        "backend_id": "local-muq-mulan",
        "labels": ["warm"],
        "audio_paths": {"one": "one.wav"},
    }
    try:
        client = TestClient(app)
        first = client.post("/api/v1/semantic/rank", json=payload)
        app.dependency_overrides[get_semantic_embedding_cache] = lambda: EmbeddingInferenceCache(
            2, persistent
        )
        second = client.post("/api/v1/semantic/rank", json=payload)
    finally:
        app.dependency_overrides.clear()

    assert first.status_code == second.status_code == 200
    assert backend.embed_calls == 1


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
                "representation": {
                    "layer": "last_hidden_state",
                    "pooling": "mean",
                    "segment": "whole_track",
                },
            },
        )
        unsupported = client.post(
            "/api/v1/semantic/reference-rank",
            json={
                "backend_id": "local-mert",
                "reference_track_id": "ref",
                "audio_paths": {"ref": "reference.wav"},
                "representation": {
                    "layer": "hidden_state_6",
                    "pooling": "max",
                    "segment": "whole_track",
                },
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
    assert response.json()["backend"]["default_representation"] == {
        "layer": "last_hidden_state",
        "pooling": "mean",
        "segment": "whole_track",
    }
    assert response.json()["results"][0]["scores"][0]["provenance"]["representation"] == {
        "layer": "last_hidden_state",
        "pooling": "mean",
        "segment": "whole_track",
    }
    assert ":last_hidden_state:mean:whole_track:" in response.json()["score_key"]
    assert rejected.status_code == 422
    assert unsupported.status_code == 422
    assert "not advertised" in unsupported.json()["detail"]


def test_embedding_extraction_is_typed_model_bound_and_batch_bounded(tmp_path: Path) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    (tmp_path / "two.wav").write_bytes(b"two")
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(FakeMuqBackend())
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path,
        semantic_max_embeddings=1,
        semantic_max_embedding_dimension=4,
        _env_file=None,
    )
    app.dependency_overrides[get_semantic_embedding_cache] = lambda: EmbeddingInferenceCache(2)
    try:
        client = TestClient(app)
        response = client.post(
            "/api/v1/semantic/embeddings",
            json={
                "backend_id": "local-muq-mulan",
                "audio_paths": {"one": "one.wav"},
            },
        )
        oversized = client.post(
            "/api/v1/semantic/embeddings",
            json={
                "backend_id": "local-muq-mulan",
                "audio_paths": {"one": "one.wav", "two": "two.wav"},
            },
        )
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    assert oversized.status_code == 422
    assert response.json()["dimension"] == 2
    assert response.json()["backend"]["model"] == "muq-local-v1"
    assert response.json()["representation"] == "muq-test-mean-v1"
    assert response.json()["embeddings"] == [
        {
            "track_id": "one",
            "status": "complete",
            "values": [1.0, 0.0],
            "cache_status": "miss",
            "error": None,
        }
    ]
    assert response.json()["cache"] == {
        "hits": 0,
        "misses": 1,
        "deduplicated": 0,
        "evictions": 0,
        "entries": 1,
        "capacity": 2,
    }


def test_embedding_cache_invalidates_for_file_model_and_representation_changes(
    tmp_path: Path,
) -> None:
    audio = tmp_path / "one.wav"
    audio.write_bytes(b"one")
    backend = FakeMuqBackend()
    cache = EmbeddingInferenceCache(8)
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(backend)
    app.dependency_overrides[get_semantic_embedding_cache] = lambda: cache
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path,
        semantic_max_embeddings=1,
        semantic_max_embedding_dimension=4,
        _env_file=None,
    )
    client = TestClient(app)
    payload = {"backend_id": "local-muq-mulan", "audio_paths": {"one": "one.wav"}}
    try:
        first = client.post("/api/v1/semantic/embeddings", json=payload)
        second = client.post("/api/v1/semantic/embeddings", json=payload)
        audio.write_bytes(b"changed")
        changed_file = client.post("/api/v1/semantic/embeddings", json=payload)
        backend.model = "muq-local-v2"
        changed_model = client.post("/api/v1/semantic/embeddings", json=payload)
        backend.representation = "muq-test-layer-6-v1"
        changed_representation = client.post("/api/v1/semantic/embeddings", json=payload)
    finally:
        app.dependency_overrides.clear()

    assert [
        response.json()["embeddings"][0]["cache_status"]
        for response in [first, second, changed_file, changed_model, changed_representation]
    ] == ["miss", "hit", "miss", "miss", "miss"]
    assert backend.embed_calls == 4


def test_embedding_partial_failures_and_cache_bounds_remain_visible(tmp_path: Path) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    (tmp_path / "broken.wav").write_bytes(b"broken")
    backend = PartiallyFailingMuqBackend()
    cache = EmbeddingInferenceCache(1)
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(backend)
    app.dependency_overrides[get_semantic_embedding_cache] = lambda: cache
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path,
        semantic_max_embeddings=2,
        semantic_max_embedding_dimension=4,
        _env_file=None,
    )
    try:
        response = TestClient(app).post(
            "/api/v1/semantic/embeddings",
            json={
                "backend_id": "local-muq-mulan",
                "audio_paths": {"one": "one.wav", "broken": "broken.wav"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert [item["status"] for item in body["embeddings"]] == ["complete", "failed"]
    assert body["embeddings"][1]["values"] == []
    assert body["embeddings"][1]["cache_status"] is None
    assert "/private/" not in body["embeddings"][1]["error"]
    assert body["failed_track_ids"] == ["broken"]
    assert body["cache"]["entries"] == 1
    assert body["cache"]["capacity"] == 1


def test_persistent_neighbor_search_uses_sqlite_vec(tmp_path: Path) -> None:
    class PathAwareMuq(FakeMuqBackend):
        def embed(self, audio_paths: list[Path]) -> list[list[float]]:
            self.embed_calls += 1
            values = {
                "one.wav": [1.0, 0.0],
                "near.wav": [0.8, 0.2],
                "far.wav": [0.0, 1.0],
            }
            return [values[path.name] for path in audio_paths]

    for name in ("one.wav", "near.wav", "far.wav"):
        (tmp_path / name).write_bytes(name.encode())
    backend = PathAwareMuq()
    cache = EmbeddingInferenceCache(
        8, PersistentSemanticArtifactStore(tmp_path / "semantic.sqlite3")
    )
    app.dependency_overrides[get_semantic_registry] = lambda: FakeRegistry(backend)
    app.dependency_overrides[get_semantic_embedding_cache] = lambda: cache
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path,
        semantic_max_embeddings=3,
        semantic_max_embedding_dimension=4,
        semantic_cache_path=None,
        _env_file=None,
    )
    try:
        client = TestClient(app)
        indexed = client.post(
            "/api/v1/semantic/embeddings",
            json={
                "backend_id": "local-muq-mulan",
                "audio_paths": {
                    "one": "one.wav",
                    "near": "near.wav",
                    "far": "far.wav",
                },
            },
        )
        neighbors = client.post(
            "/api/v1/semantic/neighbors",
            json={
                "backend_id": "local-muq-mulan",
                "reference_audio_path": "one.wav",
                "limit": 2,
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert indexed.status_code == 200
    assert neighbors.status_code == 200
    assert neighbors.json()["search_engine"] == "sqlite-vec"
    assert [item["relative_path"] for item in neighbors.json()["matches"]] == [
        "one.wav",
        "near.wav",
    ]


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
                "labels": ["  Peak   Time  ", "Warm   Glow"],
                "audio_paths": {"track-1": "one.wav", "track-2": "two.wav"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["backend"]["model"] == "fake/checkpoint-v1"
    assert body["score_key"] == "semantic:fake-clap:fake/checkpoint-v1:peak time"
    assert body["score_keys_by_normalized_label"] == {
        "peak time": "semantic:fake-clap:fake/checkpoint-v1:peak time",
        "warm glow": "semantic:fake-clap:fake/checkpoint-v1:warm glow",
    }
    assert body["results"][0]["scores"][0]["label"] == "Peak Time"
    assert body["results"][0]["scores"][0]["score"] == 0.9
    assert body["results"][0]["scores"][1]["label"] == "Warm Glow"
    assert body["results"][0]["scores"][1]["score"] == pytest.approx(0.8)
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


def test_semantic_rank_rejects_absolute_missing_directory_and_symlink_escape(
    tmp_path: Path,
) -> None:
    authorized = tmp_path / "authorized"
    authorized.mkdir()
    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"outside")
    directory = authorized / "not-a-file"
    directory.mkdir()
    symlink = authorized / "escaped.wav"
    symlink.symlink_to(outside)
    app.dependency_overrides[get_semantic_backend] = lambda: FakeSemanticBackend()
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=authorized, clap_checkpoint="fake/checkpoint-v1", _env_file=None
    )
    try:
        client = TestClient(app)
        for invalid_path in (str(outside), "missing.wav", "not-a-file", "escaped.wav"):
            response = client.post(
                "/api/v1/semantic/rank",
                json={"labels": ["warm"], "audio_paths": {"track-1": invalid_path}},
            )
            assert response.status_code == 400, invalid_path
    finally:
        app.dependency_overrides.clear()


def test_semantic_rank_rejects_non_loopback_clients(tmp_path: Path) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    app.dependency_overrides[get_semantic_backend] = lambda: FakeSemanticBackend()
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path, clap_checkpoint="fake/checkpoint-v1", _env_file=None
    )
    try:
        response = TestClient(app, client=("198.51.100.1", 1234)).post(
            "/api/v1/semantic/rank",
            json={"labels": ["warm"], "audio_paths": {"track-1": "one.wav"}},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403


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


def test_semantic_rank_rejects_unrequested_or_duplicate_normalized_backend_labels(
    tmp_path: Path,
) -> None:
    (tmp_path / "one.wav").write_bytes(b"one")
    from playlist_optimizer.config import Settings, get_settings

    app.dependency_overrides[get_settings] = lambda: Settings(
        essentia_audio_root=tmp_path, _env_file=None
    )
    try:
        client = TestClient(app)
        for scores in ({"not requested": 0.5}, {"Warm": 0.5, " warm ": 0.6}):
            app.dependency_overrides[get_semantic_backend] = lambda scores=scores: MalformedBackend(
                scores
            )
            response = client.post(
                "/api/v1/semantic/rank",
                json={"labels": ["warm"], "audio_paths": {"one": "one.wav"}},
            )
            assert response.status_code == 502
    finally:
        app.dependency_overrides.clear()


def test_checkpoint_without_required_runtime_is_not_available(tmp_path: Path, monkeypatch) -> None:
    checkpoint = tmp_path / "clap.pt"
    checkpoint.write_bytes(b"checkpoint")
    monkeypatch.setattr("playlist_optimizer.semantic.find_spec", lambda _name: None)
    capabilities = LocalClapBackend(checkpoint).capabilities()
    assert capabilities.available is False
    assert "laion_clap missing" in (capabilities.detail or "")


def test_clap_checkpoint_is_unavailable_until_provisioning_manifest_exists(
    tmp_path: Path, monkeypatch
) -> None:
    checkpoint = tmp_path / "clap" / "630k-audioset-best.pt"
    checkpoint.parent.mkdir()
    checkpoint.write_bytes(b"partial checkpoint")
    monkeypatch.setattr("playlist_optimizer.semantic.find_spec", lambda _module: object())

    incomplete = LocalClapBackend(checkpoint).capabilities()

    assert incomplete.available is False
    assert "provisioning" in (incomplete.detail or "").casefold()
    (checkpoint.parent / "manifest.json").write_text("{}", encoding="utf-8")
    complete = LocalClapBackend(checkpoint).capabilities()
    assert complete.available is True


def test_clap_exposes_audio_embeddings(tmp_path: Path, monkeypatch) -> None:
    checkpoint = tmp_path / "clap" / "630k-audioset-best.pt"
    checkpoint.parent.mkdir()
    checkpoint.write_bytes(b"checkpoint")
    (checkpoint.parent / "manifest.json").write_text("{}")
    audio_path = tmp_path / "audio.wav"
    audio_path.write_bytes(b"audio")

    class FakeValue:
        def __init__(self, values):
            self.values = values

        def detach(self):
            return self

        def cpu(self):
            return self

        def tolist(self):
            return self.values

    class FakeClapModel:
        def eval(self):
            return self

    class FakeClapModule:
        def __init__(self, **options):
            assert options == {"enable_fusion": False, "amodel": "HTSAT-tiny", "device": "cpu"}
            self.model = FakeClapModel()

        def load_ckpt(self, path, *, verbose):
            assert path == str(checkpoint)
            assert verbose is False

        def get_audio_embedding_from_filelist(self, paths):
            assert paths == [str(audio_path)]
            return FakeValue([[0.25, 0.75]])

        def get_text_embedding(self, labels, *, use_tensor):
            assert use_tensor is True
            return FakeValue([[1.0, 0.0] for _ in labels])

    monkeypatch.setitem(
        sys.modules, "laion_clap", SimpleNamespace(CLAP_Module=FakeClapModule)
    )
    monkeypatch.setattr("playlist_optimizer.semantic.find_spec", lambda _module: object())
    backend = LocalClapBackend(checkpoint)

    capabilities = backend.capabilities()
    assert capabilities.capabilities == ["text_similarity", "embedding_extraction"]
    assert capabilities.embedding_representation == "clap-htsat-tiny-model-native-v1"
    assert backend.embed([audio_path]) == [[0.25, 0.75]]


@pytest.mark.parametrize("backend_class", [LocalMuqMulanBackend, LocalMertBackend])
def test_directory_checkpoint_is_unavailable_until_provisioning_manifest_exists(
    backend_class, tmp_path: Path, monkeypatch
) -> None:
    checkpoint = tmp_path / "checkpoint"
    checkpoint.mkdir()
    monkeypatch.setattr("playlist_optimizer.semantic.find_spec", lambda _module: object())

    incomplete = backend_class(checkpoint).capabilities()

    assert incomplete.available is False
    assert "provisioning" in (incomplete.detail or "").casefold()
    (checkpoint / "manifest.json").write_text("{}", encoding="utf-8")
    complete = backend_class(checkpoint).capabilities()
    assert complete.available is True


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
    backend.rank([tmp_path / "audio.wav"], ["warm"])

    assert sum(call[0] == "init" for call in calls) == 1
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


def test_mert_rejects_incomplete_checkpoint_diagnostics(tmp_path: Path, monkeypatch) -> None:
    checkpoint = tmp_path / "local-mert"
    checkpoint.mkdir()

    class FakeAutoFeatureExtractor:
        @classmethod
        def from_pretrained(cls, identifier, **options):
            return object()

    class FakeAutoModel:
        @classmethod
        def from_pretrained(cls, identifier, **options):
            return object(), {
                "missing_keys": ["encoder.layer.0.weight"],
                "unexpected_keys": [],
                "mismatched_keys": [],
            }

    monkeypatch.setitem(sys.modules, "librosa", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace())
    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            AutoFeatureExtractor=FakeAutoFeatureExtractor,
            AutoModel=FakeAutoModel,
        ),
    )

    with pytest.raises(RuntimeError, match="trusted local checkpoint"):
        _ = LocalMertBackend(checkpoint)._runtime
