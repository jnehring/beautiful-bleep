// SPDX-License-Identifier: GPL-3.0-or-later
// bleep/osc: shape, aliasing (against an additive band-limited reference), allocation-free processing.   node test/dsp/osc.test.mjs
import { harness, check, finish, SR, rms, peak, spectrum, db, finiteAll } from "./lib.mjs";

const h = await harness("osc");
const N = 16384;
const NAIVE = 0, SAW = 1, SQUARE = 2, TRI = 3, SIN = 4, TABLE = 5, WT_SAW = 6, STACK = 7, FM = 8, WT_SQ = 9, WT_TRI = 10;

// Aliasing: the power outside the harmonic lines (within 4 bins of k * f0) relative to the power in them. The f0s are not bin-aligned and
// not rational with the sample rate, so folded harmonics land between the lines; the comparison is always against the naive shape.
const aliasRatio = (sig, f0, top = 12000) => {
  const p = spectrum(sig), n = sig.length;
  const bin = SR / n, last = Math.floor(top / bin);
  const isLine = new Uint8Array(p.length);
  for (let k = 1; k * f0 < SR; k++) for (let b = Math.round(k * f0 / bin) - 4; b <= Math.round(k * f0 / bin) + 4; b++) if (b >= 0 && b < p.length) isLine[b] = 1;
  let lines = 0, other = 0;
  for (let b = 3; b < last; b++) { if (isLine[b]) lines += p[b]; else other += p[b]; }
  return db(other / lines);
};
const idealRms = (kind, f0) => { let s = 0; for (let k = 1; k * f0 < SR / 2; k++) s += kind === "saw" ? 1 / (k * k) : 0; return Math.sqrt(s * 2 / (Math.PI * Math.PI)); };

// ---- polyBlep ------------------------------------------------------------------------------------------------------
{
  const dt = 0.01, e = h.exports;
  check(e.blep(0.5, dt) === 0 && e.blep(0.995 - 0.01, dt) === 0, "polyBlep is zero away from the step");
  check(Math.abs(e.blep(0, dt) + 1) < 1e-12 && Math.abs(e.blep(1 - 1e-12, dt) - 1) < 1e-6, "polyBlep runs from -1 just after the step to +1 just before it");
}

// ---- the saw, the pulse and the triangle: right shape, and much less aliasing than the naive wave ------------------------
for (const f0 of [1000.37, 3141.59, 7013.1]) {
  const naive = h.run(NAIVE, [f0], N), saw = h.run(SAW, [f0], N);
  const a0 = aliasRatio(naive, f0), a1 = aliasRatio(saw, f0);
  check(a1 < a0 - 15, `sawBlep at ${f0} Hz aliases much less than the naive saw (below 12 kHz)`, `${a0.toFixed(1)} dB -> ${a1.toFixed(1)} dB`);
  check(peak(saw) < 1.1 && peak(saw) > 0.7 && Math.abs(rms(saw) / idealRms("saw", f0) - 1) < 0.15, `sawBlep at ${f0} Hz has the level of a band-limited saw`, `peak ${peak(saw).toFixed(3)} rms ${rms(saw).toFixed(3)} vs ${idealRms("saw", f0).toFixed(3)}`);
}
{
  const f0 = 1000.37;
  const saw = h.run(SAW, [f0], N);
  check(aliasRatio(saw, f0) < -40, "sawBlep at 1 kHz: below 12 kHz, everything between the harmonics is below -40 dB", aliasRatio(saw, f0).toFixed(1));
  const mean = saw.reduce((s, v) => s + v, 0) / N;
  check(Math.abs(mean) < 0.01, "sawBlep has no DC", mean.toFixed(4));
}
for (const width of [0.5, 0.2]) {
  const f0 = 3141.59;
  const sq = h.run(SQUARE, [f0, width], N);
  check(peak(sq) < 1.1 && peak(sq) > 0.95, `squareBlep (width ${width}) swings between -1 and 1`, peak(sq).toFixed(3));
  const mean = sq.reduce((s, v) => s + v, 0) / N, want = 2 * width - 1;
  check(Math.abs(mean - want) < 0.01, `squareBlep (width ${width}) has the DC of its duty cycle`, `${mean.toFixed(3)} vs ${want}`);
  // the naive pulse for comparison: a hard threshold
  const naive = new Float32Array(N); let ph = 0;
  for (let i = 0; i < N; i++) { naive[i] = ph < width ? 1 : -1; ph = (ph + f0 / SR) % 1; }
  check(aliasRatio(sq, f0) < aliasRatio(naive, f0) - 15, `squareBlep (width ${width}) aliases less than the naive pulse`, `${aliasRatio(naive, f0).toFixed(1)} -> ${aliasRatio(sq, f0).toFixed(1)} dB`);
}
{
  const f0 = 1000.37, tri = h.run(TRI, [f0], N);
  check(Math.abs(tri[0]) < 1e-6 && tri[1] > 0, "triangle starts at 0 and rises");
  check(peak(tri) < 1.001 && peak(tri) > 0.95, "triangle peaks at about 1", peak(tri).toFixed(4));
  check(Math.abs(tri.reduce((s, v) => s + v, 0) / N) < 0.005, "triangle has no DC");
  const naive = new Float32Array(N); let ph = 0;
  for (let i = 0; i < N; i++) { naive[i] = ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4; ph = (ph + 7013.1 / SR) % 1; }
  const t2 = h.run(TRI, [7013.1], N);
  check(aliasRatio(t2, 7013.1) < aliasRatio(naive, 7013.1) - 10, "triangle at 7 kHz aliases less than the naive triangle (polyBLAMP)", `${aliasRatio(naive, 7013.1).toFixed(1)} -> ${aliasRatio(t2, 7013.1).toFixed(1)} dB`);
}

