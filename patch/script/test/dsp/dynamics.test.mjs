// SPDX-License-Identifier: GPL-3.0-or-later
// bleep/dynamics: compressor curve and ballistics, limiter ceiling, gate hysteresis, shapers, bitcrush, oversampling.   node test/dsp/dynamics.test.mjs
import { harness, check, finish, SR, rms, peak, finiteAll, spectrum, db, noise, responseAt } from "./lib.mjs";

const h = await harness("dynamics"), e = h.exports;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const [COMP, KEYED, LIM, GATE, SOFT, HARD, FOLD, ASYM, CHEB, CRUSH, DEC, OS2, OS4, OS2_CLIP, OS4_CLIP, COMP_FAST] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const lin = (d) => 10 ** (d / 20), toDb = (x) => 20 * Math.log10(x);
const constant = (v, n) => new Float32Array(n).fill(v);
const sine = (f, amp, n) => new Float32Array(n).map((_, i) => amp * Math.sin(2 * Math.PI * f * i / SR));
const run1 = (id, params, x) => h.run(id, params, x.length, x);

// ---- Compressor: the static curve --------------------------------------------------------------------------------------------------------------------
{
  const settle = (inDb, params) => { const o = run1(COMP, params, constant(lin(inDb), 48000)); return toDb(o[47999]); };
  check(near(settle(-6.02, [-20, 4, 0, 0]), -16.5, 0.05), "Compressor: above the threshold the level rises 1 dB per `ratio` dB", settle(-6.02, [-20, 4, 0, 0]).toFixed(2));
  check(near(settle(-30, [-20, 4, 0, 0]), -30, 0.05), "Compressor: below the threshold nothing changes", settle(-30, [-20, 4, 0, 0]).toFixed(2));
  check(near(settle(-6.02, [-20, 1, 0, 0]), -6.02, 0.05), "Compressor: ratio 1 does nothing");
  check(near(settle(-6.02, [-20, 100, 0, 0]), -20 + 13.98 / 100, 0.1), "Compressor: ratio 100 is a limiter");
  check(near(settle(-20, [-20, 4, 10, 0]), -20.9375, 0.06), "Compressor: soft knee at the threshold bends the curve (formula: -0.94 dB)", settle(-20, [-20, 4, 10, 0]).toFixed(3));
  check(near(settle(-26, [-20, 4, 10, 0]), -26, 0.05) && near(settle(-14, [-20, 4, 10, 0]), -20 + 6 / 4, 0.05), "Compressor: the knee ends where it should (5 dB either side)");
  check(near(settle(-6.02, [-20, 4, 0, 6]), -10.5, 0.05), "Compressor: makeup gain", settle(-6.02, [-20, 4, 0, 6]).toFixed(2));
  // continuity of the curve over a sweep of levels
  let worst = 0, last = null;
  for (let l = -60; l <= 0; l += 0.25) { e.setup(COMP, -20, 4, 8, 0, 0, 0); const y = l + e.curve(l); if (last !== null) worst = Math.max(worst, Math.abs(y - last - 0.25)); last = y; }
  check(worst <= 0.25 + 1e-4, "Compressor: the curve never rises faster than 1 dB per dB, and is continuous", worst.toFixed(4));
}
// ---- Compressor: ballistics -------------------------------------------------------------------------------------------------------------------------------
{
  // an input that steps from -40 dB to -10 dB (threshold -30, ratio 100: ends at ~ -30 dB, i.e. 20 dB of reduction)
  const x = new Float32Array(48000); x.fill(lin(-40), 0, 12000); x.fill(lin(-10), 12000);
  const o = h.run(COMP_FAST, [-30, 100, 0, 0.01], 48000, x);
  const gr = (i) => toDb(o[i]) - toDb(x[i]);
  // the reduction follows 63 % of its way after the attack time (10 ms = 480 samples)
  check(near(gr(12000 + 480) / gr(47999), 0.63, 0.06), "Compressor: reaches about 63 % of the reduction in the attack time", (gr(12000 + 480) / gr(47999)).toFixed(3));
  check(gr(12000) > -1, "Compressor: the first sample of a loud burst gets little reduction (it is an attack)", gr(12000).toFixed(2));
  const back = new Float32Array(48000); back.fill(lin(-10), 0, 24000); back.fill(lin(-40), 24000);
  const o2 = h.run(COMP_FAST, [-30, 100, 0, 0.01], 48000, back);
  const gr2 = (i) => toDb(o2[i]) - toDb(back[i]);
  check(gr2(24000) < -15 && near(gr2(24000 + 1920) / gr2(24000 - 1), 0.37, 0.07), "Compressor: lets go with the release time (4 x the attack here)", `${gr2(24000).toFixed(1)} dB then ${(gr2(24000 + 1920) / gr2(24000 - 1)).toFixed(2)}`);
  e.setup(COMP, -20, 4, 6, 0, 0, 0); h.process(48000, constant(0.5, 48000));
  check(e.reduction() < -5 && e.reduction() > -20, "Compressor: gainReductionDb reports the reduction", e.reduction().toFixed(2));
}
{
  // keyed: a loud key ducks a constant signal, a quiet key leaves it
  const key = new Float32Array(48000); key.fill(lin(-60), 0, 24000); key.fill(lin(0), 24000);
  const o = h.run(KEYED, [-30, 10, 0, 0], 48000, key);
  check(near(o[20000], 1, 0.01) && o[47999] < 0.35, "Compressor.nextKeyed: ducks by the key, not by the signal", `${o[20000].toFixed(3)} then ${o[47999].toFixed(3)}`);
  const silent = h.run(COMP, [-30, 4, 6, 0], 4096);
  check(finiteAll(silent) && peak(silent) === 0, "Compressor: silence stays silent (no NaN)");
  const loud = h.run(COMP, [-60, 100, 0, 0], 4096, constant(1000, 4096));
  check(finiteAll(loud), "Compressor: huge input is finite");
}

