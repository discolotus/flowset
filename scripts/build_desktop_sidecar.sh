#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
target_triple=$(rustc --print host-tuple)
binary_name="playlist-optimizer-api-${target_triple}"

mkdir -p "$project_root/src-tauri/binaries"
cd "$project_root/apps/api"
UV_CACHE_DIR=.uv-cache uv sync --locked --all-extras
UV_CACHE_DIR=.uv-cache uv run --no-sync python scripts/download_essentia_models.py
PYINSTALLER_CONFIG_DIR="$project_root/apps/api/.pyinstaller" \
  HF_HUB_OFFLINE=1 \
  TRANSFORMERS_OFFLINE=1 \
  TOKENIZERS_PARALLELISM=false \
  UV_CACHE_DIR=.uv-cache uv run --no-sync pyinstaller \
  --clean \
  --noconfirm \
  --onefile \
  --name "$binary_name" \
  --paths src \
  --add-data scripts/download_semantic_models.py:scripts \
  --add-data scripts/smoke_test_semantic_models.py:scripts \
  --collect-all essentia \
  --collect-all laion_clap \
  --collect-all muq \
  --collect-all x_clip \
  --collect-all huggingface_hub \
  --collect-all sqlite_vec \
  --collect-data transformers \
  --collect-submodules librosa \
  --collect-submodules transformers \
  --collect-submodules playlist_optimizer \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.protocols.http.h11_impl \
  --hidden-import uvicorn.lifespan.on \
  --distpath "$project_root/src-tauri/binaries" \
  --workpath "$project_root/apps/api/build/desktop-sidecar" \
  scripts/desktop_api.py
