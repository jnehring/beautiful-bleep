// SPDX-License-Identifier: GPL-3.0-only
// bleep/env: envelopes (times, levels, retrigger), followers, Slew, Lfo, Line/Ramp, Trigger/Schmitt, Clock.   node test/dsp/env.test.mjs
import { harness, check, finish, SR, rms, peak, finiteAll, spectrum } from "./lib.mjs";

const h = await harness("env"), e = h.exports;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const [ADSR, AD, AR, FOLLOW, SLEW, LFO, LINE, RAMP, TRIG, SCHMITT, CLOCK, ADSR_LIN, ADSR_HARD] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const SINE = 0, TRI = 1, SAW = 2, SQUARE = 3, SH = 4, SAW_DOWN = 5;
/// A gate that is on from sample `on` to sample `off`.
const gate = (n, on, off) => new Float32Array(n).map((_, i) => (i >= on && i < off ? 1 : 0));
const firstAbove = (a, v, from = 0) => { for (let i = from; i < a.length; i++) if (a[i] >= v) return i; return -1; };
const firstBelow = (a, v, from = 0) => { for (let i = from; i < a.length; i++) if (a[i] <= v) return i; return -1; };
const s = (sec) => Math.round(sec * SR);

// ---- Adsr, exponential ---------------------------------------------------------------------------------------------------------------------
{
  const A = 0.05, D = 0.1, S = 0.4, R = 0.2;
  const out = h.run(ADSR, [A, D, S, R], s(1.0), gate(s(1.0), s(0.1), s(0.6)));
  check(near(firstAbove(out, 0.9999), s(0.1) + s(A), 3), "Adsr: the attack reaches 1 in the attack time", `${firstAbove(out, 0.9999) - s(0.1)} samples vs ${s(A)}`);
  check(out[s(0.1) - 1] === 0, "Adsr: silent before the gate");
  check(near(out[s(0.55)], S, 0.002), "Adsr: holds the sustain level while the gate is on", out[s(0.55)].toFixed(4));
  // the curves aim a little past their end (0.0001) and stop on it, so the time they take is the time asked for
  const sustainAt = out.findIndex((v, i) => i > s(0.1) + s(A) + 5 && v === Math.fround(S));
  check(near(sustainAt, s(0.1) + s(A) + s(D), 3), "Adsr: the decay reaches the sustain in the decay time", `${sustainAt - s(0.1) - s(A)} vs ${s(D)}`);
  const end = out.findIndex((v, i) => i > s(0.6) && v === 0);
  check(near(end - s(0.6), s(R), 3), "Adsr: the release reaches 0 in the release time", `${end - s(0.6)} vs ${s(R)}`);
  check(out[s(0.6) + s(R / 4)] > 0.02 && out[s(0.6) + s(R / 4)] < S * 0.8, "Adsr: release is a curve from the sustain level");
  check(out.every((v) => v >= 0 && v <= 1.0000001), "Adsr stays within 0 to 1");
  const rise = out.slice(s(0.1), s(0.1) + s(A)); let mono = true; for (let i = 1; i < rise.length; i++) if (rise[i] < rise[i - 1]) mono = false;
  check(mono && rise[rise.length >> 1] > 0.5, "Adsr: the exponential attack is a rising curve that is fast at the start");
}
{
  // retrigger while releasing: continues from the current level
  const g = new Float32Array(s(0.5)); g.fill(1, 0, s(0.2)); g.fill(1, s(0.25), s(0.45));
  const soft = h.run(ADSR, [0.02, 0.05, 0.6, 0.5], s(0.5), g), hard = h.run(ADSR_HARD, [0.02, 0.05, 0.6, 0.5], s(0.5), g);
  check(Math.abs(soft[s(0.25) + 1] - soft[s(0.25) - 1]) < 0.01 && soft[s(0.25) + s(0.01)] > soft[s(0.25)], "Adsr: a retrigger during the release attacks from the current level (no jump)", `${soft[s(0.25) - 1].toFixed(3)} -> ${soft[s(0.25) + 1].toFixed(3)}`);
  check(hard[s(0.25) + 1] < 0.1, "Adsr hardRetrigger: starts again from 0", hard[s(0.25) + 1].toFixed(3));
  check(firstAbove(soft, 0.9999, s(0.25)) > 0 && firstAbove(soft, 0.9999, s(0.25)) <= s(0.25) + s(0.02) + 5, "Adsr: the retriggered attack ends at 1 within the attack time");
  // a gate shorter than the attack still releases from where it got to
  const brief = h.run(ADSR, [0.1, 0.1, 0.5, 0.1], s(0.5), gate(s(0.5), 0, s(0.02)));
  check(brief[s(0.02) - 1] < 0.8 && brief[s(0.02) + 5] < brief[s(0.02) - 1] && brief[s(0.45)] < 1e-3, "Adsr: a gate shorter than the attack releases from the point reached");
}
{
  const out = h.run(ADSR_LIN, [0.1, 0.2, 0.5, 0.3], s(1.5), gate(s(1.5), 0, s(0.8)));
  check(near(out[s(0.05)], 0.5, 0.002) && near(firstAbove(out, 0.99999), s(0.1), 2), "Adsr linear: the attack is a straight line", `${out[s(0.05)].toFixed(4)}`);
  check(near(out[s(0.2)], 0.75, 0.005) && near(out[s(0.5)], 0.5, 1e-6), "Adsr linear: straight decay to the sustain");
  check(near(out[s(0.8) + s(0.15)], 0.25, 0.005) && near(firstBelow(out, 0.0, s(0.8) + 1) - s(0.8), s(0.3), 3), "Adsr linear: straight release to 0 in the release time");
}
{
  const out = h.run(ADSR, [0, 0, 1, 0], 100, gate(100, 10, 50));
  check(finiteAll(out) && out[10] === 1 && out[50] === 0, "Adsr: zero times jump (no NaN, no hang)");
  const idle = h.run(ADSR, [0.01, 0.01, 0.5, 0.01], 2000, gate(2000, 0, 100));
  e.setup(ADSR, 0.01, 0.01, 0.5, 0.01, 0, 0); h.process(2000, gate(2000, 0, 100));
  check(e.stage() === 0 && idle[1999] === 0, "Adsr: goes idle after the release");
}

