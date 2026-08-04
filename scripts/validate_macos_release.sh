#!/bin/sh
set -eu

usage() {
  echo "usage: $0 APP_OR_ZIP [--allow-unsigned]" >&2
}

[ "$#" -ge 1 ] || {
  usage
  exit 2
}

input=$1
shift
allow_unsigned=false

if [ "${1-}" = "--allow-unsigned" ]; then
  allow_unsigned=true
  shift
fi

[ "$#" -eq 0 ] || {
  usage
  exit 2
}

tmp_dir=
cleanup() {
  if [ -n "$tmp_dir" ]; then
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT INT TERM

case "$input" in
  *.zip)
    tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/playlist-optimizer-validate.XXXXXX")
    ditto -x -k "$input" "$tmp_dir"
    app="$tmp_dir/Flowset.app"
    ;;
  *.app)
    app=$input
    ;;
  *)
    echo "expected a .app or .zip: $input" >&2
    exit 2
    ;;
esac

[ -d "$app" ] || {
  echo "missing app bundle: $app" >&2
  exit 1
}

info="$app/Contents/Info.plist"
main="$app/Contents/MacOS/playlist-optimizer-desktop"
sidecar="$app/Contents/MacOS/playlist-optimizer-api"
resources="$app/Contents/Resources"

[ -f "$info" ]
[ -x "$main" ]
[ -x "$sidecar" ]
[ -d "$resources/models/essentia" ]
[ -f "$resources/LICENSE" ]
[ -f "$resources/THIRD_PARTY_NOTICES.md" ]
[ -f "$resources/licenses/ESSENTIA-AGPL-3.0.txt" ]

bundle_id=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$info")
minimum_system=$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$info")

[ "$bundle_id" = "com.discolotus.playlist-optimizer" ] || {
  echo "unexpected bundle identifier: $bundle_id" >&2
  exit 1
}
[ "$minimum_system" = "15.2" ] || {
  echo "unexpected minimum macOS version: $minimum_system" >&2
  exit 1
}

main_archs=$(lipo -archs "$main")
sidecar_archs=$(lipo -archs "$sidecar")
case " $main_archs " in
  *" arm64 "*) ;;
  *) echo "main executable is missing arm64: $main_archs" >&2; exit 1 ;;
esac
case " $sidecar_archs " in
  *" arm64 "*) ;;
  *) echo "API sidecar is missing arm64: $sidecar_archs" >&2; exit 1 ;;
esac

model_count=$(find "$resources/models/essentia" -type f \( -name '*.pb' -o -name '*.json' \) | wc -l | tr -d ' ')
[ "$model_count" -eq 9 ] || {
  echo "expected 9 Essentia model artifacts, found $model_count" >&2
  exit 1
}

codesign --verify --deep --strict --verbose=2 "$app"

if [ "$allow_unsigned" = true ]; then
  authority=$(codesign -dv --verbose=4 "$app" 2>&1 | sed -n 's/^Signature=//p')
  [ "$authority" = "adhoc" ] || {
    echo "expected an ad-hoc signature, found: ${authority:-unknown}" >&2
    exit 1
  }
  if spctl --assess --type execute "$app" >/dev/null 2>&1; then
    echo "warning: Gatekeeper unexpectedly accepted the unsigned preview" >&2
  else
    echo "Gatekeeper rejection expected: this is an unsigned preview" >&2
  fi
else
  spctl --assess --type execute --verbose=2 "$app"
  xcrun stapler validate "$app"
fi

echo "validated: $app"
echo "bundle identifier: $bundle_id"
echo "architectures: main=$main_archs sidecar=$sidecar_archs"
echo "Essentia model artifacts: $model_count"
