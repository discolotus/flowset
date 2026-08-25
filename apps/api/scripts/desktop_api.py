"""Frozen desktop entry point for the Tauri sidecar."""

import json
import multiprocessing
import os
import runpy
import sys
import threading
import time
from importlib.util import find_spec
from pathlib import Path


def watch_tauri_parent() -> None:
    raw_parent_pid = os.environ.get("PLAYLIST_OPTIMIZER_PARENT_PID")
    if raw_parent_pid is None:
        return
    parent_pid = int(raw_parent_pid)

    def monitor() -> None:
        while True:
            try:
                os.kill(parent_pid, 0)
            except ProcessLookupError:
                os._exit(0)
            except PermissionError:
                pass
            time.sleep(1)

    threading.Thread(target=monitor, name="tauri-parent-watchdog", daemon=True).start()


def main() -> None:
    import uvicorn

    watch_tauri_parent()
    port = int(os.environ.get("PLAYLIST_OPTIMIZER_PORT", "8001"))
    uvicorn.run(
        "playlist_optimizer.main:app",
        host="127.0.0.1",
        port=port,
        loop="asyncio",
        http="h11",
        log_level="warning",
    )


def _bundled_script(name: str) -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "scripts" / name  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent / name


def provision_semantic_models(arguments: list[str]) -> None:
    original_argv = sys.argv
    try:
        sys.argv = ["download_semantic_models.py", *arguments]
        runpy.run_path(str(_bundled_script("download_semantic_models.py")), run_name="__main__")

        output_index = arguments.index("--output") + 1
        model_root = Path(arguments[output_index]).resolve()
        os.environ.update(
            {
                "CLAP_CHECKPOINT": str(model_root / "clap" / "630k-audioset-best.pt"),
                "MUQ_MULAN_CHECKPOINT": str(model_root / "muq-mulan"),
                "MERT_CHECKPOINT": str(model_root / "mert" / "MERT-v1-95M"),
            }
        )
        for backend in ("clap", "muq-mulan", "mert"):
            sys.argv = ["smoke_test_semantic_models.py", backend]
            runpy.run_path(
                str(_bundled_script("smoke_test_semantic_models.py")), run_name="__main__"
            )
    finally:
        sys.argv = original_argv


def semantic_runtime_status() -> bool:
    modules = ("laion_clap", "librosa", "muq", "torch", "transformers")
    missing = [module for module in modules if find_spec(module) is None]
    print(json.dumps({"ready": not missing, "missing": missing}, sort_keys=True))
    return not missing


if __name__ == "__main__":
    multiprocessing.freeze_support()
    if "--essentia-mood-worker" in sys.argv:
        from playlist_optimizer.providers.essentia_worker import main as worker_main

        worker_index = sys.argv.index("--essentia-mood-worker")
        raise SystemExit(worker_main(sys.argv[worker_index + 1 :]))
    if "--provision-semantic-models" in sys.argv:
        setup_index = sys.argv.index("--provision-semantic-models")
        provision_semantic_models(sys.argv[setup_index + 1 :])
        raise SystemExit(0)
    if "--semantic-runtime-status" in sys.argv:
        raise SystemExit(0 if semantic_runtime_status() else 1)
    main()
