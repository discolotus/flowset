#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

export HOMEBREW_NO_AUTO_UPDATE=1
for formula in node@22 uv ffmpeg; do
  if ! brew list --versions "$formula" >/dev/null 2>&1; then
    brew install "$formula"
  fi
done

node_bin="$(brew --prefix node@22)/bin"
export PATH="$node_bin:$PATH"
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$node_bin" >>"$GITHUB_PATH"
fi

rustup toolchain install 1.94.0 --profile minimal --component rustfmt --component clippy
rustup default 1.94.0
uv python install 3.12

cd "$repository_root"
npm ci
UV_CACHE_DIR=apps/api/.uv-cache uv sync --project apps/api --locked --python 3.12

make test
make lint
make build
make test-api-runtime-smoke
make test-audio-export-smoke
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
