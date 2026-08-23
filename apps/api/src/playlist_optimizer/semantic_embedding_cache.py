from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from dataclasses import dataclass
from functools import lru_cache
from threading import Lock
from typing import Literal

from playlist_optimizer.config import get_settings

EmbeddingCacheStatus = Literal["hit", "miss", "deduplicated"]


@dataclass(frozen=True)
class EmbeddingCacheKey:
    backend_id: str
    model: str
    representation: str
    relative_path: str
    size: int
    modified_time_ns: int


@dataclass(frozen=True)
class EmbeddingCacheLookup:
    values: list[float]
    status: EmbeddingCacheStatus
    evictions: int = 0


class EmbeddingInferenceCache:
    """A bounded process-local cache for raw semantic embeddings.

    Entries are deliberately not serializable and never leave the API process except through the
    explicit embeddings response. In-flight futures make concurrent requests for an identical
    track and embedding space share one model invocation.
    """

    def __init__(self, capacity: int):
        if capacity < 1:
            raise ValueError("Embedding cache capacity must be positive")
        self.capacity = capacity
        self._entries: OrderedDict[EmbeddingCacheKey, tuple[float, ...]] = OrderedDict()
        self._in_flight: dict[EmbeddingCacheKey, Future[tuple[float, ...]]] = {}
        self._lock = Lock()

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._entries)

    def get_or_compute(
        self,
        key: EmbeddingCacheKey,
        compute: Callable[[], list[float]],
    ) -> EmbeddingCacheLookup:
        with self._lock:
            cached = self._entries.get(key)
            if cached is not None:
                self._entries.move_to_end(key)
                return EmbeddingCacheLookup(values=list(cached), status="hit")
            future = self._in_flight.get(key)
            owner = future is None
            if future is None:
                future = Future()
                self._in_flight[key] = future

        if not owner:
            return EmbeddingCacheLookup(values=list(future.result()), status="deduplicated")

        try:
            computed = tuple(float(value) for value in compute())
        except BaseException as exc:
            with self._lock:
                self._in_flight.pop(key, None)
            future.set_exception(exc)
            raise

        evictions = 0
        with self._lock:
            self._entries[key] = computed
            self._entries.move_to_end(key)
            while len(self._entries) > self.capacity:
                self._entries.popitem(last=False)
                evictions += 1
            self._in_flight.pop(key, None)
        future.set_result(computed)
        return EmbeddingCacheLookup(values=list(computed), status="miss", evictions=evictions)


@lru_cache
def get_semantic_embedding_cache() -> EmbeddingInferenceCache:
    return EmbeddingInferenceCache(get_settings().semantic_embedding_cache_entries)
