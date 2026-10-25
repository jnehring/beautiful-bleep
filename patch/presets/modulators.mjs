// SPDX-License-Identifier: MIT
// Modulators: cells of control, gate and trigger outputs to move things on the board.
import { cell, category } from "./kit.mjs";

// Six Slopes looping over one bar with the rates spread over the overtone series.
function overtoneSlopes() {
  const p = cell("Overtone Slopes", {
    description: "Six looping slopes locked to the bar whose speeds are spread over the overtone series (1, 2, 3, 4 ... times the bar), plus their sum: polyrhythmic movement for filters, pans and levels. Shared inputs Harmonics and Skew.",
    tags: ["slopes", "polyrhythm", "tempo", "overtone", "multi-lfo"],
    help: "A Six Slopes module in Loop mode, synced to one bar. Harmonics spreads the six rates over the overtone " +
      "series, so slope 2 runs twice as fast as slope 1, slope 3 three times, and so on; all of them realign on the " +
      "downbeat. Skew is the position of each slope's peak. Sum adds all six together.\n\n" +
      "There is no audio. Patch Slope 1 to 6 into any knobs, for example cutoffs of different filters, or Sum into " +
      "one parameter for a complex rhythmic pulse. Harmonics is added to the Harmonics knob: pull it down to " +
      "spread the rates over the undertones (slower and slower) instead. Skew is added to the Skew knob. It " +
      "follows the transport.\n\n" +
      "Tip: send the slowest slopes to cutoff and the fastest to pan for movement at two timescales.",
  }).input("harm", "Harmonics").input("skew", "Skew")
    .output("s1", "Slope 1", "control").output("s2", "Slope 2", "control").output("s3", "Slope 3", "control")
    .output("s4", "Slope 4", "control").output("s5", "Slope 5", "control").output("s6", "Slope 6", "control")
    .output("sum", "Sum", "control");
  const s = p.add("six-slopes", [0, 0], { mode: "Loop", sync: "1/1", harmonics: 0.6, skew: 0.25, curve: 0.2, level: 1 });
  p.cable(p.cin, "harm", s, "harmonics", 0.5).cable(p.cin, "skew", s, "skew", 0.4);
  for (let i = 1; i <= 6; i++) p.cable(s, `out${i}`, p.cout, `s${i}`);
  p.cable(s, "sum", p.cout, "sum");
  return p;
}

// Quad LFO in quadrature: one sine, four phases, a full circle.
function quadratureOrbit() {
  const p = cell("Quadrature Orbit", {
    description: "One slow sine in four phases, 0, 90, 180 and 270 degrees apart: patch them into pans, cutoffs or detunes to make things orbit around each other. Shared inputs Rate and Reset.",
    tags: ["lfo", "quadrature", "phase", "orbit", "stereo"],
    help: "A Quad LFO in Quadrature mode. All four LFOs are sines running at the same rate, a quarter of a cycle " +
      "apart, so when one is at its top the next is halfway between its top and bottom. The default rate is " +
      "one cycle in about eight seconds.\n\n" +
      "There is no audio. Patch the four outputs into knobs: 0 and 180 into the pans of two oscillators for " +
      "circular stereo movement, or 0 and 90 as X and Y of anything that wants a circle. The Rate input is " +
      "added to the Rate knob, and a trigger into Reset restarts the cycle together on all four. It does not " +
      "follow the transport.\n\n" +
      "Tip: put 0 on a filter cutoff and 90 on a resonance for a swirling, never-repeating sweep.",
  }).input("rate", "Rate").input("rst", "Reset", "trigger")
    .output("p0", "0°", "control").output("p90", "90°", "control").output("p180", "180°", "control").output("p270", "270°", "control");
  const q = p.add("quad-lfo", [0, 0], { mode: "Quadrature", rate1: 0.125, spread: 90, wave2: "Sine", sync: false });
  p.cable(p.cin, "rate", q, "rate1", 0.3).cable(p.cin, "rst", q, "reset")
    .cable(q, "out1", p.cout, "p0").cable(q, "out2", p.cout, "p90").cable(q, "out3", p.cout, "p180").cable(q, "out4", p.cout, "p270");
  return p;
}