// ---- Limiter ------------------------------------------------------------------------------------------------------------------------------------------------
{
  e.setup(LIM, 0.5, 0, 0, 0, 0, 0);
  const latency = e.limiterLatency();
  check(latency > 50 && latency < 150, "Limiter: reports its look-ahead as latency", String(latency));
  const quiet = h.run(LIM, [0.9], 4096, sine(440, 0.5, 4096));
  let worst = 0; for (let i = latency; i < 4096; i++) worst = Math.max(worst, Math.abs(quiet[i] - 0.5 * Math.sin(2 * Math.PI * 440 * (i - latency) / SR)));
  check(worst < 1e-5, "Limiter: a signal under the ceiling passes unchanged, delayed by the latency", worst.toExponential(2));
  for (const [what, x] of [["noise at 10x", noise(48000).map((v) => v * 10)], ["a loud sine", sine(100, 4, 48000)], ["clicks", new Float32Array(48000).map((_, i) => (i % 5000 === 0 ? 8 : 0.01))], ["a step", new Float32Array(48000).map((_, i) => (i > 20000 ? 3 : 0.1))]]) {
    const o = h.run(LIM, [0.5], 48000, x);
    check(peak(o) <= 0.5 + 1e-6, `Limiter: nothing above the ceiling (${what})`, peak(o).toFixed(6));
  }
  const burst = new Float32Array(48000); burst.fill(0.2, 0, 12000); burst.fill(2, 12000, 12010); burst.fill(0.2, 12010);
  const o = h.run(LIM, [1.0], 48000, burst);
  const hit = o.slice(12000 + latency - 5, 12000 + latency + 15);
  check(peak(hit) <= 1 + 1e-6 && peak(hit) > 0.95, "Limiter: a short peak is brought exactly to the ceiling", peak(hit).toFixed(4));
  const before = o[12000 + latency - 40];   // 40 samples ahead of the peak the gain is already easing down
  check(before < 0.2 && before > 0.1, "Limiter: the gain eases down before the peak (look-ahead), not an abrupt clip", before.toFixed(3));
  check(near(o[47000], 0.2, 0.002), "Limiter: the gain comes back after the peak", o[47000].toFixed(4));
  const hot = h.run(LIM, [1.0], 4096, constant(1e6, 4096));
  check(finiteAll(hot) && peak(hot) <= 1 + 1e-6, "Limiter: absurd input is finite and limited");
}