// ---- sines -----------------------------------------------------------------------------------------------------------
for (const [id, name, tol] of [[SIN, "fastSin", 6e-6], [TABLE, "SineTable", 1.5e-6]]) {
  const out = h.run(id, [440.123], 8192);
  let worst = 0;
  const dt = 440.123 / SR;
  for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - Math.sin(2 * Math.PI * ((i * dt) % 1))));
  check(worst < tol + 1.2e-7, `${name} matches Math.sin`, `max error ${worst.toExponential(2)}`);
}
{
  const out = h.run(SIN, [100], 4096);
  const p = spectrum(out.slice(0, 4096)), top = Math.max(...p);
  let rest = 0; for (let i = 0; i < p.length; i++) if (Math.abs(i - 100 * 4096 / SR) > 8) rest += p[i];
  check(db(rest / top) < -50, "fastSin is spectrally clean (Hann leakage included)", db(rest / top).toFixed(1) + " dB");
}

// ---- Wavetable -------------------------------------------------------------------------------------------------------------
for (const [id, kind, f0] of [[WT_SAW, "saw", 220.3], [WT_SAW, "saw", 3141.59], [WT_SQ, "square", 3141.59], [WT_TRI, "triangle", 3141.59]]) {
  const out = h.run(id, [f0], N);
  check(finiteAll(out) && peak(out) > 0.8 && peak(out) < 1.2, `Wavetable ${kind} at ${f0} Hz has the right level`, peak(out).toFixed(3));
  check(aliasRatio(out, f0) < -45, `Wavetable ${kind} at ${f0} Hz: the mip level keeps the aliases down`, aliasRatio(out, f0).toFixed(1) + " dB");
}
{
  // at 100 Hz the table plays its 127-harmonic level; its gain is that of the full 1023-harmonic copy
  const f0 = 100, out = h.run(WT_SAW, [f0], 4096);
  const sum = (kmax, i) => { let v = 0; for (let k = 1; k <= kmax; k++) v += Math.sin(2 * Math.PI * k * f0 * i / SR) / k; return v; };
  let scale = 0; for (let i = 0; i < 2048; i++) scale = Math.max(scale, Math.abs(sum(1023, i * (SR / f0) / 2048)));
  let worst = 0;
  for (let i = 0; i < 4096; i++) worst = Math.max(worst, Math.abs(out[i] - sum(127, i) / scale));
  check(worst < 0.01, "Wavetable saw is the additive sum of its harmonics (127, the level for 100 Hz)", worst.toExponential(2));
}

// ---- Supersaw, FmOp ------------------------------------------------------------------------------------------------------------
{
  const out = h.run(STACK, [220, 30], 16384);
  check(finiteAll(out) && rms(out) > 0.3 && rms(out) < 1.0 && peak(out) < 7, "Supersaw: 7 voices are about as loud as one saw", rms(out).toFixed(3));
  const p = spectrum(out), bin = SR / 16384;
  // detuned: the line at the fundamental is smeared; the single saw has one sharp line, the stack has power spread around it
  const single = spectrum(h.run(SAW, [220], 16384));
  const sharp = (pp) => { const b = Math.round(220 / bin); return Math.max(...pp.slice(b - 3, b + 4)) / pp.reduce((s, v) => s + v, 0); };
  check(sharp(p) < sharp(single) * 0.5, "Supersaw spreads the energy around each harmonic (detune)", `${sharp(p).toExponential(2)} vs ${sharp(single).toExponential(2)}`);
  const again = h.run(STACK, [220, 30], 16384);
  check(again.every((v, i) => v === out[i]), "Supersaw sounds the same every time (fixed start phases)");
}
{
  const out = h.run(FM, [440, 0], 8192);
  let worst = 0; for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - Math.sin(2 * Math.PI * (((i + 1) * 440 / SR) % 1))));
  check(worst < 1e-5, "FmOp without modulation is a sine", worst.toExponential(2));
  // with feedback it gets brighter: a sine has one line, feedback adds harmonics
  const fb = h.run(FM, [440, 0.8], 16384);
  const harmonic = (s) => { const p = spectrum(s), bin = SR / 16384; return Math.max(...p.slice(Math.round(880 / bin) - 3, Math.round(880 / bin) + 4)); };
  check(harmonic(fb) > 1e3 * harmonic(out.length === 16384 ? out : h.run(FM, [440, 0], 16384)), "FmOp feedback adds harmonics");
  const input = new Float32Array(8192).fill(0.25);
  const shifted = h.run(FM, [440, 0], 8192, input);
  check(Math.abs(shifted[0] - Math.sin(2 * Math.PI * (440 / SR + 0.25))) < 1e-5, "FmOp phase modulation is in cycles");
}

// ---- real time: nothing is allocated while processing ------------------------------------------------------------------------
for (const id of [NAIVE, SAW, SQUARE, TRI, SIN, TABLE, WT_SAW, STACK, FM]) {
  h.exports.setup(id, 440, 0.3, 0, 0, 0, 0);
  const bytes = h.allocated(() => { h.exports.process(4096); });
  check(bytes === 0, `unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
finish();
