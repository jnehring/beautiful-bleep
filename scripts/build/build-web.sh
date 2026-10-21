#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Builds the browser version of the board (the board): one .wasm per module,
# the board UI and the web engine, as a static folder. The board does not load the
# .wasm files from this folder: it installs its modules from the Bleep Library, as
# signed packages (scripts/release/package-module.py, release.py --modules). The
# .wasm files are the input of that packaging.
#
#   scripts/build/build-web.sh [out-dir]              everything; default: build/web/site
#   scripts/build/build-web.sh --no-modules [out-dir] only the board UI and the web engine (seconds, no
#                                               Emscripten or JUCE needed; what the website image does)
#   scripts/build/build-web.sh --modules-only [out-dir]  only modules/*.wasm and manifest.json; default
#                                               build/web/modules (what package-module.py packages). It also
#                                               publishes them to the dev site's play/local-modules/ (see below)
#   add --docker (first) to run the build in the Emscripten Docker image instead of a local emsdk:
#   scripts/build/build-web.sh --docker --modules-only
#   python3 -m http.server -d build/web/site 8000
#
# Needs emcc (https://emscripten.org: `source emsdk_env.sh`), python3 and node.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PATCH="$ROOT/patch"
MODULES=1
UI=1
DOCKER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-modules) MODULES=0 ;;
    --modules-only) UI=0 ;;
    --docker) DOCKER=1 ;;
    *) break ;;
  esac
  shift
done
if [ "$DOCKER" = 1 ]; then
  # Same build inside the Emscripten image: no local emsdk needed. JUCE is cloned into build/web/JUCE
  # (kept between runs). Output paths must be inside the repository.
  args=(); [ "$MODULES" = 0 ] && args+=(--no-modules); [ "$UI" = 0 ] && args+=(--modules-only)
  uidargs=(); [ "$(uname)" = Linux ] && uidargs=(-u "$(id -u):$(id -g)" -e HOME=/tmp)
  ttyargs=(); [ -t 1 ] && ttyargs=(-t)   # a terminal: the progress bar redraws in place
  exec docker run --rm ${ttyargs[@]+"${ttyargs[@]}"} -e PYTHONUNBUFFERED=1 ${uidargs[@]+"${uidargs[@]}"} -e BLEEP_WEB_ONLY="${BLEEP_WEB_ONLY:-}" \
    -v "$ROOT:/repo" -w /repo emscripten/emsdk:4.0.10 scripts/build/build-web.sh ${args[@]+"${args[@]}"} ${1:+"/repo/${1#$ROOT/}"}
fi
if [ "$UI" = 1 ]; then OUT="${1:-$ROOT/build/web/site}"; else OUT="${1:-$ROOT/build/web/modules}"; fi
if [ "$MODULES" = 1 ]; then
  command -v emcc >/dev/null || { echo "emcc not found: install the Emscripten SDK and source emsdk_env.sh" >&2; exit 1; }
fi

# A full build starts the site folder afresh, but keeps what the module build caches there
# (modules/, manifest.json, .cache/, .juce/): wiping them recompiled every module each time.
if [ "$UI" = 1 ] && [ -d "$OUT" ]; then
  find "$OUT" -mindepth 1 -maxdepth 1 ! -name modules ! -name manifest.json ! -name .cache ! -name .juce -exec rm -rf {} +
fi
mkdir -p "$OUT/js"