// A looping swell on every beat, scaled between a floor and unity, for pumping levels.
function pumpDuck() {
  const p = cell("Pump Duck", {
    description: "Sidechain-style ducking without a sidechain: a rising swell restarts on every quarter note, scaled so the level dips and recovers like a pumping compressor. Patch Duck into a VCA's gain or a mixer. Shared input Depth.",
    tags: ["pump", "ducking", "sidechain", "tempo", "dance"],
    help: "A Contour in Loop mode, synced to quarter notes, plays a logarithmic swell on every beat: it starts at " +
      "zero and rises quickly. A Utility scales it so that it never goes lower than a floor of about 20 percent. " +
      "At full height it is exactly one, so it can multiply a signal without changing its loudness.\n\n" +
      "There is no audio. Patch Duck into the Gain of a VCA after a pad, or into a mixer level, to make it pump " +
      "with the beat. Beat is a trigger once per quarter note, and Ramp rises from 0 to 1 over each beat. The " +
      "Depth input is added to the dip: more means a deeper duck, up to full silence on the beat. It follows " +
      "the transport.\n\n" +
      "Tip: patch Duck into a pad and Ramp into a filter cutoff for a pumping that also opens the sound.",
  }).input("depth", "Depth")
    .output("duck", "Duck", "control").output("ramp", "Ramp", "control").output("beat", "Beat", "trigger");
  const env = p.add("shape-env", [0, 0], { shape: "Log swell", mode: "Loop", sync: "1/4" }, { name: "Beat Swell" });
  const sc = p.add("utility", [1, 0], { scalex: 0.8, offset: 0.2 }, { name: "Floor" });
  p.cable(env, "out", sc, "x").cable(p.cin, "depth", sc, "scalex", 0.1).cable(p.cin, "depth", sc, "offset", -0.1)
    .cable(sc, "out", p.cout, "duck").cable(env, "phase", p.cout, "ramp").cable(env, "end", p.cout, "beat");
  return p;
}

// A chart recorder: draw a movement once, get it back looping over four bars.
function gestureTape() {
  const p = cell("Gesture Tape", {
    description: "Records any control movement while Record is held and replays it as a four-bar loop, in sync with the song, at any speed or backwards. Patch a Dial or XY Pad into In and a Button into Record.",
    tags: ["recorder", "loop", "gesture", "performance", "tempo"],
    help: "A Chart Recorder with a paper strip four bars long that follows the transport. While a gate is high on " +
      "Record, the pen draws what is on In onto the strip; when it goes low, the strip keeps replaying what is on " +
      "it as a loop, smoothly interpolated. Pen is the live value of the pen, Replay is the stored movement, and " +
      "Marker is a trigger at the start of every pass.\n\n" +
      "There is no audio. Patch a Dial or an XY Pad into In, a Button into Record, and Replay into whatever you " +
      "want to move. The Speed input is added to the replay speed: up speeds the loop up, and down slows it, " +
      "stops it or plays it backwards. It follows the transport.\n\n" +
      "Tip: record a filter sweep during the first pass, then change other things by hand while it keeps going.",
  }).input("in", "In").input("rec", "Record", "gate").input("speed", "Speed")
    .output("replay", "Replay", "control").output("pen", "Pen", "control").output("marker", "Marker", "trigger");
  const cr = p.add("chart-recorder", [0, 0], { paper: "Transport", lengthbars: "4 bars", record: "Gate", replaysync: "Song",
                                                interp: "Smooth", response: 0.03, damping: 0.6 });
  p.cable(p.cin, "in", cr, "in").cable(p.cin, "rec", cr, "record").cable(p.cin, "speed", cr, "replayspeed", 0.25)
    .cable(cr, "replay", p.cout, "replay").cable(cr, "pen", p.cout, "pen").cable(cr, "marker", p.cout, "marker");
  return p;
}

