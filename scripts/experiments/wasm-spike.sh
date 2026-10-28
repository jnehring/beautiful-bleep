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
mkdir -p "$W"
"$ROOT/scripts/build/fetch-wasmtime.sh" "$W/wasmtime"
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
