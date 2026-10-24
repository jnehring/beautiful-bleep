// SPDX-License-Identifier: GPL-3.0-only
// Runs a module's own UI (src/<name>.view.js, the JavaScript of a Code node's UI tab) in node against a mock of the sandbox's `bleep` object and a
// recording canvas, so a test can check that the UI runs for many frames, draws, reacts to probes and knobs, and sets knobs when dragged.
//   const v = runView(spec, source, { probes: (t) => ({ level: ... }) });  v.frames(120);  v.drag(0.3, 0.5);  v.failures  // [] when fine
// The mock follows patch/board/ui/board-code-view.html: bleep.params / param(id) { value, normalised, set, setNormalised }, probe(id), onFrame, onValues,
// size, canvas(h) { el, g, width, height }, theme, button(id). A drawing call with a NaN or infinite number is recorded as a failure.
import { readFileSync, existsSync } from "node:fs";
import { root } from "../dsp/lib.mjs";
import { scriptModules } from "../../modules.mjs";

const THEME = { bg: "#14161a", panel: "#1b1e23", line: "#2c3038", text: "#e6e8eb", muted: "#8b93a1", accent: "#f59e0b", warn: "#ef4444" };

export const viewSource = (name) => { const m = scriptModules().find((x) => x.slug === name), f = m ? m.view : `${root}src/${name}.view.js`; return f && existsSync(f) ? readFileSync(f, "utf8") : null; };

function recordingContext(failures, stats, w, h) {
  const target = { canvas: { width: w, height: h } };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "measureText") return (s) => ({ width: String(s).length * 6 });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient") return (...a) => { check(a, k); return { addColorStop() {} }; };
      if (k === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === "createPattern") return () => ({});
      return (...a) => { check(a, k); stats.calls++; if (/^(fill|stroke|fillRect|strokeRect|fillText|strokeText|drawImage)$/.test(String(k))) stats.paints++; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  function check(args, k) { for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) failures.push(`canvas.${String(k)} got ${a} (${args.join(", ")})`); }
}

/// spec: the module's node type description (loadModule(...).spec). source: the UI's JavaScript. options.probes: (timeSeconds) => { id: number } the module reports.
export function runView(spec, source, { probes = () => ({}), width = 520, theme = THEME } = {}) {
  const failures = [], stats = { calls: 0, paints: 0, sets: [], frames: 0, buttons: [] };
  let time = 0, current = {};
  const frameCbs = [], valueCbs = [], canvases = [], listeners = [];
  const params = new Map(spec.params.map((p) => {
    const span = p.max - p.min;
    const toNorm = (v) => (p.map === "exp" ? Math.log(v / p.min) / Math.log(p.max / p.min) : p.map === "skew" ? Math.pow(Math.max(0, (v - p.min) / span), Math.log(0.5) / Math.log((p.centre - p.min) / span)) : (v - p.min) / span);
    const fromNorm = (x) => { x = Math.min(1, Math.max(0, x)); return p.map === "exp" ? p.min * Math.pow(p.max / p.min, x) : p.map === "skew" ? p.min + span * Math.pow(x, Math.log(Math.max(1e-9, (p.centre - p.min) / span)) / Math.log(0.5)) : p.min + span * x; };
    const q = { id: p.id, name: p.name, kind: p.kind, unit: p.label || "", min: p.min, max: p.max, steps: p.steps || 0, choices: p.choices || null, value: p.def, normalised: toNorm(p.def),
      set(v) { if (!Number.isFinite(v)) failures.push(`param ${p.id}.set(${v})`); q.value = Math.min(p.max, Math.max(p.min, v)); q.normalised = toNorm(q.value); stats.sets.push([p.id, q.value]); },
      setNormalised(x) { if (!Number.isFinite(x)) failures.push(`param ${p.id}.setNormalised(${x})`); q.normalised = Math.min(1, Math.max(0, x)); q.value = fromNorm(q.normalised); stats.sets.push([p.id, q.value]); } };
    return [p.id, q];
  }));
  const bleep = {
    params: Object.freeze(Object.fromEntries(params)),
    param(id) { const q = params.get(id); if (!q) throw new Error(`no param ${id}; known: ${[...params.keys()].join(", ")}`); return q; },
    probe(id) { const v = current[String(id)]; return typeof v === "number" ? v : 0; },
    button(id) { stats.buttons.push(id); },
    onFrame(fn) { frameCbs.push(fn); },
    onValues(fn) { valueCbs.push(fn); },
    size() {},
    canvas(h) {
      const fill = h === "fill", height = fill ? 240 : h;
      const el = { style: {}, width, height, addEventListener: (t, f) => listeners.push([t, f]), setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width, height, right: width, bottom: height }) };
      const c = { el, g: recordingContext(failures, stats, width, height), width, height };
      canvases.push(c);
      return c;
    },
    theme: Object.freeze({ ...theme }),
  };
  try { new Function("bleep", source)(bleep); } catch (e) { failures.push(`UI threw while loading: ${e.message}`); }

  const api = {
    failures, stats, canvases, bleep,
    /// Runs n animation frames of dt seconds; the module "reports" probes(t) before each.
    frames(n = 60, dt = 1 / 60) {
      for (let i = 0; i < n; i++) {
        time += dt; current = probes(time) || {}; stats.frames++;
        for (const f of valueCbs) try { f(); } catch (e) { failures.push(`onValues threw: ${e.message}`); }
        for (const f of frameCbs) try { f(dt); } catch (e) { failures.push(`onFrame threw: ${e.message}`); }
      }
      return api;
    },
    /// A pointer press at (x, y) in 0..1 of the first canvas, a move to (x2, y2) and a release; returns the [id, value] knob changes it caused.
    drag(x, y, x2 = x, y2 = y) {
      const before = stats.sets.length, c = canvases[0];
      if (!c) return [];
      const ev = (px, py) => ({ clientX: px * c.width, clientY: py * c.height, pointerId: 1, button: 0, buttons: 1, preventDefault() {}, stopPropagation() {}, target: c.el });
      const fire = (type, e) => { for (const [t, f] of listeners) if (t === type) try { f(e); } catch (err) { failures.push(`${type} handler threw: ${err.message}`); } };
      fire("pointerdown", ev(x, y)); fire("pointermove", ev((x + x2) / 2, (y + y2) / 2)); fire("pointermove", ev(x2, y2)); fire("pointerup", ev(x2, y2));
      return stats.sets.slice(before);
    },
    time: () => time,
  };
  return api;
}
