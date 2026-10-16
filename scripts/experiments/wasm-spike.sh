#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Spike (macOS / Linux): runs the Verb module's .wasm in Wasmtime and wasm3 next to the native build and
# prints CPU use and output differences. See patch/wasm-host/README.md.
#
#   scripts/experiments/wasm-spike.sh [seconds] [native|wasmtime|wasm3|all] [--serialized]
#
# Needs build/web/modules/modules/reverb.wasm (scripts/build/build-web.sh --docker --modules-only) and a C++20
# compiler. Downloads Wasmtime's C API and wasm3 into build/wasm-spike (once).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
W="$ROOT/build/wasm-spike"
WT_VERSION=49.0.2
mkdir -p "$W"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) WT_TARGET=aarch64-macos; WT_SHA=f7000ab1661495d09b9dc87a11b356941b4e6097f295434bcb30a8cf1393b0d5 ;;
  Darwin-x86_64) WT_TARGET=x86_64-macos; WT_SHA=1a1fd4bcec77d65bab1bdd4c38e4168825b7679c2f105bf573c4ef1cf5e779b1 ;;
  Linux-x86_64) WT_TARGET=x86_64-linux; WT_SHA=4818e139aeb83b7adbaaf41b267bf18992c18463ae26d1a9acdcfc63ea9eb316 ;;
  Linux-aarch64) WT_TARGET=aarch64-linux; WT_SHA=a97a874152b5fb49c4720b39b96a71d00ba61eab5ad59976163b7ddd1a3b14c0 ;;
  *) echo "unsupported platform" >&2; exit 1 ;;
esac
if [ ! -d "$W/wasmtime" ]; then
  curl -fsSL -o "$W/wasmtime.tar.xz" "https://github.com/bytecodealliance/wasmtime/releases/download/v$WT_VERSION/wasmtime-v$WT_VERSION-$WT_TARGET-c-api.tar.xz"
  # pinned: the download is only unpacked if it is the file whose hash was recorded for this version
  echo "$WT_SHA  $W/wasmtime.tar.xz" | shasum -a 256 -c - >/dev/null || { echo "wasmtime download does not match the pinned SHA-256" >&2; rm -f "$W/wasmtime.tar.xz"; exit 1; }
  mkdir -p "$W/wasmtime" && tar xf "$W/wasmtime.tar.xz" -C "$W/wasmtime" --strip-components=1
fi
WASM3_COMMIT=28ecb9af6d2040e474a70f7cb7f43666740141fb
if [ ! -d "$W/wasm3" ]; then
  git clone -q https://github.com/wasm3/wasm3.git "$W/wasm3"
  git -C "$W/wasm3" checkout -q "$WASM3_COMMIT"
fi

SRC="$ROOT/patch"
LIBS=""; [ "$(uname -s)" = Darwin ] && LIBS="-framework CoreFoundation -framework Security" || LIBS="-lpthread -ldl -lm"
M3=()
for f in m3_bind m3_code m3_compile m3_core m3_env m3_exec m3_function m3_info m3_module m3_parse m3_validate; do M3+=("$W/wasm3/source/$f.c"); done
mkdir -p "$W/obj"
for f in "${M3[@]}"; do clang -O3 -c -Dd_m3HasTracer=0 -I"$W/wasm3/source" "$f" -o "$W/obj/$(basename "$f").o"; done
clang++ -std=c++20 -O2 -DNDEBUG ${SPIKE_CXXFLAGS:-} \
  -I"$W/wasmtime/include" -I"$W/wasm3/source" -I"$SRC/engine" -I"$SRC/common" -I"$SRC/modules/reverb/dsp" \
  "$SRC/wasm-host/spike.cpp" "$SRC/web/src/WebShim.cpp" "$SRC/modules/reverb/ReverbModule.cpp" "$W"/obj/*.o \
  "$W/wasmtime/lib/libwasmtime.a" $LIBS -o "$W/spike"
exec "$W/spike" "$ROOT/build/web/modules/modules/reverb.wasm" "$@"
