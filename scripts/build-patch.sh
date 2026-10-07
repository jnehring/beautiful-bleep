#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Builds the Bleep Patch modules as VST3 and Standalone apps, then runs the
# DSP unit tests and the headless VST3 host test.
#
#   scripts/build-patch.sh [--debug] [--clean] [--no-test] [--install]
#                  [--juce <dir>] [--formats "VST3;Standalone;AU"] [--clap] [--ui-dev]
#
#   --juce     local JUCE checkout (default: $BLEEP_JUCE_DIR, else download JUCE 8.0.9)
#   --install  copy the plugins into the user plugin folders
#              (macOS: ~/Library/Audio/Plug-Ins/VST3)
#   --formats  JUCE format list (default "VST3;Standalone")
#   --ui-dev   plugins read their UI from patch/ instead of the embedded copy:
#              edit HTML/CSS/JS, then reopen the plugin window (or Cmd-R in it)
#
# Output: build/patch/<Module>_artefacts/<Config>/{VST3,Standalone}/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT/build/patch"
CONFIG=Release
TEST=1
INSTALL=OFF
CLAP=OFF
UI_DEV=OFF
FORMATS="VST3;Standalone"
JUCE_DIR="${BLEEP_JUCE_DIR:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --debug) CONFIG=Debug ;;
        --clean) rm -rf "$BUILD_DIR" ;;
        --no-test) TEST=0 ;;
        --install) INSTALL=ON ;;
        --clap) CLAP=ON ;;
        --ui-dev) UI_DEV=ON ;;
        --juce) JUCE_DIR="$2"; shift ;;
        --formats) FORMATS="$2"; shift ;;
        -h|--help) sed -n '3,17p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

GENERATOR=()
if command -v ninja >/dev/null && [[ ! -f "$BUILD_DIR/CMakeCache.txt" ]]; then GENERATOR=(-G Ninja); fi

cmake -S "$ROOT/patch" -B "$BUILD_DIR" ${GENERATOR[@]+"${GENERATOR[@]}"} \
    -DCMAKE_BUILD_TYPE="$CONFIG" \
    -DBLEEP_JUCE_DIR="$JUCE_DIR" \
    -DBLEEP_PATCH_FORMATS="$FORMATS" \
    -DBLEEP_PATCH_COPY_PLUGINS="$INSTALL" \
    -DBLEEP_PATCH_CLAP="$CLAP" \
    -DBLEEP_PATCH_UI_DEV="$UI_DEV"
cmake --build "$BUILD_DIR" --config "$CONFIG" --parallel

if [[ $TEST == 1 ]]; then
    ctest --test-dir "$BUILD_DIR" -C "$CONFIG" --output-on-failure
fi

echo
echo "Bleep Patch built ($FORMATS):"
for dir in "$BUILD_DIR"/*_artefacts/"$CONFIG"/*/; do
    for item in "$dir"*; do
        case "$item" in *.vst3|*.app|*.component|*.clap|*.exe) echo "  ${item#$ROOT/}" ;; esac
    done
done
