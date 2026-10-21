// SPDX-License-Identifier: GPL-3.0-or-later
// Preamp (src/preamp.dsp.ts): the transformer iron, the gain stage and the housekeeping.   node test/modules/preamp.test.mjs
import { loadModule, render, sine, gainAt, harmonicsDb, check, finish, spectrum, db, rms, peak, finiteAll } from "./lib.mjs";

const m = await loadModule("preamp");
console.log("cost", JSON.stringify(m.cost), m.warnings.map((w) => w.message).join("; "));
check(m.spec.type === "preamp", "type id is preamp");
check(m.cost.ops < 150000, "cost stays under 150,000 ops per chunk even at 4x oversampling", `${m.cost.ops} (default block ${m.cost.block}, sample ${m.cost.sample})`);
const ids = (a) => a.map((p) => p.id).join(",");
console.log("params:", ids(m.spec.params), "| inputs:", ids(m.spec.inputs), "| outputs:", ids(m.spec.outputs));

const N = 32768;
const run = (f, amp, params = {}, sampleRate = 48000, n = N) => render(m, { sampleRate, inputs: { l: sine(f, amp, n, sampleRate) }, params }).outL;
const half = (y) => y.slice(y.length / 2);
const h = (f, amp, params = {}, sampleRate = 48000) => harmonicsDb(half(run(f, amp, params, sampleRate)), f, sampleRate, 6);   // [0, H2, H3, ...] in dBc
const lvl = (f, amp, params = {}) => 20 * Math.log10(rms(half(run(f, amp, params))) / (amp / Math.SQRT2));
const quiet = { age: 0 };

// ---- the iron: low-frequency saturation that depends on frequency AND level -------------------------------------------------------------
const iron = { ...quiet, iron: 100, drive: 0, cls: 1 };
const bass = h(40, 0.5, iron), treble = h(1000, 0.5, iron);
check(bass[2] > treble[2] + 20, "bass saturates earlier than treble: H3 at 40 Hz is >20 dB above H3 at 1 kHz at the same level (iron 100 %)", `40 Hz ${bass[2].toFixed(1)} dBc, 1 kHz ${treble[2].toFixed(1)} dBc`);
const bassQuiet = h(40, 0.05, iron), bassHot = h(40, 0.5, iron);
check(bassHot[2] > bassQuiet[2] + 15, "the iron grows with level: H3 at 40 Hz rises >15 dB for +20 dB input", `${bassQuiet[2].toFixed(1)} -> ${bassHot[2].toFixed(1)} dBc`);
const ironA = { ...quiet, iron: 100, drive: 0, cls: 0 };
const fund = (f, amp, p) => gainAt(m, f, { amp, params: p, out: "outL" });
const gLo = fund(40, 0.05, ironA), gHi = fund(40, 0.7, ironA), tLo = fund(1000, 0.05, ironA), tHi = fund(1000, 0.7, ironA);
check(gHi < gLo - 2.5, "the bass gain falls with level (core flux compression)", `${gLo.toFixed(1)} dB -> ${gHi.toFixed(1)} dB`);
const i0 = { ...ironA, iron: 0 }, tLo0 = fund(1000, 0.05, i0), tHi0 = fund(1000, 0.7, i0);
check(Math.abs((tHi - tLo) - (tHi0 - tLo0)) < 0.3, "the treble gain is not changed by the iron (it is a bass effect)", `Iron 100 %: ${tLo.toFixed(1)} -> ${tHi.toFixed(1)} dB, Iron 0 %: ${tLo0.toFixed(1)} -> ${tHi0.toFixed(1)} dB`);
const off = h(40, 0.5, { ...iron, iron: 0 });
check(off[2] < bass[2] - 15, "Iron 0 % is much cleaner at 40 Hz than Iron 100 %", `${off[2].toFixed(1)} vs ${bass[2].toFixed(1)} dBc`);
// more iron, more harmonics in the 100..400 Hz octaves for a 50 Hz note
const bandEnergy = (y, lo, hi, sr = 48000) => { const P = spectrum(y), bw = sr / y.length; let s = 0; for (let i = Math.floor(lo / bw); i < hi / bw; i++) s += P[i]; return s; };
const note = (ironAmt) => bandEnergy(half(run(50, 0.4, { ...quiet, drive: 0, iron: ironAmt, cls: 1 })), 130, 450) / bandEnergy(half(run(50, 0.4, { ...quiet, drive: 0, iron: ironAmt, cls: 1 })), 40, 60);
check(note(100) > note(0) * 10, "bass thickening: a 50 Hz note grows harmonics in 130..450 Hz with Iron", `${(10 * Math.log10(note(0))).toFixed(1)} -> ${(10 * Math.log10(note(100))).toFixed(1)} dB`);
// the bass weight: Impedance lifts the low end
const w0 = gainAt(m, 62, { amp: 0.02, params: { ...quiet, drive: 0, impedance: 0, iron: 50 }, out: "outL" }), w1 = gainAt(m, 62, { amp: 0.02, params: { ...quiet, drive: 0, impedance: 100, iron: 50 }, out: "outL" });
const r1k = gainAt(m, 1000, { amp: 0.02, params: { ...quiet, drive: 0, impedance: 100, iron: 50 }, out: "outL" });
check(w1 > w0 + 2 && w1 > r1k + 2, "Impedance adds bass weight around 60 Hz", `62 Hz: ${w0.toFixed(1)} -> ${w1.toFixed(1)} dB (1 kHz ${r1k.toFixed(1)})`);
// leakage roll-off (Air)
const a0 = gainAt(m, 12000, { amp: 0.02, params: { ...quiet, drive: 0, air: 0 }, out: "outL" }), a1 = gainAt(m, 12000, { amp: 0.02, params: { ...quiet, drive: 0, air: 100 }, out: "outL" });
check(a1 > a0 + 10, "Air opens the top: 12 kHz is >10 dB louder at 100 % than at 0 %", `${a0.toFixed(1)} -> ${a1.toFixed(1)} dB`);

