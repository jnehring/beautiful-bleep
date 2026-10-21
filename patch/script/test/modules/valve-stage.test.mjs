// SPDX-License-Identifier: GPL-3.0-or-later
// Valve Stage (src/valve-stage.dsp.ts): tube cascades with plate load, grid current, Miller roll-off, blocking, cathode bypass and sag.
//   node test/modules/valve-stage.test.mjs
import { loadModule, render, sine, gainAt, harmonicsDb, check, finish, spectrum, db, rms, peak, finiteAll } from "./lib.mjs";

const m = await loadModule("valve-stage");
console.log("cost", JSON.stringify(m.cost), m.warnings.map((w) => w.message).join("; "));
check(m.spec.type === "valve-stage", "type id is valve-stage");
check(m.cost.ops < 150000, "cost stays under 150,000 ops per chunk (counted at the heaviest setting: 3 stages, 2x oversampling)", `${m.cost.ops} (block ${m.cost.block}, sample ${m.cost.sample})`);
console.log("params:", m.spec.params.map((p) => p.id).join(","), "| inputs:", m.spec.inputs.map((p) => p.id).join(","), "| outputs:", m.spec.outputs.map((p) => p.id).join(","));

const N = 32768, SR = 48000;
const run = (f, amp, params = {}, sr = SR, n = N) => render(m, { sampleRate: sr, inputs: { l: sine(f, amp, n, sr) }, params }).outL;
const half = (y) => y.slice(y.length / 2);
const h = (f, amp, params = {}, sr = SR) => harmonicsDb(half(run(f, amp, params, sr)), f, sr, 6);   // [0, H2, H3, ...] dBc
const fund = (f, amp, params = {}) => gainAt(m, f, { amp, params, out: "outL" });                 // the fundamental's gain in dB

/// Amplitude of a tone at f in y between samples a and b (a correlation, so DC and other tones do not count).
const toneAmp = (y, f, a, b) => { let re = 0, im = 0; for (let i = a; i < b; i++) { const w = 2 * Math.PI * f * i / SR; re += y[i] * Math.cos(w); im += y[i] * Math.sin(w); } return 2 * Math.hypot(re, im) / (b - a); };

// ---- level dependence: gain, harmonics and frequency response change with level ----------------------------------------------------------
{
  const p = { tube: 0, stages: 2, gain: 40 };
  const lo = fund(1000, 0.01, p), mid = fund(1000, 0.25, p), hi = fund(1000, 0.9, p);
  check(Math.abs(hi - lo) > 2, "the gain depends on the level (soft compression of the stages)", `-40 dBFS ${lo.toFixed(1)} dB, -12 dBFS ${mid.toFixed(1)} dB, -1 dBFS ${hi.toFixed(1)} dB`);
  const hLo = h(1000, 0.02, p), hHi = h(1000, 0.3, p);
  check(hHi[1] > hLo[1] + 10, "even harmonics grow with level: H2 rises >10 dB for +24 dB input", `${hLo[1].toFixed(1)} -> ${hHi[1].toFixed(1)} dBc`);
  const hv = h(1000, 0.9, { ...p, gain: 100 });
  check(hv[2] > hv[1] - 6 || hv[2] > -20, "hard drive adds odd harmonics (grid current clips the positive peaks, cutoff the negative)", `H2 ${hv[1].toFixed(1)} H3 ${hv[2].toFixed(1)} dBc`);
  // the frequency response changes with level: compare the top-to-mid ratio at a small and a large level
  const tilt = (amp) => fund(6000, amp, p) - fund(500, amp, p);
  console.log(`  response tilt 6 kHz vs 500 Hz: ${tilt(0.01).toFixed(1)} dB (-40 dBFS), ${tilt(0.25).toFixed(1)} dB (-12 dBFS), ${tilt(0.9).toFixed(1)} dB (-1 dBFS)`);
  check(Math.abs(tilt(0.9) - tilt(0.01)) > 0.7, "the frequency response changes with level", `${tilt(0.01).toFixed(2)} -> ${tilt(0.9).toFixed(2)} dB`);
}

