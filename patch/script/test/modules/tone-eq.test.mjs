// SPDX-License-Identifier: GPL-3.0-only
// Tone EQ: realised response against the analog prototypes, valve stage harmonics and aliasing, drift, input choice, safety.
//   node test/modules/tone-eq.test.mjs
import { loadModule, render, sine, gainAt, harmonicsDb, spectrum, check, finish, finiteAll, peak, SR } from "./lib.mjs";

const m = await loadModule("tone-eq");
check(m.cost.ops < 60000 && m.warnings.length === 0, "cost below the warning bound", JSON.stringify(m.cost));
const OUT = { out: "outL" };
const base = { drive: 0, age: 0, output: 0, mode: 0, lowBoost: 0, lowAtten: 0, hiBoost: 0, hiAtten: 0, tilt: 0 };
const dbOf = (z) => 20 * Math.log10(Math.hypot(z[0], z[1]));

// ---- complex arithmetic and the analog prototypes (the intended curves), as functions of frequency in Hz ----------------------------------
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const poly = (c, s) => c.reduce((acc, ci, k) => { let p = [1, 0]; for (let i = 0; i < k; i++) p = cmul(p, s); return [acc[0] + ci * p[0], acc[1] + ci * p[1]]; }, [0, 0]);   // c ascending
const proto2 = (nb, na, f, f0) => cdiv(poly(nb, [0, f / f0]), poly(na, [0, f / f0]));
const lowShelf2 = (f, f0, db, Q) => { const A = 10 ** (db / 40), r = Math.sqrt(A) / Q; return proto2([A * A, A * r, A], [1, r, A], f, f0); };   // A (sn^2 + r sn + A) / (A sn^2 + r sn + 1), c ascending
const bell = (f, f0, db, Q) => { const A = 10 ** (db / 40); return proto2([1, A / Q, 1], [1, 1 / (A * Q), 1], f, f0); };
const lowShelf1 = (f, f0, db) => { const g = 10 ** (db / 40); return proto2([g, 1], [1 / g, 1], f, f0); };
const highShelf1 = (f, f0, db) => { const g = 10 ** (db / 40); return proto2([g, g * g], [g, 1], f, f0); };
const dcBlock = (f, sr) => { const w = 2 * Math.PI * f / sr, r = 1 - 2 * Math.PI * 4 / sr; return cdiv([1 - Math.cos(w), Math.sin(w)], [1 - r * Math.cos(w), r * Math.sin(w)]); };   // (1 - z^-1) / (1 - r z^-1)
const chain = (...zs) => zs.reduce((a, b) => cmul(a, b), [1, 0]);
const LOWF = [20, 30, 60, 100], HIF = [3000, 4000, 5000, 8000, 10000, 12000, 16000], ATTF = [5000, 10000, 20000];

function passive(f, p, sr = SR) {   // the intended analog response of Passive Shelf mode
  const lf = LOWF[p.lowFreq ?? 2], hf = HIF[p.hiFreq ?? 3], af = ATTF[p.attFreq ?? 1];
  const Q = 2 * Math.pow(0.35 / 2, (p.bandwidth ?? 5) / 10);
  return chain(lowShelf2(f, lf, p.lowBoost * 1.5, 0.9), lowShelf1(f, lf * 2.4, -p.lowAtten * 1.2), bell(f, hf, p.hiBoost * 1.6, Q), highShelf1(f, af, -p.hiAtten * 1.4), dcBlock(f, sr));
}
function tiltResp(f, p, sr = SR) {
  const piv = [250, 400, 650, 1000, 1600, 2500][p.pivot ?? 2];
  return chain(lowShelf1(f, piv / 2.5, -p.tilt), highShelf1(f, piv * 2.5, p.tilt), dcBlock(f, sr));
}