// ---- class A against class AB ------------------------------------------------------------------------------------------------------------
const cA = h(500, 0.3, { ...quiet, drive: 30, cls: 0 }), cB = h(500, 0.3, { ...quiet, drive: 30, cls: 1 });
check(cA[1] > cA[2] - 6, "class A is rich in even harmonics (H2 close to or above H3)", `H2 ${cA[1].toFixed(1)}, H3 ${cA[2].toFixed(1)} dBc`);
check(cB[2] > cB[1] + 30, "class AB is odd: H3 is >30 dB above H2", `H2 ${cB[1].toFixed(1)}, H3 ${cB[2].toFixed(1)} dBc`);

// ---- level compensation ----------------------------------------------------------------------------------------------------------------
for (const d of [0, 25, 50, 100]) {
  const g = lvl(1000, 0.25, { ...quiet, drive: d, iron: 40 });
  check(Math.abs(g) < 3, `level compensation: a -12 dBFS tone at 1 kHz keeps its level within 3 dB (drive ${d} %)`, `${g.toFixed(2)} dB`);
}
const gOut = lvl(1000, 0.25, { ...quiet, drive: 20, output: -6 }) - lvl(1000, 0.25, { ...quiet, drive: 20, output: 0 });
check(Math.abs(gOut + 6) < 0.3, "Output knob is in dB", `${gOut.toFixed(2)} dB for -6`);
const gTrim = lvl(1000, 0.05, { ...quiet, drive: 0, iron: 0, trim: 12 }) - lvl(1000, 0.05, { ...quiet, drive: 0, iron: 0, trim: 0 });
check(gTrim > -1 && gTrim < 12, "Input trim pushes the stage harder but the compensation keeps the loudness in check", `${gTrim.toFixed(2)} dB for +12`);

// ---- aliasing ---------------------------------------------------------------------------------------------------------------------------
const alias = (params, sr = 48000) => {
  const f = 4783 * sr / N, x = sine(f, 0.5, N, sr), y = render(m, { sampleRate: sr, inputs: { l: x }, params }).outL;   // a coherent frequency: every bin is either a harmonic or not
  const P = spectrum(y), bw = sr / N, mask = new Uint8Array(P.length);
  for (let k = 1; k * f < sr / 2; k++) { const b = Math.round(k * f / bw); for (let j = -2; j <= 2; j++) if (b + j >= 0 && b + j < P.length) mask[b + j] = 1; }
  let s = 0; for (let i = 3; i < P.length; i++) if (!mask[i]) s += P[i];
  return db(s / P[Math.round(f / bw)]);
};
const alN = alias({ ...quiet, drive: 50, quality: 1 }), alE = alias({ ...quiet, drive: 50, quality: 0 }), alNh = alias({ ...quiet, drive: 100, quality: 1 });
check(alN < -60, "alias suppression, Normal (4x + ADAA): a 7 kHz tone driven hard leaves < -60 dBc of non-harmonic energy", `${alN.toFixed(1)} dBc`);
check(alE < -50, "alias suppression, Eco (2x + ADAA): < -50 dBc", `${alE.toFixed(1)} dBc`);
check(alNh < -45, "alias suppression at Drive 100 %, Normal: < -45 dBc", `${alNh.toFixed(1)} dBc`);
check(alN < alE, "Normal aliases less than Eco");

