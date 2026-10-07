#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Builds Bleep Bus (library, examples, conformance suite) and runs its tests.
#
#   bus/build.sh [--debug] [--clean] [--no-test]
#
# Output: build/bus/ (bleep_bus library, bb_conformance, minimal_sender,
# minimal_receiver, attenuverter).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT/build/bus"
CONFIG=Release
TEST=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        --debug) CONFIG=Debug ;;
        --clean) rm -rf "$BUILD_DIR" ;;
        --no-test) TEST=0 ;;
        -h|--help) sed -n '3,9p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

GENERATOR=()
if command -v ninja >/dev/null && [[ ! -f "$BUILD_DIR/CMakeCache.txt" ]]; then GENERATOR=(-G Ninja); fi

cmake -S "$ROOT/bus" -B "$BUILD_DIR" ${GENERATOR[@]+"${GENERATOR[@]}"} -DCMAKE_BUILD_TYPE="$CONFIG"
cmake --build "$BUILD_DIR" --config "$CONFIG" --parallel

if [[ $TEST == 1 ]]; then
    ctest --test-dir "$BUILD_DIR" -C "$CONFIG" --output-on-failure
fi

echo
echo "Bleep Bus built in $BUILD_DIR"
echo "  try: $BUILD_DIR/minimal_sender & $BUILD_DIR/minimal_receiver"