// ---- the tone stack: an independent complex nodal analysis of the full netlist (every node, no hand elimination) --------------------------
function solveC(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.hypot(...M[r][i]) > Math.hypot(...M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = i + 1; r < n; r++) { const f = cdiv(M[r][i], M[i][i]); for (let c = i; c <= n; c++) { const t = cmul(f, M[i][c]); M[r][c] = [M[r][c][0] - t[0], M[r][c][1] - t[1]]; } }
  }
  const x = Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) { const t = cmul(M[i][c], x[c]); s = [s[0] - t[0], s[1] - t[1]]; } x[i] = cdiv(s, M[i][i]); }
  return x;
}
function stackNodal(f, bass, mid, treble) {
  const R1 = 250e3, R2 = 1e6, R3 = 25e3, R4 = 56e3, C1 = 250e-12, C2 = 20e-9, C3 = 20e-9;
  const x = Math.min(1, bass / 10), l = (Math.exp(3 * x) - 1) / (Math.exp(3) - 1), mm = mid / 10, t = treble / 10, w = 2 * Math.PI * f;
  const idx = { A: 0, B: 1, W: 2, E: 3, D: 4, W3: 5, In: -1, G: -2 };
  const Y = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [0, 0])), rhs = Array.from({ length: 6 }, () => [0, 0]);
  const add = (a, b, y) => {
    const ia = idx[a], ib = idx[b];
    if (ia >= 0) { Y[ia][ia][0] += y[0]; Y[ia][ia][1] += y[1]; }
    if (ib >= 0) { Y[ib][ib][0] += y[0]; Y[ib][ib][1] += y[1]; }
    if (ia >= 0 && ib >= 0) { Y[ia][ib][0] -= y[0]; Y[ia][ib][1] -= y[1]; Y[ib][ia][0] -= y[0]; Y[ib][ia][1] -= y[1]; }
    if (ia >= 0 && ib === -1) { rhs[ia][0] += y[0]; rhs[ia][1] += y[1]; }
    if (ib >= 0 && ia === -1) { rhs[ib][0] += y[0]; rhs[ib][1] += y[1]; }
  };
  const r = (R) => [1 / Math.max(R, 50), 0], c = (C) => [0, w * C];
  add("In", "A", c(C1)); add("A", "W", r((1 - t) * R1)); add("W", "B", r(t * R1));
  add("In", "E", r(R4)); add("E", "B", c(C2)); add("E", "W3", c(C3));
  add("B", "D", r(l * R2)); add("D", "W3", r((1 - mm) * R3)); add("W3", "G", r(mm * R3));
  return dbOf(solveC(Y, rhs)[2]) + 9;   // + the make-up gain
}

const meas = (params, f, sr = SR, extra = {}) => gainAt(m, f, { amp: 0.05, params: { ...base, ...params }, n: f < 80 ? 131072 : 32768, sampleRate: sr, ...OUT, ...extra });
// The bilinear transform squeezes the top octave: the bells and shelves above about 0.2 fs are checked loosely at 44.1 / 48 kHz and tightly at 96 kHz.
const compare = (name, params, freqs, expectFn, tol, sr = SR) => {
  let worst = 0, at = 0;
  const rows = freqs.map((f) => {
    const got = meas(params, f, sr), want = dbOf(expectFn(f));
    const e = Math.abs(got - want); if (e > worst) { worst = e; at = f; }
    return `${f}:${got.toFixed(1)}/${want.toFixed(1)}`;
  });
  check(worst < tol, `${name}: realised vs analog within ${tol} dB`, `worst ${worst.toFixed(2)} dB at ${at} Hz; got/want ${rows.join(" ")}`);
};

