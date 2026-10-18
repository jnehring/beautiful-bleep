#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# One go for the dev site's Bleep Play: rebuilds the modules (published to play/local-modules/) and
# the board UI + web engine (the dev compose file's `play` service, into website/app/public/play).
#
#   scripts/build/update-play.sh [--docker]    --docker builds the modules in the Emscripten image
#
# It first regenerates board/ui/demo-types.json (the module ports the board UI draws) from the C++
# module specs, so a port added to a module shows up in Play without a manual step.
#
# Then reload Bleep Play (Settings > Library > "Allow unsigned modules" on, once).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# demo-types.json is a snapshot of the module specs; the native dumper writes it (ctest patch.ui-types checks it).
TYPES_BUILD="$ROOT/build/patch"
if [[ ! -f "$TYPES_BUILD/CMakeCache.txt" ]]; then
    cmake -S "$ROOT/patch" -B "$TYPES_BUILD" -DCMAKE_BUILD_TYPE=Release -DBLEEP_JUCE_DIR="${BLEEP_JUCE_DIR:-}" \
        -DBLEEP_FORMATS=VST3 -DBLEEP_BUILD_TESTS=ON
fi
cmake --build "$TYPES_BUILD" --config Release --target bleep_dump_types --parallel
DUMP="$(find "$TYPES_BUILD" -name bleep_dump_types -type f -perm -u+x | head -n 1)"
"$DUMP" --write patch/board/ui/demo-types.json
"$ROOT/scripts/build/build-web.sh" "$@" --modules-only
docker compose -f website/docker-compose.yml -f website/docker-compose.dev.yml --env-file website/.env run --rm play
echo "Bleep Play updated: modules and board UI. Reload the page."
