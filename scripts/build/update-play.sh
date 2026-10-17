#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# One go for the dev site's Bleep Play: rebuilds the modules (published to play/local-modules/) and
# the board UI + web engine (the dev compose file's `play` service, into website/app/public/play).
#
#   scripts/build/update-play.sh [--docker]    --docker builds the modules in the Emscripten image
#
# Then reload Bleep Play (Settings > Library > "Allow unsigned modules" on, once).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
"$ROOT/scripts/build/build-web.sh" "$@" --modules-only
docker compose -f website/docker-compose.yml -f website/docker-compose.dev.yml --env-file website/.env run --rm play
echo "Bleep Play updated: modules and board UI. Reload the page."