// ---- Passive Shelf -----------------------------------------------------------------------------------------------------------------------
const FR = [20, 30, 45, 60, 100, 200, 400, 1000, 3000, 6000, 10000];
for (const sr of [44100, 48000, 96000]) {
  compare(`passive low boost 60 Hz, boost 6 (${sr})`, { lowFreq: 2, lowBoost: 6 }, FR, (f) => passive(f, { lowFreq: 2, lowBoost: 6, lowAtten: 0, hiBoost: 0, hiAtten: 0 }, sr), 0.35, sr);
}
compare("passive low 20 Hz boost 8", { lowFreq: 0, lowBoost: 8 }, [20, 30, 50, 100, 200], (f) => passive(f, { lowFreq: 0, lowBoost: 8, lowAtten: 0, hiBoost: 0, hiAtten: 0 }), 0.35);
compare("passive low 100 Hz boost 10, atten 4", { lowFreq: 3, lowBoost: 10, lowAtten: 4 }, FR, (f) => passive(f, { lowFreq: 3, lowBoost: 10, lowAtten: 4, hiBoost: 0, hiAtten: 0 }), 0.35);
compare("passive high 8 kHz boost 6, narrow", { hiFreq: 3, hiBoost: 6, bandwidth: 0 }, [500, 2000, 4000, 6000, 8000, 10000, 13000], (f) => passive(f, { hiFreq: 3, hiBoost: 6, bandwidth: 0, lowBoost: 0, lowAtten: 0, hiAtten: 0 }), 1.5);
compare("passive high 5 kHz boost 8, broad", { hiFreq: 2, hiBoost: 8, bandwidth: 10 }, [300, 1000, 2500, 5000, 8000, 12000], (f) => passive(f, { hiFreq: 2, hiBoost: 8, bandwidth: 10, lowBoost: 0, lowAtten: 0, hiAtten: 0 }), 1.6);
compare("passive high atten 10 kHz, 8", { hiAtten: 8, attFreq: 1 }, [500, 2000, 5000, 8000, 10000, 14000], (f) => passive(f, { hiAtten: 8, attFreq: 1, lowBoost: 0, lowAtten: 0, hiBoost: 0 }), 1.2);
compare("passive full: 30 Hz boost 5 + atten 5, 12 kHz boost 4, atten 5 kHz 3", { lowFreq: 1, lowBoost: 5, lowAtten: 5, hiFreq: 5, hiBoost: 4, bandwidth: 4, attFreq: 0, hiAtten: 3 }, [25, 40, 80, 150, 400, 1500, 4000, 7000, 10000],
  (f) => passive(f, { lowFreq: 1, lowBoost: 5, lowAtten: 5, hiFreq: 5, hiBoost: 4, bandwidth: 4, attFreq: 0, hiAtten: 3 }), 1.3);
// the same high settings at 96 kHz: close to the analog curves
compare("passive high 8 kHz boost 6 + atten 10 kHz 5 at 96 kHz", { hiFreq: 3, hiBoost: 6, bandwidth: 2, attFreq: 1, hiAtten: 5 }, [500, 2000, 4000, 6000, 8000, 10000, 13000, 20000], (f) => passive(f, { hiFreq: 3, hiBoost: 6, bandwidth: 2, attFreq: 1, hiAtten: 5, lowBoost: 0, lowAtten: 0 }, 96000), 0.7, 96000);
{ // 16 kHz bell at 44.1: print the warping error rather than hide it
  const got = meas({ hiFreq: 6, hiBoost: 6, bandwidth: 5 }, 16000, 44100), want = dbOf(passive(16000, { hiFreq: 6, hiBoost: 6, bandwidth: 5, lowBoost: 0, lowAtten: 0, hiAtten: 0 }, 44100));
  check(Math.abs(got - want) < 0.3, "16 kHz bell at 44.1 kHz is exact at its centre", `${got.toFixed(2)} vs ${want.toFixed(2)} dB`);
  const g2 = meas({ hiFreq: 6, hiBoost: 6, bandwidth: 5 }, 9000, 44100), w2 = dbOf(passive(9000, { hiFreq: 6, hiBoost: 6, bandwidth: 5, lowBoost: 0, lowAtten: 0, hiAtten: 0 }, 44100));
  console.log(`     16 kHz bell at 44.1 kHz, 9 kHz (the warped side): ${g2.toFixed(2)} dB realised, ${w2.toFixed(2)} dB analog`);
}
{ // interaction: boost and attenuation at the same frequency
  const fr = [20, 30, 45, 60, 80, 100, 150, 200, 300, 450, 700, 1000, 2000];
  const both = fr.map((f) => meas({ lowFreq: 2, lowBoost: 7, lowAtten: 7 }, f)), boostOnly = fr.map((f) => meas({ lowFreq: 2, lowBoost: 7 }, f)), cutOnly = fr.map((f) => meas({ lowFreq: 2, lowAtten: 7 }, f));
  console.log("     60 Hz boost 7 + atten 7 (dB):", fr.map((f, i) => `${f}:${both[i].toFixed(1)}`).join(" "));
  const dip = Math.min(...both.slice(5)), low = Math.max(...both.slice(0, 5));
  check(both[0] > 0 && low > 1 && dip < -2, "boost + atten at the same frequency: a smooth low boost with a dip above it", `bottom ${both[0].toFixed(1)} dB, max below ${low.toFixed(1)}, dip ${dip.toFixed(1)} dB`);
  check(both.every((v, i) => Math.abs(v - (boostOnly[i] + cutOnly[i])) < 0.5), "the two sections are a cascade (dB add)", "");
  check(boostOnly[0] > 7 && boostOnly[0] < 12 && Math.abs(boostOnly[1] - boostOnly[0]) < 3, "the boost shelf is smooth and bounded at the 20 Hz end", `${boostOnly[0].toFixed(1)} dB`);
  check(Math.abs(meas({ lowBoost: 0, lowAtten: 0, hiBoost: 0, hiAtten: 0 }, 1000)) < 0.1 && Math.abs(meas({}, 100)) < 0.2, "all controls at 0: flat", "");
}

