#!/bin/sh
set -eu

usage() {
  echo "usage: $0 --version VERSION (--unsigned | --identity IDENTITY) [--output-dir DIR]" >&2
}

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=
identity=
unsigned=false
output_dir="$project_root/dist/release"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      version=${2-}
      shift 2
      ;;
    --unsigned)
      unsigned=true
      shift
      ;;
    --identity)
      identity=${2-}
      shift 2
      ;;
    --output-dir)
      output_dir=${2-}
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

case "$version" in
  *[!0-9A-Za-z.-]*|"")
    echo "invalid version: $version" >&2
    exit 2
    ;;
esac

if [ "$unsigned" = true ] && [ -n "$identity" ]; then
  echo "choose either --unsigned or --identity, not both" >&2
  exit 2
fi
if [ "$unsigned" = false ] && [ -z "$identity" ]; then
  usage
  exit 2
fi

case "$(uname -m)" in
  arm64) arch=arm64 ;;
  *)
    echo "the current release contract supports Apple silicon only" >&2
    exit 1
    ;;
esac

cd "$project_root"
npm run desktop:build

app="$project_root/src-tauri/target/release/bundle/macos/Playlist Optimizer.app"
[ -d "$app" ] || {
  echo "Tauri did not produce the expected app bundle: $app" >&2
  exit 1
}

resources="$app/Contents/Resources"
mkdir -p "$resources/licenses"
cp "$project_root/LICENSE" "$resources/LICENSE"
cp "$project_root/THIRD_PARTY_NOTICES.md" "$resources/THIRD_PARTY_NOTICES.md"

essentia_license=$(find "$project_root/apps/api/.venv" -path \
  '*/essentia_tensorflow-*.dist-info/licenses/COPYING.txt' -print -quit)
[ -n "$essentia_license" ] || {
  echo "could not find Essentia's installed AGPL license text" >&2
  exit 1
}
cp "$essentia_license" "$resources/licenses/ESSENTIA-AGPL-3.0.txt"

sidecar="$app/Contents/MacOS/playlist-optimizer-api"
main="$app/Contents/MacOS/playlist-optimizer-desktop"
[ -x "$sidecar" ]
[ -x "$main" ]

if [ "$unsigned" = true ]; then
  codesign --force --sign - --timestamp=none "$sidecar"
  codesign --force --sign - --timestamp=none "$main"
  codesign --force --sign - --timestamp=none \
    --entitlements "$project_root/src-tauri/Entitlements.plist" "$app"
else
  codesign --force --sign "$identity" --timestamp --options runtime "$sidecar"
  codesign --force --sign "$identity" --timestamp --options runtime "$main"
  codesign --force --sign "$identity" --timestamp --options runtime \
    --entitlements "$project_root/src-tauri/Entitlements.plist" "$app"
fi

mkdir -p "$output_dir"
artifact="$output_dir/Playlist-Optimizer-$version-$arch.zip"
checksum="$artifact.sha256"
rm -f "$artifact" "$checksum"
ditto -c -k --sequesterRsrc --keepParent "$app" "$artifact"
(
  cd "$output_dir"
  shasum -a 256 "$(basename "$artifact")" >"$(basename "$checksum")"
)

if [ "$unsigned" = true ]; then
  "$project_root/scripts/validate_macos_release.sh" "$artifact" --allow-unsigned
else
  "$project_root/scripts/validate_macos_release.sh" "$artifact"
fi

echo "artifact: $artifact"
echo "checksum: $checksum"
