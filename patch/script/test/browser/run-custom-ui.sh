#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Runs custom-ui.html in headless Chrome against a static server of patch/ (the Code node's sandboxed UI page, checked like a browser would).
# The page posts its result back to a tiny server; Chrome runs in real time (virtual time does not load the sandboxed frames).
#   test/browser/run-custom-ui.sh [chrome]
set -euo pipefail
CHROME="${1:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PATCH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PORT=8791
RESULT="$(mktemp)"
rm -f "$RESULT"
python3 - "$PATCH" "$PORT" "$RESULT" <<'PY' &
import sys, http.server, functools
root, port, result = sys.argv[1], int(sys.argv[2]), sys.argv[3]
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        open(result, "wb").write(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(204); self.end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory=root)).serve_forever()
PY
SERVER=$!; disown
"$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$(mktemp -d)" "http://localhost:$PORT/script/test/browser/custom-ui.html" >/dev/null 2>&1 &
BROWSER=$!
trap 'kill $SERVER $BROWSER 2>/dev/null || true; pkill -f "user-data-dir=.*" 2>/dev/null || true' EXIT
for _ in $(seq 1 160); do [ -s "$RESULT" ] && break; sleep 0.5; done
[ -s "$RESULT" ] || { echo "no result from the page"; exit 1; }
python3 - "$RESULT" <<'PY'
import sys, json
r = json.load(open(sys.argv[1]))
for c in r["checks"]: print(("ok   " if c["ok"] else "FAIL ") + c["what"] + ("  " + c["detail"] if c["detail"] and not c["ok"] else ""))
print("\n%d of %d checks passed" % (r["total"] - r["failed"], r["total"]))
sys.exit(1 if r["failed"] else 0)
PY