// ---- Gate ----------------------------------------------------------------------------------------------------------------------------------------------------
{
  const gain = (x, params) => { const o = h.run(GATE, params, x.length, x); return o; };
  const burst = new Float32Array(48000).map((_, i) => (i >= 6000 && i < 24000 ? 0.1 * Math.sin(2 * Math.PI * 440 * i / SR) : 0.001 * Math.sin(2 * Math.PI * 440 * i / SR)));
  const o = gain(burst, [-40, -46, -80]);
  check(rms(o, 0, 5000) < 1e-5, "Gate: closed below the threshold (-60 dB signal, -40 dB threshold)", rms(o, 0, 5000).toExponential(2));
  check(near(rms(o, 10000, 20000) / rms(burst, 10000, 20000), 1, 0.01), "Gate: open above it, at unity gain");
  check(rms(o, 42000, 48000) < 1e-5, "Gate: closes again after the burst");
  // hysteresis: a signal at -43 dB, between close (-46) and open (-40): stays closed if closed, stays open if open
  const mid = 10 ** (-43 / 20);
  const x1 = new Float32Array(48000).fill(0); x1.fill(0.3, 2000, 6000); x1.fill(mid, 6000);   // opens, then drops to the middle band
  const x2 = new Float32Array(48000).fill(mid);                                                // starts in the middle band
  const o1 = gain(x1, [-40, -46, -80]), o2 = gain(x2, [-40, -46, -80]);
  check(near(o1[47999], mid, 0.003) && Math.abs(o2[47999]) < 1e-4, "Gate: between the two thresholds it keeps its state (hysteresis)", `${o1[47999].toFixed(4)} / ${o2[47999].toExponential(1)}`);
  const half = gain(burst, [-40, -46, -12]);
  check(near(rms(half, 0, 5000) / rms(burst, 0, 5000), lin(-12), 0.05), "Gate: `range` sets how far it closes", (toDb(rms(half, 0, 5000) / rms(burst, 0, 5000))).toFixed(1));
  const chat = new Float32Array(48000).map((_, i) => 0.0063 * (1 + 0.5 * Math.sin(i * 0.3)) * Math.sin(2 * Math.PI * 300 * i / SR));
  const oc = gain(chat, [-40, -46, -80]); let flips = 0; { e.setup(GATE, -40, -46, -80, 0, 0, 0); let last = false; for (let i = 0; i < 48000; i += 48) { h.process(48, chat.subarray(i, i + 48)); const op = e.gateOpen(); if (op !== last) flips++; last = op; } }
  check(flips <= 2 && finiteAll(oc), "Gate: a level wobbling around the threshold does not chatter", `${flips} changes`);
}