# 1. The modules: <out>/modules/*.wasm and <out>/manifest.json. Modules that use
#    juce_core need a JUCE checkout: BLEEP_JUCE_DIR, else JUCE 8.0.9 is cloned.
if [ "$MODULES" = 1 ]; then
  JUCE="${BLEEP_JUCE_DIR:-}"
  if [ -z "$JUCE" ]; then
    JUCE="$ROOT/build/web/JUCE"
    [ -d "$JUCE/modules/juce_core" ] || { git clone -q --depth 1 --branch 8.0.9 https://github.com/juce-framework/JUCE.git "$JUCE" && [ "$(git -C "$JUCE" rev-parse HEAD)" = f72bad64d29715216226685810c5196bd0d79d77 ] || { echo "JUCE 8.0.9 is not the pinned commit" >&2; exit 1; }; }
  fi
  python3 "$PATCH/web/build_modules.py" --out "$OUT" --juce "$JUCE" ${BLEEP_WEB_ONLY:+--only "$BLEEP_WEB_ONLY"}
fi
if [ "$UI" = 0 ]; then
  rmdir "$OUT/js" 2>/dev/null || true
  echo "Built the modules in $OUT"
  # For development: the website's dev site (website/docker-compose.dev.yml) serves website/app/public/play, and Bleep Play there takes
  # the modules of a local-modules/ folder next to it, unsigned, while Settings > Library > "Allow unsigned modules" is on. So this build
  # is all a module change needs: no packaging, signing or release. The modules' view scripts go along, so a change to one shows too.
  # BLEEP_LOCAL_MODULES=<dir> names another folder, BLEEP_LOCAL_MODULES=off skips this; it is skipped unless the play folder exists.
  LOCAL="${BLEEP_LOCAL_MODULES:-$ROOT/website/app/public/play/local-modules}"
  if [ "$LOCAL" != off ] && [ -d "$(dirname "$LOCAL")" ]; then
    rm -rf "$LOCAL"; mkdir -p "$LOCAL/views"
    cp -R "$OUT/modules" "$OUT/manifest.json" "$LOCAL/"
    for m in "$PATCH"/modules/*/; do [ -d "$m/ui" ] && cp "$m"/ui/*.js "$LOCAL/views/" 2>/dev/null || true; done
    ( cd "$LOCAL/views" && ls *.js 2>/dev/null | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))' ) > "$LOCAL/views.json"
    echo "Local modules for Bleep Play: $LOCAL (reload the page; turn on Allow unsigned modules once)"
  fi
  exit 0
fi

# 2. The board UI, the way the plugins and scripts/run/ui-server.py serve it: board,
#    common and every module's ui/ and doc/ files side by side.
cp "$PATCH"/board/ui/* "$OUT"/
cp "$PATCH"/common/ui/* "$OUT"/
# The Bleep Script compiler and code editor for the Code node (patch/script: npm install && npm run bundle), loaded on first use. Without the
# compiler the Code node says so; without the editor it uses a plain text box.
for f in bleep-script-compiler.js bleep-script-merge.js bleep-script-editor.js; do [ -f "$PATCH/script/dist/$f" ] && cp "$PATCH/script/dist/$f" "$OUT"/ || true; done
for m in "$PATCH"/modules/*/; do
  for sub in ui doc; do
    [ -d "$m$sub" ] && cp "$m$sub"/* "$OUT"/ 2>/dev/null || true
  done
done
# The Help menu's Info shows the version of the project.
sed -n 's/^project(BleepBoard VERSION \([0-9.]*\).*/{"version":"\1"}/p' "$PATCH/CMakeLists.txt" > "$OUT/version.json"
( cd "$PATCH/modules" && ls */ui/*.js 2>/dev/null | xargs -n1 basename | sort | python3 -c \
  'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))' ) > "$OUT/module-views.json"

# 3. The web engine, loaded before board-demo.js (which forwards the board to it).
cp "$PATCH"/web/js/*.js "$OUT/js/"
# The library's root keys are pinned here, from the one configuration the apps are built with; the page never fetches them.
python3 - "$ROOT/config/library.json" "$OUT/js/library-roots.js" <<'PY'
import json, sys
keys = json.load(open(sys.argv[1])).get("rootKeys", [])
assert keys and all(len(bytes.fromhex(k)) == 32 for k in keys), "config/library.json needs rootKeys"
open(sys.argv[2], "w").write("// Generated by build-web.sh from config/library.json: the library's pinned root keys.\n"
    "BleepLibrary.configure({ roots: %s.map(BleepLibrary.fromHex) });\n" % json.dumps(keys))
PY
python3 - "$OUT/index.html" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
tag = '<script src="js/user-modules.js"></script>\n  <script src="js/bleepmod.js"></script>\n  <script src="js/library-client.js"></script>\n  <script src="js/library-roots.js"></script>\n  <script src="js/web-settings.js"></script>\n  <script src="js/web-media.js"></script>\n  <script src="js/bleep-web.js"></script>\n  <script src="js/bridge-ui.js"></script>\n  '
assert '<script src="board-demo.js"></script>' in s
s = s.replace('<script src="board-demo.js"></script>', tag + '<script src="board-demo.js"></script>', 1)
# Content-Security-Policy for the browser build: no inline script and no eval anywhere in the UI; 'wasm-unsafe-eval' only because the
# modules are WebAssembly. connect-src: the page's own origin (store, registry, account API) and the app's web link on this computer.
csp = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
       "connect-src 'self' ws://127.0.0.1:* ws://localhost:*; "
       "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'")
meta = '<meta http-equiv="Content-Security-Policy" content="%s">\n  ' % csp
marker = '<meta name="viewport"'
assert marker in s
open(p, 'w').write(s.replace(marker, meta + marker, 1))
PY
echo "Built $OUT ($(du -sh "$OUT" | cut -f1)); serve it with: python3 -m http.server -d $OUT 8000"