// ---- Tilt -----------------------------------------------------------------------------------------------------------------------------
for (const [tilt, pivot] of [[6, 2], [-5, 3], [3, 0]]) compare(`tilt ${tilt} dB, pivot ${pivot}`, { mode: 1, tilt, pivot }, [30, 100, 250, 650, 1000, 2500, 6000, 12000], (f) => tiltResp(f, { tilt, pivot }), 1.0);
{
  const lo = meas({ mode: 1, tilt: 6, pivot: 2 }, 40), hi = meas({ mode: 1, tilt: 6, pivot: 2 }, 12000), mid = meas({ mode: 1, tilt: 6, pivot: 2 }, 650);
  check(lo < -3 && hi > 3 && Math.abs(mid) < 0.6, "tilt seesaws around the pivot (bass down, treble up, pivot unchanged)", `${lo.toFixed(1)} / ${mid.toFixed(1)} / ${hi.toFixed(1)} dB`);
  const slope = (meas({ mode: 1, tilt: 6, pivot: 2 }, 1300) - meas({ mode: 1, tilt: 6, pivot: 2 }, 325)) / 2;
  check(slope > 0.5 && slope < 4, "the tilt slope is broad and gentle", `${slope.toFixed(2)} dB per octave around the pivot`);
}

// ---- Tone Stack --------------------------------------------------------------------------------------------------------------------------
const SF = [50, 100, 200, 400, 800, 1600, 3200, 6400, 10000];
for (const [b, mi, t] of [[5, 5, 5], [10, 10, 10], [2, 0, 8], [8, 7, 1], [0, 3, 6], [6, 10, 0]])
  compare(`tone stack bass ${b} mid ${mi} treble ${t}`, { mode: 2, bass: b, mid: mi, treble: t }, SF, (f) => { const g = stackNodal(f, b, mi, t); return [10 ** (g / 20), 0]; }, 1.0);
compare("tone stack at 96 kHz", { mode: 2, bass: 5, mid: 5, treble: 5 }, SF, (f) => [10 ** (stackNodal(f, 5, 5, 5) / 20), 0], 0.6, 96000);
{
  const r = (b, mi, t) => SF.map((f) => meas({ mode: 2, bass: b, mid: mi, treble: t }, f));
  const mid5 = r(5, 5, 5), mid10 = r(5, 10, 5), mid0 = r(5, 0, 5), bass10 = r(10, 5, 5), bass0 = r(0, 5, 5), tre10 = r(5, 5, 10), tre0 = r(5, 5, 0);
  const minOf = (a) => Math.min(...a.slice(2, 7));
  console.log("     tone stack 5/5/5 (dB at 50..10k):", mid5.map((v) => v.toFixed(1)).join(" "));
  check(minOf(mid5) < Math.max(mid5[0], mid5[8]) - 6 && minOf(mid5) < mid5[4] + 0.01, "the characteristic mid scoop", `scoop ${minOf(mid5).toFixed(1)} dB`);
  check(minOf(mid10) > minOf(mid5) + 2 && minOf(mid0) < minOf(mid5) - 2, "mid control fills and deepens the scoop", `${minOf(mid0).toFixed(1)} / ${minOf(mid5).toFixed(1)} / ${minOf(mid10).toFixed(1)}`);
  check(bass10[0] > bass0[0] + 5, "bass control moves the low end", `${bass0[0].toFixed(1)} -> ${bass10[0].toFixed(1)} dB at 50 Hz`);
  check(tre10[7] > tre0[7] + 8, "treble control moves the top", `${tre0[7].toFixed(1)} -> ${tre10[7].toFixed(1)} dB at 6.4 kHz`);
  const nominal = meas({ mode: 2, bass: 10, mid: 10, treble: 10 }, 1000) - 9;
  check(nominal < -1 && minOf(mid5) - 9 < -9, "insertion loss before make-up", `with everything up ${nominal.toFixed(1)} dB at 1 kHz; at 5/5/5 the scoop loses ${(minOf(mid5) - 9).toFixed(1)} dB`);
}

