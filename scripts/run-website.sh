#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Runs the Bleep Patch website in Docker (one container: static site + Caddy).
#
#   scripts/run-website.sh [up|down|logs|rebuild]     (default: up)
#
# Serves on http://localhost:${BLEEP_SITE_PORT:-8080}.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/website/docker-compose.yml")

case "${1:-up}" in
    up) "${COMPOSE[@]}" up --build -d && echo "site: http://localhost:${BLEEP_SITE_PORT:-8080}" ;;
    rebuild) "${COMPOSE[@]}" build --no-cache && "${COMPOSE[@]}" up -d ;;
    down) "${COMPOSE[@]}" down ;;
    logs) "${COMPOSE[@]}" logs -f ;;
    -h|--help) sed -n '3,8p' "$0" ;;
    *) echo "unknown command: $1" >&2; exit 2 ;;
esac
