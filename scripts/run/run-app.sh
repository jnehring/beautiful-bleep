#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Builds the standalone Bleep App (spec §11) and starts it, with its
# console output in this terminal. Only the app is built, not the plugins
# (in build/app/, apart from build-patch.sh's build/patch/).
#
#   scripts/run/run-app.sh [--debug] [--ui-dev] [--no-build] [--smoke]
#                      [--juce <dir>] [project.bleepboard]
#
#   --debug     Debug build (default Release)
#   --ui-dev    the app reads the board UI from patch/: edit HTML/CSS/JS,
#               then press Cmd-R in the board window
#   --no-build  start the last build as it is
#   --smoke     start without audio inputs and Link, print a report, quit
#   --juce      local JUCE checkout (default: $BLEEP_JUCE_DIR, else the
#               build's cached choice, else download JUCE 8.0.9)
#
# A running app is asked to quit first (it may ask you to save); the script
# never force-quits it. Output: build/app/BleepApp_artefacts/<Config>/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Its own build dir: build-patch.sh configures build/patch with other options (tests, ccache, ...),
# and every change of a CMake option there recompiles. Sharing the dir made both scripts rebuild.
BUILD_DIR="$ROOT/build/app"
CONFIG=Release
UI_DEV=OFF
BUILD=1
APP_ARGS=()
JUCE_DIR="${BLEEP_JUCE_DIR:-}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --debug) CONFIG=Debug ;;
        --ui-dev) UI_DEV=ON ;;
        --no-build) BUILD=0 ;;
        --smoke) APP_ARGS+=(--smoke) ;;
        --juce) JUCE_DIR="$2"; shift ;;
        -h|--help) sed -n '3,20p' "$0"; exit 0 ;;
        -*) echo "unknown option: $1" >&2; exit 2 ;;
        *) APP_ARGS+=("$(cd "$(dirname "$1")" && pwd)/$(basename "$1")") ;;  # a project file
    esac
    shift
done

APP="$BUILD_DIR/BleepApp_artefacts/$CONFIG/Bleep App.app"
BIN="$APP/Contents/MacOS/Bleep App"

if [[ $BUILD == 1 ]]; then
    GENERATOR=()
    if command -v ninja >/dev/null && [[ ! -f "$BUILD_DIR/CMakeCache.txt" ]]; then GENERATOR=(-G Ninja); fi
    LAUNCHER=()
    if command -v ccache >/dev/null; then
        LAUNCHER=(-DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache -DCMAKE_OBJCXX_COMPILER_LAUNCHER=ccache)
    fi
    JUCE_ARG=()
    [[ -n "$JUCE_DIR" ]] && JUCE_ARG=(-DBLEEP_JUCE_DIR="$JUCE_DIR")
    cmake -S "$ROOT/patch" -B "$BUILD_DIR" ${GENERATOR[@]+"${GENERATOR[@]}"} ${JUCE_ARG[@]+"${JUCE_ARG[@]}"} ${LAUNCHER[@]+"${LAUNCHER[@]}"} \
        -DCMAKE_BUILD_TYPE="$CONFIG" \
        -DBLEEP_FORMATS=VST3 \
        -DBLEEP_BUILD_APP=ON \
        -DBLEEP_UI_DEV="$UI_DEV" >/dev/null
    cmake --build "$BUILD_DIR" --config "$CONFIG" --target BleepApp --parallel
fi

if [[ ! -x "$BIN" ]]; then
    echo "no app at ${APP#$ROOT/}: build it first (without --no-build)" >&2
    exit 1
fi

# Quit a running copy politely: it keeps the virtual MIDI ports and the bridge segment.
if [[ "$(uname)" == "Darwin" ]] && pgrep -f "Bleep App.app/Contents/MacOS/Bleep App" >/dev/null; then
    echo "Asking the running Bleep App to quit…"
    osascript -e 'tell application id "com.brilliantbleep.patch.app" to quit' >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
        pgrep -f "Bleep App.app/Contents/MacOS/Bleep App" >/dev/null || break
        sleep 0.5
    done
    if pgrep -f "Bleep App.app/Contents/MacOS/Bleep App" >/dev/null; then
        echo "The app is still running (unsaved changes?). Quit it, then run this again." >&2
        exit 1
    fi
fi

# The binary is started directly, not through `open`, so register the bundle with
# LaunchServices first; otherwise the Dock shows a generic icon.
if [[ "$(uname)" == "Darwin" ]]; then
    touch "$APP"
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
fi

echo "Starting ${APP#$ROOT/} ($CONFIG$([[ $UI_DEV == ON ]] && echo ", UI from source"))"
exec "$BIN" ${APP_ARGS[@]+"${APP_ARGS[@]}"}
