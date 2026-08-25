from pathlib import Path

import pytest

from playlist_optimizer.semantic_artifacts import (
    PersistentSemanticArtifactStore,
    SemanticArtifactKey,
)


def key(
    *,
    relative_path: str = "one.wav",
    model: str = "model-v1",
    representation: str = "mean-v1",
) -> SemanticArtifactKey:
    return SemanticArtifactKey(
        library_id="library-a",
        relative_path=relative_path,
        size=3,
        modified_time_ns=100,
        backend_id="local-muq-mulan",
        model=model,
        representation=representation,
        preprocessing="mono-24khz-v1",
        segment_policy="first-30s-v1",
    )


def test_artifacts_survive_restart_and_reuse_content_after_rename(tmp_path: Path) -> None:
    database = tmp_path / "semantic.sqlite3"
    original = tmp_path / "one.wav"
    original.write_bytes(b"one")
    store = PersistentSemanticArtifactStore(database, enable_vector_extension=False)

    assert store.get(key(), original) is None
    store.put(key(), original, [1.0, 0.0])

    restarted = PersistentSemanticArtifactStore(database, enable_vector_extension=False)
    assert restarted.get(key(), original) == [1.0, 0.0]

    renamed = tmp_path / "renamed.wav"
    original.rename(renamed)
    renamed_key = key(relative_path="renamed.wav")
    assert restarted.get(renamed_key, renamed) == [1.0, 0.0]
    assert restarted.count_embeddings() == 1


def test_model_representation_and_preprocessing_are_separate_spaces(tmp_path: Path) -> None:
    audio = tmp_path / "one.wav"
    audio.write_bytes(b"one")
    store = PersistentSemanticArtifactStore(
        tmp_path / "semantic.sqlite3", enable_vector_extension=False
    )
    store.put(key(), audio, [1.0, 0.0])

    assert store.get(key(model="model-v2"), audio) is None
    assert store.get(key(representation="layer-6-v1"), audio) is None
    changed_preprocessing = key().model_copy(
        update={"preprocessing": "mono-48khz-v1"}
    )
    assert store.get(changed_preprocessing, audio) is None


def test_exact_cosine_search_is_stable_and_space_bound(tmp_path: Path) -> None:
    store = PersistentSemanticArtifactStore(
        tmp_path / "semantic.sqlite3", enable_vector_extension=False
    )
    for name, values in (
        ("a.wav", [1.0, 0.0]),
        ("b.wav", [0.8, 0.2]),
        ("c.wav", [0.0, 1.0]),
    ):
        audio = tmp_path / name
        audio.write_bytes(name.encode())
        stat = audio.stat()
        store.put(
            key(relative_path=name).model_copy(
                update={"size": stat.st_size, "modified_time_ns": stat.st_mtime_ns}
            ),
            audio,
            values,
        )

    matches = store.nearest(key(), [1.0, 0.0], limit=2)

    assert store.search_engine == "python-exact"
    assert [match.relative_path for match in matches] == ["a.wav", "b.wav"]
    assert matches[0].similarity == pytest.approx(1.0)
    assert matches[1].similarity > 0.9


def test_dimension_mismatch_is_rejected(tmp_path: Path) -> None:
    audio = tmp_path / "one.wav"
    audio.write_bytes(b"one")
    store = PersistentSemanticArtifactStore(
        tmp_path / "semantic.sqlite3", enable_vector_extension=False
    )
    store.put(key(), audio, [1.0, 0.0])

    with pytest.raises(ValueError, match="dimension"):
        store.put(key(relative_path="two.wav"), audio, [1.0, 0.0, 0.0])
    with pytest.raises(ValueError, match="dimension"):
        store.nearest(key(), [1.0, 0.0, 0.0], limit=1)


def test_sqlite_vec_accelerates_cosine_search(tmp_path: Path) -> None:
    store = PersistentSemanticArtifactStore(tmp_path / "semantic.sqlite3")
    for name, values in (("a.wav", [1.0, 0.0]), ("b.wav", [0.0, 1.0])):
        audio = tmp_path / name
        audio.write_bytes(name.encode())
        stat = audio.stat()
        store.put(
            key(relative_path=name).model_copy(
                update={"size": stat.st_size, "modified_time_ns": stat.st_mtime_ns}
            ),
            audio,
            values,
        )

    assert store.search_engine == "sqlite-vec"
    assert [item.relative_path for item in store.nearest(key(), [1.0, 0.0], limit=2)] == [
        "a.wav",
        "b.wav",
    ]


