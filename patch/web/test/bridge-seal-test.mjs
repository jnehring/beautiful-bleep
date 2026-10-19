// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bridge-seal-test.mjs — module view scripts cannot reach the native bridge (security finding H3).
//
//   node patch/web/test/bridge-seal-test.mjs
//
// Runs common/ui/bleep-bridge.js in a vm context that stands in for the page (a fake JUCE backend and platform message
// channel that record what is posted), calls seal() the way board.js does, and then runs "hostile view" scripts in the
// same context: they look for the bridge, replace the platform's message channel, patch JSON/Array/Promise, forge
// events and call the one-shot boot getter again. Nothing they do may produce a message that carries the secret, and the
// board's own calls must keep working afterwards. Also checks, as text, that no module view script touches the bridge and
// that the board's scripts keep their privileged objects in the private namespace instead of on `window`.
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const patch = path.resolve(here, "../..");
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.error("FAIL: " + msg); } };
const read = (rel) => fs.readFileSync(path.join(patch, rel), "utf8");

const SECRET = "s3cr3t-" + "0123456789abcdef".repeat(4);

/// A page: window with a JUCE-like backend, the platform channel (window.webkit...), crypto and a boot getter.
function makePage({ withSecret = true, noSeal = false } = {}) {
  const posted = [];      // everything that reached the platform's message channel
  const listeners = new Map();
  const events = [];      // window.addEventListener registrations: [type, fn, capture]
  const backend = {
    listeners,
    addEventListener(id, fn) { if (!listeners.has(id)) listeners.set(id, []); listeners.get(id).push(fn); return [id, 0]; },
    removeEventListener() {},
    emitEvent(id, o) { win.__JUCE__.postMessage(JSON.stringify({ eventId: id, payload: o })); },  // as JUCE's own script does
    emitByBackend(id, json) { for (const f of listeners.get(id) || []) f(JSON.parse(json)); },
  };
  const win = {
    console,
    crypto: { getRandomValues: (a) => webcrypto.getRandomValues(a) },  // a fresh object per page: a hostile script patches it
    Math, Uint32Array,
    addEventListener: (type, fn, cap) => events.push([type, fn, cap]),
    __JUCE__: { backend, initialisationData: { __juce__functions: [] }, postMessage(o) { win.webkit.messageHandlers.__JUCE__.postMessage(o); } },
    webkit: { messageHandlers: { __JUCE__: { postMessage(o) { posted.push(o); } } } },
  };
  // a document that can make an anchor, for download()
  const clicked = [];
  win.document = { body: { appendChild() {} }, createElement: (tag) => ({ tagName: tag.toUpperCase(), click() { clicked.push(this); }, remove() {} }) };
  win.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } };
  win.URL = { createObjectURL: () => "blob:x", revokeObjectURL() {} };
  win.setTimeout = () => 0;
  win.window = win;
  if (noSeal) win.__BLEEP_NO_SEAL__ = true;
  let taken = false;
  if (withSecret) Object.defineProperty(win, "__bleepBoot", { configurable: true, value: () => { if (taken) return null; taken = true; return SECRET; } });
  const ctx = vm.createContext(win);
  vm.runInContext(read("common/ui/bleep-bridge.js"), ctx, { filename: "bleep-bridge.js" });
  const run = (code) => vm.runInContext(code, ctx);
  /// What the native side does: answer a posted "__juce__invoke" with a completion event.
  const answer = (msg, result) => backend.emitByBackend("__juce__complete", JSON.stringify({ promiseId: JSON.parse(msg).payload.resultId, result }));
  return { win, ctx, posted, events, backend, run, answer, clicked };
}