// ---- wave shapers -----------------------------------------------------------------------------------------------------------------------------------------
{
  const xs = Float32Array.from({ length: 41 }, (_, i) => -2 + i * 0.1);
  const soft = h.run(SOFT, [], 41, xs), hard = h.run(HARD, [0.8], 41, xs), fold = h.run(FOLD, [0.5], 41, xs), asym = h.run(ASYM, [0.5], 41, xs);
  check(near(soft[20], 0, 1e-6) && near(soft[22], Math.tanh(0.2), 1e-4) && soft.every((v) => Math.abs(v) <= 1), "softClip: a tanh, bounded by 1");
  check(hard.every((v, i) => v === Math.fround(Math.max(-0.8, Math.min(0.8, xs[i]))) || (Math.abs(xs[i]) <= 0.8 && v === xs[i])), "hardClip: clamps at +-limit");
  check(fold.every((v, i) => Math.abs(v) <= 0.5 + 1e-6) && near(fold[20 + 3], 0.3, 1e-5) && near(fold[20 + 7], 0.3, 1e-5) && near(fold[20 + 10], 0.0, 1e-5), "foldback: reflects at +-threshold (0.7 -> 0.3, 1.0 -> 0)", [fold[23], fold[27], fold[30]].join(" "));
  check(fold.every((v, i) => Math.abs(xs[i]) > 0.5 || Math.abs(v - xs[i]) < 1e-7), "foldback: signals inside the threshold are untouched");
  check(near(asym[20], 0, 1e-6) && Math.abs(asym[30] + asym[10]) > 0.01, "asymSat: zero in, zero out, and the halves differ", `${asym[30].toFixed(3)} vs ${asym[10].toFixed(3)}`);
  const small = h.run(ASYM, [0.8], 3, Float32Array.of(0, 0.001, -0.001));
  check(near(small[1], 0.001, 2e-5) && near(small[2], -0.001, 2e-5), "asymSat: small signals keep gain 1");
  const symm = h.run(ASYM, [0], 41, xs);
  check(symm.every((v, i) => near(v, Math.tanh(xs[i]), 2e-4)), "asymSat(0) is the soft clip");
  // asymmetric -> even harmonics: second harmonic present for asymSat, absent for softClip
  const p = (id, params) => spectrum(h.run(id, params, 16384, sine(1000.5, 0.8, 16384))), bin = SR / 16384;
  const at = (s, f) => Math.max(...s.slice(Math.round(f / bin) - 3, Math.round(f / bin) + 4));
  const a = p(ASYM, [0.7]), s = p(SOFT, []);
  check(db(at(a, 2001) / at(a, 1000.5)) > -40 && db(at(s, 2001) / at(s, 1000.5)) < -80, "asymSat adds even harmonics, softClip (odd) does not", `${db(at(a, 2001) / at(a, 1000.5)).toFixed(1)} dB vs ${db(at(s, 2001) / at(s, 1000.5)).toFixed(1)} dB`);
  // chebyshev
  const xc = Float32Array.from({ length: 21 }, (_, i) => -1 + i * 0.1);
  for (const n of [1, 2, 3, 5, 8]) {
    const o = h.run(CHEB, [n], 21, xc);
    check(xc.every((x, i) => near(o[i], Math.cos(n * Math.acos(x)), 2e-4)), `chebyshev order ${n} is cos(n acos x)`);
  }
  const t3 = spectrum(h.run(CHEB, [3], 16384, sine(1000.5, 1, 16384)));
  check(db(at(t3, 3001.5) / at(t3, 1000.5)) > 40 && at(t3, 1000.5) < at(t3, 3001.5) * 1e-6, "chebyshev order 3 turns a sine into its third harmonic only");
  check(h.run(CHEB, [0], 1, Float32Array.of(0.3))[0] === 1, "chebyshev order 0 is 1");
}

// ---- Bitcrush, Decimate -----------------------------------------------------------------------------------------------------------------------------------
{
  const x = sine(220, 0.9, 4800);
  for (const bits of [2, 4, 8, 12]) {
    const o = h.run(CRUSH, [bits], 4800, x);
    const levels = new Set(o);
    const step = 1 / 2 ** (bits - 1);
    check(levels.size <= 2 ** bits + 1 && o.every((v) => near(Math.round(v / step) * step, v, 1e-6)) && peak(o.map((v, i) => v - x[i])) <= step / 2 + 1e-6, `Bitcrush ${bits} bits: values on the grid, error within half a step`, `${levels.size} levels (2^bits + 1: the grid has a zero)`);
  }
  const one = h.run(CRUSH, [1], 4800, x);
  check(new Set(one).size <= 3, "Bitcrush 1 bit: three levels at most");
  const frac = h.run(CRUSH, [5.5], 4800, x);
  check(new Set(frac).size > new Set(h.run(CRUSH, [5], 4800, x)).size, "Bitcrush: fractional bit depths give in-between steps");
  const d = h.run(DEC, [0.25], 64, Float32Array.from({ length: 64 }, (_, i) => i + 1));
  check([...d.slice(0, 12)].join() === "1,1,1,4,4,4,4,8,8,8,8,12", "Decimate 0.25: takes the first sample, then every 4th, and holds it", [...d.slice(0, 12)].join());
  const pass = h.run(DEC, [1], 16, Float32Array.from({ length: 16 }, (_, i) => i + 1));
  check(pass.every((v, i) => v === i + 1), "Decimate 1: passes the signal");
  const third = h.run(DEC, [1 / 3], 3000, noise(3000)), changes = third.reduce((c, v, i) => c + (i > 0 && v !== third[i - 1] ? 1 : 0), 0);
  check(near(changes, 1000, 3), "Decimate 1/3: a new sample a third of the time", String(changes));
}

