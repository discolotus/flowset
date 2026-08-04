#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version_file=${RELEASE_VERSION_FILE:-VERSION}
version=$(tr -d '[:space:]' <"$repository_root/$version_file")

case "$version" in
  *[!0-9A-Za-z.+-]*|"")
    echo "invalid release version: $version" >&2
    exit 2
    ;;
esac

cd "$repository_root"
./scripts/package_macos_release.sh --version "$version" --unsigned

artifact="dist/release/Flowset-$version-arm64.zip"
sha256=$(cut -d ' ' -f 1 "$artifact.sha256")
./scripts/generate_homebrew_cask.sh \
  --version "$version" \
  --sha256 "$sha256" \
  --output dist/release/playlist-optimizer.rb
