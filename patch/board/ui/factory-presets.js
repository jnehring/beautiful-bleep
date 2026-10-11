// SPDX-License-Identifier: MIT
// Factory cell presets (spec §8.3.3), shown under Add → Cell next to the
// user's own. Params left out take their defaults.
(function () {
  "use strict";
  const n = (id, type, name, x, y, params, extra) =>
    Object.assign({ id, type, name, x, y, parent: "root", params: params || {} }, extra || {});
  const k = (fn, fj, tn, tj, amount) => ({ id: "k" + fn + fj + tn + tj, from: { node: fn, jack: fj },
                                          to: { node: tn, jack: tj }, amount: amount === undefined ? 1 : amount });

  // Basic Poly: Oscillator → Multi Filter (SVF Saturating) → VCA, an ADSR each for filter and VCA,
  // key tracking, and shared inputs Cutoff and Bend (±2 semitones).
  const basicPoly = {
    format: 1,
    root: "root",
    category: "Synthesizers",
    plays: { instrument: { notes: "voice" } },
    nodes: [
      { id: "root", type: "voice-cell", name: "Basic Poly", x: 0, y: 0, parent: "", params: {},
        inputs: [{ id: "cut", name: "Cutoff", type: "control" }, { id: "bend", name: "Bend", type: "control" }],
        outputs: [] },
      n("vi", "voice-in", "Voice In", 40, 60),
      n("ci", "cell-in", "Cell In", 40, 480),
      n("osc", "oscillator", "Oscillator", 320, 40),
      n("envf", "adsr", "Filter Env", 320, 300, { sustain: 0.3 }),
      n("flt", "filter", "Multi Filter", 620, 40, { cutoff: 0.42, resonance: 0.35, keytrack: 0.5, type: 1 }),  // type 1: the last type, SVF Saturating
      n("enva", "adsr", "Amp Env", 620, 320),
      n("amp", "vca", "VCA", 920, 60),
      n("vo", "voice-out", "Voice Out", 1200, 80),
      n("co", "cell-out", "Cell Out", 1200, 480),
    ],
    cables: [
      k("vi", "pitch", "osc", "pitch"),
      k("ci", "bend", "osc", "pitch", 2 / 12),
      k("osc", "out", "flt", "l"),
      k("vi", "pitch", "flt", "pitch"),
      k("envf", "env", "flt", "cutoff", 0.45),
      k("ci", "cut", "flt", "cutoff", 0.5),
      k("vi", "gate", "envf", "gate"),
      k("vi", "trigger", "envf", "retrig"),
      k("vi", "velocity", "envf", "velocity"),
      k("vi", "gate", "enva", "gate"),
      k("vi", "trigger", "enva", "retrig"),
      k("vi", "velocity", "enva", "velocity"),
      k("flt", "l", "amp", "l"),
      k("flt", "r", "amp", "r"),
      k("enva", "env", "amp", "gain"),
      k("amp", "l", "vo", "l"),
      k("amp", "r", "vo", "r"),
      k("enva", "active", "vo", "active"),
    ],
  };

  // Drum machines: a Drum Grid plays one kit's voices (gate → trigger, velocity → velocity per track),
  // one Audio Mixer takes the drums, one the toms and perc, a third mixes both to the cell's Out L/R. Clock and Run go to the grid.
  // Params are normalised: Hz on a log scale, pan 0.5 = centre, toggles 0/1.
  const drumGrid = (perc, patterns) => ({
    tracks: ["Kick", "Snare", "Closed Hat", "Open Hat", "Clap", "Low Tom", "High Tom", perc]
      .map((name) => ({ name, mute: false, solo: false })),
    current: 0,
    patterns: patterns.concat(new Array(16 - patterns.length).fill(null)),
  });
  const pattern = (name, steps) => ({ name, length: 16, steps });

  function drumMachine(name, kit, perc, settings, patterns) {
    const t = kit.toLowerCase(), s = settings;
    const voices = [  // id, type, name, params, the grid tracks that play it, mixer, channel
      ["kick", t + "-kick", kit + " Kick", s.kick, [1], "mixA", 1],
      ["snare", t + "-snare", kit + " Snare", s.snare, [2], "mixA", 2],
      ["hats", t + "-hats", kit + " Hats", s.hats, [3, 4], "mixA", 3],  // Closed Hat, Open Hat
      ["clap", t + "-clap", kit + " Clap", s.clap, [5], "mixA", 4],
      ["tomlo", t + "-tom", "Low Tom", s.tomLo, [6], "mixB", 1],
      ["tomhi", t + "-tom", "High Tom", s.tomHi, [7], "mixB", 2],
      ["perc", t + "-" + perc.toLowerCase(), kit + " " + perc, s.perc, [8], "mixB", 3],
    ];
    const nodes = [
      { id: "root", type: "cell", name, x: 0, y: 0, parent: "", params: {},
        inputs: [{ id: "clock", name: "Clock", type: "trigger" }, { id: "run", name: "Run", type: "gate" }],
        outputs: [{ id: "l", name: "Out L", type: "audio" }, { id: "r", name: "Out R", type: "audio" }] },
      n("ci", "cell-in", "Cell In", 40, 60),
      n("grid", "drum-grid", "Drum Grid", 300, 60, {}, { data: drumGrid(perc, patterns) }),
      n("mixA", "audio-mixer", "Drums Mixer", 1000, 60, Object.assign({ limiter: 0 }, s.mixA)),
      n("mixB", "audio-mixer", "Toms & Perc Mixer", 1000, 560, Object.assign({ limiter: 0 }, s.mixB)),
      n("master", "audio-mixer", "Master", 1340, 260),
      n("co", "cell-out", "Cell Out", 1660, 300),
    ];
    const cables = [k("ci", "clock", "grid", "clock"), k("ci", "run", "grid", "run")];  // unpatched: the transport drives the grid
    voices.forEach(([id, type, vname, params, tracks, mix, ch], i) => {
      nodes.push(n(id, type, vname, 660, 40 + i * 130, params));
      if (tracks.length === 2) cables.push(k("grid", "gate" + tracks[0], id, "closed"), k("grid", "gate" + tracks[1], id, "open"));
      else cables.push(k("grid", "gate" + tracks[0], id, "trig"));
      cables.push(k("grid", "velocity" + tracks[0], id, "velocity"), k(id, "out", mix, "in" + ch + "l"));  // mono in: L feeds both
    });
    cables.push(
      k("mixA", "outl", "master", "in1l"), k("mixA", "outr", "master", "in1r"),
      k("mixB", "outl", "master", "in2l"), k("mixB", "outr", "master", "in2r"),
      k("master", "outl", "co", "l"), k("master", "outr", "co", "r"));
    return { format: 1, root: "root", category: "Drum Machines", plays: { instrument: { notes: {} } }, nodes, cables };
  }

  // Punch Machine: the Punch kit with a rim shot on Perc; a four-on-the-floor and a broken beat.
  const punchMachine = drumMachine("Punch Machine", "Punch", "Rim", {
    tomLo: { tune: 0.255 }, tomHi: { tune: 0.556 },  // 90 Hz and 180 Hz
    mixA: { pan3: 0.62, pan4: 0.45 },
    mixB: { pan1: 0.35, pan2: 0.65, pan3: 0.58 },
  }, [
    pattern("Punch Four", ["X...x...X...x...", "....X.......X...", "x...x...x...x...", "..x...x...x...x.",
                           "....x.......x..x", "", "", "...x.....x......"]),
    pattern("Punch Break", ["X..x..x...X..x..", "....X..x....X...", "x.xxx...x.xxx...", "......x.......x.",
                            "", "...........x.x..", "..........x.....", "..x.....x..x...."]),
  ]);

  // Ring Machine: the Ring kit with a cowbell on Perc; a laid-back groove and a tom beat.
  const ringMachine = drumMachine("Ring Machine", "Ring", "Cowbell", {
    tomLo: { tune: 0.279 }, tomHi: { tune: 0.558 },  // 100 Hz and 200 Hz
    mixA: { pan3: 0.62, pan4: 0.45 },
    mixB: { pan1: 0.35, pan2: 0.65, pan3: 0.58 },
  }, [
    pattern("Ring Groove", ["X......x..X.....", "....X.......X...", "x.x.x.x.x.x.x...", "..............x.",
                            "", "", "", "......x.....x..."]),
    pattern("Ring Toms", ["X.....x...X.....", "....X.......X..x", "x.x.x.x.x.x.x.x.", "",
                          "............x...", "x.....x.......x.", "...x.....x..x...", "..x.......x....."]),
  ]);

  // Each preset's help (the "?" on its cell): plain text, paragraphs separated by a blank line (see presets/kit.mjs normaliseHelp).
  const withHelp = (preset, text) => Object.assign(preset, { help: { text } });

  window.BleepFactoryPresets = [
    { name: "Basic Poly", category: "Synthesizers", preset: withHelp(basicPoly,
      "The starter synth: one Oscillator into a Multi Filter (SVF Saturating) and a VCA, with an ADSR for the filter and one for the " +
      "amplitude, and the filter following the keyboard by half.\n\n" +
      "Patch Notes into the cell and take Out L/R. Its two shared inputs are Cutoff (a modulation source into the filter cutoff) and " +
      "Bend (a pitch source, scaled to plus or minus two semitones).\n\n" +
      "Open the cell and change the oscillator or the filter type to make it your own, then save it with Save as preset.") },
    { name: "Punch Machine", category: "Drum Machines", preset: withHelp(punchMachine,
      "A complete drum machine that plays by itself: a Drum Grid with eight tracks (Kick, Snare, Closed Hat, Open Hat, Clap, two Toms and " +
      "a Rim shot) drives the Punch drum modules, which are mixed and panned into Out L/R. It comes with two patterns, Punch Four " +
      "(four on the floor) and Punch Break (a broken beat).\n\n" +
      "Press play in your host or the app: the grid follows the transport. To use another clock or start and stop it by hand, patch " +
      "a trigger into Clock and a gate into Run. Take Out L/R to an Audio Out.\n\n" +
      "Open the Drum Grid to switch patterns or draw your own steps, and open the mixers to rebalance the kit.") },
    { name: "Ring Machine", category: "Drum Machines", preset: withHelp(ringMachine,
      "A complete drum machine that plays by itself, like Punch Machine but built from the Ring drum modules, with a cowbell on the last " +
      "track. A Drum Grid sends gates and velocities to the voices, three mixers balance and pan them, and the sum goes to Out L/R. " +
      "Its patterns are Ring Groove (laid back) and Ring Toms (a tom beat).\n\n" +
      "It follows the transport. Patch a trigger into Clock and a gate into Run if you want to drive it yourself, and take Out L/R " +
      "to an Audio Out.\n\n" +
      "Open the Drum Grid to edit the patterns, or mute and solo single tracks to play the kit in parts.") },
  ];
})();
