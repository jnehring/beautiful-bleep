#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Fetches the Wasmtime C API the wasm module host is built with (patch/CMakeLists.txt, BLEEP_WASMTIME_DIR) into
# build/wasm-spike/wasmtime, where CMake finds it without a flag. Pinned: the download is only unpacked if it is the file
# whose SHA-256 was recorded for this version. macOS, Linux and Windows (in Git Bash; the MSVC build); does nothing when the folder is there.
#
#   scripts/build/fetch-wasmtime.sh [folder]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEST="${1:-$ROOT/build/wasm-spike/wasmtime}"
WT_VERSION=49.0.2
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) WT_TARGET=aarch64-macos; WT_SHA=f7000ab1661495d09b9dc87a11b356941b4e6097f295434bcb30a8cf1393b0d5 ;;
  Darwin-x86_64) WT_TARGET=x86_64-macos; WT_SHA=1a1fd4bcec77d65bab1bdd4c38e4168825b7679c2f105bf573c4ef1cf5e779b1 ;;
  Linux-x86_64) WT_TARGET=x86_64-linux; WT_SHA=4818e139aeb83b7adbaaf41b267bf18992c18463ae26d1a9acdcfc63ea9eb316 ;;
  Linux-aarch64) WT_TARGET=aarch64-linux; WT_SHA=a97a874152b5fb49c4720b39b96a71d00ba61eab5ad59976163b7ddd1a3b14c0 ;;
  MINGW64_NT*-x86_64|MSYS_NT*-x86_64) WT_TARGET=x86_64-windows; WT_EXT=zip; WT_SHA=928dad67acbf4a4f97be8d528b271ac72f8e329da21e327b0724d3af86fe3f44 ;;
  *) echo "wasmtime: no pinned download for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
WT_EXT="${WT_EXT:-tar.xz}"
[ -f "$DEST/lib/libwasmtime.a" ] || [ -f "$DEST/lib/wasmtime.lib" ] && exit 0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/wasmtime.$WT_EXT" "https://github.com/bytecodealliance/wasmtime/releases/download/v$WT_VERSION/wasmtime-v$WT_VERSION-$WT_TARGET-c-api.$WT_EXT"
if command -v sha256sum >/dev/null; then SUM="sha256sum"; else SUM="shasum -a 256"; fi
echo "$WT_SHA  $TMP/wasmtime.$WT_EXT" | $SUM -c - >/dev/null || { echo "wasmtime download does not match the pinned SHA-256" >&2; exit 1; }
mkdir -p "$DEST"
if [ "$WT_EXT" = zip ]; then   # Git Bash has no unzip; Python reads the zip, without the folder level of the archive
  PY="$(command -v python3 || command -v python)"
  "$PY" - "$TMP/wasmtime.zip" "$DEST" <<'PYEOF'
import sys, zipfile
z, dest = zipfile.ZipFile(sys.argv[1]), sys.argv[2]
for m in z.infolist():
    m.filename = m.filename.split("/", 1)[1] if "/" in m.filename else ""
    if m.filename:
        z.extract(m, dest)
PYEOF
else
  tar xf "$TMP/wasmtime.tar.xz" -C "$DEST" --strip-components=1
fi
echo "Wasmtime $WT_VERSION in $DEST"