// ---- Miller roll-off depends on the stage gain ---------------------------------------------------------------------------------------------
{
  const roll = (p) => fund(12000, 0.005, p) - fund(500, 0.005, p);
  const ax = roll({ tube: 0, stages: 2, bright: 0 }), au = roll({ tube: 1, stages: 2, bright: 0 });
  check(ax < au - 1, "the high-gain 12AX7 rolls the top off more than the 12AU7 (Miller capacitance grows with gain)", `12 kHz vs 500 Hz: 12AX7 ${ax.toFixed(1)} dB, 12AU7 ${au.toFixed(1)} dB`);
  const one = roll({ tube: 0, stages: 1, bright: 0 }), three = roll({ tube: 0, stages: 3, bright: 0 });
  check(three < one - 1.5, "more cascaded stages roll the top off more", `1 stage ${one.toFixed(1)} dB, 3 stages ${three.toFixed(1)} dB`);
}

// ---- cathode bypass: Bright trades bass gain for a bright top ------------------------------------------------------------------------------
{
  const tiltOf = (bright) => fund(8000, 0.005, { stages: 1, bright }) - fund(80, 0.005, { stages: 1, bright });
  const t0 = tiltOf(0), t1 = tiltOf(100);
  check(t1 > t0 + 3, "Bright: the bass loses gain to cathode feedback while the top does not (8 kHz vs 80 Hz tilts up)", `${t0.toFixed(1)} -> ${t1.toFixed(1)} dB`);
}

// ---- coupling capacitor: low cut, and blocking after loud peaks ---------------------------------------------------------------------------
{
  const lowCut = fund(5, 0.005, { stages: 2, bright: 0 }) - fund(1000, 0.005, { stages: 2, bright: 0 });
  check(lowCut < -6, "the coupling capacitors cut the very low end", `5 Hz vs 1 kHz ${lowCut.toFixed(1)} dB`);
  // a quiet tone, a loud burst, the quiet tone again: after the burst the grid has been charged negative, the stage is biased cold and the quiet tone is weaker until the charge leaks away
  const sr = SR, quiet = 0.02, burst = 1.2, tone = 700;
  const n = sr * 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, a = t > 0.6 && t < 0.62 ? burst : quiet; x[i] = a * Math.sin(2 * Math.PI * tone * t); }
  const y = render(m, { inputs: { l: x }, params: { stages: 1, gain: 70, sag: 0 } }).outL;
  const win = (t0_, t1_) => toneAmp(y, tone, Math.floor(t0_ * sr), Math.floor(t1_ * sr));
  const before = win(0.45, 0.58), after = win(0.66, 0.74), later = win(1.6, 1.9);
  const dipDb = 20 * Math.log10(after / before), recDb = 20 * Math.log10(later / before);
  check(Math.abs(dipDb) > 1.0, "blocking: a loud burst shifts the bias, so the quiet tone right after it has a different level", `${dipDb.toFixed(1)} dB right after, ${recDb.toFixed(1)} dB 1 s later`);
  check(Math.abs(recDb) < Math.abs(dipDb) * 0.5 + 0.3, "and the bias recovers over the next fraction of a second");
}