// ---- Ad, Ar -----------------------------------------------------------------------------------------------------------------------------------
{
  const trig = new Float32Array(s(0.6)); trig.fill(1, 1000, 1010);   // a 10-sample trigger
  const out = h.run(AD, [0.01, 0.1], s(0.6), trig);
  check(near(firstAbove(out, 0.9999) - 1000, s(0.01), 3), "Ad: rises in the attack time even though the trigger is short");
  const end = out.findIndex((v, i) => i > 1000 + s(0.01) + 5 && v === 0);
  check(near(end - 1000 - s(0.01), s(0.1), 4), "Ad: falls to 0 in the decay time", `${end - 1000 - s(0.01)} vs ${s(0.1)}`);
  const held = h.run(AD, [0.01, 0.1], s(0.6), gate(s(0.6), 1000, s(0.6)));
  check(held.every((v, i) => Math.abs(v - out[i]) < 1e-6), "Ad: holding the trigger on makes no difference");
  const twice = new Float32Array(s(0.6)); twice.fill(1, 1000, 1010); twice.fill(1, 9000, 9010);
  const o2 = h.run(AD, [0.01, 0.1], s(0.6), twice);
  check(o2[9010] > 0.01 && o2[9000 + s(0.01) + 2] > 0.99, "Ad: a second trigger plays it again");
}
{
  const out = h.run(AR, [0.02, 0.15], s(1), gate(s(1), 1000, s(0.5)));
  check(near(firstAbove(out, 0.9999) - 1000, s(0.02), 3) && near(out[s(0.4)], 1, 1e-6), "Ar: rises in the attack and holds at 1 while the gate is on");
  check(near(out.findIndex((v, i) => i > s(0.5) && v === 0) - s(0.5), s(0.15), 3), "Ar: falls to 0 in the release time");
}

// ---- EnvFollower -------------------------------------------------------------------------------------------------------------------------------------
{
  const step = new Float32Array(s(1)); step.fill(1, 0, s(0.5)); step.fill(-1, s(0.5), s(1));   // |x| = 1 throughout, then the release
  const a = h.run(FOLLOW, [0.01, 0.1], s(1), step);
  check(near(a[s(0.01) - 1], 1 - Math.exp(-1), 0.01), "EnvFollower: reaches 63 % of a step in the attack time", a[s(0.01) - 1].toFixed(4));
  const drop = new Float32Array(s(1)); drop.fill(1, 0, s(0.5));
  const r = h.run(FOLLOW, [0.001, 0.1], s(1), drop);
  check(near(r[s(0.5) + s(0.1)], Math.exp(-1), 0.01), "EnvFollower: falls to 37 % in the release time", r[s(0.5) + s(0.1)].toFixed(4));
  const sine = new Float32Array(s(1)).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 100 * i / SR));
  const f = h.run(FOLLOW, [0.002, 0.2], s(1), sine);
  check(near(f[s(1) - 1], 0.5, 0.06) && f[s(1) - 1] > 0.4, "EnvFollower: follows the peak of a sine", f[s(1) - 1].toFixed(3));
  const inst = h.run(FOLLOW, [0, 0], 10, new Float32Array(10).fill(0.7));
  check(near(inst[0], 0.7, 1e-6), "EnvFollower: zero times follow at once");
}

