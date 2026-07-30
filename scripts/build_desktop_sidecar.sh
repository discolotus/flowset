#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target_triple=$(rustc --print host-tuple)
binary_name="playlist-optimizer-api-${target_triple}"

mkdir -p "$project_root/src-tauri/binaries"
cd "$project_root/apps/api"
UV_CACHE_DIR=.uv-cache uv sync --locked --extra essentia
UV_CACHE_DIR=.uv-cache uv run --no-sync python scripts/download_essentia_models.py
PYINSTALLER_CONFIG_DIR="$project_root/apps/api/.pyinstaller" \
  UV_CACHE_DIR=.uv-cache uv run --no-sync pyinstaller \
  --clean \
  --noconfirm \
  --onefile \
  --name "$binary_name" \
  --paths src \
  --collect-all essentia \
  --collect-submodules playlist_optimizer \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.protocols.http.h11_impl \
  --hidden-import uvicorn.lifespan.on \
  --distpath "$project_root/src-tauri/binaries" \
  --workpath "$project_root/apps/api/build/desktop-sidecar" \
  scripts/desktop_api.py
