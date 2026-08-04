#!/bin/sh
set -eu

usage() {
  echo "usage: $0 --version VERSION --sha256 SHA256 [--url URL] [--output PATH]" >&2
}

version=
sha256=
output=
url='https://github.com/discolotus/spotify-playlist-optimizer/releases/download/v#{version}/Flowset-#{version}-arm64.zip'

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      version=${2-}
      shift 2
      ;;
    --sha256)
      sha256=${2-}
      shift 2
      ;;
    --output)
      output=${2-}
      shift 2
      ;;
    --url)
      url=${2-}
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

case "$sha256" in
  *[!0-9a-f]*|"")
    echo "invalid SHA-256: $sha256" >&2
    exit 2
    ;;
esac
[ "${#sha256}" -eq 64 ] || {
  echo "SHA-256 must contain exactly 64 lowercase hexadecimal characters" >&2
  exit 2
}
[ -n "$url" ] || {
  echo "URL must not be empty" >&2
  exit 2
}

render() {
  cat <<EOF
cask "playlist-optimizer" do
  version "$version"
  sha256 "$sha256"

  url "$url"
  name "Flowset"
  desc "Organize local music and export inspectable DJ-ready playlists"
  homepage "https://github.com/discolotus/spotify-playlist-optimizer"

  depends_on arch: :arm64
  depends_on formula: "ffmpeg"
  depends_on macos: :sequoia

  app "Flowset.app"

  zap trash: [
    "~/Library/Application Support/com.discolotus.playlist-optimizer",
    "~/Library/Caches/com.discolotus.playlist-optimizer",
    "~/Library/Preferences/com.discolotus.playlist-optimizer.plist",
  ]

  caveats <<~EOS
    This is an unsigned, non-commercial preview. It is ad-hoc signed but has
    not been notarized by Apple. Install it with:

      brew install --cask playlist-optimizer

    Before first launch, review the source and release checksum. macOS will
    require an explicit "Open Anyway" approval in Privacy & Security:
    https://github.com/discolotus/spotify-playlist-optimizer
  EOS
end
EOF
}

if [ -n "$output" ]; then
  mkdir -p "$(dirname "$output")"
  render >"$output"
else
  render
fi
