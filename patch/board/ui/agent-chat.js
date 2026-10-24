// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// agent-chat.js — the patch assistant's chat panel (doc/specs/agent.md §3.2, §5; doc/agent-concept.md).
//
// Only exists when the website's backend says so: GET /api/agent/status must answer {enabled: true}. In an instrument or FX plugin
// window (the cell's panel only), the static Play page without a backend, offline, or when the answer is anything else, the page shows
// nothing at all (no button, no CSS loaded). Bleep Play talks to the backend with the website's session cookie; the standalone app and
// the Bleep Board plugin with the library login (account.js: the personal token in the keychain), through the native `account` calls,
// because their page is not served by the website.
//
//   P.BleepAgentChat.init(host)   board.js calls it once the board is up. host:
//        board(): the board document              types(): type → description          selection(): selected node ids
//        edit(label, fn): board.js's edit()      one commit = one undo step           undo(): the board's undo
//        goToNode(id): select and centre a node   notice(text): the board's short message
//
// The chat sends the board document and the transcript to the backend (POST /api/agent/chat, server-sent events over fetch) and
// applies the changesets it gets back, as ONE undo step each, through the board's own edit(). Live tools (probe_signals, play,
// highlight, ask_user, get_environment) run here, in the page; the run then resumes with a second request. Nothing is kept on the
// server: the transcript lives in this browser's localStorage, per board.
(function () {
  "use strict";
  // The page's lock (common/ui/bleep-bridge.js): the native bridge and the board's private namespace are not on `window`.
  const { native, onNative, priv: P } = window.BleepSeal;

  const CLIENT = { version: "board-ui-1" };
  const MAX_MESSAGES = 40;
  const LIVE_TIMEOUT = 5000;      // ms a live tool may take (ask_user waits for a person and has its own limit)
  const ASK_TIMEOUT = 10 * 60e3;  // the run token is valid for 15 minutes
  const MAX_ROUNDS = 10;          // live pauses in one turn
  const SVG = "http://www.w3.org/2000/svg";
  const EXAMPLES = [
    "Why is there no sound?",
    "Add a chorus to my synth",
    "Make me a simple bass drum pattern",
    "What does the Filter module do?",
  ];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode, full */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* none */ } },
  };
  function withTimeout(promise, ms, what) {
    let t;
    return Promise.race([Promise.resolve(promise), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + " took too long")), ms); })])
      .finally(() => clearTimeout(t));
  }

  // ------------------------------------------------------------------ markdown (minimal, built with DOM nodes only)
  // Paragraphs, headings (as bold lines), lists, fenced code, **bold**, *italic*, `code` and [links](http…). Everything else is text.
  const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)|(\[[^\]\n]+\]\((?:https?:\/\/|\/)[^\s)]*\))/g;
  // Models sometimes emit HTML entities (&rarr;); the text is shown as text nodes, so decode the common ones here.
  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", rarr: "\u2192", larr: "\u2190", harr: "\u2194",
                     ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", times: "\u00d7", deg: "\u00b0" };
  const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all; }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : all;
  });
  function inline(parent, text) {
    let last = 0, m;
    const re = new RegExp(INLINE.source, "g");   // its own state: bold and italic recurse into inline()
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(decode(text.slice(last, m.index))));
      const tok = m[0];
      if (m[1]) parent.appendChild(el("code", "", tok.slice(1, -1)));
      else if (m[2]) { const b = el("strong"); inline(b, tok.slice(2, -2)); parent.appendChild(b); }
      else if (m[3]) { const i = el("em"); inline(i, tok.slice(1, -1)); parent.appendChild(i); }
      else {
        const k = tok.indexOf("](");
        const a = el("a", "", tok.slice(1, k));
        a.href = tok.slice(k + 2, -1);
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        parent.appendChild(a);
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(decode(text.slice(last))));
  }
  function markdown(root, src) {
    root.textContent = "";
    const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
    let para = [], list = null, code = null;
    const flushPara = () => { if (para.length) { const p = el("p"); inline(p, para.join(" ")); root.appendChild(p); para = []; } };
    const flushList = () => { list = null; };
    for (const line of lines) {
      if (code) {
        if (/^\s*```/.test(line)) { root.appendChild(code.pre); code = null; } else code.text.push(line);
        if (code) code.pre.firstChild.textContent = code.text.join("\n");
        continue;
      }
      if (/^\s*```/.test(line)) { flushPara(); flushList(); const pre = el("pre"); pre.appendChild(el("code")); code = { pre, text: [] }; continue; }
      const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        flushPara();
        const ordered = /^\s*\d/.test(line);
        if (!list || list.ordered !== ordered) { list = { ordered, el: el(ordered ? "ol" : "ul") }; root.appendChild(list.el); }
        const item = el("li");
        inline(item, li[1]);
        list.el.appendChild(item);
        continue;
      }
      if (!line.trim()) { flushPara(); flushList(); continue; }
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h) { flushPara(); flushList(); const p = el("p", "ag-h"); inline(p, h[1]); root.appendChild(p); continue; }
      flushList();
      para.push(line.trim());
    }
    if (code) root.appendChild(code.pre);
    flushPara();
  }

  // ------------------------------------------------------------------ primitive ops (spec §3.2)
  // applyOps(b, ops, host) edits the board document b in place and returns "" or the reason the first failing op gives. The caller runs
  // it on a copy first (all or none), then inside the board's edit().
  const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);
  const str = (v) => typeof v === "string" && v.length > 0;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const CELLISH = new Set(["cell", "voice-cell", "cell-in", "cell-out", "voice-in", "voice-out", "patchbay-in", "patchbay-out"]);

  /// The jacks a node has, when they can be known: {out:[ids], in:[ids]} or null (cells and bays build theirs from the document).
  function jacksOf(n, types) {
    const t = types[n.type];
    if (!t || CELLISH.has(n.type)) {
      if (n.type === "cell" || n.type === "voice-cell") return { out: (n.outputs || []).map((j) => j.id).concat(n.type === "voice-cell" ? ["l", "r"] : []),
                                                              in: (n.inputs || []).map((j) => j.id).concat(n.type === "voice-cell" ? ["notes"] : []) };
      return null;
    }
    return { out: (t.outputs || []).map((j) => j.id),
             in: (t.inputs || []).map((j) => j.id).concat((t.params || []).filter((p) => p.modulatable).map((p) => p.id)) };
  }

  function applyOps(b, ops, host) {
    const types = host.types() || {};
    const node = (id) => b.nodes.find((n) => n.id === id);
    const cable = (id) => b.cables.find((c) => c.id === id);
    if (!Array.isArray(ops) || !ops.length) return "the changeset has no operations";
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const fail = (why) => `operation ${i + 1}${op && op.op ? " (" + op.op + ")" : ""}: ${why}`;
      if (!isObj(op)) return fail("not an object");
      switch (op.op) {
        case "add_node": {
          const n = op.node;
          if (!isObj(n) || !str(n.id) || !str(n.type)) return fail("needs a node with an id and a type");
          if (node(n.id)) return fail(`the id ${n.id} is taken`);
          const t = types[n.type];
          if (!t && !CELLISH.has(n.type)) return fail(`unknown module type ${n.type}`);
          if (n.parent && !node(n.parent)) return fail(`the cell ${n.parent} does not exist`);
          const c = clone(n);
          c.name = str(c.name) ? c.name : t ? t.name : n.type;
          c.x = num(c.x, 0); c.y = num(c.y, 0);
          c.parent = c.parent || "";
          c.muted = !!c.muted;
          const params = {};
          if (t) for (const p of t.params || []) params[p.id] = num(p.default, 0);
          for (const [k, v] of Object.entries(isObj(c.params) ? c.params : {})) {
            if (t && !(t.params || []).some((p) => p.id === k)) return fail(`${n.type} has no parameter ${k}`);
            if (typeof v !== "number" || !isFinite(v)) return fail(`parameter ${k} is not a number`);
            params[k] = clamp(v, 0, 1);
          }
          c.params = params;
          b.nodes.push(c);
          break;
        }
        case "remove_node": {
          const n = node(op.id);
          if (!n) return fail(`no node ${op.id}`);
          if (n.port) return fail(`${n.name} is a port and cannot be removed`);
          const doomed = new Set([n.id]);
          for (let again = true; again;) { again = false; for (const m of b.nodes) if (m.parent && doomed.has(m.parent) && !doomed.has(m.id)) { doomed.add(m.id); again = true; } }
          b.nodes = b.nodes.filter((m) => !doomed.has(m.id));
          b.cables = b.cables.filter((k) => !doomed.has(k.from.node) && !doomed.has(k.to.node));
          break;
        }
        case "add_cable": {
          const c = op.cable;
          if (!isObj(c) || !str(c.id) || !isObj(c.from) || !isObj(c.to)) return fail("needs a cable with an id, from and to");
          if (cable(c.id)) return fail(`the id ${c.id} is taken`);
          const a = node(c.from.node), z = node(c.to.node);
          if (!a) return fail(`no node ${c.from.node}`);
          if (!z) return fail(`no node ${c.to.node}`);
          const ja = jacksOf(a, types), jz = jacksOf(z, types);
          if (ja && !ja.out.includes(c.from.jack)) return fail(`${a.name} has no output ${c.from.jack}`);
          if (jz && !jz.in.includes(c.to.jack)) return fail(`${z.name} has no input ${c.to.jack}`);
          if (b.cables.some((k) => k.from.node === a.id && k.from.jack === c.from.jack && k.to.node === z.id && k.to.jack === c.to.jack)) return fail("that cable exists already");
          b.cables.push({ id: c.id, from: { node: a.id, jack: c.from.jack }, to: { node: z.id, jack: c.to.jack }, amount: clamp(num(c.amount, 1), -1, 1) });
          break;
        }
        case "remove_cable":
          if (!cable(op.id)) return fail(`no cable ${op.id}`);
          b.cables = b.cables.filter((k) => k.id !== op.id);
          break;
        case "set_param": {
          const n = node(op.node);
          if (!n) return fail(`no node ${op.node}`);
          const t = types[n.type];
          if (t && !(t.params || []).some((p) => p.id === op.param)) return fail(`${n.type} has no parameter ${op.param}`);
          if (typeof op.value !== "number" || !isFinite(op.value)) return fail("the value is not a number");
          (n.params = n.params || {})[op.param] = clamp(op.value, 0, 1);
          break;
        }
        case "set_cable_amount": {
          const c = cable(op.id);
          if (!c) return fail(`no cable ${op.id}`);
          if (typeof op.amount !== "number" || !isFinite(op.amount)) return fail("the amount is not a number");
          c.amount = clamp(op.amount, -1, 1);
          break;
        }
        case "set_data": {
          const n = node(op.node);
          if (!n) return fail(`no node ${op.node}`);
          if (!isObj(op.data)) return fail("the data is not an object");
          n.data = clone(op.data);
          break;
        }
        case "set_muted": {
          const n = node(op.node);
          if (!n) return fail(`no node ${op.node}`);
          if (typeof op.muted !== "boolean") return fail("muted must be true or false");
          n.muted = op.muted;
          break;
        }
        case "rename_node": {
          const n = node(op.id);
          if (!n) return fail(`no node ${op.id}`);
          if (!str(op.name)) return fail("needs a name");
          n.name = op.name.slice(0, 80);
          break;
        }
        case "move_node": {
          const n = node(op.id);
          if (!n) return fail(`no node ${op.id}`);
          if (!isFinite(op.x) || !isFinite(op.y)) return fail("needs x and y");
          n.x = op.x; n.y = op.y;
          break;
        }
        case "set_tempo":
          if (typeof op.bpm !== "number" || !(op.bpm >= 20 && op.bpm <= 400)) return fail("the tempo must be between 20 and 400");
          b.tempo = op.bpm;
          break;
        case "set_panel": {
          const p = op.panel;
          if (!isObj(p) || !str(p.id) || !Array.isArray(p.controls)) return fail("needs a panel with an id and controls");
          if (p.cell && !node(p.cell)) return fail(`the cell ${p.cell} does not exist`);
          const list = b.panels || (b.panels = []);
          const at = list.findIndex((q) => q.id === p.id);
          if (at >= 0) list[at] = clone(p); else list.push(clone(p));
          break;
        }
        case "remove_panel":
          if (!(b.panels || []).some((q) => q.id === op.id)) return fail(`no panel ${op.id}`);
          b.panels = b.panels.filter((q) => q.id !== op.id);
          break;
        default:
          return fail("unknown operation");
      }
    }
    return "";
  }

  // ------------------------------------------------------------------ live tools (spec §5.4)
  // Engine state (the board's "state" events, about 30 a second): collected only while a probe is running.
  const probes = new Set();
  let stateHooked = false;
  function hookState() {
    if (stateHooked) return;
    stateHooked = true;
    onNative("state", (s) => { if (probes.size && s && s.nodes) for (const p of [...probes]) p(s.nodes); });
  }

  const W = () => window.BleepWeb || null;
  const topKeyboards = (host) => ((host.board() || {}).nodes || []).filter((n) => n.type === "keyboard").map((n) => n.id);
  /// Plays a note the way the screen keyboard does: BleepWeb.keyDown (MIDI In nodes and Keyboard modules) or perform on the Keyboard nodes.
  function noteOn(host, note, velocity) {
    const w = W();
    if (w && w.keyDown) { w.keyDown(note, velocity); return true; }
    const ks = topKeyboards(host);
    for (const id of ks) native("perform", id, "on", [note]);
    return ks.length > 0;
  }
  function noteOff(host, note) {
    const w = W();
    if (w && w.keyUp) { w.keyUp(note); return; }
    for (const id of topKeyboards(host)) native("perform", id, "off", [note]);
  }
  const canPlay = (host) => {
    const b = host.board() || { nodes: [] };
    return b.nodes.some((n) => n.type === "keyboard" || (n.type === "midi-in" && W()));
  };

  /// Cancellable sleep: ctx.aborted ends it early.
  function sleep(ctx, ms) {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() { clearTimeout(t); ctx.cleanups.delete(done); resolve(); }
      ctx.cleanups.add(done);
    });
  }

  function makeTools(host, ui) {
    return {
      async get_environment() {
        const w = W(), b = host.board() || { nodes: [] };
        let inputs = [];
        try {   // MIDI devices only when the browser has been allowed already: asking now would pop up a permission prompt
          if (w && w.midiDevices && navigator.permissions) {
            const st = await navigator.permissions.query({ name: "midi" });
            if (st.state === "granted") inputs = (await withTimeout(w.midiDevices(), 2000, "MIDI")).map((name) => ({ id: name, name, enabled: true }));
          }
        } catch (e) { /* no Web MIDI */ }
        return {
          audio: { running: !!(w && w.running), sampleRate: w ? num(w.sampleRate, 0) : 0, muted: false },
          midi: { inputs },
          transport: { playing: w && w.transport ? !!w.transport.playing : false, bpm: w && w.transport ? num(w.transport.bpm, 120) : num(b.tempo, 120) },
          keyboard: topKeyboards(host),
        };
      },

      async probe_signals(args, ctx) {
        const points = (Array.isArray(args.points) ? args.points : []).filter((p) => isObj(p) && str(p.node) && str(p.jack)).slice(0, 24);
        if (!points.length) return { error: "no points to probe" };
        const seconds = clamp(num(args.seconds, 1), 0.2, 2);
        const b = host.board();
        // A point may be an input: read the output that feeds it.
        const src = points.map((p) => {
          const n = b && b.nodes.find((x) => x.id === p.node);
          if (!n) return { node: p.node, jack: p.jack, missing: true };
          const t = (host.types() || {})[n.type];
          const isOut = t ? (t.outputs || []).some((o) => o.id === p.jack) : (n.outputs || []).some((o) => o.id === p.jack);
          if (isOut || !b) return { node: p.node, jack: p.jack, from: [{ node: p.node, jack: p.jack }] };
          const feed = b.cables.filter((c) => c.to.node === p.node && c.to.jack === p.jack).map((c) => ({ node: c.from.node, jack: c.from.jack }));
          return { node: p.node, jack: p.jack, from: feed.length ? feed : [{ node: p.node, jack: p.jack }] };
        });
        const rows = src.map(() => ({ vals: [], act: 0, seen: false }));
        let frames = 0;
        const feed = (nodes) => {
          frames++;
          src.forEach((s, i) => {
            if (s.missing) return;
            let v = 0, a = 0, got = false;
            for (const f of s.from) {
              const e = nodes[f.node];
              if (!e) continue;
              const o = e.outputs && e.outputs[f.jack];
              if (typeof o === "number") { v += o; got = true; }
              const ac = e.activity && e.activity[f.jack];
              if (typeof ac === "number") a = Math.max(a, ac);
            }
            if (got) { rows[i].vals.push(v); rows[i].seen = true; }
            rows[i].act = Math.max(rows[i].act, a);
          });
        };
        hookState();
        probes.add(feed);
        let notesSent = false, note = null;
        const tn = isObj(args.test_note) ? args.test_note : null;
        try {
          if (tn && typeof tn.note === "number") {
            note = clamp(Math.round(tn.note), 0, 127);
            notesSent = noteOn(host, note, clamp(num(tn.velocity, 0.8) > 1 ? num(tn.velocity, 100) / 127 : num(tn.velocity, 0.8), 0.05, 1));
            if (notesSent) ctx.cleanups.add(offNow);
            else note = null;
          }
          const hold = note === null ? 0 : clamp(num(tn.seconds, seconds * 0.7), 0.05, seconds);
          if (note !== null) { await sleep(ctx, hold * 1000); offNow(); await sleep(ctx, Math.max(0, seconds - hold) * 1000); }
          else await sleep(ctx, seconds * 1000);
        } finally {
          probes.delete(feed);
          offNow();
        }
        function offNow() { if (note !== null) { const n = note; note = null; ctx.cleanups.delete(offNow); noteOff(host, n); } }
        if (!frames) return { error: "no engine state arrived (is the audio running?)" };
        const out = rows.map((r, i) => {
          const v = r.vals, lo = v.length ? Math.min(...v) : 0, hi = v.length ? Math.max(...v) : 0;
          let transitions = 0;
          for (let k = 1; k < v.length; k++) if ((v[k - 1] < 0.5) !== (v[k] < 0.5)) transitions++;
          const step = Math.max(1, Math.ceil(v.length / 40)), series = [];
          for (let k = 0; k < v.length; k += step) series.push(+v[k].toFixed(4));
          const moves = hi - lo > 1e-4 || r.act > 1e-4;
          return { node: src[i].node, jack: src[i].jack, present: !src[i].missing && (moves || Math.max(Math.abs(lo), Math.abs(hi)) > 1e-4),
                   min: +lo.toFixed(4), max: +hi.toFixed(4), last: v.length ? +v[v.length - 1].toFixed(4) : 0, moves, transitions, series };
        });
        return { points: out, notes_sent: notesSent };
      },

      async play(args, ctx) {
        const notes = (Array.isArray(args.notes) ? args.notes : []).filter((n) => isObj(n) && typeof n.note === "number").slice(0, 64);
        if (!notes.length) return { error: "no notes to play" };
        if (!canPlay(host)) return { error: "the board has no Keyboard module to play (and no MIDI In)" };
        const total = clamp(num(args.seconds, 2), 0.1, 4.5);
        const held = new Set();
        const stopAll = () => { for (const n of held) noteOff(host, n); held.clear(); ctx.cleanups.delete(stopAll); };
        ctx.cleanups.add(stopAll);
        const timers = notes.map((n) => {
          const note = clamp(Math.round(n.note), 0, 127);
          const at = clamp(num(n.at, 0), 0, total) * 1000, len = clamp(num(n.length, 0.5), 0.05, total) * 1000;
          const v = num(n.velocity, 0.8) > 1 ? num(n.velocity, 100) / 127 : num(n.velocity, 0.8);
          const on = setTimeout(() => { noteOn(host, note, clamp(v, 0.05, 1)); held.add(note); }, at);
          const off = setTimeout(() => { noteOff(host, note); held.delete(note); }, at + len);
          return [on, off];
        });
        ctx.cleanups.add(() => timers.forEach((t) => t.forEach(clearTimeout)));
        await sleep(ctx, total * 1000);
        stopAll();
        return { played: true };
      },

      async highlight(args) { return ui.highlight(Array.isArray(args.refs) ? args.refs : [], args.message); },

      ask_user(args, ctx) { return ui.ask(args, ctx); },
    };
  }

  // ------------------------------------------------------------------ the module
  let host = null, status = null, ui = null, tools = null;

  const state = {
    items: [],            // {role, text, cards: [id], notes: [text]}  (the transcript, as shown)
    cards: new Map(),     // changeset id → {id, summary, lines, ops, destructive, status, group, error}
    notes: [],            // what happened since the last request, sent along with the next user message
    usage: null,
    running: null,        // {ctrl, cleanups, aborted}
    key: "",
  };
  const boardKey = () => "bleep-agent-chat:" + String((host && host.board() && host.board().id) || "default");

  function save() {
    if (!state.key) return;
    const items = state.items.slice(-MAX_MESSAGES).map((it) => ({
      role: it.role, text: it.text, notes: it.notes || undefined, at: it.at, runs: it.runs && it.runs.length ? it.runs : undefined,
      cards: (it.cards || []).map((id) => {
        const c = state.cards.get(id);
        return c ? { id: c.id, summary: c.summary, lines: c.lines, destructive: c.destructive, status: c.status === "pending" ? "expired" : c.status, error: c.error } : null;
      }).filter(Boolean),
    }));
    store.set(state.key, { v: 1, items, notes: state.notes.slice(-10) });
  }
  function load() {
    state.key = boardKey();
    state.items = []; state.cards = new Map(); state.notes = [];
    const d = store.get(state.key, null);
    if (!d || d.v !== 1 || !Array.isArray(d.items)) return;
    for (const it of d.items) {
      if (!it || (it.role !== "user" && it.role !== "assistant") || typeof it.text !== "string") continue;
      const ids = [];
      for (const c of Array.isArray(it.cards) ? it.cards : []) {
        if (!c || typeof c.id !== "string") continue;
        state.cards.set(c.id, { id: c.id, summary: String(c.summary || ""), lines: Array.isArray(c.lines) ? c.lines.map(String) : [], ops: [],
                                destructive: !!c.destructive, status: ["applied", "rejected", "failed", "undone"].includes(c.status) ? c.status : "expired", error: c.error });
        ids.push(c.id);
      }
      state.items.push({ role: it.role, text: it.text, cards: ids, notes: Array.isArray(it.notes) ? it.notes.map(String) : undefined,
                         at: typeof it.at === "string" ? it.at : undefined, runs: Array.isArray(it.runs) ? it.runs.filter((x) => typeof x === "string") : [] });
    }
    state.notes = Array.isArray(d.notes) ? d.notes.map(String) : [];
  }

  // ---- Copy chat: everything about this conversation as one JSON document, for discussing the assistant's behaviour
  // (the server's run log: every model call with the messages sent, the responses, tool calls and results, events, with timestamps).
  function dedupeCalls(rows) {
    // Each model call repeats the whole history; keep only what is new since the previous call of the run.
    let prev = null;
    return rows.map((r) => {
      if (r.kind !== "model_call" || !isObj(r.data) || !Array.isArray(r.data.request)) return r;
      const cur = r.data.request, was = prev;
      prev = cur;
      if (!was) return r;
      let n = 0;
      while (n < was.length && n < cur.length && JSON.stringify(was[n]) === JSON.stringify(cur[n])) n++;
      if (!n) return r;
      const { request, ...rest } = r.data;
      return Object.assign({}, r, { data: Object.assign(rest, { request_new_messages: cur.slice(n), request_first_messages_same_as_previous_call: n }) });
    });
  }
  async function exportChat() {
    const ids = [];
    for (const it of state.items) for (const id of it.runs || []) if (!ids.includes(id)) ids.push(id);
    const out = {
      format: "bleep-assistant-chat", version: 1, exported_at: new Date().toISOString(),
      notes: "transcript = what the user saw (with the changesets and what became of them). runs = the server's log of each request, in order: run_start (prompt, board snapshot), "
        + "model_call (request = messages sent to the model incl. instructions; response; usage; latency in seconds), tool_call (args, result or retry error), event, answer, summary. "
        + "To save space a model_call lists only the messages that are new since the previous call of the run (request_first_messages_same_as_previous_call = how many leading messages repeat).",
      client: Object.assign({ page: String(location.pathname), user_agent: navigator.userAgent, mode: mode() }, CLIENT),
      transcript: state.items.map((it) => ({
        role: it.role, at: it.at || null, text: it.text, notes: it.notes || [], run_ids: it.runs || [],
        changesets: (it.cards || []).map((id) => state.cards.get(id)).filter(Boolean)
          .map((c) => ({ id: c.id, summary: c.summary, lines: c.lines, destructive: c.destructive, status: c.status, error: c.error || null, ops: c.ops && c.ops.length ? c.ops : undefined })),
      })),
      pending_notes: state.notes.slice(), usage: state.usage, runs: [], missing_runs: [], log_error: null,
    };
    if (ids.length) {
      try {
        const resp = await agentFetch("/api/agent/log?run_ids=" + encodeURIComponent(ids.join(",")));
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const d = await resp.json();
        out.runs = (d.runs || []).map((r) => ({ run_id: r.run_id, rows: dedupeCalls(r.rows || []) }));
        out.missing_runs = d.missing || [];
        if (d.log_enabled === false) out.log_error = "the server's run log is switched off (BLEEP_AGENT_LOG_MESSAGES=0)";
        else if (out.missing_runs.length) out.log_error = "some runs are no longer in the rolling log";
      } catch (e) {
        out.log_error = "could not fetch the run log: " + String((e && e.message) || e);
      }
    } else out.log_error = "no run ids in this chat (it was made before logging, or nothing was sent yet)";
    return out;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return "clipboard"; } catch (e) { /* not allowed here: try the old way */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) return "clipboard";
    } catch (e) { /* fall through */ }
    const a = document.createElement("a");   // last resort: a file
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = "bleep-assistant-chat.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return "file";
  }

  // ---- the request
  function snapshot() {
    const b = host.board(), media = b && b.media;
    if (!isObj(media)) return { patch: clone(b), selection: host.selection() };
    // Embedded sample data (base64 wav) is not something the assistant reads or edits; leaving it out keeps the request small. The ops apply to the real board by id.
    const slim = Object.assign({}, b, { media: Object.fromEntries(Object.entries(media).map(([k, m]) =>
      [k, isObj(m) && typeof m.data === "string" && m.data.length > 1000 ? Object.assign({}, m, { data: `<${m.data.length} characters of audio data left out>` }) : m])) });
    return { patch: clone(slim), selection: host.selection() };
  }
  function transcript() {
    const out = [];
    for (const it of state.items.slice(-MAX_MESSAGES)) {
      const content = (it.notes && it.notes.length ? it.notes.map((n) => `[${n}]`).join(" ") + "\n" : "") + it.text;
      if (!content.trim()) continue;
      const last = out[out.length - 1];
      if (last && last.role === it.role) last.content += "\n\n" + content;   // an earlier turn that failed leaves two user turns in a row
      else out.push({ role: it.role, content });
    }
    return out;
  }
  const mode = () => (store.get("bleep-agent-mode", "ask") === "auto" ? "auto" : "ask");

  /// Where the assistant's answers come from. Bleep Play: the website's own address, with the session cookie. The app and the plugin:
  /// the library, through the native `account` calls with the login. Both return a standard Response, so the callers do not differ.
  let viaApp = false;
  async function agentFetch(path, init) {
    if (!viaApp) return fetch(path, Object.assign({ credentials: "same-origin" }, init));
    const A = P.BleepAccount;
    const json = (status, body, headers) => new Response(JSON.stringify(body === undefined ? null : body), { status, headers: Object.assign({ "Content-Type": "application/json" }, headers) });
    if (!init || !init.method || init.method === "GET") {
      const r = await A.call("GET", path);
      if (!r || !r.status) throw new TypeError((r && r.error) || "cannot reach the library");
      return json(r.status, r.body);
    }
    const s = await native("account", "streamStart", path, JSON.parse(init.body));
    if (!s || !s.id) {
      if (s && s.status >= 400) return json(s.status, { detail: s.error || "" });
      throw new TypeError((s && s.error) || "cannot reach the library");
    }
    const id = s.id, signal = init.signal;
    let finished = false;
    const stop = () => { if (!finished) { finished = true; native("account", "streamCancel", id); } };
    if (signal) signal.addEventListener("abort", stop, { once: true });
    let head = null;
    while (!head) {   // the first answer carries the status
      if (signal && signal.aborted) { stop(); throw new DOMException("Aborted", "AbortError"); }
      const r = await native("account", "streamRead", id, 1000);
      if (r && r.status !== undefined) head = r;
      else if (!r || r.done) { finished = true; throw new TypeError((r && r.error) || "cannot reach the library"); }
    }
    const queue = head.chunk ? [head.chunk] : [];
    let ended = !!head.done;
    const enc = new TextEncoder();
    const headers = head.retryAfter > 0 ? { "Retry-After": String(head.retryAfter) } : {};
    const body = new ReadableStream({
      async pull(ctrl) {
        for (;;) {
          if (signal && signal.aborted) { stop(); ctrl.error(new DOMException("Aborted", "AbortError")); return; }
          if (queue.length) { ctrl.enqueue(enc.encode(queue.shift())); return; }
          if (ended) { finished = true; ctrl.close(); return; }
          const r = await native("account", "streamRead", id, 1000);
          if (!r) { ended = true; continue; }
          if (r.chunk) queue.push(r.chunk);
          if (r.done) ended = true;
        }
      },
      cancel: stop,
    });
    return new Response(body, { status: head.status, headers });
  }

  async function errorFrom(resp) {
    let body = null;
    try { body = await resp.json(); } catch (e) { /* no JSON */ }
    const d = body && (body.message || body.detail || (body.error && body.error.message));
    return { body, text: typeof d === "string" ? d : "" };
  }
  const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }); };

  /// One POST, one event stream. Returns {pause, live, reason}; throws on a network failure (AbortError when stopped).
  async function streamOnce(body, run, bubble) {
    const resp = await agentFetch("/api/agent/chat", {
      method: "POST", signal: run.ctrl.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const e = await errorFrom(resp);
      const err = new Error(e.text || `The assistant answered ${resp.status}.`);
      err.http = resp.status;
      err.body = e.body;
      err.retryAfter = parseInt(resp.headers.get("Retry-After") || "", 10);
      throw err;
    }
    if (!resp.body || !resp.body.getReader) throw new Error("This browser cannot read the assistant's answer as a stream.");
    const out = { pause: null, live: [], reason: "", errored: false };
    const reader = resp.body.getReader(), dec = new TextDecoder();
    let buf = "";
    const seen = { i: 0, o: 0 };
    const dispatch = (name, data) => {
      switch (name) {
        case "run": if (typeof data.run_id === "string" && run.item) (run.item.runs = run.item.runs || []).push(data.run_id); break;
        case "text": if (typeof data.delta === "string") bubble.addText(data.delta); break;
        case "activity": if (typeof data.text === "string") ui.setActivity(data.text); break;
        case "changeset": bubble.addCard(data); break;
        case "live": out.live.push(data); break;
        case "pause": out.pause = data; break;
        case "usage": {   // cumulative for this request: add only what is new since the last event
          const i = num(data.input_tokens, 0), o = num(data.output_tokens, 0);
          run.tokens.input += i - seen.i; run.tokens.output += o - seen.o; seen.i = i; seen.o = o;
          state.usage = { ...data, run_total: run.tokens.input + run.tokens.output }; ui.drawUsage(); break;
        }
        case "error": out.errored = true; bubble.addError(data.message || "The assistant failed.", data.code); break;
        case "done": out.reason = data.reason || ""; break;
        default: break;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      buf += dec.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n?/g, "\n");
      let at;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        let name = "message";
        const data = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (!data.length) continue;
        let parsed;
        try { parsed = JSON.parse(data.join("\n")); } catch (e) { continue; }
        if (isObj(parsed)) dispatch(name, parsed);
      }
      if (done) break;
    }
    return out;
  }

  async function runTurn(text) {
    if (state.running) return;
    ensureBoard();
    const user = { role: "user", text, cards: [], notes: state.notes.length ? state.notes.slice() : undefined, at: new Date().toISOString() };
    state.notes = [];
    state.items.push(user);
    const reply = { role: "assistant", text: "", cards: [], at: new Date().toISOString(), runs: [] };
    state.items.push(reply);
    const t0 = performance.now();
    const tokens = { input: 0, output: 0 };
    const run = state.running = { tokens, ctrl: new AbortController(), cleanups: new Set(), aborted: false, item: reply };
    ui.addItem(user);
    const bubble = ui.addItem(reply);
    ui.setBusy(true);
    ui.setActivity("Thinking");
    save();
    // The transcript ends with the new user turn (the empty assistant bubble is not part of it).
    let body = { messages: transcript(), snapshot: snapshot(), mode: mode(), client: CLIENT };
    try {
      for (let round = 0; ; round++) {
        const r = await streamOnce(body, run, bubble);
        if (r.errored || !r.pause || !r.live.length) {
          if (r.pause && !r.live.length && !r.errored) bubble.addError("The assistant paused without asking for anything.", "internal");
          break;
        }
        if (round >= MAX_ROUNDS) { bubble.addError("The assistant asked for too many live checks in a row; stopped.", "limit"); break; }
        const results = [];
        for (const call of r.live) {
          if (run.aborted) throw new DOMException("stopped", "AbortError");
          ui.setActivity(LIVE_TEXT[call.tool] || "Checking the board");
          results.push({ call_id: call.call_id, result: await runLive(call, run) });
        }
        await bubble.settle();   // changesets that arrived before the pause are on the board before the fresh snapshot
        body = { messages: transcript(), snapshot: snapshot(), mode: mode(), client: CLIENT, resume: { token: r.pause.token, results } };
        ui.setActivity("Thinking");
      }
    } catch (e) {
      if (run.aborted || (e && e.name === "AbortError")) bubble.addNote("Stopped.");
      else failure(e, bubble);
    } finally {
      for (const f of [...run.cleanups]) { try { f(); } catch (e) { /* none */ } }
      state.running = null;
      await bubble.settle();
      reply.text = reply.text.replace(/\s+$/, "");
      if (!reply.text && !reply.cards.length && !bubble.hadError) {
        // Nothing came back: drop the empty bubble so the transcript stays clean.
        state.items.splice(state.items.indexOf(reply), 1);
        bubble.row.remove();
      }
      ui.setBusy(false);
      ui.setActivity("");
      if (state.items.includes(reply) && (tokens.input || tokens.output)) {
        const n = (v) => v.toLocaleString("en-US");
        bubble.addStats(`${ui.fmtSecs(performance.now() - t0)} · ${n(tokens.input)} input · ${n(tokens.output)} output tokens`);
      }
      save();
      ui.refresh();
    }
  }

  const LIVE_TEXT = { probe_signals: "Checking signal levels", play: "Playing a note", get_environment: "Looking at the audio setup", highlight: "Pointing at the board", ask_user: "Waiting for your answer" };

  async function runLive(call, run) {
    const fn = tools[call.tool];
    if (!fn) return { error: "unknown tool " + call.tool };
    const args = isObj(call.args) ? call.args : {};
    try {
      const r = await (call.tool === "ask_user" ? withTimeout(fn(args, run), ASK_TIMEOUT, "the question") : withTimeout(fn(args, run), LIVE_TIMEOUT, call.tool));
      return r === undefined ? {} : r;
    } catch (e) {
      for (const f of [...run.cleanups]) { try { f(); } catch (x) { /* none */ } }
      run.cleanups.clear();
      return { error: String((e && e.message) || e) };
    }
  }

  /// The login dialog (account.js). Shown by itself the first time the panel opens without a login; the panel's button asks again.
  let askedSignIn = false;
  async function askSignIn() {
    askedSignIn = true;
    const ok = await P.BleepAccount.requireSignIn("Sign in to use the assistant",
      "The assistant runs on the Bleep Library's servers, so it needs your account (the same one that shares presets).");
    if (ok) { await refreshStatus(); ui.refresh(); }
  }

  function failure(e, bubble) {
    if (e.http === 401) { status.signed_in = false; ui.refresh(); bubble.addError(viaApp ? "You are signed out. Sign in again to use the assistant." : "You are signed out. Sign in on the website to use the assistant."); return; }
    if (e.http === 429) {
      const b = e.body || {};
      const when = b.reset_at ? fmtTime(b.reset_at) : "";
      if (b.reset_at || (b.code || "") === "budget") { status.budget_exhausted = true; status.reset_at = b.reset_at || status.reset_at; ui.refresh(); }
      let msg = e.message && !/^The assistant answered/.test(e.message) ? e.message
        : when ? "The daily limit of the assistant is used up."
        : e.retryAfter ? `Too many requests. Try again in ${e.retryAfter} seconds.` : "Too many requests. Try again in a minute.";
      if (when && !/reset/i.test(msg)) msg += ` It resets ${when}.`;
      bubble.addError(msg);
      return;
    }
    if (e.http === 503) { bubble.addError("The assistant is not available right now."); return; }
    bubble.addError(e.http ? e.message : "Could not reach the assistant. Check your connection and try again.");
  }

  function ensureBoard() {
    if (state.key !== boardKey()) { load(); ui.renderAll(); }
  }

  // ---- changesets
  let queue = Promise.resolve();
  /// Applies cards (all or none, one undo step) and tells the model afterwards through a note on the next message.
  function applyCards(cards, byUser) {
    const job = queue.then(async () => {
      cards = cards.filter((c) => c.status === "pending");
      if (!cards.length) return;
      const b = host.board();
      if (!b) { for (const c of cards) fail(c, "There is no board to change."); return; }
      const ops = cards.flatMap((c) => c.ops);
      const dry = applyOps(clone(b), ops, host);
      if (dry) {
        for (const c of cards) fail(c, dry);
        state.notes.push(`The changeset${cards.length > 1 ? "s" : ""} ${cards.map((c) => c.id).join(", ")} could not be applied (${dry}); the board was not changed`);
        save();
        return;
      }
      const label = cards.length === 1 ? "assistant: " + cards[0].summary : "assistant: " + cards.length + " changesets";
      await host.edit(label, (next) => { applyOps(next, ops, host); });
      const tempo = ops.filter((o) => o.op === "set_tempo").pop();
      if (tempo && W() && W().setTempo) W().setTempo(tempo.bpm);
      const group = { json: JSON.stringify(host.board()), cards };
      for (const c of cards) { c.status = "applied"; c.group = group; ui.drawCard(c); }
      if (byUser) state.notes.push(`The user applied ${cards.map((c) => `changeset ${c.id} ("${c.summary}")`).join(", ")}`);
      save();
      ui.refresh();
    }).catch((e) => { for (const c of cards) fail(c, String((e && e.message) || e)); });
    queue = job;
    return job;
  }
  function fail(c, why) { c.status = "failed"; c.error = why; ui.drawCard(c); }
  function rejectCards(cards) {
    for (const c of cards.filter((k) => k.status === "pending")) {
      c.status = "rejected";
      state.notes.push(`The user rejected changeset ${c.id} ("${c.summary}"); nothing was changed`);
      ui.drawCard(c);
    }
    save();
    ui.refresh();
  }
  async function undoCard(c) {
    const g = c.group;
    if (!g || c.status !== "applied") return;
    if (JSON.stringify(host.board()) !== g.json) { ui.notice("The board changed since; use Undo in the menu to step back."); return; }
    await host.undo();
    for (const k of g.cards) { k.status = "undone"; ui.drawCard(k); }
    state.notes.push(`The user undid ${g.cards.map((k) => `changeset ${k.id} ("${k.summary}")`).join(", ")}`);
    save();
    ui.refresh();
  }

  // ------------------------------------------------------------------ the panel
  function buildUI() {
    const css = el("link");
    css.rel = "stylesheet";
    css.href = "agent-chat.css";
    document.head.appendChild(css);

    const main = document.getElementById("main");
    const top = document.getElementById("top");
    const audio = document.getElementById("audio");

    // the button in the top bar
    const toggle = el("button", "ag-toggle");
    toggle.id = "agent-toggle";
    toggle.type = "button";
    toggle.title = "Assistant: ask about this patch, or have it change the patch";
    toggle.setAttribute("aria-label", "Assistant");
    toggle.setAttribute("aria-controls", "agent-chat");
    toggle.setAttribute("aria-expanded", "false");
    const icon = document.createElementNS(SVG, "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", "M2.5 3.5h11v7h-5l-3 2.5v-2.5h-3z");
    icon.appendChild(path);
    toggle.append(icon, el("span", "ag-toggle-text", "Assistant"));
    top.insertBefore(toggle, audio || null);

    // the panel
    const root = el("aside", "ag");
    root.id = "agent-chat";
    root.hidden = true;
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "Patch assistant");
    const head = el("div", "ag-head");
    head.appendChild(el("strong", "", "Assistant"));
    head.appendChild(el("span", "ag-spacer"));
    const copy = el("button", "ag-small", "Copy chat");
    copy.type = "button";
    copy.title = "Copy this whole chat as JSON, with every model call, tool call and timestamp (to discuss it)";
    const clear = el("button", "ag-small", "New chat");
    clear.type = "button";
    clear.title = "Clear this chat (kept only in this browser)";
    const close = el("button", "ag-small ag-x", "✕");
    close.type = "button";
    close.title = "Close (Esc)";
    close.setAttribute("aria-label", "Close the assistant");
    head.append(copy, clear, close);

    const list = el("div", "ag-list");
    list.setAttribute("role", "log");
    list.setAttribute("aria-live", "polite");
    list.setAttribute("aria-label", "Conversation");
    list.tabIndex = 0;
    const blocker = el("div", "ag-blocker");       // sign-in, budget, privacy note
    const activity = el("div", "ag-activity");
    activity.hidden = true;
    activity.setAttribute("role", "status");
    const spin = el("span", "ag-spin");
    const actText = el("span", "ag-act-text");
    const actTime = el("span", "ag-act-time");
    activity.append(spin, actText, actTime);
    let timer = null, label = "";
    const fmtSecs = (ms) => (ms < 60e3 ? (ms / 1000).toFixed(1) + " s" : Math.floor(ms / 60e3) + " min " + String(Math.floor(ms / 1000) % 60).padStart(2, "0") + " s");
    const composer = el("form", "ag-composer");
    const input = el("textarea", "ag-input");
    input.rows = 2;
    input.placeholder = "Ask about this patch…";
    input.setAttribute("aria-label", "Message to the assistant");
    input.maxLength = 4000;
    input.spellcheck = true;
    const send = el("button", "ag-send", "Send");
    send.type = "submit";
    const stop = el("button", "ag-send ag-stop", "Stop");
    stop.type = "button";
    stop.hidden = true;
    const bar = el("div", "ag-bar");
    const modes = el("div", "ag-modes");
    modes.setAttribute("role", "radiogroup");
    modes.setAttribute("aria-label", "When the assistant changes the patch");
    const modeBtns = {};
    for (const [v, label, tip] of [["ask", "Ask first", "The assistant proposes changes; you apply them"], ["auto", "Apply automatically", "Safe changes are applied at once (one undo step each); deletions still ask"]]) {
      const b = el("button", "ag-mode", label);
      b.type = "button";
      b.title = tip;
      b.setAttribute("role", "radio");
      b.addEventListener("click", () => { store.set("bleep-agent-mode", v); drawMode(); });
      modeBtns[v] = b;
      modes.appendChild(b);
    }
    const usage = el("span", "ag-usage");
    bar.append(modes, el("span", "ag-spacer"), usage);
    const row = el("div", "ag-row");
    row.append(input, send, stop);
    composer.append(row, bar);
    root.append(head, list, blocker, activity, composer);
    main.appendChild(root);

    const drawMode = () => {
      const m = mode();
      for (const [v, b] of Object.entries(modeBtns)) { b.classList.toggle("on", v === m); b.setAttribute("aria-checked", v === m ? "true" : "false"); }
    };
    drawMode();

    let open = false;
    const api = {
      root, toggle, input,
      get open() { return open; },
      setOpen(on) {
        open = on;
        root.hidden = !on;
        toggle.setAttribute("aria-expanded", on ? "true" : "false");
        toggle.classList.toggle("on", on);
        if (on) { refreshStatus().then(() => { ensureBoard(); api.refresh(); if (viaApp && status && status.enabled && !status.signed_in && !askedSignIn) askSignIn(); }); api.refresh(); setTimeout(() => (input.offsetParent ? input : close).focus(), 0); }
        else if (root.contains(document.activeElement)) toggle.focus();
      },
      setActivity(text) { label = text; activity.hidden = !text && !timer; actText.textContent = text ? text + "…" : ""; },
      setBusy(on) {
        if (on && !timer) {
          const t0 = performance.now();
          const tick = () => { actTime.textContent = fmtSecs(performance.now() - t0); };
          tick();
          timer = setInterval(tick, 100);
          activity.hidden = false;
        } else if (!on && timer) {
          clearInterval(timer);
          timer = null;
          actTime.textContent = "";
          activity.hidden = !label;
        }
        send.hidden = on; stop.hidden = !on; input.disabled = false; root.classList.toggle("busy", on); list.setAttribute("aria-busy", on ? "true" : "false");
      },
      fmtSecs,
      notice(t) { if (host.notice) host.notice(t); },
      drawUsage() {
        const u = state.usage;
        if (!u) { usage.textContent = ""; return; }
        const k = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
        usage.textContent = `${k(num(u.run_total, num(u.input_tokens, 0) + num(u.output_tokens, 0)))} tokens` + (u.day_limit ? ` · day ${k(num(u.day_total, 0))}/${k(u.day_limit)}` : "");
        usage.title = "Tokens used by this answer, and today's total";
      },
      // ---- what stands in place of the composer
      refresh() {
        blocker.textContent = "";
        const ok = status && status.enabled;
        let block = true;
        if (!ok) { /* hidden anyway */ }
        else if (!status.signed_in) {
          blocker.append(el("p", "", "Sign in to use the assistant."));
          const r = el("div", "ag-actions");
          if (viaApp) {   // the app and the plugin: the library login, a dialog with the code to confirm on the website
            const go = el("button", "ag-primary", "Sign in…");
            go.type = "button";
            go.addEventListener("click", () => askSignIn());
            r.append(go);
          } else {
            const a = el("a", "ag-link", "Sign in on the website");
            a.href = "/login/"; a.target = "_blank"; a.rel = "noopener";
            const again = el("button", "ag-small", "I have signed in");
            again.type = "button";
            again.addEventListener("click", async () => { await refreshStatus(); api.refresh(); });
            r.append(a, again);
          }
          blocker.appendChild(r);
        } else if (status.budget_exhausted) {
          const when = status.reset_at ? fmtTime(status.reset_at) : "";
          blocker.append(el("p", "", "The assistant's daily limit is used up." + (when ? ` It resets ${when}.` : " Try again tomorrow.")));
        } else if (!store.get("bleep-agent-privacy", false)) {
          blocker.append(el("p", "", "Messages and the current patch are sent to the AI provider that answers them. Nothing else from your computer is sent, and the chat itself is kept only in this browser."));
          const okb = el("button", "ag-primary", "OK");
          okb.type = "button";
          okb.addEventListener("click", () => { store.set("bleep-agent-privacy", true); api.refresh(); input.focus(); });
          blocker.appendChild(okb);
        } else block = false;
        blocker.hidden = !block;
        composer.hidden = block;
        const empty = !state.items.length;
        list.classList.toggle("empty", empty);
        if (empty && !list.querySelector(".ag-examples")) api.renderAll();
        if (!empty) { const ex = list.querySelector(".ag-examples"); if (ex) ex.remove(); }
        clear.disabled = !!state.running || !state.items.length;
      },
      renderAll() {
        list.textContent = "";
        if (!state.items.length) {
          const ex = el("div", "ag-examples");
          ex.appendChild(el("p", "ag-hint", "Ask about your patch, or have the assistant change it. For example:"));
          for (const q of EXAMPLES) {
            const b = el("button", "ag-chip", q);
            b.type = "button";
            b.addEventListener("click", () => { if (!state.running) submit(q); });
            ex.appendChild(b);
          }
          list.appendChild(ex);
          return;
        }
        for (const it of state.items) api.addItem(it);
      },
      addItem(item) {
        const ex = list.querySelector(".ag-examples");
        if (ex) ex.remove();
        const wrap = el("div", "ag-msg " + item.role);
        const body = el("div", "ag-body");
        const cardsBox = el("div", "ag-cards");
        wrap.append(body, cardsBox);
        list.appendChild(wrap);
        const bubble = {
          row: wrap, hadError: false, pending: 0,
          draw() { if (item.role === "user") body.textContent = item.text; else markdown(body, item.text); body.hidden = !item.text; },
          addText(d) { item.text += d; if (!bubble.raf) bubble.raf = requestAnimationFrame(() => { bubble.raf = 0; bubble.draw(); api.scroll(); }); },
          addStats(t) { wrap.appendChild(el("div", "ag-stats", t)); api.scroll(); },
          addNote(t) { bubble.hadError = true; wrap.appendChild(el("div", "ag-note", t)); api.scroll(); },
          addError(t, code) { bubble.hadError = true; const e = el("div", "ag-error", t); e.setAttribute("role", "alert"); wrap.appendChild(e); api.scroll(); void code; },
          addCard(cs) {
            if (!isObj(cs) || !str(cs.id)) return;
            const c = { id: cs.id, summary: String(cs.summary || "Changes"), lines: Array.isArray(cs.lines) ? cs.lines.map(String) : [], ops: Array.isArray(cs.ops) ? cs.ops : [],
                        destructive: !!cs.destructive, status: "pending" };
            state.cards.set(c.id, c);
            item.cards.push(c.id);
            c.box = cardsBox;
            api.drawCard(c);
            api.drawBatch(cardsBox, item);
            api.scroll();
            if (!cs.needs_confirmation) bubble.apply = applyCards([c], false);
          },
          async settle() { if (bubble.apply) await bubble.apply; await queue; },
        };
        bubble.draw();
        for (const id of item.cards || []) { const c = state.cards.get(id); if (c) { c.box = cardsBox; api.drawCard(c); } }
        if ((item.cards || []).length > 1) api.drawBatch(cardsBox, item);
        api.scroll();
        return bubble;
      },
      /// "Apply all" above several cards waiting for an answer.
      drawBatch(box, item) {
        let bar = box.querySelector(".ag-batch");
        const pend = (item.cards || []).map((id) => state.cards.get(id)).filter((c) => c && c.status === "pending");
        if (pend.length < 2) { if (bar) bar.remove(); return; }
        if (!bar) {
          bar = el("div", "ag-batch");
          const all = el("button", "ag-primary", "Apply all");
          all.type = "button";
          all.addEventListener("click", () => { const p = (item.cards || []).map((id) => state.cards.get(id)).filter((c) => c && c.status === "pending"); applyCards(p, true); });
          const none = el("button", "", "Reject all");
          none.type = "button";
          none.addEventListener("click", () => rejectCards((item.cards || []).map((id) => state.cards.get(id)).filter(Boolean)));
          bar.append(all, none);
          box.prepend(bar);
        }
      },
      drawCard(c) {
        if (!c.box) return;
        let card = c.el;
        if (!card) { card = c.el = el("div", "ag-card"); c.box.appendChild(card); }
        card.textContent = "";
        card.className = "ag-card " + c.status + (c.destructive ? " destructive" : "");
        const h = el("div", "ag-card-head");
        h.appendChild(el("strong", "", c.summary));
        if (c.destructive) h.appendChild(el("span", "ag-tag", "removes things"));
        card.appendChild(h);
        if (c.lines.length) {
          const ul = el("ul", "ag-diff");
          for (const line of c.lines.slice(0, 60)) {
            const li = el("li", /^\s*\+/.test(line) ? "add" : /^\s*[-−]/.test(line) ? "del" : "chg", line);
            ul.appendChild(li);
          }
          if (c.lines.length > 60) ul.appendChild(el("li", "chg", `… and ${c.lines.length - 60} more`));
          card.appendChild(ul);
        }
        const foot = el("div", "ag-card-foot");
        const label = { applied: "Applied", rejected: "Rejected", undone: "Undone", expired: "Not applied", failed: "Not applied" }[c.status];
        if (c.status === "pending") {
          const yes = el("button", "ag-primary", "Apply");
          yes.type = "button";
          yes.addEventListener("click", () => applyCards([c], true));
          const no = el("button", "", "Reject");
          no.type = "button";
          no.addEventListener("click", () => rejectCards([c]));
          foot.append(yes, no);
        } else {
          foot.appendChild(el("span", "ag-state", label));
          if (c.status === "applied") {
            const u = el("button", "ag-small", "Undo");
            u.type = "button";
            u.title = "Undo this change (one step)";
            u.addEventListener("click", () => undoCard(c));
            foot.appendChild(u);
          }
          if (c.status === "failed") card.appendChild(el("div", "ag-error", c.error || "The change did not fit the board."));
        }
        card.appendChild(foot);
        const item = state.items.find((it) => (it.cards || []).includes(c.id));
        if (item) api.drawBatch(c.box, item);
      },
      scroll() { if (list.scrollHeight - list.scrollTop - list.clientHeight < 140 || state.running) list.scrollTop = list.scrollHeight; },

      // ---- live tools that need the page
      highlight(refs, message) {
        const found = [];
        const board = host.board();
        const first = (board && refs.map((r) => (isObj(r) ? r.node : null)).find((id) => str(id) && board.nodes.some((n) => n.id === id))) || null;
        if (first) host.goToNode(first);   // enters the cells around it and redraws the board: look the elements up afterwards
        for (const r of refs.slice(0, 24)) {
          if (!isObj(r)) continue;
          if (str(r.cable)) {
            const hit = document.querySelector(`.cable-hit[data-id="${CSS.escape(r.cable)}"]`);
            const p = hit && hit.previousElementSibling && hit.previousElementSibling.classList.contains("cable") ? hit.previousElementSibling : hit;
            if (p) found.push(p);
          } else if (str(r.node)) {
            const sel = r.jack ? `[data-node="${CSS.escape(r.node)}"][data-jack="${CSS.escape(r.jack)}"]` : `.node[data-id="${CSS.escape(r.node)}"]`;
            const e = document.querySelector(sel) || document.querySelector(`.node[data-id="${CSS.escape(r.node)}"]`);
            if (e) found.push(e);
          }
        }
        for (const e of found) e.classList.add("ag-hl");
        setTimeout(() => found.forEach((e) => e.classList.remove("ag-hl")), 3000);
        if (message && host.notice) host.notice(String(message).slice(0, 200));
        return { ok: true, found: found.length };
      },
      ask(args, run) {
        const item = state.items[state.items.length - 1];
        const box = list.querySelector(".ag-msg:last-child") || list;
        const q = el("div", "ag-ask");
        q.setAttribute("role", "group");
        q.appendChild(el("p", "ag-ask-q", String(args.question || "?")));
        return new Promise((resolve) => {
          let done = false;
          const finish = (answer, label) => {
            if (done) return;
            done = true;
            run.cleanups.delete(cancel);
            q.textContent = "";
            q.classList.add("answered");
            q.append(el("p", "ag-ask-q", String(args.question || "?")), el("p", "ag-ask-a", label === null ? "No answer." : "You: " + label));
            if (item && label !== null) item.text += (item.text ? "\n\n" : "") + `(The assistant asked: ${String(args.question || "")} You answered: ${label})`;
            resolve(label === null ? { error: "the user did not answer" } : { answer });
          };
          const cancel = () => finish("", null);
          run.cleanups.add(cancel);
          const choices = (Array.isArray(args.choices) ? args.choices : []).map(String).slice(0, 8);
          const row = el("div", "ag-choices");
          for (const c of choices) {
            const b = el("button", "ag-chip", c);
            b.type = "button";
            b.addEventListener("click", () => finish(c, c));
            row.appendChild(b);
          }
          q.appendChild(row);
          if (args.allow_text || !choices.length) {
            const f = el("form", "ag-ask-form");
            const t = el("input");
            t.type = "text"; t.maxLength = 400; t.placeholder = "Your answer"; t.setAttribute("aria-label", "Your answer");
            const go = el("button", "ag-primary", "Answer");
            go.type = "submit";
            f.append(t, go);
            f.addEventListener("submit", (e) => { e.preventDefault(); if (t.value.trim()) finish(t.value.trim(), t.value.trim()); });
            q.appendChild(f);
            setTimeout(() => !choices.length && t.focus(), 0);
          } else setTimeout(() => { const b = row.querySelector("button"); if (b) b.focus(); }, 0);
          box.appendChild(q);
          api.scroll();
        });
      },
    };

    // ---- wiring
    const submit = (text) => {
      text = (text || "").trim();
      if (!text || state.running || composer.hidden) return;
      input.value = "";
      input.style.height = "";
      runTurn(text);
    };
    api.submit = submit;
    composer.addEventListener("submit", (e) => { e.preventDefault(); submit(input.value); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(input.value); }
    });
    stop.addEventListener("click", () => {
      const run = state.running;
      if (!run) return;
      run.aborted = true;
      for (const f of [...run.cleanups]) { try { f(); } catch (e) { /* none */ } }
      run.ctrl.abort();
    });
    copy.addEventListener("click", async () => {
      if (!state.items.length) { ui.notice("Nothing to copy yet."); return; }
      const label = copy.textContent;
      copy.disabled = true; copy.textContent = "Copying…";
      try {
        const doc = await exportChat();
        const text = JSON.stringify(doc, null, 1);
        const how = await copyText(text);
        const kb = Math.max(1, Math.round(text.length / 1024));
        ui.notice(how === "clipboard" ? `Chat copied (${doc.runs.length} runs, ${kb} kB)${doc.log_error ? ": " + doc.log_error : ""}` : `Could not use the clipboard; saved as a file (${kb} kB)`);
        copy.textContent = "Copied ✓";
      } catch (e) {
        ui.notice("Could not copy the chat: " + String((e && e.message) || e));
        copy.textContent = label;
      }
      copy.disabled = false;
      setTimeout(() => { copy.textContent = label; }, 2000);
    });
    clear.addEventListener("click", () => {
      if (state.running) return;
      state.items = []; state.cards = new Map(); state.notes = []; state.usage = null;
      store.del(state.key);
      api.renderAll();
      api.refresh();
      api.drawUsage();
      input.focus();
    });
    close.addEventListener("click", () => api.setOpen(false));
    toggle.addEventListener("click", () => api.setOpen(!open));
    // The board's own keys (Delete, Tab, T, F …) must not act while the panel has the focus; Undo/Redo still reach the board.
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); api.setOpen(false); return; }
      const undoKey = (e.metaKey || e.ctrlKey) && /^[zy]$/i.test(e.key) && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if (!undoKey) e.stopPropagation();
    });
    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    return api;
  }

  async function refreshStatus() {
    try {
      const r = await agentFetch("/api/agent/status", { headers: { Accept: "application/json" } });
      if (!r.ok) return;
      const d = await r.json();
      if (isObj(d)) status = d;
    } catch (e) { /* keep what we know */ }
  }

  async function init(h) {
    if (host || !h) return;
    if (document.body.classList.contains("plugin")) return;   // an instrument or FX window shows the cell's panel only
    const A = P.BleepAccount;
    // The app and the plugin: the library login (Bleep Play, a page of the website, has the cookie instead).
    viaApp = !!(A && A.enabled && !(await A.status(false)).playLogin);
    if (!viaApp && !/^https?:$/.test(location.protocol)) return;
    let d = null;
    try {
      const r = await agentFetch("/api/agent/status", { headers: { Accept: "application/json" } });
      if (!r.ok) return;
      d = await r.json();
    } catch (e) { return; }   // offline, a static page without backend, not JSON: no assistant
    if (!isObj(d) || d.enabled !== true) return;
    host = h;
    status = d;
    hookState();
    ui = buildUI();
    tools = makeTools(host, ui);
    load();
    ui.renderAll();
    ui.refresh();
    ui.drawUsage();
    if (viaApp && A.onChange) A.onChange(() => { refreshStatus().then(() => ui.refresh()); });   // signed in or out in Settings
  }

  P.BleepAgentChat = {
    init,
    // for the tests of the page and the mock server
    _test: { applyOps, markdown, get state() { return state; } },
  };
})();
