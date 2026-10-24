#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# Builds and runs test/wasmtime_check.cpp: the compiled Gains module in the engine's Wasmtime host.
# Needs the Wasmtime C API that scripts/experiments/wasm-spike.sh downloads to build/wasm-spike/wasmtime.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WT="${BLEEP_WASMTIME_DIR:-$ROOT/build/wasm-spike/wasmtime}"
OUT="$HERE/build/wasmtime_check"
LIBS=""; [ "$(uname -s)" = Darwin ] && LIBS="-framework CoreFoundation -framework Security" || LIBS="-lpthread -ldl -lm"
mkdir -p "$HERE/build"
clang++ -std=c++20 -O2 -DNDEBUG -I"$WT/include" -I"$ROOT/patch/engine" \
  "$HERE/test/wasmtime_check.cpp" "$ROOT/patch/engine/wasm/WasmRuntime.cpp" "$WT/lib/libwasmtime.a" $LIBS -o "$OUT"
exec "$OUT" "${1:-$HERE/build/gains.wasm}"
