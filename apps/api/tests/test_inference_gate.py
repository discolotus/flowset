import pytest
from fastapi import HTTPException

from playlist_optimizer.inference_gate import inference_slot


def test_inference_gate_rejects_overlap_and_releases_after_failure():
    first = inference_slot()
    next(first)
    with pytest.raises(HTTPException) as caught:
        next(inference_slot())
    assert caught.value.status_code == 429
    first.close()
    second = inference_slot()
    next(second)
    with pytest.raises(RuntimeError):
        second.throw(RuntimeError("model failed"))
    third = inference_slot()
    next(third)
    third.close()


def test_all_inference_routes_are_guarded_but_health_remains_responsive():
    from fastapi.testclient import TestClient

    from playlist_optimizer.main import app

    slot = inference_slot()
    next(slot)
    try:
        with TestClient(app) as client:
            for route in (
                "semantic/rank",
                "semantic/reference-rank",
                "semantic/embeddings",
                "semantic/neighbors",
                "audio-features/resolve",
            ):
                response = client.post(f"/api/v1/{route}", json={})
                assert response.status_code == 429
            assert client.get("/api/v1/health").status_code == 200
    finally:
        slot.close()
