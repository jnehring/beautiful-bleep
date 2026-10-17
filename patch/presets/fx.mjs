// SPDX-License-Identifier: MIT
// Effects chains for the instrument categories: `withFx(voice, chain, extra)` wraps a Voice Cell preset in a plain cell,
// so Chorus, Phaser, Delay, Reverb … sit after the summed voices, the way Slate Stabs does by hand.
import { cell } from "./kit.mjs";

/// One effect of a chain: [module type, knobs in units, settings in units].
export const verb = (size, decay, mix, damping = 0.45, preDelay) => ["reverb", { size, decay, damping, mix, ...(preDelay !== undefined ? { preDelay } : {}) }];
/// A free-running delay: times in ms. `ping` swaps in ping-pong.
export const echo = (timeL, timeR, feedback, mix, highcut = 6000, lowcut = 120, ping = false) =>
  ["delay", { timel: timeL, timer: timeR, feedback, mix, highcut, lowcut, ...(ping ? { mode: "Ping-Pong" } : {}) }];
/// A tempo-synced delay (rate names as the module lists them, e.g. "1/8.").
export const synced = (ratel, rater, feedback, mix, highcut = 6000, lowcut = 120, ping = false) =>
  ["delay", { sync: "Tempo", ratel, rater, feedback, mix, highcut, lowcut, ...(ping ? { mode: "Ping-Pong" } : {}) }];
export const chorus = (rate, depth, mix, delay = 12, spread = 0.7) => ["chorus", { rate, depth, delay, spread, mix }];
export const flanger = (rate, depth, feedback, mix) => ["chorus", { mode: "Flanger", rate, depth, delay: 3, feedback, spread: 0.6, mix }];
export const phaser = (rate, depth, centre, feedback, stages, mix) => ["phaser", { rate, depth, centre, feedback, stages: String(stages), mix }];
export const tape = (drive, mix = 1, character = "Tape") => ["saturator", { drive, character, mix, sag: 0, age: 0 }];
/// Octave-up shimmer: a pitch shifter whose wet part goes on into the reverb after it.
export const shimmer = (mix = 0.25) => ["pitch-shifter", { pitch: 12, mix, window: 90, drift: 0.2 }];

/// `make`: a function returning a finished voice preset. `chain`: effects in series. `extra`:
///   { say: a sentence for the description, help: a paragraph for the help, tags: more tags }.
/// The result is a function returning the cell preset, under the voice's own name, with its jacks and help.
export function withFx(make, chain, extra = {}) {
  return () => {
    const v = make();
    const p = cell(v.name, {
      description: `${v.description} ${extra.say || ""}`.trim(),
      tags: [...v.tags, ...(extra.tags || [])],
      help: `${v.help.text}\n\n${extra.help || "The summed voices then pass through an effects chain."} Everything after the voices is inside the cell: open it to change the effects.`,
    }).input("notes", "Notes", "notes");
    const inner = p.embed(v, [0, 0], `${v.name} Voice`);
    for (const j of v.root.inputs) {
      if (j.id === "notes") continue;
      p.input(j.id, j.name, j.type);
      p.cable(p.cin, j.id, inner, j.id);
    }
    p.output("l", "Out L").output("r", "Out R");
    p.cable(p.cin, "notes", inner, "notes");
    let prev = inner;
    chain.forEach(([type, values], i) => {
      const fx = p.add(type, [i + 1, 0], values);
      p.stereo(prev, fx);
      prev = fx;
    });
    p.stereo(prev, p.cout);
    return p;
  };
}