// A pulse generator that fires a burst of pulses for every trigger: ratchets and flams.
function burstMaker() {
  const p = cell("Burst Maker", {
    description: "Turns every trigger into a burst of four evenly spaced pulses: patch a clock or a drum trigger into Trigger and the Gate into an envelope for ratchets, flams and rolls. Shared inputs Trigger and Spacing.",
    tags: ["ratchet", "burst", "pulses", "gates", "drums"],
    help: "A Pulse Generator in Triggered mode with burst count four: each trigger starts a short train of four " +
      "exact pulses, 50 milliseconds apart, each 15 milliseconds wide. Gate carries the pulses as gates; Sync is " +
      "a trigger at the start of each pulse, which is better for drum voices that only need a trigger.\n\n" +
      "There is no audio. Patch a clock, a sequencer trigger or a button into Trigger, and Gate or Sync into " +
      "an envelope or drum voice. The Spacing input is added to the pulse period: more means a slower " +
      "roll, less a faster buzz that becomes a flam when it is short enough. It does not follow the tempo.\n\n" +
      "Tip: put the burst on snare hits only, and leave kicks and hats alone, for a drum roll that never gets muddy.",
  }).input("trig", "Trigger", "trigger").input("space", "Spacing")
    .output("gate", "Gate", "gate").output("sync", "Pulse", "trigger");
  const pg = p.add("pulse-generator", [0, 0], { mode: "Triggered", period: 0.05, width: 0.015, burst: 4, amplitude: 1, jitter: 0.03 });
  p.cable(p.cin, "trig", pg, "trigger").cable(p.cin, "space", pg, "period", 0.3)
    .cable(pg, "gate", p.cout, "gate").cable(pg, "sync", p.cout, "sync");
  return p;
}

// Rotating divider on the Fibonacci set: 1, 2, 3, 5, 8, 13 sixteenths.
function fibonacciGates() {
  const p = cell("Fibonacci Gates", {
    description: "Six gates that fire every 1, 2, 3, 5, 8 and 13 steps of a sixteenth-note clock, and a Rotate input that moves the whole set up the series: a lopsided but musical set of rhythms. Shared inputs Rotate and Reset.",
    tags: ["clock", "divider", "fibonacci", "polyrhythm", "gates"],
    help: "A Rotating Divider on the Fibonacci set, with a base of sixteenth notes, outputs gates every 1, 2, 3, 5, 8 " +
      "and 13 steps. Because these numbers have no common rhythm, the combined result drifts through the bar " +
      "and only all realigns after many bars; Align is a trigger when it does. Stair is a staircase signal that rises one " +
      "step for every rotation.\n\n" +
      "There is no audio. Patch the six gates into drum voices, envelopes or sequencer clocks. The Rotate " +
      "input is added to the Rotate knob, changing the divisions assigned to each output at the next bar: higher " +
      "values give slower outputs. A trigger into Reset restarts all of them. It follows the transport unless " +
      "you patch Clock.\n\n" +
      "Tip: put 1 and 2 on a hat, 3 on a clap, 5 on a kick and 8 and 13 on accents.",
  }).input("rot", "Rotate").input("rst", "Reset", "trigger")
    .output("g1", "÷1", "gate").output("g2", "÷2", "gate").output("g3", "÷3", "gate").output("g5", "÷5", "gate")
    .output("g8", "÷8", "gate").output("g13", "÷13", "gate").output("align", "Align", "trigger").output("stair", "Stair", "control");
  const rd = p.add("rotating-divider", [0, 0], { set: "Fibonacci", base: "1/16", output: "Gate", sync: "Next Bar", width: 0.5 });
  p.cable(p.cin, "rot", rd, "rotate", 0.5).cable(p.cin, "rst", rd, "reset");
  ["g1", "g2", "g3", "g5", "g8", "g13"].forEach((id, i) => p.cable(rd, `out${i + 1}`, p.cout, id));
  p.cable(rd, "align", p.cout, "align").cable(rd, "stair", p.cout, "stair");
  return p;
}