// ---- 1. the board's own calls: secret first, results come back, events arrive
{
  const p = makePage();
  const { native, onNative, priv, seal } = p.win.BleepSeal;
  ok(typeof native === "function" && typeof seal === "function", "BleepSeal exposes native and seal");
  ok(p.win.__bleepBoot === undefined, "the boot getter is removed from window once read");
  let got;
  native("libraryStatus", 1, { a: 2 }).then((r) => { got = r; });
  ok(p.posted.length === 1, "native posts one message");
  const m = JSON.parse(p.posted[0]);
  ok(m.eventId === "__juce__invoke" && m.payload.name === "libraryStatus", "message is a __juce__invoke of the named function");
  ok(m.payload.params[0] === SECRET && m.payload.params[1] === 1 && m.payload.params[2].a === 2, "the secret is the first parameter, the arguments follow");
  ok(Number.isSafeInteger(m.payload.resultId) && m.payload.resultId > 1000, "the result id is not a small counter: " + m.payload.resultId);
  // a forged completion with a guessed id changes nothing
  p.backend.emitByBackend("__juce__complete", JSON.stringify({ promiseId: 1, result: "forged" }));
  await Promise.resolve();
  ok(got === undefined, "a completion for a guessed id is ignored");
  p.answer(p.posted[0], { ok: true });
  await Promise.resolve();
  ok(got && got.ok === true, "the real completion resolves the promise");
  let ev;
  onNative("state", (s) => { ev = s; });
  p.backend.emitByBackend("state", JSON.stringify({ x: 1 }));
  ok(ev && ev.x === 1, "events from the native side reach onNative listeners");
  ok(priv && Object.getPrototypeOf(priv) === null, "priv is a plain private namespace, not window");
  seal();
  p.run("window.later = 1");
  ok(p.win.later === 1, "the page still runs after seal");
  // after seal the board's captured handles still work
  let got2;
  native("undo").then((r) => { got2 = r; });
  const m2 = JSON.parse(p.posted.at(-1));
  ok(m2.payload.params[0] === SECRET, "native still sends the secret after seal");
  p.answer(p.posted.at(-1), 5);
  await Promise.resolve();
  ok(got2 === 5, "native still resolves after seal");
  p.backend.emitByBackend("state", JSON.stringify({ x: 2 }));
  ok(ev.x === 2, "events still arrive after seal (through the facade the native side calls)");
  p.win.__JUCE__.backend.emitByBackend("state", JSON.stringify({ x: 3 }));
  ok(ev.x === 3, "window.__JUCE__.backend.emitByBackend (what the native side calls) still works after seal");
}