// ---- dry / wet --------------------------------------------------------------------------------------------------------------------------
{
  const x = sine(1000, 0.3, 8192);
  for (const q of [0, 1]) {
    const y = render(m, { inputs: { l: x }, params: { ...quiet, mix: 0, quality: q } }).outL;
    // the dry path is delayed by the wet latency: find the delay by phase at 1 kHz, then check the match
    let best = 1e9, bestD = 0;
    for (let d = 0; d < 8; d += 0.05) { let e = 0; for (let i = 4096; i < 8192; i++) { const t = (i - d) / 48000; e += (y[i] - 0.3 * Math.sin(2 * Math.PI * 1000 * t)) ** 2; } if (e < best) { best = e; bestD = d; } }
    check(Math.sqrt(best / 4096) < 0.003, `Mix 0 % passes the dry signal untouched, delayed by ${bestD.toFixed(2)} samples (${q ? "4x" : "2x"})`, `rms error ${Math.sqrt(best / 4096).toExponential(2)}`);
    // the wet path has the same delay: summing 50/50 must not comb-filter a low-drive signal
    const w = render(m, { inputs: { l: x }, params: { ...quiet, mix: 100, quality: q, drive: 0, iron: 0, impedance: 0 } }).outL;
    const mid = render(m, { inputs: { l: x }, params: { ...quiet, mix: 50, quality: q, drive: 0, iron: 0, impedance: 0 } }).outL;
    check(rms(mid, 4096) > 0.93 * rms(w, 4096) * 0.97 && rms(mid, 4096) > 0.9 * rms(y, 4096) * 0.97, `dry and wet are in phase at 1 kHz (Mix 50 % is not quieter than both, ${q ? "4x" : "2x"})`, `dry ${rms(y, 4096).toFixed(4)} wet ${rms(w, 4096).toFixed(4)} mix ${rms(mid, 4096).toFixed(4)}`);
  }
}

// ---- stereo, input modes, age -----------------------------------------------------------------------------------------------------------
{
  const x = sine(300, 0.3, 24000), z = new Float32Array(24000);
  const auto = render(m, { inputs: { l: x }, params: { ...quiet, drive: 40 } });
  let dd = 0; for (let i = 20000; i < 24000; i++) dd = Math.max(dd, Math.abs(auto.outL[i] - auto.outR[i]));
  check(dd < 5e-4, "Auto: with nothing patched into In R, both channels carry the left signal", `difference ${dd.toExponential(1)} after the switch`);
  const st = render(m, { inputs: { l: x, r: sine(450, 0.3, 24000) }, params: { ...quiet, drive: 40, input: 0 } });
  check(rms(st.outR, 12000) > 0.1 && !st.outL.every((v, i) => v === st.outR[i]), "Auto: a signal on In R makes it a true stereo module");
  const mono = render(m, { inputs: { l: x, r: sine(450, 0.3, 24000) }, params: { ...quiet, drive: 40, input: 2 } });
  check(mono.outL.every((v, i) => v === mono.outR[i]), "Mono: In R is ignored");
  const stereo = render(m, { inputs: { l: x }, connected: { l: true, r: true }, params: { ...quiet, drive: 40, input: 1 } });
  check(peak(stereo.outR) < 1e-6, "Stereo: a silent In R stays silent");
  // an input going from unpatched to live: smooth
  const r2 = new Float32Array(24000); for (let i = 12000; i < 24000; i++) r2[i] = 0.2 * Math.sin(2 * Math.PI * 450 * i / 48000);
  const sw = render(m, { inputs: { l: x, r: r2 }, params: { ...quiet, drive: 10 } }).outR;
  let jump = 0; for (let i = 12000; i < 13000; i++) jump = Math.max(jump, Math.abs(sw[i] - sw[i - 1]));
  check(jump < 0.15, "Auto: In R coming alive does not click", `largest step ${jump.toFixed(3)}`);
  const aged = render(m, { inputs: { l: sine(200, 0.3, 96000) }, params: { age: 100, input: 2, drive: 40 }, n: 96000 });
  let dsum = 0, n2 = 0; for (let i = 0; i < 96000; i++) { dsum += (aged.outL[i] - aged.outR[i]) ** 2; n2 += aged.outL[i] ** 2; }
  check(dsum > 0 && dsum / n2 > 1e-8, "Age: left and right drift independently", `difference ${(10 * Math.log10(dsum / n2)).toFixed(1)} dB`);
  const aged0 = render(m, { inputs: { l: sine(200, 0.3, 96000) }, params: { age: 0, input: 2, drive: 40 }, n: 96000 });
  check(aged0.outL.every((v, i) => v === aged0.outR[i]), "Age 0 %: the channels are identical for a mono source");
}