// ---- Oversampling ----------------------------------------------------------------------------------------------------------------------------------------
{
  e.setup(OS2, 0, 0, 0, 0, 0, 0); const l2 = e.os2Latency();
  e.setup(OS4, 0, 0, 0, 0, 0, 0); const l4 = e.os4Latency();
  for (const [id, name, latency, tol] of [[OS2, "Oversampler2x", l2, 0.02], [OS4, "Oversampler4x", l4, 0.04]]) {
    const imp = new Float32Array(400); imp[0] = 1;
    const o = h.run(id, [], 400, imp);
    const at = o.indexOf(Math.max(...o));
    check(Math.abs(at - latency) <= 1 && o[at] > 0.5, `${name}: an impulse comes back after the latency (its peak is a little lower: the band above 0.375 fs is filtered out)`, `peak ${o[at].toFixed(3)} at ${at}, latency ${latency}`);
    for (const f of [100, 1000, 5000, 10000, 15000]) {
      const g = responseAt(h, id, [], f, { n: 8192 });
      check(near(g.gain, 0, tol * 8.7) , `${name}: flat at ${f} Hz`, g.gain.toFixed(3) + " dB");
    }
    const tail = o.slice(at + 40);
    check(peak(tail) < 0.01, `${name}: the filters ring out quickly`);
  }
  // the point: clipping a high sine aliases; inside the oversampler most of that is gone
  const f0 = 4110.7, n = 32768, x = sine(f0, 1.0, n), bin = SR / n;
  const aliasRatio = (o) => {   // power away from the odd harmonics that fit under Nyquist, relative to the power in them
    const p = spectrum(o); const line = new Uint8Array(p.length);
    for (let k = 1; k * f0 < SR / 2; k += 2) for (let b = Math.round(k * f0 / bin) - 4; b <= Math.round(k * f0 / bin) + 4; b++) line[b] = 1;
    let l = 0, other = 0; for (let b = 8; b < p.length - 8; b++) (line[b] ? (l += p[b]) : (other += p[b]));
    return db(other / l);
  };
  const clip = (id) => h.run(id, [0.5], n, x);
  const direct = aliasRatio(clip(HARD)), a2 = aliasRatio(clip(OS2_CLIP)), a4 = aliasRatio(clip(OS4_CLIP));
  check(a2 < direct - 12 && a4 < a2 - 5, "hard clip of a 4.1 kHz sine: oversampling takes the aliases down (2x by 12 dB, 4x further by 5)", `${direct.toFixed(1)} / ${a2.toFixed(1)} / ${a4.toFixed(1)} dB`);
}

// ---- real time ----------------------------------------------------------------------------------------------------------------------------------------------
for (let id = 0; id <= 15; id++) {
  e.setup(id, id === GATE ? -40 : 0.5, id === GATE ? -46 : 3, id === GATE ? -80 : 6, 0, 0, 0);
  const bytes = h.allocated(() => e.process(4096));
  check(bytes === 0, `dynamics unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
void toDb;
finish();
