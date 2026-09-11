"""Durable, single-worker local analysis jobs, independent of browser navigation."""

import json
import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime
from functools import lru_cache
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
from threading import RLock
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, model_validator

from playlist_optimizer.api.router import (
    _require_loopback,
    _resolve_semantic_paths,
    rank_semantic_audio,
    rank_semantic_reference,
)
from playlist_optimizer.config import get_settings
from playlist_optimizer.inference_gate import inference_slot
from playlist_optimizer.models import (
    AudioFeatureResolutionRequest,
    SemanticRankRequest,
    SemanticReferenceRankRequest,
    Track,
)
from playlist_optimizer.providers import get_audio_feature_provider_registry
from playlist_optimizer.semantic import get_semantic_backend, get_semantic_registry
from playlist_optimizer.semantic_embedding_cache import (
    get_semantic_embedding_cache,
    semantic_library_id,
)


class JobInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    backend: Literal["local-clap", "local-muq-mulan", "local-mert", "essentia"]
    tracks: list[Track] = Field(min_length=1, max_length=5000)
    audio_paths: dict[str, str]
    labels: list[str] = Field(default_factory=list, max_length=20)
    reference_id: str | None = None

    @model_validator(mode="after")
    def validate_input(self):
        ids = [t.id for t in self.tracks]
        if len(set(ids)) != len(ids) or set(ids) != set(self.audio_paths):
            raise ValueError("Every selected track needs a unique ID and local audio path.")
        if self.backend == "local-mert" and self.reference_id not in self.audio_paths:
            raise ValueError("Select a reference from the job tracks.")
        if self.backend in ("local-clap", "local-muq-mulan"):
            SemanticRankRequest(
                backend_id=self.backend,
                labels=self.labels,
                audio_paths={ids[0]: self.audio_paths[ids[0]]},
            )
        return self


def identity(payload):
    settings = get_settings()
    paths = _resolve_semantic_paths(payload["audio_paths"], settings)
    root = settings.semantic_audio_root or settings.clap_audio_root or settings.essentia_audio_root
    stats = {
        key: [path.stat().st_size, path.stat().st_mtime_ns]
        for key, path in zip(payload["audio_paths"], paths, strict=True)
    }
    return semantic_library_id(root.resolve()), stats


def model_identity(backend):
    if backend == "essentia":
        settings = get_settings()
        model_dir = settings.essentia_model_dir
        assets = (
            []
            if model_dir is None
            else [
                (p.name, p.stat().st_size, p.stat().st_mtime_ns)
                for p in sorted(model_dir.iterdir())
                if p.is_file()
            ]
        )
        try:
            runtime = version("essentia-tensorflow")
        except Exception:
            runtime = "unavailable"
        return "essentia-" + runtime + "-" + sha256(json.dumps(assets).encode()).hexdigest()[:16]
    model = get_semantic_registry().get(backend)
    if model is None or not model.capabilities().available:
        raise HTTPException(
            422, "This model is not available. Check model setup in Learn / model tools."
        )
    caps = model.capabilities()
    representation = caps.default_representation
    return caps.model + ("|" + representation.model_dump_json() if representation else "")


def run_batch(job, ids):
    paths = {key: job["audio_paths"][key] for key in ids}
    request = Request({"type": "http", "client": ("127.0.0.1", 0), "headers": []})
    settings = get_settings()
    if job["backend"] == "essentia":
        tracks = [Track.model_validate(t) for t in job["tracks"] if t["id"] in ids]
        response = get_audio_feature_provider_registry().resolve(
            AudioFeatureResolutionRequest(
                provider="essentia",
                tracks=tracks,
                local_audio_paths=paths,
            )
        )
        return {
            t.id: {
                "status": "complete"
                if t.id not in response.unavailable_track_ids and t.audio_features is not None
                else "failed",
                "track": t.model_dump(mode="json"),
            }
            for t in response.tracks
        }
    registry, cache = get_semantic_registry(), get_semantic_embedding_cache()
    if job["backend"] == "local-mert":
        paths[job["reference_id"]] = job["audio_paths"][job["reference_id"]]
        response = rank_semantic_reference(
            SemanticReferenceRankRequest(
                backend_id=job["backend"],
                reference_track_id=job["reference_id"],
                audio_paths=paths,
            ),
            request,
            settings,
            registry,
            cache,
        )
    else:
        response = rank_semantic_audio(
            SemanticRankRequest(
                backend_id=job["backend"],
                labels=job["labels"],
                audio_paths=paths,
            ),
            request,
            settings,
            get_semantic_backend(),
            registry,
            cache,
        )
    if model_identity(job["backend"]) != job["model"]:
        raise ValueError("Model changed during analysis. Start a new job.")
    return {r.track_id: r.model_dump(mode="json") for r in response.results if r.track_id in ids}