// ---- sag -----------------------------------------------------------------------------------------------------------------------------------
{
  // a burst of loud signal, then a quiet tone: with sag the supply is low right after the burst, so the gain is lower than before it
  const sr = SR, n = sr * 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr, a = t > 0.4 && t < 0.7 ? 0.9 : 0.05; x[i] = a * Math.sin(2 * Math.PI * 300 * t); }
  const level = (sag, t0_, t1_) => { const y = render(m, { inputs: { l: x }, params: { stages: 2, gain: 50, sag } }).outL; return toneAmp(y, 300, Math.floor(t0_ * sr), Math.floor(t1_ * sr)); };
  const change = (sag) => 20 * Math.log10(level(sag, 0.72, 0.8) / level(sag, 0.2, 0.38));
  const c0 = change(0), c100 = change(100);
  check(c100 < c0 - 1, "sag: after a loud passage the gain is lower than before it", `Sag 0 %: ${c0.toFixed(1)} dB, Sag 100 %: ${c100.toFixed(1)} dB`);
  const rec = 20 * Math.log10(level(100, 1.75, 1.95) / level(100, 0.2, 0.38));
  check(Math.abs(rec) < Math.abs(c100) * 0.5 + 0.4, "and it recovers slowly (about a second later the level is back)", `${rec.toFixed(1)} dB at 1.0 s after`);
}

// ---- tube types -----------------------------------------------------------------------------------------------------------------------------
{
  const hAX = h(500, 0.1, { tube: 0, stages: 1, gain: 60 }), hAU = h(500, 0.1, { tube: 1, stages: 1, gain: 60 });
  check(hAX[1] > hAU[1] + 3, "12AX7 distorts more than 12AU7 at the same setting", `H2 ${hAX[1].toFixed(1)} vs ${hAU[1].toFixed(1)} dBc`);
  const hEL = h(500, 0.5, { tube: 2, stages: 1, gain: 80 });
  check(hEL[2] > hEL[1] + 25, "EL34 (push-pull pentode) is odd: H3 >25 dB above H2", `H2 ${hEL[1].toFixed(1)} H3 ${hEL[2].toFixed(1)} dBc`);
  const hA = h(500, 0.1, { tube: 0, stages: 1, gain: 50 });
  check(hA[1] > hA[2] + 6, "12AX7 triode stage is asymmetric: H2 >6 dB above H3 in moderate overdrive", `H2 ${hA[1].toFixed(1)} H3 ${hA[2].toFixed(1)} dBc`);
  const cold = h(500, 0.1, { tube: 0, stages: 1, gain: 50, bias: -100 }), hot = h(500, 0.1, { tube: 0, stages: 1, gain: 50, bias: 100 });
  console.log(`  bias cold H2/H3 ${cold[1].toFixed(1)}/${cold[2].toFixed(1)}, hot ${hot[1].toFixed(1)}/${hot[2].toFixed(1)}`);
  check(Math.abs(cold[1] - hot[1]) > 3 || Math.abs(cold[2] - hot[2]) > 3, "the bias point changes the harmonic balance");
  const s1 = h(500, 0.2, { tube: 0, stages: 1, gain: 50 }), s3 = h(500, 0.2, { tube: 0, stages: 3, gain: 50 });
  check(s3[2] > s1[2] + 8 || s3[3] > s1[3] + 8, "more stages, more distortion", `H3 ${s1[2].toFixed(1)} -> ${s3[2].toFixed(1)} dBc`);
}

