#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Rebuilds the plugins and restarts Ableton Live with a test set (macOS).
# Live keeps a plugin's code loaded until it quits, so this is the shortest
# loop for engine, DSP and bus changes.
#
#   scripts/run/reload-live.sh <set.als> [build-patch.sh options]
#   e.g. scripts/run/reload-live.sh ~/Music/bleep-test.als --juce ~/JUCE --ui-dev
#
# The set can also come from $BLEEP_LIVE_SET. Steps:
#   1. build (scripts/build/build-patch.sh --no-test …); stop here if it fails
#   2. ask Live to quit and wait — save the set first, or answer Live's
#      save dialog; the script never force-quits Live
#   3. replace the VST3 bundles in ~/Library/Audio/Plug-Ins/VST3
#      (only now: overwriting a loaded plugin can crash Live)
#   4. open the set in the same Live version
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VST3_DIR="$HOME/Library/Audio/Plug-Ins/VST3"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then sed -n '3,17p' "$0"; exit 0; fi
SET="${BLEEP_LIVE_SET:-}"
if [[ $# -gt 0 && "$1" != --* ]]; then SET="$1"; shift; fi
if [[ -z "$SET" || ! -f "$SET" ]]; then
    echo "usage: scripts/run/reload-live.sh <set.als> [build options]   (or set BLEEP_LIVE_SET)" >&2
    exit 2
fi
SET="$(cd "$(dirname "$SET")" && pwd)/$(basename "$SET")"
[[ "$(uname)" == "Darwin" ]] || { echo "reload-live.sh supports macOS only" >&2; exit 2; }

# 1. Build, without the CMake copy step (it would overwrite the loaded plugins).
"$ROOT/scripts/build/build-patch.sh" --no-test "$@"

# 2. Quit Live, remembering which Live app was running.
live_pid() { pgrep -f '\.app/Contents/MacOS/Live$' | head -1; }
LIVE_APP=""
if PID="$(live_pid)" && [[ -n "$PID" ]]; then
    LIVE_APP="$(ps -o command= -p "$PID" | sed -E 's#(\.app)/Contents/MacOS/Live$#\1#')"
    echo "quitting $(basename "$LIVE_APP") …"
    osascript -e 'on run argv' -e 'tell application (item 1 of argv) to quit' -e 'end run' "$LIVE_APP" >/dev/null 2>&1 || true
    waited=0
    while kill -0 "$PID" 2>/dev/null; do
        sleep 1
        waited=$((waited + 1))
        if [[ $waited == 5 ]]; then echo "waiting for Live to quit (answer its save dialog if it shows one) …"; fi
        if [[ $waited -ge 300 ]]; then echo "Live is still running; giving up without touching the plugins." >&2; exit 1; fi
    done
fi
if [[ -z "$LIVE_APP" ]]; then
    LIVE_APP="$(ls -d /Applications/Ableton\ Live*.app 2>/dev/null | sort | tail -1 || true)"
    [[ -n "$LIVE_APP" ]] || { echo "no Ableton Live found in /Applications" >&2; exit 1; }
fi

# 3. Replace the bundles (new files, not an in-place overwrite).
CONFIG_DIR=Release
for arg in "$@"; do [[ "$arg" == "--debug" ]] && CONFIG_DIR=Debug; done
mkdir -p "$VST3_DIR"
for bundle in "$ROOT"/build/patch/*_artefacts/"$CONFIG_DIR"/VST3/*.vst3; do
    [[ -e "$bundle" ]] || continue
    rm -rf "$VST3_DIR/$(basename "$bundle")"
    ditto "$bundle" "$VST3_DIR/$(basename "$bundle")"
    echo "installed $(basename "$bundle")"
done

# 4. Reopen the set.
echo "opening $(basename "$SET") in $(basename "$LIVE_APP")"
open -a "$LIVE_APP" "$SET"