// ---- 2. a hostile view script, after seal
{
  const p = makePage();
  const { native, seal } = p.win.BleepSeal;
  seal();
  const before = p.posted.length;
  const report = p.run(`(function () {
    const r = {};
    r.seal = typeof window.BleepSeal;
    r.native = typeof window.native + typeof window.onNative + typeof globalThis.native;
    r.boot = typeof window.__bleepBoot;
    r.demo = typeof window.BleepDemo;
    // the raw JUCE object: every way to post through it
    const J = window.__JUCE__;
    r.juce = [typeof J, typeof J.backend, typeof J.backend.addEventListener, typeof J.backend.emitEvent, typeof J.backend.listeners].join();
    try { J.postMessage(JSON.stringify({ eventId: "__juce__invoke", payload: { name: "libraryRemove", params: ["x"], resultId: 1 } })); } catch (e) { r.juceErr = String(e); }
    try { J.backend.emitEvent("__juce__invoke", { name: "libraryRemove", params: ["x"], resultId: 2 }); } catch (e) { r.emitErr = String(e); }
    try { J.backend = {}; } catch (e) { /* strict */ }
    r.juceWritable = typeof J.backend.emitByBackend !== "function";
    try { window.__JUCE__ = {}; } catch (e) { /* strict */ }
    r.windowJuceWritable = !(window.__JUCE__ && window.__JUCE__.backend && typeof window.__JUCE__.backend.emitByBackend === "function");
    // the platform's channel is still there: using it gets a message without the secret
    window.webkit.messageHandlers.__JUCE__.postMessage(JSON.stringify({ eventId: "__juce__invoke", payload: { name: "libraryRemove", params: ["x"], resultId: 3 } }));
    // spy on everything: replace the channel, JSON, Array, Promise, Map ...
    const seen = [];
    window.webkit.messageHandlers.__JUCE__.postMessage = (o) => seen.push(o);
    window.webkit.messageHandlers = { __JUCE__: { postMessage: (o) => seen.push(o) } };
    window.webkit = { messageHandlers: { __JUCE__: { postMessage: (o) => seen.push(o) } } };
    const patched = [];
    const trySet = (name, fn) => { try { fn(); } catch (e) { /* frozen: strict mode throws */ } };
    const origStringify = JSON.stringify;
    trySet("stringify", () => { JSON.stringify = function (v) { seen.push(v); return origStringify(v); }; });
    trySet("then", () => { Promise.prototype.then = function () { seen.push("then"); }; });
    trySet("push", () => { Array.prototype.push = function () { seen.push("push"); }; });
    trySet("spread", () => { Array.prototype[Symbol.iterator] = function () { seen.push("iter"); return [][Symbol.iterator](); }; });
    trySet("mapget", () => { Map.prototype.get = function () { seen.push("get"); }; });
    trySet("mapset", () => { Map.prototype.set = function () { seen.push("set"); }; });
    trySet("objproto", () => { Object.prototype.stolen = 1; });
    trySet("fnproto", () => { Function.prototype.call = function () { seen.push("call"); }; });
    trySet("define", () => { Object.defineProperty(Object.prototype, "x", { get() { seen.push("x"); } }); });
    trySet("crypto", () => { window.crypto.getRandomValues = () => { seen.push("rand"); }; });
    r.frozen = [Object.isFrozen(JSON), Object.isFrozen(Object.prototype), Object.isFrozen(Promise.prototype), Object.isFrozen(Array.prototype), Object.isFrozen(Map.prototype), Object.isFrozen(Function.prototype)].join();
    r.patched = [JSON.stringify === origStringify, ({}).stolen === undefined].join();
    window.__seen = seen;
    // the boot getter is gone and a second call would give nothing
    r.second = typeof window.__bleepBoot;
    return JSON.stringify(r);
  })()`);
  const r = JSON.parse(report);
  ok(r.seal === "undefined", "BleepSeal is gone after seal");
  ok(r.native === "undefinedundefinedundefined", "window.native / onNative do not exist: " + r.native);
  ok(r.boot === "undefined" && r.second === "undefined", "the boot getter is gone");
  ok(r.demo === "undefined", "the demo engine is not reachable");
  ok(r.juce === "object,object,undefined,undefined,undefined", "window.__JUCE__ keeps only emitByBackend: " + r.juce);
  ok(r.windowJuceWritable === false && r.juceWritable === false, "window.__JUCE__ cannot be replaced (" + r.windowJuceWritable + "," + r.juceWritable + ")");
  ok(r.frozen === "true,true,true,true,true,true", "built-ins are frozen: " + r.frozen);
  ok(r.patched === "true,true", "patching JSON / Object.prototype had no effect: " + r.patched);
  // hostile posts without the secret are possible (the platform channel is in the page) but carry no secret
  const hostilePosts = p.posted.slice(before);
  ok(hostilePosts.length === 1, "only the hostile script's own raw post reached the channel (" + hostilePosts.length + ")");
  ok(hostilePosts.every((m) => !m.includes(SECRET)), "no hostile message carries the secret");
  // the board's call afterwards still goes to the original channel and never to the hostile spy
  native("setParam", "n1", "gain", 0.5);
  const last = p.posted.at(-1);
  ok(JSON.parse(last).payload.params[0] === SECRET && JSON.parse(last).payload.params.length === 4, "the board's call still posts, with the secret and its arguments");
  const seenText = p.run("JSON.stringify(window.__seen.filter(x => typeof x === 'string'))");
  ok(!seenText.includes(SECRET), "the hostile spies never saw the secret");
  ok(p.run("window.__seen.length") === 0, "no hostile hook was ever called by the board's code");
}