// ---- Slew ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const x = new Float32Array(s(0.4)); x.fill(1, 0, s(0.2));
  const out = h.run(SLEW, [10, 5], s(0.4), x);   // 10 units / second up, 5 down
  check(near(out[s(0.05)], 0.5, 0.002) && near(firstAbove(out, 1) / SR, 0.1, 0.001), "Slew: rises at `rise` units a second", `${out[s(0.05)].toFixed(4)}`);
  check(near(out[s(0.2) + s(0.05)], 1 - 0.25, 0.01) || near(out[s(0.2) + s(0.1)], 0.5, 0.01), "Slew: falls at `fall` units a second", `${out[s(0.2) + s(0.1)].toFixed(3)}`);
  const free = h.run(SLEW, [1e9, 1e9], 100, new Float32Array(100).fill(0.8));
  check(near(free[0], 0.8, 1e-6), "Slew: no limit passes the input through");
  const sine = new Float32Array(2000).map((_, i) => Math.sin(2 * Math.PI * 200 * i / SR));
  const lim = h.run(SLEW, [50, 50], 2000, sine);
  let maxStep = 0; for (let i = 1; i < lim.length; i++) maxStep = Math.max(maxStep, Math.abs(lim[i] - lim[i - 1]));
  check(maxStep <= 50 / SR + 1e-7, "Slew: never moves faster than the limit", maxStep.toExponential(2));
}

// ---- Lfo -----------------------------------------------------------------------------------------------------------------------------------------------
{
  const n = SR * 2;
  const cycles = (sig) => { let c = 0; for (let i = 1; i < sig.length; i++) if (sig[i - 1] < 0 && sig[i] >= 0) c++; return c; };
  for (const [shape, name] of [[SINE, "sine"], [TRI, "triangle"], [SAW, "saw"], [SQUARE, "square"], [SAW_DOWN, "saw down"]]) {
    const out = h.run(LFO, [5, shape, 0.5], n);
    check(near(cycles(out), 10, 1) && peak(out) <= 1.0001 && peak(out) > 0.99, `Lfo ${name}: 5 Hz, -1 to 1`, `${cycles(out)} cycles, peak ${peak(out).toFixed(4)}`);
  }
  const tri = h.run(LFO, [1, TRI, 0.5], SR), saw = h.run(LFO, [1, SAW, 0.5], SR), sq = h.run(LFO, [1, SQUARE, 0.25], SR), sine = h.run(LFO, [1, SINE, 0.5], SR);
  check(near(tri[SR / 4], 1, 0.001) && near(tri[SR / 2], 0, 0.001) && near(tri[3 * SR / 4], -1, 0.001), "Lfo triangle: up to 1 at a quarter, back through 0, down to -1");
  check(near(saw[SR / 2], 0, 0.001) && saw[SR - 100] > 0.99 && saw[10] < -0.99, "Lfo saw: rises from -1 to 1");
  check(sq.filter((v) => v > 0).length === SR / 4 || near(sq.filter((v) => v > 0).length, SR / 4, 2), "Lfo square: the width is the duty cycle");
  check(near(sine[SR / 4], 1, 1e-4) && near(sine[SR / 2], 0, 5e-4), "Lfo sine");
  const sh = h.run(LFO, [4, SH, 0.5], SR);
  const levels = new Set(sh); check(levels.size >= 3 && levels.size <= 6 && peak(sh) <= 1, "Lfo sample-and-hold: one random value per cycle", String(levels.size));
  const ph = h.run(LFO, [1, SINE, 0.5], 100);
  check(Math.abs(ph[0]) < 0.001, "Lfo: starts at its zero crossing");
  // sync restarts the cycle
  e.setup(LFO, 1, SAW, 0.5, 0, 0, 0); h.process(SR / 3);
  const before = h.process(1)[0];
  e.lfoSync();
  const after = h.process(1)[0];
  check(before > -0.5 && after < -0.99, "Lfo: sync() restarts the cycle", `${before.toFixed(3)} -> ${after.toFixed(3)}`);
  const slow = h.run(LFO, [0.01, SINE, 0.5], 1000);
  check(finiteAll(slow), "Lfo: very slow rates are fine");
}

