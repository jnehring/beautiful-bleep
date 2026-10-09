#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Builds the browser version of the board (Bleep Board): one .wasm per module,
# the board UI and the web engine, as a static folder.
#
#   scripts/build-web.sh [out-dir]          default: build/web/site
#   python3 -m http.server -d build/web/site 8000
#
# Needs emcc (https://emscripten.org: `source emsdk_env.sh`), python3 and node.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATCH="$ROOT/patch"
OUT="${1:-$ROOT/build/web/site}"
command -v emcc >/dev/null || { echo "emcc not found: install the Emscripten SDK and source emsdk_env.sh" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/js"

# 1. The modules: <out>/modules/*.wasm and <out>/manifest.json.
python3 "$PATCH/web/build_modules.py" --out "$OUT" ${BLEEP_WEB_ONLY:+--only "$BLEEP_WEB_ONLY"}

# 2. The board UI, the way the plugins and scripts/ui-server.py serve it: board,
#    common and every module's ui/ and doc/ files side by side.
cp "$PATCH"/board/ui/* "$OUT"/
cp "$PATCH"/common/ui/* "$OUT"/
for m in "$PATCH"/modules/*/; do
  for sub in ui doc; do
    [ -d "$m$sub" ] && cp "$m$sub"/* "$OUT"/ 2>/dev/null || true
  done
done
( cd "$PATCH/modules" && ls */ui/*.js 2>/dev/null | xargs -n1 basename | sort | python3 -c \
  'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))' ) > "$OUT/module-views.json"

# 3. The web engine, loaded before board-demo.js (which forwards the board to it).
cp "$PATCH"/web/js/*.js "$OUT/js/"
python3 - "$OUT/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
tag = '<script src="js/bleep-web.js"></script>\n  '
assert '<script src="board-demo.js"></script>' in s
open(p, 'w').write(s.replace('<script src="board-demo.js"></script>', tag + '<script src="board-demo.js"></script>', 1))
PY
echo "Built $OUT ($(du -sh "$OUT" | cut -f1)); serve it with: python3 -m http.server -d $OUT 8000"