// ---- 3. synthetic input is dropped, real and file-input clicks pass
{
  const p = makePage();
  const { download } = p.win.BleepSeal;
  p.win.BleepSeal.seal();
  const clicks = p.events.filter(([t, , cap]) => t === "click" && cap === true);
  ok(clicks.length === 1, "a capture-phase click guard is installed");
  const mk = (isTrusted, target) => { const e = { isTrusted, target, stopped: false, prevented: false, stopImmediatePropagation() { e.stopped = true; }, preventDefault() { e.prevented = true; } }; return e; };
  const guard = clicks[0][1];
  const synth = mk(false, { tagName: "BUTTON" }); guard(synth);
  ok(synth.stopped && synth.prevented, "a script-made click is stopped");
  const real = mk(true, { tagName: "BUTTON" }); guard(real);
  ok(!real.stopped && !real.prevented, "a real click passes");
  const file = mk(false, { tagName: "INPUT", type: "file" }); guard(file);
  ok(!file.stopped, "input.click() on a file input passes");
  // Download Project: the anchor the bridge makes passes, an anchor a view script makes does not
  ok(download("{}", "a.bleepboard", "application/json") === true && p.clicked.length === 1, "download() clicks an anchor");
  const mine = mk(false, p.clicked[0]); guard(mine);
  ok(!mine.stopped && !mine.prevented, "the anchor made by download() passes the guard");
  const foreign = mk(false, { tagName: "A", href: "blob:evil", download: "x.exe" }); guard(foreign);
  ok(foreign.stopped && foreign.prevented, "an anchor made by a view script is stopped");
  for (const t of ["mousedown", "pointerdown", "keydown", "submit", "dblclick"]) ok(p.events.some(([x, , c]) => x === t && c === true), "guard for " + t);
}

// ---- 4. without a secret (Ableton panel view) the page still works, and in the smoke-test build nothing is sealed
{
  const p = makePage({ withSecret: false });
  p.win.BleepSeal.native("watch", ["a"]);
  const m = JSON.parse(p.posted[0]);
  ok(m.payload.params.length === 1 && m.payload.params[0][0] === "a", "without a boot getter the call carries no secret");
  const q = makePage({ noSeal: true });
  q.win.BleepSeal.seal();
  ok(typeof q.win.BleepSeal === "object" && typeof q.win.native === "function", "the unsealed (smoke-test) page keeps BleepSeal and window.native");
  ok(q.win.BleepSeal.priv.native === q.win.native, "…and its private namespace is window");
}