// ---- the valve make-up stage ------------------------------------------------------------------------------------------------------------
{
  const run = (amp, drive, f = 1000) => render(m, { inputs: { l: sine(f, amp, 16384) }, params: { ...base, drive, lowBoost: 0 } }).outL;
  const h = (amp, drive) => harmonicsDb(run(amp, drive), 1000, SR, 5);
  const lo = h(0.02, 1), mid = h(0.2, 1), hi = h(0.6, 1), off = h(0.6, 0);
  console.log(`     harmonics (dB re fundamental) at 1 kHz, drive 1: amp .02 [${lo.slice(1).map((v) => v.toFixed(0))}]  .2 [${mid.slice(1).map((v) => v.toFixed(0))}]  .6 [${hi.slice(1).map((v) => v.toFixed(0))}]`);
  check(hi[1] > hi[2] + 1 && mid[1] > mid[2], "even harmonic (2nd) dominates the 3rd: valve-style asymmetry", `2nd ${hi[1].toFixed(1)} vs 3rd ${hi[2].toFixed(1)} dB`);
  check(mid[1] > lo[1] + 14 && hi[1] > mid[1] + 6, "colour grows with level", `2nd: ${lo[1].toFixed(0)} -> ${mid[1].toFixed(0)} -> ${hi[1].toFixed(0)} dB`);
  check(off[1] < hi[1] - 15 && hi[1] < -10, "subtle: drive 0 is nearly clean, drive 1 stays small at -4 dBFS", `drive 0: ${off[1].toFixed(0)} dB`);
  const g = (amp) => { const y = run(amp, 1); return 20 * Math.log10(peak(y, 8192) / amp); };
  check(Math.abs(g(0.002)) < 0.3, "unity small-signal gain (no level jump when the drive changes)", `${g(0.002).toFixed(2)} dB`);
  check(g(0.9) > -3.5 && g(0.9) < 0.5, "bounded compression of loud peaks", `${g(0.9).toFixed(2)} dB at 0.9`);
  const dcOut = render(m, { inputs: { l: sine(100, 0.8, 48000) }, params: { ...base, drive: 1 } }).outL, mean = dcOut.slice(24000).reduce((a, v) => a + v, 0) / 24000;
  check(Math.abs(mean) < 0.005, "no DC offset from the asymmetry", mean.toExponential(1));
}
{ // aliasing: a high tone driven hard; the harmonics above Nyquist fold back to bins that are not harmonics of the tone
  const n = 16384;
  const alias = (y, f0) => {
    const sp = spectrum(y), bin0 = Math.round(f0 * n / SR), fund = Math.max(...sp.slice(bin0 - 3, bin0 + 4));
    let p = 0;
    for (let h = 2; h <= 10; h++) {
      const hf = h * f0; if (hf < SR / 2) continue;
      const fold = hf % SR > SR / 2 ? SR - (hf % SR) : hf % SR, k = Math.round(fold * n / SR);
      p += Math.max(...sp.slice(k - 3, k + 4));
    }
    return 10 * Math.log10(p / fund);
  };
  const naive = (x, drive) => {   // the same curve without anti-aliasing
    const k = 0.02 + 0.9 * drive, b = 0.45, s = (v) => v / Math.sqrt(1 + v * v), sb = s(b), isl = Math.pow(1 + b * b, 1.5);
    const y = Float32Array.from(x, (v) => (s(b + k * v) - sb) * isl / k);
    const r = 1 - 2 * Math.PI * 4 / SR; let x1 = 0, y1 = 0;
    return y.map((v) => { y1 = v - x1 + r * y1; x1 = v; return y1; });
  };
  for (const [f0, amp, limit] of [[7000, 0.25, -65], [9500, 0.25, -65], [7000, 0.9, -40], [9500, 0.9, -40]]) {
    const x = sine(f0, amp, 2 * n);
    const y = render(m, { inputs: { l: x }, params: { ...base, drive: 1, lowBoost: 0 } }).outL.slice(n);   // the second half: the start-up click is gone
    const a = alias(y, f0), a0 = alias(naive(x, 1).slice(n), f0);
    console.log(`     ${f0} Hz at ${amp}, drive 1: folded harmonics ${a.toFixed(1)} dB re the fundamental (the same curve without anti-aliasing: ${a0.toFixed(1)} dB)`);
    check(a < limit && a < a0 - 3, `alias products of a driven ${f0} Hz tone at ${amp}: below ${limit} dB and below the unfiltered curve`, "");
  }
}

