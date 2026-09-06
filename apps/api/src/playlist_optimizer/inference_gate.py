"""Bound local inference concurrency across browser windows and providers."""

from collections.abc import Iterator
from threading import Lock

from fastapi import HTTPException

_gate = Lock()


def inference_slot() -> Iterator[None]:
    # Do not hold worker threads waiting behind an expensive model job.
    if not _gate.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail=("Another local analysis is running. Wait for it to finish, then retry. "
                    "Cached work is retained."),
            headers={"Retry-After": "5"},
        )
    try:
        yield
    finally:
        _gate.release()