class JobStore:
    def __init__(
        self, path: Path, runner=run_batch, validator=identity, model_validator=model_identity
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
        self.lock = RLock()
        self.runner, self.validator, self.model_validator = runner, validator, model_validator
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="flowset-job")
        for summary in self.list():
            if summary["status"] in ("queued", "running", "stopping"):
                job = self.get(summary["id"])
                job["status"] = "interrupted"
                self.save(job)

    def save(self, job):
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO jobs VALUES (?, ?)", (job["id"], json.dumps(job))
            )
            self.db.commit()

    def get(self, key):
        with self.lock:
            row = self.db.execute("SELECT body FROM jobs WHERE id=?", (key,)).fetchone()
        if not row:
            raise HTTPException(404, "Job not found")
        return json.loads(row[0])

    def list(self, full=False):
        # Strip large snapshots inside SQLite so polling history never loads them into Python.
        expression = (
            "body"
            if full
            else "json_remove(body, '$.tracks', '$.audio_paths', '$.results', '$.fingerprints')"
        )
        with self.lock:
            return [
                json.loads(row[0])
                for row in self.db.execute(f"SELECT {expression} FROM jobs ORDER BY rowid DESC")
            ]

    @staticmethod
    def summary(job):
        return {
            k: v
            for k, v in job.items()
            if k not in ("tracks", "audio_paths", "results", "fingerprints")
        }

    def create(self, payload):
        root, fingerprints = self.validator(payload)
        job = dict(
            payload,
            id=uuid4().hex,
            root_id=root,
            fingerprints=fingerprints,
            model=self.model_validator(payload["backend"]),
            results={},
            completed=0,
            total=len(payload["tracks"]),
            status="queued",
            created_at=datetime.now(UTC).isoformat(),
        )
        self.save(job)
        self.executor.submit(self.work, job["id"])
        return self.summary(job)

    def control(self, key, action):
        with self.lock:
            job = self.get(key)
            if action == "stop":
                if job["status"] in ("queued", "running"):
                    job["status"] = "stopping"
                    self.save(job)
            elif job["status"] in ("interrupted", "cancelled", "failed", "partial"):
                self.check_identity(job)
                job["results"] = {
                    k: v for k, v in job["results"].items() if v["status"] == "complete"
                }
                job["status"], job["error"] = "queued", ""
                job["completed"] = len(job["results"])
                self.save(job)
                self.executor.submit(self.work, key)
            return self.summary(job)

    def check_identity(self, job, ids=None):
        paths = job["audio_paths"] if ids is None else {key: job["audio_paths"][key] for key in ids}
        root, fingerprints = self.validator(dict(job, audio_paths=paths))
        expected = {key: job["fingerprints"][key] for key in paths}
        if root != job["root_id"] or fingerprints != expected:
            raise ValueError("Source files changed or the drive is unavailable. Start a new job.")
        if self.model_validator(job["backend"]) != job["model"]:
            raise ValueError("Model changed. Start a new job.")

    def work(self, key):
        try:
            job = self.get(key)
            self.check_identity(job)
            pending = [t["id"] for t in job["tracks"] if t["id"] not in job["results"]]
            size = 1 if job["backend"] == "essentia" else 4 if job["backend"] == "local-mert" else 5
            for offset in range(0, len(pending), size):
                while True:
                    with self.lock:
                        job = self.get(key)
                        if job["status"] == "stopping":
                            job["status"] = "cancelled"
                            self.save(job)
                            return
                        job["status"] = "running"
                        self.save(job)
                    try:
                        with contextmanager(inference_slot)():
                            ids = pending[offset : offset + size]
                            checked = list(
                                dict.fromkeys(
                                    ids + ([job["reference_id"]] if job.get("reference_id") else [])
                                )
                            )
                            self.check_identity(job, checked)
                            results = self.runner(job, ids)
                            self.check_identity(job, checked)
                        break
                    except HTTPException as exc:
                        if exc.status_code != 429:
                            raise
                        time.sleep(1)
                with self.lock:
                    job = self.get(key)
                    for track_id in ids:
                        job["results"][track_id] = results.get(
                            track_id, {"status": "failed", "error": "No result returned"}
                        )
                    job["completed"] = len(job["results"])
                    self.save(job)
            with self.lock:
                job = self.get(key)
                job["status"] = (
                    "cancelled"
                    if job["status"] == "stopping"
                    else (
                        "complete"
                        if all(r["status"] == "complete" for r in job["results"].values())
                        else "partial"
                    )
                )
                self.save(job)
        except Exception as exc:
            with self.lock:
                job = self.get(key)
                job["status"] = "failed"
                job["error"] = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
                self.save(job)


@lru_cache
def get_job_store():
    return JobStore(Path(os.environ.get("FLOWSET_JOBS_PATH", ".flowset/jobs.sqlite3")))


router = APIRouter(prefix="/api/v1/library-jobs")


@router.get("")
def list_jobs(request: Request):
    _require_loopback(request)
    return get_job_store().list()


@router.post("")
def create_job(payload: JobInput, request: Request):
    _require_loopback(request)
    try:
        return get_job_store().create(payload.model_dump(mode="json"))
    except (ValueError, OSError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/{key}")
def read_job(key: str, request: Request):
    _require_loopback(request)
    store = get_job_store()
    job = store.get(key)
    try:
        store.check_identity(job)
        job["stale"] = False
    except (ValueError, OSError, HTTPException):
        job["stale"] = True
    return job


@router.post("/{key}/{action}")
def control_job(key: str, action: Literal["stop", "resume"], request: Request):
    _require_loopback(request)
    try:
        return get_job_store().control(key, action)
    except (ValueError, OSError) as exc:
        raise HTTPException(409, str(exc)) from exc