// ---- starved plate: gated and sputtering at low levels --------------------------------------------------------------------------------------
{
  // a starved plate moves the stage to the edge of cutoff: it compresses harder (the output is level-compensated at -12 dBFS, so weak signals come out relatively louder),
  // and the weak ones are gated on one side: the two halves of the wave are very different
  const slope = (plate) => fund(800, 0.1, { stages: 2, gain: 50, plate }) - fund(800, 0.01, { stages: 2, gain: 50, plate });
  const sHot = slope(100), sStarved = slope(0);
  check(sStarved < sHot - 2, "starved plate: the stage compresses much harder (gain at -20 dBFS minus gain at -40 dBFS falls)", `hot ${sHot.toFixed(1)} dB, starved ${sStarved.toFixed(1)} dB`);
  const asym = (plate) => { const y = half(run(800, 0.02, { stages: 2, gain: 50, plate })); let mx = -9, mn = 9; for (const v of y) { if (v > mx) mx = v; if (v < mn) mn = v; } return 20 * Math.log10(mx / -mn); };
  const aStarved = Math.abs(asym(0)), aHot = Math.abs(asym(100));
  check(aStarved > aHot + 3, "starved plate: a weak tone is gated on one side (the positive and negative peaks differ by >3 dB more than with a hot plate)", `peak ratio ${aStarved.toFixed(1)} dB vs ${aHot.toFixed(1)} dB`);
  const hs = h(800, 0.02, { stages: 2, gain: 50, plate: 0 }), hh = h(800, 0.02, { stages: 2, gain: 50, plate: 100 });
  const distStarved = Math.max(hs[1], hs[2], hs[3]), distHot = Math.max(hh[1], hh[2], hh[3]);
  check(distStarved > distHot + 6, "starved plate: a quiet signal is much more distorted (sputtering)", `worst harmonic ${distStarved.toFixed(1)} vs ${distHot.toFixed(1)} dBc`);
  const idle = (plate) => rms(render(m, { inputs: { l: new Float32Array(48000) }, params: { plate, gain: 100, stages: 3 } }).outL, 24000);
  check(idle(12) > idle(100) * 10 && idle(100) < 1e-3, "starved plate: the bias flickers (a crackle floor); a hot plate is silent at idle", `idle rms starved ${(20 * Math.log10(idle(12) + 1e-9)).toFixed(0)} dBFS, hot ${(20 * Math.log10(idle(100) + 1e-9)).toFixed(0)} dBFS`);
  const a = render(m, { inputs: { l: new Float32Array(48000) }, params: { plate: 12, gain: 100, stages: 3 } }), b = render(m, { inputs: { l: new Float32Array(48000) }, params: { plate: 12, gain: 100, stages: 3 } });
  check(a.outL.every((v, i) => v === b.outL[i]) && !a.outL.every((v, i) => v === a.outR[i]), "the crackle is deterministic and different on the two channels");
}

// ---- level compensation --------------------------------------------------------------------------------------------------------------------
for (const p of [{ gain: 0 }, { gain: 40 }, { gain: 100 }, { tube: 1, gain: 70 }, { tube: 2, stages: 1, gain: 90 }, { stages: 3, gain: 60 }, { plate: 40, gain: 60 }]) {
  const g = fund(1000, 0.25, p);
  check(Math.abs(g) < 4, `level compensation: a -12 dBFS tone keeps its level within 4 dB (${JSON.stringify(p)})`, `${g.toFixed(2)} dB`);
}
{
  const d = fund(1000, 0.1, { output: -6 }) - fund(1000, 0.1, { output: 0 });
  check(Math.abs(d + 6) < 0.3, "Output knob is in dB", `${d.toFixed(2)} dB for -6`);
}

// ---- aliasing ------------------------------------------------------------------------------------------------------------------------------
{
  const alias = (params, sr = SR) => {
    const f = 4783 * sr / N, x = sine(f, 0.5, N, sr), y = render(m, { sampleRate: sr, inputs: { l: x }, params }).outL;
    const P = spectrum(y), bw = sr / N, mask = new Uint8Array(P.length);
    for (let k = 1; k * f < sr / 2; k++) { const b = Math.round(k * f / bw); for (let j = -2; j <= 2; j++) if (b + j >= 0 && b + j < P.length) mask[b + j] = 1; }
    let s = 0; for (let i = 3; i < P.length; i++) if (!mask[i]) s += P[i];
    return db(s / P[Math.round(f / bw)]);
  };
  const aN = alias({ gain: 60, quality: 1 }), aE = alias({ gain: 60, quality: 0 });
  console.log(`  non-harmonic energy, 7 kHz at gain 60 %: Eco ${aE.toFixed(1)} dBc, Normal ${aN.toFixed(1)} dBc`);
  const mildN = alias({ gain: 30, quality: 1 }), oneN = alias({ gain: 60, stages: 1, quality: 1 });
  console.log(`  moderate drive (gain 30 %): Normal ${mildN.toFixed(1)} dBc; one stage at gain 60 %: Normal ${oneN.toFixed(1)} dBc`);
  check(mildN < -55, "alias suppression, Normal (2x oversampling): moderate drive leaves < -55 dBc of non-harmonic energy", `${mildN.toFixed(1)} dBc`);
  check(oneN < -55, "alias suppression, Normal: one hard-driven stage < -55 dBc", `${oneN.toFixed(1)} dBc`);
  check(aN < -38, "alias suppression, Normal: two cascaded hard-clipping stages stay < -38 dBc (a 4x mode does not fit the cost bound)", `${aN.toFixed(1)} dBc`);
  check(aN < aE - 20, "Normal aliases at least 20 dB less than Eco (no oversampling)", `${aE.toFixed(1)} vs ${aN.toFixed(1)}`);
}