// ---- drift, determinism, input choice ----------------------------------------------------------------------------------------------------
{
  const x = sine(500, 0.2, 96000);
  const p = { ...base, lowBoost: 5, hiBoost: 5, drive: 0.3 };
  const a = render(m, { inputs: { l: x, r: x }, params: { ...p, age: 1 } }), b = render(m, { inputs: { l: x, r: x }, params: { ...p, age: 1 } });
  check(a.outL.every((v, i) => v === b.outL[i]) && a.outR.every((v, i) => v === b.outR[i]), "deterministic: two renders are identical", "");
  let d = 0; for (let i = 48000; i < 96000; i++) d = Math.max(d, Math.abs(a.outL[i] - a.outR[i]));
  check(d > 1e-4, "Age drift is different in the left and right channel", `max L-R ${d.toExponential(1)}`);
  const c = render(m, { inputs: { l: x, r: x }, params: { ...p, age: 0 } });
  let d0 = 0; for (let i = 0; i < 96000; i++) d0 = Math.max(d0, Math.abs(c.outL[i] - c.outR[i]));
  check(d0 < 1e-6, "Age 0: the two channels are identical for identical input", d0.toExponential(1));
  // drift is slow: the gain of a 100 Hz tone changes over seconds, not per block
  const t100 = sine(100, 0.1, 480000);
  const long = render(m, { inputs: { l: t100, r: t100 }, params: { ...p, mode: 0, lowBoost: 8, age: 1 } }).outL;
  const rmsAt = (s) => { let t = 0; for (let i = s; i < s + 4800; i++) t += long[i] * long[i]; return Math.sqrt(t / 4800); };
  const levels = [24000, 96000, 168000, 240000, 312000, 384000].map(rmsAt);
  const spread = 20 * Math.log10(Math.max(...levels) / Math.min(...levels));
  check(spread > 0.01 && spread < 2.5, "drift wanders by a fraction of a dB over seconds", `${spread.toFixed(2)} dB over 10 s`);
}
{
  const x = sine(300, 0.3, 24000);
  const auto = render(m, { inputs: { l: x }, params: { ...base, input: 0 } }), st = render(m, { inputs: { l: x }, params: { ...base, input: 1 } }), mono = render(m, { inputs: { l: x }, params: { ...base, input: 2 } });
  let dAuto = 0, dSt = 0, dMono = 0;
  for (let i = 12000; i < 24000; i++) { dAuto = Math.max(dAuto, Math.abs(auto.outL[i] - auto.outR[i])); dSt = Math.max(dSt, Math.abs(st.outR[i])); dMono = Math.max(dMono, Math.abs(mono.outL[i] - mono.outR[i])); }
  check(dAuto < 1e-4 && dMono < 1e-4, "Auto with nothing on In R, and Mono: both channels carry the left signal", `${dAuto.toExponential(1)} ${dMono.toExponential(1)}`);
  check(dSt < 1e-12, "Stereo: the unpatched right input stays silent", "");
  const both = render(m, { inputs: { l: x, r: x.map((v) => v * -0.5) }, params: { ...base, input: 0 } });
  let dd = 0; for (let i = 12000; i < 24000; i++) dd = Math.max(dd, Math.abs(both.outR[i] + 0.5 * both.outL[i]));
  check(dd < 2e-3, "Auto with a signal on In R: true stereo", dd.toExponential(1));
  // R becomes non-zero after a long silence: smooth change, no click
  const r2 = new Float32Array(24000); for (let i = 12000; i < 24000; i++) r2[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / SR);
  const sw = render(m, { inputs: { l: x, r: r2 }, params: { ...base, input: 0 } });
  let jump = 0; for (let i = 12000; i < 14000; i++) jump = Math.max(jump, Math.abs(sw.outR[i] - sw.outR[i - 1]));
  check(jump < 0.05, "switching from the left signal to a real right signal is smooth", `max step ${jump.toFixed(4)}`);
}

