#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(dirname "$script_directory")
rust_target=$(rustc -vV | sed -n 's/^host: //p')

if [ -z "$rust_target" ]; then
  echo "Could not determine the Rust host target." >&2
  exit 1
fi

sidecar_directory="$repository_root/src-tauri/binaries"
sidecar_path="$sidecar_directory/playlist-optimizer-api-$rust_target"
model_directory="$repository_root/apps/api/.models/essentia"

mkdir -p "$sidecar_directory" "$model_directory"
if [ ! -e "$sidecar_path" ]; then
  printf '#!/bin/sh\nexit 0\n' > "$sidecar_path"
  chmod +x "$sidecar_path"
fi