// ---- 5. no module view script touches the bridge or the board's private objects
{
  const forbidden = [/\bnative\s*\(/, /\bonNative\b/, /__JUCE__/, /BleepSeal/, /\bwebkit\b/, /chrome\.webview/, /window\.parent|window\.top|\bparent\.|\btop\./,
    /\bBleep(Account|LibraryView|SettingsView|AppMenu|SideMenu|PresetBrowser|ProjectBrowser|Modal|HelpView|Demo|Web)\b/, /\bpostMessage\b/, /\bcreateElement\(\s*["'](iframe|object|embed)/, /\bnew Function\b|\beval\s*\(/];
  const dir = path.join(patch, "modules");
  let files = 0;
  for (const m of fs.readdirSync(dir)) {
    const ui = path.join(dir, m, "ui");
    if (!fs.existsSync(ui)) continue;
    for (const f of fs.readdirSync(ui).filter((x) => x.endsWith(".js"))) {
      files++;
      const src = fs.readFileSync(path.join(ui, f), "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:"'])\/\/.*$/gm, "$1");
      for (const re of forbidden) ok(!re.test(src), `modules/${m}/ui/${f} must not use ${re}`);
    }
  }
  ok(files > 50, "module view scripts were found (" + files + ")");
  // the board's privileged objects live in `priv`, never on window
  const names = ["BleepAccount", "BleepLibraryView", "BleepSettingsView", "BleepAppMenu", "BleepSideMenu", "BleepProjectBrowser", "BleepModal", "BleepHelpView"];
  for (const f of fs.readdirSync(path.join(patch, "board/ui")).filter((x) => x.endsWith(".js"))) {
    const src = read("board/ui/" + f).replace(/^\s*\/\/.*$/gm, "");
    for (const n of names) ok(!new RegExp("window\\." + n + "\\b").test(src), `board/ui/${f}: window.${n} (use the private namespace P.${n})`);
    ok(!/window\.native\b|window\.onNative\b/.test(src), `board/ui/${f}: window.native`);
  }
  // no privileged object is used by its bare name either (it would be a window global): only P.<name>, or defined in a closure
  for (const f of fs.readdirSync(path.join(patch, "board/ui")).filter((x) => x.endsWith(".js"))) {
    const src = read("board/ui/" + f).replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");
    for (const n of names) ok(!new RegExp("(?<![\\w.])" + n + "\\s*[.=\\[(]").test(src), `board/ui/${f}: bare ${n} (use P.${n})`);
    ok(!/window\.(BleepModal|BleepProjectBrowser|BleepPresetBrowser)\b/.test(src), `board/ui/${f}: window.<browser/modal>`);
  }
  // the project/modal/menu code is loaded before board.js (which seals), takes its handles from BleepSeal and registers only in P
  for (const [f, n] of [["project-browser.js", "BleepProjectBrowser"], ["modal.js", "BleepModal"], ["app-menu.js", "BleepAppMenu"]]) {
    const src = read("board/ui/" + f);
    ok(/window\.BleepSeal/.test(src) && new RegExp("\\bP\\." + n + "\\s*=").test(src), `board/ui/${f} registers P.${n} from BleepSeal`);
    ok(!/window\.native|\bwindow\.__JUCE__/.test(src), `board/ui/${f} does not use the raw bridge`);
    const html0 = read("board/ui/index.html");
    ok(html0.indexOf(f) > 0 && html0.indexOf(f) < html0.indexOf('src="board.js"'), `${f} is loaded before board.js seals`);
  }
  ok(!fs.existsSync(path.join(patch, "board/ui/preset-browser.js")), "the old preset browser is gone");
  // native side: every native function is gated by the per-process secret (a new one that is not would be open to view scripts)
  {
    const cpp = read("board/BoardWindow.cpp");
    const all = (cpp.match(/\.withNativeFunction\(/g) || []).length;
    const gatedCount = (cpp.match(/\.withNativeFunction\(\s*"[A-Za-z0-9_]+"\s*,\s*gated\(/g) || []).length;
    ok(all > 30 && all === gatedCount, `every withNativeFunction is wrapped in gated(): ${gatedCount} of ${all}`);
    for (const n of ["setMenu", "presets", "savePreset", "deletePreset", "loadPatch"])
      ok(new RegExp('withNativeFunction\\(\\s*"' + n + '"\\s*,\\s*gated\\(').test(cpp), `native ${n} is gated`);
  }
  // module views reach the preset natives only through the view api, limited to their own kinds
  ok(/viewKind\(kind\)/.test(read("board/ui/board-views.js")) && !/viewKind\([^)]*\)[^\n]*"projects"/.test(read("board/ui/board-views.js")), "the view api's preset kinds exclude projects");
  ok(/BleepSeal/.test(read("board/ui/board.js")) && /seal\(\);/.test(read("board/ui/board.js")), "board.js seals before it loads module views");
  const html = read("board/ui/index.html");
  ok(html.indexOf("bleep-bridge.js") > 0 && html.indexOf("bleep-bridge.js") < html.indexOf("board-demo.js"), "the bridge is the first script");
  // Frames: only the board's own origin (the Code node's sandboxed UI, board-code-view.html), never another site.
  ok(/Content-Security-Policy/.test(html) && /frame-src 'self'/.test(html) && !/frame-src[^;"]*(https?:|\*)/.test(html), "index.html allows frames of its own origin only");
  {
    const frame = read("board/ui/board-code-view.html");
    ok(/default-src 'none'/.test(frame) && !/connect-src|frame-src|worker-src/.test(frame), "the Code node's UI page has no network, frames or workers (default-src 'none')");
    ok(!/allow-same-origin/.test(read("board/ui/board-code.js")) && /setAttribute\("sandbox", "allow-scripts"\)/.test(read("board/ui/board-code.js")), "the Code node's UI frame is sandboxed with allow-scripts only");
    ok(/e\.source !== f\.contentWindow/.test(read("board/ui/board-code.js")), "messages are accepted only from that frame");
  }
}

console.log(`bridge-seal: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