// ---- safety --------------------------------------------------------------------------------------------------------------------------------
{
  const square = Float32Array.from({ length: 48000 }, (_, i) => (Math.floor(i / 50) % 2 ? 1 : -1));
  const extremes = [
    { mode: 0, lowFreq: 0, lowBoost: 10, lowAtten: 10, hiFreq: 6, hiBoost: 10, bandwidth: 0, attFreq: 2, hiAtten: 10, drive: 1, output: 12, age: 1 },
    { mode: 1, tilt: 6, pivot: 5, drive: 1, output: 12, age: 1 },
    { mode: 1, tilt: -6, pivot: 0, drive: 1, output: -12, age: 1 },
    { mode: 2, bass: 10, mid: 0, treble: 10, drive: 1, output: 12, age: 1 },
    { mode: 2, bass: 0, mid: 10, treble: 0, drive: 0, output: -12, age: 0 },
  ];
  for (const sr of [44100, 96000]) for (const [i, p] of extremes.entries()) {
    const s = render(m, { sampleRate: sr, inputs: { l: square, r: Float32Array.from(square, (v) => -v) }, params: p });
    const dc = render(m, { sampleRate: sr, inputs: { l: 1, r: -1 }, n: 48000, params: p });
    const burst = Float32Array.from({ length: 96000 }, (_, k) => (k < 2000 ? square[k] : 0));
    const tail = render(m, { sampleRate: sr, inputs: { l: burst }, params: p });
    check(finiteAll(s.outL) && finiteAll(s.outR) && finiteAll(dc.outL) && finiteAll(tail.outL) && peak(s.outL) < 100, `finite and bounded at extreme settings #${i} (${sr} Hz)`, `peak ${peak(s.outL).toFixed(1)}`);
    check(peak(tail.outL, 90000) < 1e-2, `silence after a burst decays (#${i}, ${sr} Hz)`, `tail ${peak(tail.outL, 90000).toExponential(1)}`);
  }
  // mode switching while playing is click free
  const x = sine(400, 0.3, 48000);
  const sw = render(m, { inputs: { l: x }, params: { ...base, lowBoost: 4, mode: (i) => (i < 16000 ? 0 : i < 32000 ? 1 : 2), tilt: 4, bass: 5, mid: 5, treble: 5 } }).outL;
  let jump = 0; for (let i = 1; i < sw.length; i++) jump = Math.max(jump, Math.abs(sw[i] - sw[i - 1]));
  check(finiteAll(sw) && jump < 0.1, "switching mode while playing does not click", `max step ${jump.toFixed(3)}`);
  // parameter sweep while playing: no zipper steps bigger than the signal slope
  const sweep = render(m, { inputs: { l: sine(200, 0.3, 48000) }, params: { ...base, mode: 0, lowBoost: (i) => 10 * i / 48000, hiBoost: 3, drive: 0.3 } }).outL;
  let sj = 0; for (let i = 1; i < sweep.length; i++) sj = Math.max(sj, Math.abs(sweep[i] - sweep[i - 1]));
  check(sj < 0.1, "sweeping Low Boost while playing is smooth", `max step ${sj.toFixed(3)}`);
}
{ // the render length does not change the samples
  const x = sine(220, 0.3, 4000);
  const a = render(m, { inputs: { l: x }, n: 4000, params: { ...base, lowBoost: 4, age: 0.5 } }).outL, b = render(m, { inputs: { l: x }, n: 3001, params: { ...base, lowBoost: 4, age: 0.5 } }).outL;
  check(a.slice(0, 3001).every((v, i) => v === b[i]), "output does not depend on the render length", "");
}
finish();
