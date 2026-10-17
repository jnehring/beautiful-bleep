#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Builds the data the patch assistant needs (agent/, doc/specs/agent.md) into website/api/agent_data/:
#   catalog.json   every module type with knobs and jacks (from board/ui/demo-types.json and the module folders)
#   presets.jsonl  the example patches the assistant can study (board/ui/demo-patches.json)
#   docs.sqlite    the documentation index: chunks, full-text index and, with --embed, embeddings
#
#   scripts/build/build-agent-data.sh                       keyword-only documentation search, no API key needed
#   scripts/build/build-agent-data.sh --embed gemini-embedding-2   + embeddings (needs GEMINI_API_KEY; cached in .eval-cache)
#
# Run it again after docs, modules or demo patches change; ship the result with the API image (website/api/Dockerfile).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PY="${PYTHON:-python3}"
if ! "$PY" -c "import bleep_agent" 2>/dev/null; then
    echo "bleep_agent is not installed: python3 -m venv .venv-agent && .venv-agent/bin/pip install -e agent  (then PYTHON=.venv-agent/bin/python)" >&2
    exit 1
fi
exec "$PY" -m bleep_agent.cli data "$@"