// ---- robustness ----------------------------------------------------------------------------------------------------------------------
{
  const tests = {
    dc: new Float32Array(20000).fill(0.8), neg: new Float32Array(20000).fill(-1),
    square: Float32Array.from({ length: 20000 }, (_, i) => (Math.floor(i / 40) % 2 ? 1 : -1)),
    full: sine(60, 1, 20000), loud: Float32Array.from({ length: 20000 }, (_, i) => 8 * Math.sin(i * 0.37)),
  };
  const extremes = [
    { trim: 12, drive: 100, iron: 100, impedance: 100, cls: 0, air: 100, output: 12, mix: 100, age: 100 },
    { trim: -12, drive: 0, iron: 0, impedance: 0, cls: 1, air: 0, output: -24, mix: 0, age: 0 },
    { trim: 12, drive: 100, iron: 100, impedance: 100, cls: 1, air: 0, output: 12, mix: 50, age: 100, quality: 0 },
  ];
  let ok = true, worst = 0;
  for (const [k, x] of Object.entries(tests)) for (const p of extremes) for (const sr of [44100, 96000]) {
    const o = render(m, { sampleRate: sr, inputs: { l: x, r: x }, params: p });
    if (!finiteAll(o.outL) || !finiteAll(o.outR)) { ok = false; console.log("non-finite", k, JSON.stringify(p), sr); }
    worst = Math.max(worst, peak(o.outL), peak(o.outR));
  }
  check(ok, "output is finite for DC, square, full-scale and over-range input at extreme knob settings (44.1 and 96 kHz)", `largest peak ${worst.toFixed(1)}`);
  const tail = render(m, { inputs: { l: Float32Array.from({ length: 4000 }, (_, i) => 5 * Math.sin(i * 0.05)) }, n: 96000, params: extremes[0] });
  check(finiteAll(tail.outL) && peak(tail.outL.slice(90000)) < 1e-4, "after silence the output decays to nothing and stays finite (no NaN, no DC left)", `${peak(tail.outL.slice(90000)).toExponential(2)}`);
}

// ---- determinism, sample rates -----------------------------------------------------------------------------------------------------
{
  const x = sine(220, 0.4, 20000), p = { drive: 60, age: 70, iron: 80 };
  const a = render(m, { inputs: { l: x }, params: p }).outL, b = render(m, { inputs: { l: x }, params: p }).outL;
  check(a.every((v, i) => v === b[i]), "two renders are identical (deterministic drift)");
  for (const sr of [44100, 96000]) {
    const g = 20 * Math.log10(rms(half(run(1000, 0.25, { ...quiet, drive: 20 }, sr, 16384))) / (0.25 / Math.SQRT2));
    const hb = harmonicsDb(half(run(40, 0.5, iron, sr)), 40, sr, 4);
    check(Math.abs(g) < 3 && hb[2] > -40, `works at ${sr} Hz: level ${g.toFixed(2)} dB, 40 Hz iron H3 ${hb[2].toFixed(1)} dBc`);
  }
}

// ---- the anti-aliasing leaves the small-signal response flat ---------------------------------------------------------------------------------
for (const q of [0, 1]) {
  const f = { ...quiet, drive: 0, iron: 0, impedance: 0, air: 100, quality: q };
  const g1 = gainAt(m, 1000, { amp: 0.02, params: f, out: "outL" }), g15 = gainAt(m, 15000, { amp: 0.02, params: f, out: "outL" });
  check(Math.abs(g15 - g1) < 0.5, `small-signal response is flat from 1 kHz to 15 kHz (${q ? "Normal" : "Eco"}): the antiderivative anti-aliasing does not roll the top off`, `${g1.toFixed(2)} -> ${g15.toFixed(2)} dB`);
}

finish();