// ---- dry / wet, stereo --------------------------------------------------------------------------------------------------------------------
{
  const x = sine(1000, 0.2, 8192);
  for (const q of [0, 1]) {
    const y = render(m, { inputs: { l: x }, params: { mix: 0, quality: q } }).outL;
    let best = 1e9, bestD = 0;
    for (let d = 0; d < 8; d += 0.05) { let e = 0; for (let i = 4096; i < 8192; i++) { const t = (i - d) / SR; e += (y[i] - 0.2 * Math.sin(2 * Math.PI * 1000 * t)) ** 2; } if (e < best) { best = e; bestD = d; } }
    check(Math.sqrt(best / 4096) < 0.003, `Mix 0 % passes the dry signal untouched, delayed by ${bestD.toFixed(2)} samples (${q ? "2x" : "1x"})`, `rms error ${Math.sqrt(best / 4096).toExponential(2)}`);
    const p = { stages: 1, gain: 0, tube: 1, bright: 0, sag: 0 };
    const w = render(m, { inputs: { l: x }, params: { ...p, mix: 100, quality: q } }).outL, mid = render(m, { inputs: { l: x }, params: { ...p, mix: 50, quality: q } }).outL;
    check(rms(mid, 4096) > 0.9 * Math.max(rms(w, 4096), rms(y, 4096)) * 0.97, `dry and wet are in phase at 1 kHz (${q ? "2x" : "1x"})`, `dry ${rms(y, 4096).toFixed(4)} wet ${rms(w, 4096).toFixed(4)} mix ${rms(mid, 4096).toFixed(4)}`);
  }
  const l = sine(300, 0.3, 24000), p = { gain: 50 };
  const auto = render(m, { inputs: { l }, params: p });
  let dd = 0; for (let i = 20000; i < 24000; i++) dd = Math.max(dd, Math.abs(auto.outL[i] - auto.outR[i]));
  check(dd < 2e-3, "Auto: with nothing patched into In R both channels carry the left signal", `difference ${dd.toExponential(1)} after the switch`);
  const st = render(m, { inputs: { l, r: sine(450, 0.3, 24000) }, params: p });
  check(rms(st.outR, 12000) > 0.05 && !st.outL.every((v, i) => v === st.outR[i]), "Auto: a signal on In R makes it a true stereo module");
  const mono = render(m, { inputs: { l, r: sine(450, 0.3, 24000) }, params: { ...p, plate: 100, input: 2 } });
  check(mono.outL.every((v, i) => v === mono.outR[i]), "Mono: In R is ignored");
  const stereo = render(m, { inputs: { l }, connected: { l: true, r: true }, params: { ...p, input: 1 } });
  check(peak(stereo.outR) < 1e-3, "Stereo: a silent In R stays silent", `${peak(stereo.outR).toExponential(1)}`);
  const r2 = new Float32Array(24000); for (let i = 12000; i < 24000; i++) r2[i] = 0.2 * Math.sin(2 * Math.PI * 450 * i / SR);
  const sw = render(m, { inputs: { l, r: r2 }, params: { gain: 10 } }).outR;
  let jump = 0; for (let i = 12000; i < 13000; i++) jump = Math.max(jump, Math.abs(sw[i] - sw[i - 1]));
  check(jump < 0.1, "Auto: In R coming alive does not click", `largest step ${jump.toFixed(3)}`);
}

