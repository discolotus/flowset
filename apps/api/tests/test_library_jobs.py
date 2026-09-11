import threading
import time

import pytest

from playlist_optimizer.library_jobs import JobStore


def payload(count=12):
    return dict(
        name="Test job",
        backend="local-clap",
        labels=["bass"],
        tracks=[{"id": str(i)} for i in range(count)],
        audio_paths={str(i): str(i) for i in range(count)},
    )


def identity(job):
    return "root", {key: [1, 2] for key in job["audio_paths"]}


def wait(store, key, status):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        value = store.get(key)
        if value["status"] in status:
            return value
        time.sleep(0.01)
    raise AssertionError(store.get(key))


def test_batches_are_bounded_and_summaries_omit_snapshots(tmp_path):
    batches = []

    def run(job, ids):
        batches.append(ids)
        return {key: {"status": "complete", "scores": []} for key in ids}

    store = JobStore(tmp_path / "jobs.db", run, identity, lambda _: "v1")
    try:
        job = store.create(payload())
        result = wait(store, job["id"], {"complete"})
        assert [len(batch) for batch in batches] == [5, 5, 2]
        assert len(result["results"]) == 12
        assert "tracks" not in store.list()[0]
        assert "results" not in store.list()[0]
    finally:
        store.executor.shutdown()


def test_stop_and_resume_keeps_completed_batches(tmp_path):
    entered, release = threading.Event(), threading.Event()
    batches = []

    def run(job, ids):
        batches.append(ids)
        entered.set()
        assert release.wait(3)
        return {key: {"status": "complete"} for key in ids}

    store = JobStore(tmp_path / "jobs.db", run, identity, lambda _: "v1")
    try:
        key = store.create(payload())["id"]
        assert entered.wait(3)
        store.control(key, "stop")
        release.set()
        assert wait(store, key, {"cancelled"})["completed"] == 5
        store.control(key, "resume")
        assert wait(store, key, {"complete"})["completed"] == 12
        assert [i for batch in batches for i in batch] == [str(i) for i in range(12)]
    finally:
        release.set()
        store.executor.shutdown()


def test_restart_and_changed_source_block_resume(tmp_path):
    path = tmp_path / "jobs.db"
    store = JobStore(path, validator=identity, model_validator=lambda _: "v1")
    store.save(
        dict(
            payload(1),
            id="old",
            status="running",
            root_id="root",
            fingerprints={"0": [1, 2]},
            model="v1",
            results={},
            completed=0,
        )
    )
    store.executor.shutdown()
    recovered = JobStore(
        path, validator=lambda _: ("root", {"0": [1, 3]}), model_validator=lambda _: "v1"
    )
    try:
        assert recovered.get("old")["status"] == "interrupted"
        with pytest.raises(ValueError, match="Source files changed"):
            recovered.control("old", "resume")
        assert recovered.get("old")["results"] == {}
    finally:
        recovered.executor.shutdown()


def test_missing_result_is_partial_not_success(tmp_path):
    store = JobStore(tmp_path / "jobs.db", lambda job, ids: {}, identity, lambda _: "v1")
    try:
        key = store.create(payload(1))["id"]
        assert wait(store, key, {"partial"})["results"]["0"]["status"] == "failed"
    finally:
        store.executor.shutdown()