// Logic: three gates in, every combination out.
function gateAlchemy() {
  const p = cell("Gate Alchemy", {
    description: "Combines up to three gates with AND, OR and XOR, halves the first one with a flip-flop and gives a trigger for each change: new rhythms from rhythms you already have. Shared inputs Gate A, Gate B and Gate C.",
    tags: ["logic", "gates", "rhythm", "divider", "utility"],
    help: "A Logic module with three gate inputs. And is high only when A, B and C are all high; Or when any is; Xor " +
      "when an odd number of them are. Half is a flip-flop that changes state on every rising edge of A, so " +
      "it is A divided by two. Change is a trigger on every rising or falling edge of the combined " +
      "result.\n\n" +
      "There is no audio. Patch gates from drum voices, clocks or sequencers into the three inputs (an unpatched " +
      "input is low), and the outputs into envelopes or drum voices. It does not have a clock of its own, so " +
      "it follows whatever you patch in.\n\n" +
      "Tip: Xor of a kick and a hat pattern gives a rhythm that plays where only one of them does.",
  }).input("a", "Gate A", "gate").input("b", "Gate B", "gate").input("c", "Gate C", "gate")
    .output("and", "And", "gate").output("or", "Or", "gate").output("xor", "Xor", "gate")
    .output("half", "Half", "gate").output("change", "Change", "trigger");
  const lg = p.add("logic", [0, 0], { flipsource: "A Rising Edge" });
  p.cable(p.cin, "a", lg, "a").cable(p.cin, "b", lg, "b").cable(p.cin, "c", lg, "c")
    .cable(lg, "and", p.cout, "and").cable(lg, "or", p.cout, "or").cable(lg, "xor", p.cout, "xor")
    .cable(lg, "ff", p.cout, "half").cable(lg, "change", p.cout, "change");
  return p;
}

// A long triggered ramp with three markers, for builds and risers.
function riserRamp() {
  const p = cell("Riser Ramp", {
    description: "Each trigger starts an eight-bar logarithmic ramp with three marker triggers on the way: automate a build-up by patching Sweep into a cutoff or a send. Shared inputs Trigger and Hold.",
    tags: ["riser", "build-up", "ramp", "tempo", "sweep"],
    help: "A Sweep Generator in Triggered mode glides from its start to its stop frequency over eight bars, on a " +
      "logarithmic law, so the first bars move fast and the last move slowly like a rising pitch. Sweep is the " +
      "ramp from 0 to 1, Pitch is the sweeping frequency as pitch, and three Markers fire as it passes 250 Hz, " +
      "1 kHz and 4 kHz. End is a trigger at the top.\n\n" +
      "There is no audio. Patch a trigger or a Button into Trigger to start a build, Sweep into a filter " +
      "cutoff, a reverb mix or a drum level, and Marker into a drum voice or a sequencer's Reset for fills along " +
      "the way. A gate into Hold freezes the sweep where it is. It follows the transport.\n\n" +
      "Tip: Pitch into an oscillator makes a rising siren, matching the filter sweep.",
  }).input("trig", "Trigger", "trigger").input("hold", "Hold", "gate")
    .output("sweep", "Sweep", "control").output("pitch", "Pitch", "pitch").output("marker", "Marker", "trigger")
    .output("end", "End", "trigger");
  const sw = p.add("sweep-generator", [0, 0], { mode: "Triggered", sweepsync: "8 bars", law: "Log", direction: "Up", retrace: "Instant",
                                                start: 100, stop: 8000, markers: 3, marker1: 250, marker2: 1000, marker3: 4000,
                                                warmup: "Off", drift: 0, level: 0.1 });
  p.cable(p.cin, "trig", sw, "trigger").cable(p.cin, "hold", sw, "hold")
    .cable(sw, "sweep", p.cout, "sweep").cable(sw, "freq", p.cout, "pitch").cable(sw, "marker", p.cout, "marker")
    .cable(sw, "end", p.cout, "end");
  return p;
}

