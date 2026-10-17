// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// panel-build.js — "Build panel from cell" (doc/specs/panels.md §3, §6): a first
// panel for a cell, made the way the factory panels are: the cell's inputs as
// controls first, then a section of main knobs for each module, faders for
// mixers, a keyboard under a Voice Cell, a meter. Every control it makes is an
// ordinary control, free to move or delete.
//
//   BleepPanelBuild.build(cell, ctx) → a panel document
//     ctx { nodes: [node] the cell's contents, in layout order, types, inputsOf(n), cables,
//           focus?: id of the module to show first and with more knobs (the module a project is about),
//           focusViews?: draw the module's own view (sequencers, the Sampler's waveform) only for `focus`,
//           generic?: also give modules without a FACE entry their first modulatable knobs,
//           outs?: [[l, r], …] "node.jack" outputs for the Out meter when there is no Cell Out }
//     cell { id, name, type, params } is the cell the panel fronts; { board: true, id: "", name } builds a board panel
//     (no cell inputs, no keyboard, no `cell` in the result).
(function () {
  "use strict";
  // The knobs of a module that matter, in order. Others: its first few modulatable knobs.
  const FACE = {
    "oscillator": ["shape", "pw", "fine", "coarse", "octave", "fm"], "dual-osc": ["shapeA", "shapeB", "octaveB", "fineB", "balance", "fmDepth", "fold", "width"],
    "macro-osc": ["model", "tone", "shape", "blend", "decay", "level"], "wavetable-osc": ["bank", "x", "y", "scan", "warp", "subLevel"],
    "chord-osc": ["chord", "voicing", "shape", "detune", "stereo", "glide"], "formant-osc": ["formant", "narrow", "body", "roll", "spread", "fmDepth"],
    "additive-osc": ["partials", "tilt", "oddEven", "stretch", "comb", "chorus"], "swarm": ["chord", "spread", "detune", "warp", "drift", "count"],
    "noise": ["colour", "level"], "perc-voice": ["engine", "pitch", "tone", "morph", "click", "decay", "level"],
    "modal-voice": ["strike", "bow", "blow", "geometry", "brightness", "damping", "position", "space"],
    "filter": ["type", "cutoff", "resonance", "drive", "keytrack", "mode"], "dual-filter": ["cutoff", "spread", "res1", "res2", "balance", "drive"],
    "filter-bank": ["scan", "width", "q", "tilt", "shift", "mix", "vocode"], "low-pass-gate": ["level", "response", "resonance", "brightness", "drive", "bleed"],
    "wavefolder": ["fold", "symmetry", "tap", "shape", "mix", "level"], "freq-shifter": ["shift", "fine", "feedback", "spread", "mix"],
    "resonator": ["frequency", "structure", "brightness", "damping", "position", "dry"], "reverb": ["size", "decay", "preDelay", "damping", "tone", "mix", "freeze"],
    "zone-delay": ["time", "feedback", "character", "tone", "wobble", "mix"], "delay-network": ["time", "taps", "feedback", "character", "tone", "mix"],
    "grains": ["position", "size", "pitch", "density", "texture", "mix"], "bender": ["time", "chance", "repeats", "bend", "corrupt", "mix"],
    "pitch-shifter": ["pitch", "fine", "window", "drift", "feedback", "mix"], "chorus": ["rate", "depth", "delay", "feedback", "spread", "mix"],
    "phaser": ["rate", "depth", "centre", "feedback", "stages", "mix"], "compressor": ["threshold", "ratio", "attack", "release", "makeup", "mix"],
    "crunch": ["drive", "bits", "rate", "tone", "level", "mix"], "eq": ["b2Gain", "b3Gain", "b4Gain", "b5Gain", "level"],
    "audio-mixer": [], "vca": [], "sampler": ["transpose", "speed", "position", "attack", "release", "cutoff", "level", "pan"],
    "delay": ["timel", "timer", "feedback", "lowcut", "highcut", "mix"], "saturator": ["drive", "bias", "color", "tone", "level", "mix"], "limiter": ["ceiling", "release", "input"],
    "adsr": ["attack", "decay", "sustain", "release", "velamount"], "lfo": ["wave", "rate", "pw", "fade", "phase"],
    "organic-lfos": ["rate", "spread", "drift", "twist", "scatter", "level"], "quad-lfo": ["rate1", "rate2", "rate3", "rate4", "level1", "spread"],
    "shape-env": ["time", "shape", "morph", "level", "skew", "velamount"], "function": ["rise", "fall", "shape", "spread", "cycle"],
    "tidal": ["freq", "skew", "curve", "smooth", "spread"], "wobble": ["rate", "smooth", "wobble", "chaos", "burst", "level"],
    "random": ["rate", "spread", "bias", "smooth", "loop", "quantize"], "uncertainty": ["f1rate", "f2rate", "f1spread", "qrate", "distribution", "correlation"],
    "coin-toss": ["prob1", "prob2", "memory1", "memory2", "mode1", "link"], "logic": ["threshold", "hysteresis"],
    "utility": ["scalex", "scaley", "offset", "slew", "mode"], "multiplier": ["gain1", "biasx1", "biasy1", "gain2"],
    "quantizer": ["scale", "root", "hysteresis", "glide", "rounding"], "harmony-master": ["key", "scale", "quality", "degree", "advance", "octave"],
    "punch-kick": ["tune", "decay", "sweep", "drive", "attack", "level"], "punch-snare": ["tune", "tone", "snappy", "decay", "level"],
    "punch-hats": ["tune", "closed", "open", "tone", "crunch", "level"], "punch-clap": ["tone", "decay", "spread", "bursts", "level"],
    "punch-tom": ["tune", "decay", "bend", "noise", "level"], "punch-rim": ["tune", "decay", "level"], "punch-cymbal": ["voice", "tune", "decay", "tone", "crunch", "level"],
    "ring-kick": ["tune", "decay", "sweep", "tone", "drive", "level"], "ring-snare": ["tune", "tone", "snappy", "decay", "level"],
    "ring-hats": ["tune", "closed", "open", "tone", "level"], "ring-clap": ["tone", "decay", "spread", "bursts", "level"],
    "ring-tom": ["tune", "decay", "bend", "noise", "level"], "ring-rim": ["voice", "tune", "decay", "level"],
    "ring-cowbell": ["tune", "decay", "tone", "level"], "ring-cymbal": ["tune", "decay", "tone", "level"],
  };
  // Modules whose own view goes on the panel: sequencers and pictures. [columns, rows]
  const EMBED = {
    "drum-grid": [46, 20], "step-sequencer": [40, 16], "cartesian-sequencer": [36, 16], "polymeter-sequencer": [40, 16],
    "stage-sequencer": [40, 14], "gate-sequencer": [36, 14], "drum-map": [36, 12], "rhythm-bank": [20, 10],
    "rotating-divider": [18, 9], "shift-register": [18, 11], "recall": [18, 11], "segments": [22, 13], "neuron": [20, 10],
    "quantizer-suite": [32, 14], "sampler": [40, 18],
  };
  const CONTROLLER_TYPES = new Set(["dial", "wheel", "xy-pad", "button", "keyboard", "level-meter", "monitor"]);
  const SIZE = { dial: [4, 4], slider: [2, 8], wheel: [3, 8], meter: [2, 8], button: [4, 3], select: [6, 3] };
  const SECTION_MAX = 24;
  const BIPOLAR = new Set(["cut", "bend", "tone", "pos", "scan", "x", "y", "tr"]);

  function shelf(boxes, max, gap) {
    let x = 0, y = 0, rowH = 0, width = 0;
    for (const b of boxes) {
      if (x > 0 && x + b.w > max) { x = 0; y += rowH + gap; rowH = 0; }
      b.x = x; b.y = y;
      x += b.w + gap; rowH = Math.max(rowH, b.h); width = Math.max(width, x - gap);
    }
    return { w: width, h: y + rowH };
  }

  /// The control that suits a knob: a button for a toggle, a select for a choice, a dial otherwise.
  function knobControl(node, p) {
    const c = { wire: [{ param: `${node.id}.${p.id}` }], label: p.name.length > 12 ? p.name.replace(/ (Time|Amount|Level)$/, "") : p.name };
    if (p.kind === "bool") return { type: "button", ...c };
    if (p.kind === "choice") return { type: "select", ...c };
    return { type: "dial", ...c };
  }

  function build(cell, ctx) {
    const { nodes, types, inputsOf, cables } = ctx;
    const isVoice = cell.type === "voice-cell";
    const faceOf = (n) => FACE[n.type] || (ctx.generic && types[n.type] && types[n.type].creatable && !CONTROLLER_TYPES.has(n.type)
      ? types[n.type].params.filter((q) => q.modulatable).slice(0, 6).map((q) => q.id) : undefined);
    const sections = [];
    // The cell's own inputs first.
    const macros = [];
    for (const j of inputsOf(cell)) {
      if (j.type === "control") macros.push(j.id === "bend"
        ? { type: "wheel", label: j.name, spring: true, wire: [{ cell: j.id, range: [-1, 1] }] }
        : { type: "dial", label: j.name, wire: [{ cell: j.id, ...(BIPOLAR.has(j.id) ? { range: [-1, 1] } : {}) }] });
      else if (j.type === "trigger" || j.type === "gate") macros.push({ type: "button", label: j.name, wire: [{ cell: j.id }] });
      else if (j.type === "pitch") macros.push({ type: "dial", label: j.name, wire: [{ cell: j.id, range: [-1, 1] }] });
    }
    if (macros.length) sections.push({ title: "Controls", colour: "#fda4af", items: macros });

    const faced = nodes.filter((n) => n.parent === cell.id && (faceOf(n) !== undefined || EMBED[n.type]) && !(ctx.focusViews && EMBED[n.type] && n.id !== ctx.focus));
    if (ctx.focus) faced.sort((a, b) => (b.id === ctx.focus) - (a.id === ctx.focus));
    const cap = faced.length <= 3 ? 8 : faced.length <= 6 ? 6 : faced.length <= 10 ? 4 : 3;
    for (const n of faced) {
      const t = types[n.type];
      const capHere = n.id === ctx.focus ? Math.max(cap, 8) : cap;
      if (EMBED[n.type]) { sections.push({ title: n.name, embed: EMBED[n.type], node: n.id, colour: t.colour }); if (!FACE[n.type]) continue; }
      let items = [];
      if (n.type === "audio-mixer") {
        const chans = [];
        for (let ch = 1; ch <= 4; ch++) {
          const cab = cables.find((c) => c.to.node === n.id && (c.to.jack === `in${ch}l` || c.to.jack === `in${ch}r`));
          if (!cab) continue;
          const src = nodes.find((q) => q.id === cab.from.node);
          chans.push({ type: "slider", label: (src ? src.name : "Ch " + ch).replace(/ Mixer$/, ""), wire: [{ param: `${n.id}.level${ch}` }] });
        }
        if (chans.length > 1) items = chans.concat({ type: "slider", label: "Master", wire: [{ param: `${n.id}.master` }] });
      } else {
        const named = faceOf(n).map((id) => t.params.find((p) => p.id === id)).filter(Boolean);
        const moved = t.params.filter((p) => !named.includes(p) && !p.id.startsWith("seed") && n.params && n.params[p.id] !== undefined && Math.abs(n.params[p.id] - p.default) > 1e-4);
        items = named.concat(moved).slice(0, capHere).map((p) => knobControl(n, p));
      }
      if (items.length) sections.push({ title: n.name, colour: t.colour, items });
    }
    if (isVoice) {
      const t = types["voice-cell"];
      const single = Math.round(((cell.params || {}).voices ?? 0) * 15 + 1) === 1;
      const items = (single ? ["mode", "glide"] : ["voices", "mode", "glide"]).map((id) => t.params.find((p) => p.id === id)).filter(Boolean).map((p) => knobControl(cell, p));
      sections.push({ title: "Voice", colour: "#94a3b8", items });
    }
    // Outputs: a meter for the sound.
    if (ctx.outs && ctx.outs.length) sections.push({ title: "Out", colour: "#94a3b8", items: [{ type: "meter", label: "Out", source: { out: ctx.outs[0] } }] });
    const outNode = ctx.outs ? null : nodes.find((n) => n.parent === cell.id && n.type === (isVoice ? "voice-out" : "cell-out"));
    const feeds = (jack) => outNode && cables.find((c) => c.to.node === outNode.id && c.to.jack === jack);
    const l = feeds("l"), r = feeds("r");
    if (l && !ctx.outs) sections.push({ title: "Out", colour: "#94a3b8", items: [{ type: "meter", label: "Out", source: { out: [`${l.from.node}.${l.from.jack}`].concat(r ? [`${r.from.node}.${r.from.jack}`] : []) } }] });

    // Layout: sections flow left to right, wrapping.
    for (const s of sections) {
      if (s.embed) { s.w = s.embed[0]; s.h = s.embed[1]; continue; }
      s.items.sort((a, b) => (b.type === "select") - (a.type === "select"));
      s.boxes = s.items.map((c) => ({ c, w: SIZE[c.type][0], h: SIZE[c.type][1] }));
      const inner = shelf(s.boxes, SECTION_MAX, 0);
      s.w = Math.max(inner.w, 6) + 2;
      s.h = inner.h + 4;
    }
    const flow = shelf(sections, sections.length > 8 ? 84 : 56, 1);
    const keysW = 42;
    const cols = Math.max(flow.w, isVoice ? keysW + 2 : 0, 18) + 2;
    const controls = [{ id: "c1", type: "label", at: [1, 0], size: [cols - 2, 2], text: cell.name, style: "title" }];
    const add = (c) => controls.push({ ...c, id: "c" + (controls.length + 1) });
    for (const s of sections) {
      const sx = 1 + s.x, sy = 3 + s.y;
      if (s.embed) { add({ type: "view", at: [sx, sy], size: [s.w, s.h], node: s.node }); continue; }
      add({ type: "section", at: [sx, sy], size: [s.w, s.h], text: s.title, colour: s.colour });
      for (const b of s.boxes) add({ ...b.c, at: [sx + 1 + b.x, sy + 2 + b.y], size: [b.w, b.h] });
    }
    let rows = 3 + flow.h + 1;
    if (isVoice) {
      add({ type: "keys", at: [Math.floor((cols - keysW) / 2), rows], size: [keysW, 7], octaves: 3, from: "C3", wire: [{ notes: "cell" }] });
      rows += 8;
    }
    return { name: cell.name, ...(cell.board ? {} : { cell: cell.id }), cols, rows, controls };
  }

  window.BleepPanelBuild = { build, knobControl, EMBED, FACE };
})();
