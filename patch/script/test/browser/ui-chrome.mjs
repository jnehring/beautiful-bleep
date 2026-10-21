// SPDX-License-Identifier: GPL-3.0-or-later
// Loads each module's own UI (script/src/<name>.view.js) in the real sandboxed frame in headless Chrome, with a real mouse driven through the
// DevTools protocol, and checks that it paints, that dragging in the picture sets knobs, and that nothing is reported as an error. Takes a screenshot
// of every UI at two widths into <outdir> (look at them: nothing else can tell whether a picture is any good).
//   node test/browser/ui-chrome.mjs [outdir] [name ...]        needs Chrome (CHROME=/path/to/chrome); run `node build.mjs` first (spec.json files)
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), PATCH = join(here, "..", "..", "..");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outdir = process.argv[2] || join(tmpdir(), "bleep-ui-shots");
const ALL = ["preamp", "valve-stage", "channel-strip", "tone-eq", "opto-compressor", "mic-colour", "tape-machine", "vinyl", "cheap-speaker"];
const names = process.argv.length > 3 ? process.argv.slice(3) : ALL;
mkdirSync(outdir, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const path = join(PATCH, decodeURIComponent(req.url.split("?")[0]));
  if (!path.startsWith(PATCH) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" }).end(readFileSync(path));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), "bleep-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const done = (code) => { chrome.kill(); server.close(); process.exit(code); };
process.on("SIGINT", () => done(1));

let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch("http://127.0.0.1:9333/json/list")).json()).find((t) => t.type === "page"); } catch (e) { /* not up yet */ }
  if (!target) await new Promise((r) => setTimeout(r, 250));
}
if (!target) { console.error("Chrome did not start"); done(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } };
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await cdp("Page.enable");

const EXTRA = { "tone-eq": [[128, 88]], "mic-colour": [[344, 82]], "cheap-speaker": [[164, 216], [404, 30]] };
let failures = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); if (!ok) failures++; };
const mouse = (type, x, y, extra = {}) => cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });

for (const W of [700, 1100]) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: W + 40, height: 700, deviceScaleFactor: 2, mobile: false });
  for (const name of names) {
    await cdp("Page.navigate", { url: `${base}/script/test/browser/custom-ui-live.html?name=${name}&w=${W}` });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(100); ok = await evaluate("!!(window._ui && window._ui.painted)").catch(() => false); }
    await sleep(900);   // let the picture animate
    const h = await evaluate("document.querySelector('iframe').getBoundingClientRect().height");
    check(ok, `${name} @ ${W}px: the UI paints in the sandboxed frame`);
    const shot = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W + 20, height: Math.min(700, h + 20), scale: 1 } });
    writeFileSync(join(outdir, `${name}-${W}.png`), Buffer.from(shot.data, "base64"));
    if (W !== 700) { check((await evaluate("_ui.errors.length")) === 0, `${name} @ ${W}px: no errors`, JSON.stringify(await evaluate("_ui.errors"))); continue; }
    // a real mouse: drag from many points over the picture; any knob set (or button press) means the interaction reaches the module
    const before = await evaluate("_ui.sets.length + _ui.commands.length");
    const box = await evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
    const hits = new Set();
    const points = [];
    for (const fy of [0.25, 0.5, 0.75]) for (const fx of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) points.push([box.w * fx, box.h * fy]);
    for (const [px, py] of EXTRA[name] || []) points.push([px, py]);   // small handles a sweep would miss (css px inside the frame at 700 px)
    for (const [dx, dy] of points) {
      const x = box.x + dx, y = box.y + dy, n = await evaluate("_ui.sets.length");
      await mouse("mouseMoved", x, y, { button: "none", buttons: 0 }); await mouse("mousePressed", x, y);
      await mouse("mouseMoved", x + 18, y - 14); await mouse("mouseMoved", x + 36, y - 28); await mouse("mouseReleased", x + 36, y - 28);
      await sleep(40);
      for (const s of (await evaluate(`_ui.sets.slice(${n})`))) hits.add(s.id);
    }
    const after = await evaluate("_ui.sets.length + _ui.commands.length");
    check(after > before, `${name}: dragging with a real mouse sets knobs`, [...hits].join(", "));
    check((await evaluate("_ui.errors.length")) === 0, `${name}: no errors after the interaction`, JSON.stringify(await evaluate("_ui.errors")));
    const range = await evaluate("_ui.sets.every((s) => Number.isFinite(s.value) && s.x >= 0 && s.x <= 1)");
    check(range, `${name}: every value it set is finite and inside its range`);
    await sleep(200);
    const shot2 = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W + 20, height: Math.min(700, h + 20), scale: 1 } });
    writeFileSync(join(outdir, `${name}-${W}-after-drag.png`), Buffer.from(shot2.data, "base64"));
  }
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed", `(screenshots in ${outdir})`);
done(failures ? 1 : 0);