// Controllers in one cell: an XY pad, a dial and a button for performing.
function macroPad() {
  const p = cell("Macro Pad", {
    description: "A small performance surface for the board: an XY pad, a big dial and a button, each smoothed so moves never click. Patch the outputs into any knobs, and play the pad from the cell's front panel.",
    tags: ["controller", "performance", "xy pad", "manual", "macro"],
    help: "Three controllers in one cell: an XY Pad, a Dial and a Button. The pad and the dial are smoothed so that " +
      "even fast moves do not click. The button gives a gate while it is held and a trigger when it is pressed.\n\n" +
      "There is no audio and no inputs. Patch X and Y into two parameters, such as a cutoff and a reverb mix, " +
      "Macro into a third parameter such as a level, Hold into a gate input of an envelope, and Press into a " +
      "trigger input. Everything is played by hand on the front panel of the cell, or by automating the " +
      "knobs from the host.\n\n" +
      "Tip: use X and Y on two related parameters (cutoff and resonance) so one gesture moves both.",
  }).output("x", "X", "control").output("y", "Y", "control").output("macro", "Macro", "control")
    .output("hold", "Hold", "gate").output("press", "Press", "trigger");
  const xy = p.add("xy-pad", [0, 0], { x: 0.5, y: 0.5, smooth: 0.12 }, { name: "Pad" });
  const dial = p.add("dial", [0, 1], { value: 0.5, smooth: 0.1 }, { name: "Macro Dial" });
  const btn = p.add("button", [0, 2], {}, { name: "Button" });
  p.cable(xy, "x", p.cout, "x").cable(xy, "y", p.cout, "y").cable(dial, "out", p.cout, "macro")
    .cable(btn, "gate", p.cout, "hold").cable(btn, "trigger", p.cout, "press");
  return p;
}

// An envelope follower that turns the level of any audio into modulation and gates.
function loudnessTracker() {
  const p = cell("Loudness Tracker", {
    description: "Follows the loudness of any audio you patch into In and turns it into a smooth level, an inverted level and a gate and trigger when it is loud enough: let a drum loop move a filter or duck a pad. Shared inputs In and Threshold.",
    tags: ["follower", "envelope", "sidechain", "audio to cv", "dynamics"],
    help: "An Envelope Follower with a fast attack and a medium release. Level rises with the loudness of the audio on " +
      "In; Inverted is the mirror image, which is what you want for ducking: patch it into the Gain of a VCA " +
      "after the signal you want to duck. Gate is high while the signal is above the threshold and Trigger " +
      "fires each time it crosses upwards.\n\n" +
      "Patch audio into In (a drum bus, a bass, a vocal). It passes nothing on; it only listens. Threshold is " +
      "added to the threshold knob of the gate: higher means that only louder hits count. The release time " +
      "sets how smoothly the level falls. It does not need the transport.\n\n" +
      "Tip: kick drum in, Inverted on a pad's VCA gain: a real sidechain duck that follows the actual kick.",
  }).input("in", "In", "audio").input("thr", "Threshold")
    .output("level", "Level", "control").output("inv", "Inverted", "control").output("gate", "Gate", "gate").output("trig", "Trigger", "trigger");
  const ef = p.add("envelope-follower", [0, 0], { attack: 0.005, release: 0.18, gain: 2, threshold: 0.3, detector: "Peak" });
  p.cable(p.cin, "in", ef, "in").cable(p.cin, "thr", ef, "threshold", 0.5)
    .cable(ef, "env", p.cout, "level").cable(ef, "inverted", p.cout, "inv").cable(ef, "gate", p.cout, "gate")
    .cable(ef, "trigger", p.cout, "trig");
  return p;
}

export default category("Modulators", "Control, gate and trigger sources for everything else on the board: LFOs, randomness, envelopes and rhythms.", [
  overtoneSlopes, quadratureOrbit, pumpDuck, gestureTape, burstMaker, fibonacciGates, gateAlchemy, riserRamp,
  macroPad, loudnessTracker,
]);