def test_sqlite_vec_partitions_search_by_authorized_library(tmp_path: Path) -> None:
    store = PersistentSemanticArtifactStore(tmp_path / "semantic.sqlite3")
    library_a = tmp_path / "a.wav"
    library_b = tmp_path / "b.wav"
    library_a.write_bytes(b"a")
    library_b.write_bytes(b"b")
    stat_a = library_a.stat()
    stat_b = library_b.stat()
    key_a = key(relative_path="a.wav").model_copy(
        update={
            "size": stat_a.st_size,
            "modified_time_ns": stat_a.st_mtime_ns,
            "library_id": "library-a",
        }
    )
    key_b = key(relative_path="b.wav").model_copy(
        update={
            "size": stat_b.st_size,
            "modified_time_ns": stat_b.st_mtime_ns,
            "library_id": "library-b",
        }
    )
    store.put(key_a, library_a, [1.0, 0.0])
    store.put(key_b, library_b, [0.0, 1.0])

    matches = store.nearest(key_a, [0.0, 1.0], limit=1)

    assert [(match.relative_path, match.similarity) for match in matches] == [
        ("a.wav", pytest.approx(0.0))
    ]


def test_inventory_and_model_filtered_prune_are_previewable(tmp_path: Path) -> None:
    now = 100
    store = PersistentSemanticArtifactStore(
        tmp_path / "semantic.sqlite3",
        enable_vector_extension=False,
        clock_ns=lambda: now,
    )
    audio = tmp_path / "one.wav"
    audio.write_bytes(b"one")
    store.put(key(model="model-v1"), audio, [1.0, 0.0])
    now = 200
    store.put(key(model="model-v2"), audio, [0.0, 1.0])

    inventory = store.inventory()
    preview = store.plan_prune(model="model-v1")

    assert inventory.embedding_count == 2
    assert {space.model for space in inventory.spaces} == {"model-v1", "model-v2"}
    assert preview.matched_embeddings == 1
    assert preview.deleted_embeddings == 0
    assert store.count_embeddings() == 2

    deleted = store.prune(model="model-v1", confirmation_token=preview.confirmation_token)

    assert deleted.deleted_embeddings == 1
    assert deleted.deleted_spaces == 1
    assert store.count_embeddings() == 1
    assert store.get(key(model="model-v1"), audio) is None
    assert store.get(key(model="model-v2"), audio) == [0.0, 1.0]


def test_prune_filters_by_creation_and_access_dates(tmp_path: Path) -> None:
    now = 100
    store = PersistentSemanticArtifactStore(
        tmp_path / "semantic.sqlite3",
        enable_vector_extension=False,
        clock_ns=lambda: now,
    )
    old = tmp_path / "old.wav"
    recent = tmp_path / "recent.wav"
    old.write_bytes(b"old")
    recent.write_bytes(b"recent")
    old_stat = old.stat()
    recent_stat = recent.stat()
    store.put(
        key(relative_path="old.wav").model_copy(
            update={"size": old_stat.st_size, "modified_time_ns": old_stat.st_mtime_ns}
        ),
        old,
        [1.0, 0.0],
    )
    now = 200
    store.put(
        key(relative_path="recent.wav").model_copy(
            update={"size": recent_stat.st_size, "modified_time_ns": recent_stat.st_mtime_ns}
        ),
        recent,
        [0.0, 1.0],
    )
    now = 300
    assert store.get(
        key(relative_path="old.wav").model_copy(
            update={"size": old_stat.st_size, "modified_time_ns": old_stat.st_mtime_ns}
        ),
        old,
    ) == [1.0, 0.0]

    created_preview = store.plan_prune(created_before_ns=150)
    accessed_preview = store.plan_prune(last_accessed_before_ns=250)

    assert created_preview.matched_embeddings == 1
    assert accessed_preview.matched_embeddings == 1
    assert created_preview.confirmation_token != accessed_preview.confirmation_token


def test_prune_rejects_a_stale_preview_token(tmp_path: Path) -> None:
    store = PersistentSemanticArtifactStore(
        tmp_path / "semantic.sqlite3", enable_vector_extension=False
    )
    first = tmp_path / "one.wav"
    second = tmp_path / "two.wav"
    first.write_bytes(b"one")
    second.write_bytes(b"two")
    store.put(key(), first, [1.0, 0.0])
    preview = store.plan_prune(backend_id="local-muq-mulan")
    second_stat = second.stat()
    store.put(
        key(relative_path="two.wav").model_copy(
            update={"size": second_stat.st_size, "modified_time_ns": second_stat.st_mtime_ns}
        ),
        second,
        [0.0, 1.0],
    )

    with pytest.raises(ValueError, match="preview"):
        store.prune(
            backend_id="local-muq-mulan",
            confirmation_token=preview.confirmation_token,
        )
