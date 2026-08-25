from concurrent.futures import Future, ThreadPoolExecutor
from threading import Event, Lock

import playlist_optimizer.semantic_embedding_cache as cache_module
from playlist_optimizer.semantic_artifacts import PersistentSemanticArtifactStore
from playlist_optimizer.semantic_embedding_cache import (
    EmbeddingCacheKey,
    EmbeddingInferenceCache,
)


def key(*, model: str = "model-v1", representation: str = "mean-v1", path: str = "one.wav"):
    return EmbeddingCacheKey(
        backend_id="local-muq-mulan",
        model=model,
        representation=representation,
        relative_path=path,
        size=3,
        modified_time_ns=100,
    )


def test_cache_hits_skip_inference_and_space_changes_invalidate() -> None:
    cache = EmbeddingInferenceCache(capacity=8)
    calls = 0

    def compute() -> list[float]:
        nonlocal calls
        calls += 1
        return [1.0, 0.0]

    assert cache.get_or_compute(key(), compute).status == "miss"
    assert cache.get_or_compute(key(), compute).status == "hit"
    assert cache.get_or_compute(key(model="model-v2"), compute).status == "miss"
    assert cache.get_or_compute(key(representation="layer-6-mean-v1"), compute).status == "miss"
    assert calls == 3


def test_cache_is_lru_bounded() -> None:
    cache = EmbeddingInferenceCache(capacity=2)
    calls = 0

    def compute() -> list[float]:
        nonlocal calls
        calls += 1
        return [float(calls)]

    cache.get_or_compute(key(path="one.wav"), compute)
    cache.get_or_compute(key(path="two.wav"), compute)
    assert cache.get_or_compute(key(path="one.wav"), compute).status == "hit"
    third = cache.get_or_compute(key(path="three.wav"), compute)
    assert third.evictions == 1
    assert cache.size == 2
    assert cache.get_or_compute(key(path="two.wav"), compute).status == "miss"
    assert calls == 4


def test_concurrent_requests_deduplicate_one_inference(monkeypatch) -> None:
    cache = EmbeddingInferenceCache(capacity=2)
    started = Event()
    waiter_started = Event()
    release = Event()
    calls = 0
    calls_lock = Lock()

    class TrackingFuture(Future[tuple[float, ...]]):
        def result(self, timeout=None):
            waiter_started.set()
            return super().result(timeout)

    monkeypatch.setattr(cache_module, "Future", TrackingFuture)

    def compute() -> list[float]:
        nonlocal calls
        with calls_lock:
            calls += 1
        started.set()
        assert release.wait(timeout=2)
        return [0.25, 0.75]

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(cache.get_or_compute, key(), compute)
        assert started.wait(timeout=2)
        second = executor.submit(cache.get_or_compute, key(), compute)
        assert waiter_started.wait(timeout=2)
        release.set()
        statuses = {first.result(timeout=2).status, second.result(timeout=2).status}

    assert statuses == {"miss", "deduplicated"}
    assert calls == 1


def test_persistent_l2_cache_survives_l1_restart(tmp_path) -> None:
    audio = tmp_path / "one.wav"
    audio.write_bytes(b"one")
    stat = audio.stat()
    persistent = PersistentSemanticArtifactStore(
        tmp_path / "semantic.sqlite3", enable_vector_extension=False
    )
    artifact_key = EmbeddingCacheKey(
        backend_id="local-muq-mulan",
        model="model-v1",
        representation="mean-v1",
        relative_path="one.wav",
        size=stat.st_size,
        modified_time_ns=stat.st_mtime_ns,
        library_id="library-a",
        preprocessing="mono-24khz-v1",
        segment_policy="first-30s-v1",
    )
    calls = 0

    def compute() -> list[float]:
        nonlocal calls
        calls += 1
        return [1.0, 0.0]

    first = EmbeddingInferenceCache(capacity=2, persistent=persistent)
    assert first.get_or_compute(artifact_key, compute, audio_path=audio).status == "miss"

    restarted = EmbeddingInferenceCache(capacity=2, persistent=persistent)
    assert restarted.get_or_compute(artifact_key, compute, audio_path=audio).status == "hit"
    assert calls == 1
