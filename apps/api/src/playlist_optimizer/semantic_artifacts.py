from __future__ import annotations

import json
import math
import sqlite3
import struct
import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path

from pydantic import BaseModel, ConfigDict


class SemanticArtifactKey(BaseModel):
    model_config = ConfigDict(frozen=True)

    library_id: str
    relative_path: str
    size: int
    modified_time_ns: int
    backend_id: str
    model: str
    representation: str
    preprocessing: str = "backend-native-v1"
    segment_policy: str = "model-native-v1"

    @property
    def space_id(self) -> str:
        payload = json.dumps(
            {
                "backend_id": self.backend_id,
                "model": self.model,
                "preprocessing": self.preprocessing,
                "representation": self.representation,
                "segment_policy": self.segment_policy,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        return sha256(payload).hexdigest()


@dataclass(frozen=True)
class SemanticNeighbor:
    content_sha256: str
    relative_path: str
    similarity: float


@dataclass(frozen=True)
class SemanticCacheSpaceInventory:
    space_id: str
    backend_id: str
    model: str
    representation: str
    preprocessing: str
    segment_policy: str
    dimension: int
    embedding_count: int
    vector_bytes: int
    oldest_created_at_ns: int | None
    newest_created_at_ns: int | None
    last_accessed_at_ns: int | None


@dataclass(frozen=True)
class SemanticCacheInventory:
    database_bytes: int
    location_count: int
    embedding_count: int
    search_engine: str
    spaces: tuple[SemanticCacheSpaceInventory, ...]


@dataclass(frozen=True)
class SemanticCachePruneResult:
    matched_embeddings: int
    matched_spaces: int
    matched_vector_bytes: int
    deleted_embeddings: int
    deleted_spaces: int
    deleted_locations: int
    confirmation_token: str


class PersistentSemanticArtifactStore:
    """Content-addressed semantic embeddings with optional sqlite-vec KNN acceleration."""

    def __init__(
        self,
        database_path: Path,
        *,
        enable_vector_extension: bool = True,
        clock_ns: Callable[[], int] = time.time_ns,
    ):
        self.database_path = database_path
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._extension_requested = enable_vector_extension
        self._vector_enabled = False
        self._clock_ns = clock_ns
        self._initialize()

    @property
    def search_engine(self) -> str:
        return "sqlite-vec" if self._vector_enabled else "python-exact"

    def get(self, key: SemanticArtifactKey, audio_path: Path) -> list[float] | None:
        with self._connection() as connection:
            content_hash, location_id = self._resolve_content_hash(connection, key, audio_path)
            row = connection.execute(
                """SELECT e.vector, e.dimension, s.vector_table FROM embeddings e
                JOIN embedding_spaces s ON s.id = e.space_id
                WHERE e.content_sha256 = ? AND e.space_id = ?""",
                (content_hash, key.space_id),
            ).fetchone()
            if row is None:
                return None
            connection.execute(
                """UPDATE embeddings SET last_accessed_at_ns = ?
                WHERE content_sha256 = ? AND space_id = ?""",
                (self._clock_ns(), content_hash, key.space_id),
            )
            if self._vector_enabled and row[2]:
                self._upsert_vector_location(
                    connection, row[2], location_id, key.library_id, row[0]
                )
            return _unpack_vector(row[0], row[1])

    def put(self, key: SemanticArtifactKey, audio_path: Path, values: list[float]) -> None:
        vector = _validate_vector(values)
        dimension = len(vector)
        with self._connection() as connection:
            content_hash, location_id = self._resolve_content_hash(connection, key, audio_path)
            vector_table = self._ensure_space(connection, key, dimension)
            now = self._clock_ns()
            connection.execute(
                """
                INSERT INTO embeddings(
                    content_sha256, space_id, dimension, vector,
                    created_at_ns, last_accessed_at_ns
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(content_sha256, space_id) DO UPDATE SET
                    dimension = excluded.dimension,
                    vector = excluded.vector,
                    last_accessed_at_ns = excluded.last_accessed_at_ns
                """,
                (
                    content_hash,
                    key.space_id,
                    dimension,
                    _pack_vector(vector),
                    now,
                    now,
                ),
            )
            if vector_table is not None:
                self._upsert_vector_location(
                    connection,
                    vector_table,
                    location_id,
                    key.library_id,
                    _pack_vector(vector),
                )

    def touch(self, key: SemanticArtifactKey) -> bool:
        """Record an L1 hit without rehashing an unchanged file location."""
        with self._connection() as connection:
            before = connection.total_changes
            connection.execute(
                """
                UPDATE embeddings SET last_accessed_at_ns = ?
                WHERE space_id = ? AND content_sha256 = (
                    SELECT content_sha256 FROM file_locations
                    WHERE library_id = ? AND relative_path = ?
                        AND size = ? AND modified_time_ns = ?
                )
                """,
                (
                    self._clock_ns(),
                    key.space_id,
                    key.library_id,
                    key.relative_path,
                    key.size,
                    key.modified_time_ns,
                ),
            )
            return connection.total_changes > before

    def nearest(
        self, key: SemanticArtifactKey, query: list[float], *, limit: int
    ) -> list[SemanticNeighbor]:
        if limit < 1:
            raise ValueError("Search limit must be positive")
        query_vector = _validate_vector(query)
        with self._connection() as connection:
            space = connection.execute(
                "SELECT dimension, vector_table FROM embedding_spaces WHERE id = ?",
                (key.space_id,),
            ).fetchone()
            if space is None:
                return []
            dimension, vector_table = space
            if len(query_vector) != dimension:
                raise ValueError("Embedding dimension does not match the selected space")
            if self._vector_enabled and vector_table:
                matches = connection.execute(
                    f"""WITH matches AS (
                        SELECT location_id, distance
                        FROM "{vector_table}"
                        WHERE embedding MATCH ? AND k = ? AND library_id = ?
                    )
                    SELECT e.content_sha256, l.relative_path, 1.0 - matches.distance
                    FROM matches
                    JOIN file_locations l ON l.id = matches.location_id
                    JOIN embeddings e ON e.content_sha256 = l.content_sha256
                        AND e.space_id = ?
                    ORDER BY matches.distance, l.relative_path
                    """,
                    (
                        _pack_vector(query_vector),
                        limit,
                        key.library_id,
                        key.space_id,
                    ),
                ).fetchall()
                return [SemanticNeighbor(row[0], row[1], float(row[2])) for row in matches]

            rows = connection.execute(
                """
                SELECT e.content_sha256, MIN(l.relative_path), e.vector, e.dimension
                FROM embeddings e
                JOIN file_locations l ON l.content_sha256 = e.content_sha256
                WHERE e.space_id = ? AND l.library_id = ?
                GROUP BY e.id, e.content_sha256, e.vector, e.dimension
                """,
                (key.space_id, key.library_id),
            ).fetchall()
        neighbors = [
            SemanticNeighbor(
                content_sha256=row[0],
                relative_path=row[1],
                similarity=_cosine(query_vector, _unpack_vector(row[2], row[3])),
            )
            for row in rows
        ]
        return sorted(neighbors, key=lambda item: (-item.similarity, item.relative_path))[:limit]

    def count_embeddings(self) -> int:
        with self._connection() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0])

    def inventory(self) -> SemanticCacheInventory:
        with self._connection() as connection:
            location_count = int(
                connection.execute("SELECT COUNT(*) FROM file_locations").fetchone()[0]
            )
            rows = connection.execute(
                """
                SELECT
                    s.id, s.backend_id, s.model, s.representation, s.preprocessing,
                    s.segment_policy, s.dimension, COUNT(e.id),
                    COALESCE(SUM(LENGTH(e.vector)), 0), MIN(e.created_at_ns),
                    MAX(e.created_at_ns), MAX(e.last_accessed_at_ns)
                FROM embedding_spaces s
                LEFT JOIN embeddings e ON e.space_id = s.id
                GROUP BY s.id
                ORDER BY s.backend_id, s.model, s.representation, s.id
                """
            ).fetchall()
        spaces = tuple(
            SemanticCacheSpaceInventory(
                space_id=row[0],
                backend_id=row[1],
                model=row[2],
                representation=row[3],
                preprocessing=row[4],
                segment_policy=row[5],
                dimension=int(row[6]),
                embedding_count=int(row[7]),
                vector_bytes=int(row[8]),
                oldest_created_at_ns=row[9],
                newest_created_at_ns=row[10],
                last_accessed_at_ns=row[11],
            )
            for row in rows
        )
        return SemanticCacheInventory(
            database_bytes=self._database_bytes(),
            location_count=location_count,
            embedding_count=sum(space.embedding_count for space in spaces),
            search_engine=self.search_engine,
            spaces=spaces,
        )

    def plan_prune(
        self,
        *,
        backend_id: str | None = None,
        model: str | None = None,
        representation: str | None = None,
        preprocessing: str | None = None,
        segment_policy: str | None = None,
        created_before_ns: int | None = None,
        last_accessed_before_ns: int | None = None,
    ) -> SemanticCachePruneResult:
        filters = _prune_filters(
            backend_id=backend_id,
            model=model,
            representation=representation,
            preprocessing=preprocessing,
            segment_policy=segment_policy,
            created_before_ns=created_before_ns,
            last_accessed_before_ns=last_accessed_before_ns,
        )
        with self._connection() as connection:
            return self._plan_prune(connection, filters)

    def prune(
        self,
        *,
        confirmation_token: str,
        backend_id: str | None = None,
        model: str | None = None,
        representation: str | None = None,
        preprocessing: str | None = None,
        segment_policy: str | None = None,
        created_before_ns: int | None = None,
        last_accessed_before_ns: int | None = None,
        remove_orphan_locations: bool = True,
        compact: bool = False,
    ) -> SemanticCachePruneResult:
        filters = _prune_filters(
            backend_id=backend_id,
            model=model,
            representation=representation,
            preprocessing=preprocessing,
            segment_policy=segment_policy,
            created_before_ns=created_before_ns,
            last_accessed_before_ns=last_accessed_before_ns,
        )
        deleted_spaces = deleted_locations = 0
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            preview = self._plan_prune(connection, filters)
            if confirmation_token != preview.confirmation_token:
                raise ValueError("Cache changed after the prune preview; preview it again")
            rows = self._matching_embeddings(connection, filters)
            touched_spaces: dict[str, str | None] = {}
            for (
                embedding_id,
                content_hash,
                space_id,
                vector_table,
                _vector_bytes,
                _created_at_ns,
                _last_accessed_at_ns,
            ) in rows:
                touched_spaces[space_id] = vector_table
                if vector_table and self._vector_enabled:
                    location_ids = connection.execute(
                        "SELECT id FROM file_locations WHERE content_sha256 = ?",
                        (content_hash,),
                    ).fetchall()
                    connection.executemany(
                        f'DELETE FROM "{vector_table}" WHERE location_id = ?', location_ids
                    )
                connection.execute("DELETE FROM embeddings WHERE id = ?", (embedding_id,))
            for space_id, vector_table in touched_spaces.items():
                remaining = connection.execute(
                    "SELECT 1 FROM embeddings WHERE space_id = ? LIMIT 1", (space_id,)
                ).fetchone()
                if remaining is None and (not vector_table or self._vector_enabled):
                    if vector_table:
                        connection.execute(f'DROP TABLE IF EXISTS "{vector_table}"')
                    connection.execute("DELETE FROM embedding_spaces WHERE id = ?", (space_id,))
                    deleted_spaces += 1
            if remove_orphan_locations:
                before = connection.total_changes
                connection.execute(
                    """DELETE FROM file_locations
                    WHERE NOT EXISTS (
                        SELECT 1 FROM embeddings
                        WHERE embeddings.content_sha256 = file_locations.content_sha256
                    )"""
                )
                deleted_locations = connection.total_changes - before
        if compact:
            self.compact()
        return SemanticCachePruneResult(
            matched_embeddings=preview.matched_embeddings,
            matched_spaces=preview.matched_spaces,
            matched_vector_bytes=preview.matched_vector_bytes,
            deleted_embeddings=len(rows),
            deleted_spaces=deleted_spaces,
            deleted_locations=deleted_locations,
            confirmation_token=preview.confirmation_token,
        )

    def compact(self) -> None:
        with self._connection() as connection:
            connection.execute("VACUUM")

    def _plan_prune(
        self, connection: sqlite3.Connection, filters: dict[str, object]
    ) -> SemanticCachePruneResult:
        rows = self._matching_embeddings(connection, filters)
        payload = json.dumps(
            {
                "filters": filters,
                "matches": [
                    {
                        "id": row[0],
                        "content_sha256": row[1],
                        "space_id": row[2],
                        "created_at_ns": row[5],
                        "last_accessed_at_ns": row[6],
                    }
                    for row in rows
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        return SemanticCachePruneResult(
            matched_embeddings=len(rows),
            matched_spaces=len({row[2] for row in rows}),
            matched_vector_bytes=sum(int(row[4]) for row in rows),
            deleted_embeddings=0,
            deleted_spaces=0,
            deleted_locations=0,
            confirmation_token=sha256(payload).hexdigest(),
        )

    def _matching_embeddings(
        self, connection: sqlite3.Connection, filters: dict[str, object]
    ) -> list[tuple[int, str, str, str | None, int, int, int]]:
        clauses: list[str] = []
        parameters: list[object] = []
        columns = {
            "backend_id": "s.backend_id",
            "model": "s.model",
            "representation": "s.representation",
            "preprocessing": "s.preprocessing",
            "segment_policy": "s.segment_policy",
            "created_before_ns": "e.created_at_ns <",
            "last_accessed_before_ns": "e.last_accessed_at_ns <",
        }
        for name, value in filters.items():
            if value is None:
                continue
            column = columns[name]
            clauses.append(f"{column} ?" if column.endswith("<") else f"{column} = ?")
            parameters.append(value)
        where = " AND ".join(clauses) if clauses else "1 = 1"
        return connection.execute(
            f"""SELECT e.id, e.content_sha256, e.space_id, s.vector_table, LENGTH(e.vector),
                e.created_at_ns, e.last_accessed_at_ns
            FROM embeddings e JOIN embedding_spaces s ON s.id = e.space_id
            WHERE {where} ORDER BY e.id""",
            parameters,
        ).fetchall()

    def _database_bytes(self) -> int:
        return sum(
            path.stat().st_size
            for path in (
                self.database_path,
                Path(f"{self.database_path}-wal"),
                Path(f"{self.database_path}-shm"),
            )
            if path.is_file()
        )

    def _initialize(self) -> None:
        with self._connection(load_extension=True) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS file_locations(
                    id INTEGER PRIMARY KEY,
                    library_id TEXT NOT NULL,
                    relative_path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    modified_time_ns INTEGER NOT NULL,
                    content_sha256 TEXT NOT NULL,
                    UNIQUE(library_id, relative_path)
                );
                CREATE INDEX IF NOT EXISTS file_locations_content
                    ON file_locations(content_sha256);
                CREATE INDEX IF NOT EXISTS file_locations_library
                    ON file_locations(library_id);
                CREATE TABLE IF NOT EXISTS embedding_spaces(
                    id TEXT PRIMARY KEY,
                    backend_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    representation TEXT NOT NULL,
                    preprocessing TEXT NOT NULL,
                    segment_policy TEXT NOT NULL,
                    dimension INTEGER NOT NULL,
                    vector_table TEXT,
                    created_at_ns INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS embeddings(
                    id INTEGER PRIMARY KEY,
                    content_sha256 TEXT NOT NULL,
                    space_id TEXT NOT NULL REFERENCES embedding_spaces(id),
                    dimension INTEGER NOT NULL,
                    vector BLOB NOT NULL,
                    created_at_ns INTEGER NOT NULL DEFAULT 0,
                    last_accessed_at_ns INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(content_sha256, space_id)
                );
                CREATE INDEX IF NOT EXISTS embeddings_space ON embeddings(space_id);
                """
            )
            self._migrate_timestamps(connection)

    @contextmanager
    def _connection(self, *, load_extension: bool = False):
        connection = sqlite3.connect(self.database_path, timeout=30)
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 30000")
            if self._extension_requested and (load_extension or self._vector_enabled):
                try:
                    import sqlite_vec  # type: ignore[import-not-found]

                    connection.enable_load_extension(True)
                    sqlite_vec.load(connection)
                    connection.enable_load_extension(False)
                    self._vector_enabled = True
                except (AttributeError, ImportError, OSError, sqlite3.Error):
                    self._vector_enabled = False
            with connection:
                yield connection
        finally:
            connection.close()

    def _resolve_content_hash(
        self, connection: sqlite3.Connection, key: SemanticArtifactKey, audio_path: Path
    ) -> tuple[str, int]:
        cached = connection.execute(
            """
            SELECT content_sha256, id FROM file_locations
            WHERE library_id = ? AND relative_path = ? AND size = ? AND modified_time_ns = ?
            """,
            (key.library_id, key.relative_path, key.size, key.modified_time_ns),
        ).fetchone()
        if cached is not None:
            return str(cached[0]), int(cached[1])
        digest = sha256()
        with audio_path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        content_hash = digest.hexdigest()
        connection.execute(
            """
            INSERT INTO file_locations(
                library_id, relative_path, size, modified_time_ns, content_sha256
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(library_id, relative_path) DO UPDATE SET
                size = excluded.size,
                modified_time_ns = excluded.modified_time_ns,
                content_sha256 = excluded.content_sha256
            """,
            (
                key.library_id,
                key.relative_path,
                key.size,
                key.modified_time_ns,
                content_hash,
            ),
        )
        location_id = connection.execute(
            "SELECT id FROM file_locations WHERE library_id = ? AND relative_path = ?",
            (key.library_id, key.relative_path),
        ).fetchone()[0]
        return content_hash, int(location_id)

    def _ensure_space(
        self, connection: sqlite3.Connection, key: SemanticArtifactKey, dimension: int
    ) -> str | None:
        existing = connection.execute(
            "SELECT dimension, vector_table FROM embedding_spaces WHERE id = ?", (key.space_id,)
        ).fetchone()
        if existing is not None:
            if int(existing[0]) != dimension:
                raise ValueError("Embedding dimension does not match the selected space")
            return existing[1]

        vector_table: str | None = None
        if self._vector_enabled:
            candidate = f"vec_{key.space_id[:24]}"
            try:
                connection.execute(
                    f'CREATE VIRTUAL TABLE IF NOT EXISTS "{candidate}" USING vec0('
                    f"location_id INTEGER PRIMARY KEY, "
                    f"embedding FLOAT[{dimension}] distance_metric=cosine, "
                    "library_id TEXT PARTITION KEY)"
                )
                vector_table = candidate
            except sqlite3.Error:
                self._vector_enabled = False
        connection.execute(
            """
            INSERT INTO embedding_spaces(
                id, backend_id, model, representation, preprocessing,
                segment_policy, dimension, vector_table, created_at_ns
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                key.space_id,
                key.backend_id,
                key.model,
                key.representation,
                key.preprocessing,
                key.segment_policy,
                dimension,
                vector_table,
                self._clock_ns(),
            ),
        )
        return vector_table

    def _migrate_timestamps(self, connection: sqlite3.Connection) -> None:
        now = self._clock_ns()
        for table, column in (
            ("embedding_spaces", "created_at_ns"),
            ("embeddings", "created_at_ns"),
            ("embeddings", "last_accessed_at_ns"),
        ):
            columns = {
                row[1] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if column not in columns:
                connection.execute(
                    f"ALTER TABLE {table} ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0"
                )
            connection.execute(f"UPDATE {table} SET {column} = ? WHERE {column} = 0", (now,))

    def _upsert_vector_location(
        self,
        connection: sqlite3.Connection,
        vector_table: str,
        location_id: int,
        library_id: str,
        vector: bytes,
    ) -> None:
        connection.execute(
            f'DELETE FROM "{vector_table}" WHERE location_id = ?', (location_id,)
        )
        connection.execute(
            f'INSERT INTO "{vector_table}"(location_id, embedding, library_id) VALUES (?, ?, ?)',
            (location_id, vector, library_id),
        )


def _validate_vector(values: list[float]) -> list[float]:
    vector = [float(value) for value in values]
    if not vector or not all(math.isfinite(value) for value in vector):
        raise ValueError("Embedding must contain finite values")
    return vector


def _prune_filters(
    *,
    backend_id: str | None,
    model: str | None,
    representation: str | None,
    preprocessing: str | None,
    segment_policy: str | None,
    created_before_ns: int | None,
    last_accessed_before_ns: int | None,
) -> dict[str, object]:
    return {
        "backend_id": backend_id,
        "model": model,
        "representation": representation,
        "preprocessing": preprocessing,
        "segment_policy": segment_policy,
        "created_before_ns": created_before_ns,
        "last_accessed_before_ns": last_accessed_before_ns,
    }


def _pack_vector(values: list[float]) -> bytes:
    return struct.pack(f"<{len(values)}f", *values)


def _unpack_vector(value: bytes, dimension: int) -> list[float]:
    if len(value) != dimension * 4:
        raise ValueError("Stored embedding dimension is invalid")
    return list(struct.unpack(f"<{dimension}f", value))


def _cosine(left: list[float], right: list[float]) -> float:
    denominator = math.sqrt(sum(value * value for value in left)) * math.sqrt(
        sum(value * value for value in right)
    )
    if denominator == 0:
        return 0.0
    return sum(a * b for a, b in zip(left, right, strict=True)) / denominator