// ---- Line, Ramp ------------------------------------------------------------------------------------------------------------------------------------------
{
  const out = h.run(LINE, [2, -1, 0.1], s(0.2));
  check(near(out[s(0.05) - 1], 0.5, 0.001) && near(out[s(0.1)], -1, 1e-6) && out[s(0.2) - 1] === -1, "Line: straight from 2 to -1 in 0.1 s, then holds", `${out[s(0.05) - 1].toFixed(4)}`);
  check(h.run(LINE, [0, 1, 0], 4)[0] === 1, "Line: zero time jumps to the end");
  const ramp = h.run(RAMP, [0.1], s(0.4), gate(s(0.4), 100, 200));
  check(ramp[50] === 1 && near(ramp[100 + s(0.05)], 0.5, 0.01) && ramp[100 + s(0.1) + 10] === 1 && ramp[110] < 0.01, "Ramp: a trigger starts a 0 to 1 ramp over the time, and it holds at 1", `${ramp[100 + s(0.05)].toFixed(3)}`);
}

// ---- Trigger, Schmitt ---------------------------------------------------------------------------------------------------------------------------------
{
  const x = Float32Array.from([0, 0.2, 0.6, 0.8, 0.9, 0.3, 0.1, 0.7, 0.4]);
  const t = h.run(TRIG, [], 9, x);
  check([...t].join() === "0,0,1,0,0,0,0,1,0", "Trigger: one pulse where the signal rises through 0.5", [...t].join());
  const sg = h.run(SCHMITT, [], 12, Float32Array.from([0, 0.5, 0.75, 0.6, 0.5, 0.35, 0.29, 0.5, 0.65, 0.71, 0.4, 0.2]));
  check([...sg].join() === "0,0,1,1,1,1,0,0,0,1,1,0", "Schmitt: switches on above 0.7 and off below 0.3, nothing in between", [...sg].join());
  e.setup(SCHMITT, 0, 0, 0, 0, 0, 0); h.process(2, Float32Array.of(0, 0.9));
  check(e.schRose() === 1, "Schmitt: rose is true in the sample it went high");
  const chatter = new Float32Array(2000).map((_, i) => 0.5 + 0.15 * Math.sin(i * 0.9) + (i > 1000 ? 0.4 : 0));
  const c = h.run(SCHMITT, [], 2000, chatter); let edges = 0; for (let i = 1; i < c.length; i++) if (c[i] !== c[i - 1]) edges++;
  check(edges <= 1, "Schmitt: a noisy signal inside the band does not chatter", String(edges));
}

// ---- Clock ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const ticks = (bpm, ratio, secs) => { const o = h.run(CLOCK, [bpm, ratio], s(secs)); return o.filter((v) => v >= 5).length; };
  check(ticks(120, 1, 10) === 20 || ticks(120, 1, 10) === 19, "Clock: 120 bpm at ratio 1 ticks twice a second", String(ticks(120, 1, 10)));
  check(near(ticks(90, 4, 10), 60, 1), "Clock: ratio 4 gives sixteenth notes (4 per beat)", String(ticks(90, 4, 10)));
  check(near(ticks(240, 0.25, 8), 8, 1), "Clock: ratio 0.25 is one cycle per bar of 4/4", String(ticks(240, 0.25, 8)));
  const out = h.run(CLOCK, [60, 1], s(2.5));
  const ph = [...out].map((v) => (v >= 5 ? v - 10 : v));
  check(ph.every((v) => v >= 0 && v < 1) && near(ph[s(0.5) - 1], 0.5, 1e-3), "Clock: the phase runs 0 to 1 once per cycle", ph[s(0.5) - 1].toFixed(4));
  e.setup(CLOCK, 100, 2, 0, 0, 0, 0);
  e.clockBeat(5.25);   // ratio 2: 10.5 cycles -> phase 0.5
  const first = h.process(1)[0];
  check(near(first, 0.5, 1e-3), "Clock: setBeat aligns the phase with the transport", first.toFixed(4));
  check(e.clockCount() === 0, "Clock: count starts at 0");
  h.process(SR * 3); check(e.clockCount() >= 9 && e.clockCount() <= 11, "Clock: counts the cycles", String(e.clockCount()));
}

// ---- real time ---------------------------------------------------------------------------------------------------------------------------------------
for (let id = 0; id <= 12; id++) {
  e.setup(id, 0.01, 1, 0.5, 0.1, 0, 0);
  const bytes = h.allocated(() => e.process(4096));
  check(bytes === 0, `env unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
void rms; void spectrum;
finish();