// ---- robustness ----------------------------------------------------------------------------------------------------------------------------
{
  const tests = {
    dc: new Float32Array(20000).fill(0.8), neg: new Float32Array(20000).fill(-1),
    square: Float32Array.from({ length: 20000 }, (_, i) => (Math.floor(i / 40) % 2 ? 1 : -1)),
    full: sine(60, 1, 20000), loud: Float32Array.from({ length: 20000 }, (_, i) => 8 * Math.sin(i * 0.37)),
    noise: Float32Array.from({ length: 20000 }, (_, i) => Math.sin(i * i * 0.001) * 3),
  };
  const extremes = [
    { tube: 0, stages: 3, gain: 100, bias: 100, plate: 100, bright: 100, sag: 100, output: 12, mix: 100 },
    { tube: 2, stages: 3, gain: 100, bias: -100, plate: 0, bright: 0, sag: 100, output: 12, mix: 100 },
    { tube: 1, stages: 1, gain: 0, bias: 0, plate: 50, bright: 50, sag: 0, output: -24, mix: 0 },
    { tube: 2, stages: 1, gain: 100, bias: 100, plate: 0, bright: 100, sag: 50, output: 12, mix: 50, quality: 0 },
  ];
  let ok = true, worst = 0;
  for (const [k, x] of Object.entries(tests)) for (const p of extremes) for (const sr of [44100, 96000]) {
    const o = render(m, { sampleRate: sr, inputs: { l: x, r: x }, params: p });
    if (!finiteAll(o.outL) || !finiteAll(o.outR)) { ok = false; console.log("non-finite", k, JSON.stringify(p), sr); }
    worst = Math.max(worst, peak(o.outL), peak(o.outR));
  }
  check(ok, "output is finite for DC, square, full-scale, over-range and noisy input at extreme knob settings (44.1 and 96 kHz)", `largest peak ${worst.toFixed(1)}`);
  const tail = render(m, { inputs: { l: Float32Array.from({ length: 4000 }, (_, i) => 5 * Math.sin(i * 0.05)) }, n: 144000, params: { ...extremes[0], plate: 100 } });
  check(finiteAll(tail.outL) && peak(tail.outL.slice(130000)) < 1e-3, "after silence the output decays to nothing and stays finite", `${peak(tail.outL.slice(130000)).toExponential(2)}`);
}

// ---- determinism, sample rates ----------------------------------------------------------------------------------------------------------
{
  const x = sine(220, 0.4, 20000), p = { gain: 70, plate: 40, sag: 60 };
  const a = render(m, { inputs: { l: x }, params: p }).outL, b = render(m, { inputs: { l: x }, params: p }).outL;
  check(a.every((v, i) => v === b[i]), "two renders are identical");
  for (const sr of [44100, 96000]) {
    const g = fund(1000, 0.25, { gain: 50 });
    const y = half(run(1000, 0.25, { gain: 50 }, sr, 16384));
    const gg = 20 * Math.log10(rms(y) / (0.25 / Math.SQRT2));
    const hb = harmonicsDb(half(run(500, 0.2, { gain: 60 }, sr)), 500, sr, 3);
    check(Math.abs(gg) < 4 && hb[1] > -40, `works at ${sr} Hz: level ${gg.toFixed(2)} dB (48 kHz ${g.toFixed(2)}), H2 ${hb[1].toFixed(1)} dBc`);
  }
}

finish();
