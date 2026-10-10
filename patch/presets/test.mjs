// SPDX-License-Identifier: MIT
// Test: presets for trying things out by hand in a host. Not musical examples.
import { cell, category } from "./kit.mjs";
import { melody } from "./demo-kit.mjs";

// A self-playing melody through Verb: checks the plugin plays, and lets you hear every Verb knob.
function liveTestVerb() {
  const p = cell("Live Test: Verb", {
    description: "A pentatonic melody that plays with the transport, through Verb (medium room). Move Size, Decay and Mix while it plays; Mix at 100 % leaves only the tail.",
    tags: ["test", "reverb"],
  }).stereoOut();
  const m = melody(p, [0, 0], [0, ".", 7, ".", 4, 9, ".", 2], { rate: "1/8", shape: 0.4, root: "C", scale: "Major Pentatonic",
    env: { attack: 0.005, decay: 0.3, sustain: 0.1, release: 0.3 } });
  const verb = p.add("reverb", [3, 0], { size: 0.6, decay: 3, preDelay: 0.02, diffusion: 0.8, damping: 0.45, mix: 0.5 });
  p.cable(m.amp, "l", verb, "l").cable(m.amp, "l", verb, "r").stereo(verb, p.cout);
  return p;
}

export default category("Test", "Presets for trying things out by hand in a host.", [liveTestVerb]);
