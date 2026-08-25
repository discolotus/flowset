import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).parents[1] / "scripts" / "download_semantic_models.py"
_SPEC = importlib.util.spec_from_file_location("download_semantic_models", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
download_semantic_models = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(download_semantic_models)


def test_all_model_setup_rejects_missing_consent_before_any_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    downloads: list[str] = []
    monkeypatch.setattr(
        download_semantic_models,
        "download_clap",
        lambda _root: downloads.append("clap"),
    )

    with pytest.raises(SystemExit, match="CC-BY-NC-4.0"):
        download_semantic_models.main(["all", "--output", str(tmp_path)])

    assert downloads == []
    assert list(tmp_path.iterdir()) == []


def test_all_model_setup_requires_trusted_code_before_any_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    downloads: list[str] = []
    monkeypatch.setattr(
        download_semantic_models,
        "download_clap",
        lambda _root: downloads.append("clap"),
    )

    with pytest.raises(SystemExit, match="trusted-code"):
        download_semantic_models.main(
            ["all", "--output", str(tmp_path), "--accept-restricted-weights"]
        )

    assert downloads == []
    assert list(tmp_path.iterdir()) == []
