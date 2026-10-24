// SPDX-License-Identifier: GPL-3.0-only
// Scene Arranger: factory presets (play orders, follow actions, launch quantize, lanes).
export default [
  ["Four Scene Loop", { scenes: 4, steps: 4, length: "1 bar", quantize: "Bar" }, "Scenes 1 to 4, one bar each, round and round; manual launches wait for the bar line."],
  ["Verse and Chorus", { scenes: 4, steps: 6, length: "2 bars", slot1: 1, slot2: 2, slot3: 1, slot4: 2, slot5: 3, slot6: 4, rep1: 2, rep2: 2, rep3: 2, rep4: 2, rep5: 1, rep6: 1 }, "A song shape: two verse rounds, two chorus rounds, then a bridge and an outro."],
  ["Long Form", { scenes: 8, steps: 8, length: "4 bars", rep1: 2, rep3: 2, rep5: 2, rep7: 2 }, "Eight scenes of four bars, every odd one twice: a 48-bar arrangement."],
  ["Ping Pong", { scenes: 4, steps: 6, length: "1 bar", slot1: 1, slot2: 2, slot3: 3, slot4: 4, slot5: 3, slot6: 2 }, "Up through the scenes and back down without repeating the end scenes."],
  ["Random Walk", { scenes: 6, length: "1 bar", follow1: "Random", follow2: "Random", follow3: "Random", follow4: "Random", follow5: "Random", follow6: "Random" }, "Every scene hands over to a random other one; the seed makes the walk repeatable."],
  ["Drift Forward", { scenes: 8, length: "2 bars", follow1: "Next", follow2: "Next", follow3: "Next", follow4: "Next", follow5: "Next", follow6: "Next", follow7: "Next", follow8: "Next" }, "Follow action Next on every scene: the order list is ignored and the scenes simply step on."],
  ["Hold the Last", { scenes: 4, steps: 4, length: "2 bars", follow4: "Hold" }, "Plays 1, 2, 3 and settles on scene 4 until you launch something else."],
  ["Chance Breakdown", { scenes: 4, steps: 4, length: "1 bar", follow3: "Chance", jump3: 1, chance3: 0.35, rep3: 2 }, "After scene 3 there is a one in three chance of dropping back to scene 1 instead of moving on."],
  ["Stutter Back", { scenes: 4, steps: 4, length: "1 bar", follow2: "Jump", jump2: 1, follow4: "Chance", jump4: 3, chance4: 0.5 }, "Scene 2 always falls back to 1; scene 4 flips a coin between 3 and the start."],
  ["Beat Launcher", { scenes: 8, steps: 1, length: "16 bars", quantize: "Beat", follow1: "Hold" }, "Nothing moves on its own: launches from the knob, buttons or jack land on the next beat."],
  ["Bar Launcher", { scenes: 16, steps: 1, length: "16 bars", quantize: "Bar", follow1: "Hold", cvmode: "Slot of 16" }, "Sixteen scenes for a pattern selector, launched on the bar; the Queued gate shows what is waiting."],
  ["Immediate Switch", { scenes: 8, steps: 8, length: "1 beat", quantize: "Immediate" }, "Scenes change every beat and a launch cuts in at once: for fast, hands-on switching."],
  ["Phrase Lengths", { scenes: 4, steps: 4, length: "8 bars", rep2: 2, rep4: 2 }, "Eight-bar phrases, the second and fourth played twice."],
  ["Lane Groups", { scenes: 8, steps: 8, length: "1 bar", from1: 1, to1: 2, from2: 3, to2: 4, from3: 5, to3: 6, from4: 7, to4: 8, from5: 1, to5: 8, from6: 2, to6: 7, from7: 4, to7: 5, from8: 0 }, "Each lane covers a range of scenes: pairs, the whole run, the middle and the centre two."],
  ["Lane Triggers", { scenes: 8, steps: 8, length: "1 bar", laneout: "Trigger" }, "Lane outputs give a short trigger when their scene starts instead of holding a gate."],
  ["Linear Scene CV", { scenes: 8, steps: 8, length: "1 bar", cvmode: "Linear 0-1" }, "The Scene output climbs from 0 to 1 over scenes 1 to 16: a staircase for filters and pitch."],
  ["Odd Meter Bars", { scenes: 4, steps: 4, length: "2 bars", beats: 7, quantize: "Bar" }, "Seven beats to the bar: scene length and launches follow the odd bar."],
];
