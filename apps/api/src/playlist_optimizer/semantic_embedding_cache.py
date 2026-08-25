from __future__ import annotations

import sqlite3
from collections import OrderedDict
from collections.abc import Callable
from concurrent.futures import Future
from contextlib import suppress
from dataclasses import dataclass
from functools import lru_cache
from hashlib import sha256
from pathlib import Path
from threading import Lock
from typing import Literal

from playlist_optimizer.config import get_settings
from playlist_optimizer.semantic_artifacts import (
    PersistentSemanticArtifactStore,
    SemanticArtifactKey,
    SemanticNeighbor,
)

EmbeddingCacheStatus = Literal["hit", "miss", "deduplicated"]


@dataclass(frozen=True)
class EmbeddingCacheKey:
    backend_id: str
    model: str
    representation: str
    relative_path: str
    size: int
    modified_time_ns: int
    library_id: str = "default"
    preprocessing: str = "backend-native-v1"
    segment_policy: str = "model-native-v1"


@dataclass(frozen=True)
class EmbeddingCacheLookup:
    values: list[float]
    status: EmbeddingCacheStatus
    evictions: int = 0


class EmbeddingInferenceCache:
    """A bounded process-local L1 for raw semantic embeddings.

    The optional content-addressed L2 owns durable serialization. Raw values leave the API process
    only through the explicit loopback embedding response. In-flight futures make concurrent
    requests for an identical track and embedding space share one model invocation.
    """

    def __init__(
        self,
        capacity: int,
        persistent: PersistentSemanticArtifactStore | None = None,
    ):
        if capacity < 1:
            raise ValueError("Embedding cache capacity must be positive")
        self.capacity = capacity
        self.persistent = persistent
        self._entries: OrderedDict[EmbeddingCacheKey, tuple[float, ...]] = OrderedDict()
        self._in_flight: dict[EmbeddingCacheKey, Future[tuple[float, ...]]] = {}
        self._lock = Lock()

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._entries)

    @property
    def persistent_enabled(self) -> bool:
        return self.persistent is not None

    @property
    def search_engine(self) -> str:
        return self.persistent.search_engine if self.persistent is not None else "unavailable"

    def nearest(
        self, key: EmbeddingCacheKey, query: list[float], *, limit: int
    ) -> list[SemanticNeighbor]:
        if self.persistent is None:
            return []
        return self.persistent.nearest(_artifact_key(key), query, limit=limit)

    def get_or_compute(
        self,
        key: EmbeddingCacheKey,
        compute: Callable[[], list[float]],
        *,
        audio_path: Path | None = None,
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

        if self.persistent is not None and audio_path is not None:
            try:
                persisted = self.persistent.get(_artifact_key(key), audio_path)
            except (OSError, ValueError, sqlite3.Error):
                persisted = None
            if persisted is not None:
                evictions = 0
                with self._lock:
                    self._entries[key] = tuple(persisted)
                    self._entries.move_to_end(key)
                    while len(self._entries) > self.capacity:
                        self._entries.popitem(last=False)
                        evictions += 1
                    self._in_flight.pop(key, None)
                future.set_result(tuple(persisted))
                return EmbeddingCacheLookup(
                    values=persisted, status="hit", evictions=evictions
                )

        try:
            computed = tuple(float(value) for value in compute())
        except BaseException as exc:
            with self._lock:
                self._in_flight.pop(key, None)
            future.set_exception(exc)
            raise

        if self.persistent is not None and audio_path is not None:
            with suppress(OSError, ValueError, sqlite3.Error):
                self.persistent.put(_artifact_key(key), audio_path, list(computed))

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
    settings = get_settings()
    persistent = None
    if settings.semantic_cache_path is not None:
        try:
            persistent = PersistentSemanticArtifactStore(settings.semantic_cache_path)
        except (OSError, sqlite3.Error):
            persistent = None
    return EmbeddingInferenceCache(settings.semantic_embedding_cache_entries, persistent)


def semantic_library_id(root: Path) -> str:
    return sha256(str(root.resolve()).encode()).hexdigest()


def _artifact_key(key: EmbeddingCacheKey) -> SemanticArtifactKey:
    return SemanticArtifactKey(
        library_id=key.library_id,
        relative_path=key.relative_path,
        size=key.size,
        modified_time_ns=key.modified_time_ns,
        backend_id=key.backend_id,
        model=key.model,
        representation=key.representation,
        preprocessing=key.preprocessing,
        segment_policy=key.segment_policy,
    )
