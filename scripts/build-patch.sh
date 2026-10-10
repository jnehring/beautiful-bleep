#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Builds the Bleep Patch plugins (Bleep Patch, the six ports and Bleep Audio Bridge) as
# VST3, then runs the DSP, engine and bridge tests.
#
#   scripts/build-patch.sh [--debug] [--clean] [--no-test] [--install]
#                  [--juce <dir>] [--ui-dev]
#
#   --juce     local JUCE checkout (default: $BLEEP_JUCE_DIR, else download JUCE 8.0.9)
#   --install  copy the plugins into the user plugin folders
#              (macOS: ~/Library/Audio/Plug-Ins/VST3)
#   --ui-dev   plugins read the board UI from patch/ instead of the embedded copy:
#              edit HTML/CSS/JS, then press Cmd-R in the board window
#
# Spec §5.2: VST3 only, Ableton Live only (for now).
# Output: build/patch/<Plugin>_artefacts/<Config>/VST3/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT/build/patch"
CONFIG=Release
TEST=1
INSTALL=OFF
UI_DEV=OFF
JUCE_DIR="${BLEEP_JUCE_DIR:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --debug) CONFIG=Debug ;;
        --clean) rm -rf "$BUILD_DIR" ;;
        --no-test) TEST=0 ;;
        --install) INSTALL=ON ;;
        --ui-dev) UI_DEV=ON ;;
        --juce) JUCE_DIR="$2"; shift ;;
        -h|--help) sed -n '3,18p' "$0"; exit 0 ;;
        *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

# ccache (when installed) keeps compiled objects across clean builds and build directories.
LAUNCHER=()
if command -v ccache >/dev/null; then
    LAUNCHER=(-DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_OBJCXX_COMPILER_LAUNCHER=ccache)
fi

GENERATOR=()
if command -v ninja >/dev/null && [[ ! -f "$BUILD_DIR/CMakeCache.txt" ]]; then GENERATOR=(-G Ninja); fi

cmake -S "$ROOT/patch" -B "$BUILD_DIR" ${GENERATOR[@]+"${GENERATOR[@]}"} \
    -DCMAKE_BUILD_TYPE="$CONFIG" \
    ${LAUNCHER[@]+"${LAUNCHER[@]}"} \
    -DBLEEP_JUCE_DIR="$JUCE_DIR" \
    -DBLEEP_PATCH_FORMATS=VST3 \
    -DBLEEP_PATCH_COPY_PLUGINS="$INSTALL" \
    -DBLEEP_PATCH_UI_DEV="$UI_DEV"
cmake --build "$BUILD_DIR" --config "$CONFIG" --parallel

if [[ $TEST == 1 ]]; then
    ctest --test-dir "$BUILD_DIR" -C "$CONFIG" --output-on-failure
fi

echo
echo "Bleep Patch built (VST3):"
for app in "$BUILD_DIR"/*_artefacts/"$CONFIG"/*.app; do
    [[ -e "$app" ]] && echo "  ${app#$ROOT/}   (standalone app)"
done
for dir in "$BUILD_DIR"/*_artefacts/"$CONFIG"/*/; do
    for item in "$dir"*; do
        case "$item" in *.vst3|*.app|*.component|*.clap|*.exe) echo "  ${item#$ROOT/}" ;; esac
    done
done
