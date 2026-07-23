"""Frozen desktop entry point for the Tauri sidecar."""

import multiprocessing
import os
import sys
import threading
import time


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


if __name__ == "__main__":
    multiprocessing.freeze_support()
    if "--essentia-mood-worker" in sys.argv:
        from playlist_optimizer.providers.essentia_worker import main as worker_main

        worker_index = sys.argv.index("--essentia-mood-worker")
        raise SystemExit(worker_main(sys.argv[worker_index + 1 :]))
    main()
