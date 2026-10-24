// SPDX-License-Identifier: GPL-3.0-only
// bleep/random: seeded generators, the noise colours (spectral slope), sample and hold, NoiseLfo.   node test/dsp/random.test.mjs
import { harness, check, finish, SR, rms, peak, finiteAll, spectrum, noise } from "./lib.mjs";

const h = await harness("random"), e = h.exports;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const [XS, XSB, LCG, LCGB, WHITEFN, WHITE, PINK, BROWN, SH, LFO] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// ---- the generators ----------------------------------------------------------------------------------------------------------------------------
{
  // xorshift32 (13, 17, 5) from seed 1 is the published sequence: 270369, 67634689, 2647435461
  check(e.firstU32(1) === 270369, "Xorshift(1) starts with 270369 (the reference xorshift32 sequence)", String(e.firstU32(1)));
  check(e.firstU32(0) !== 0 && e.firstU32(0) === e.firstU32(0), "Xorshift: seed 0 is replaced, not stuck");
  check(e.firstLcg(1) === ((1664525 + 1013904223) >>> 0), "Lcg(1) starts with a * 1 + c");
}
for (const [id, name, lo] of [[XS, "Xorshift.next", 0], [XSB, "Xorshift.nextBipolar", -1], [LCG, "Lcg.next", 0], [LCGB, "Lcg.nextBipolar", -1]]) {
  const a = h.run(id, [0, 0, 12345], 100000);
  const min = Math.min(...a), max = Math.max(...a), m = mean(a);
  const range = lo === 0 ? 1 : 2;
  check(min >= lo && max < lo + range && min < lo + 0.001 * range && max > lo + 0.999 * range, `${name} stays in [${lo}, ${lo + range}) and reaches both ends`, `${min.toFixed(5)}..${max.toFixed(5)}`);
  check(near(m, lo + range / 2, 0.005), `${name} is centred`, m.toFixed(4));
  // uniform: 10 bins each hold 10% +- 0.5%
  const bins = new Array(10).fill(0); for (const v of a) bins[Math.min(9, Math.floor((v - lo) / range * 10))]++;
  check(bins.every((c) => near(c / a.length, 0.1, 0.006)), `${name} is uniformly spread`, bins.map((c) => (c / 1000).toFixed(1)).join(" "));
  const b = h.run(id, [0, 0, 12345], 1000), c = h.run(id, [0, 0, 54321], 1000);
  check(a.slice(0, 1000).every((v, i) => v === b[i]) && c.some((v, i) => v !== b[i]), `${name}: the same seed repeats, another seed differs`);
  // serial correlation of neighbours is small
  let num = 0, den = 0; for (let i = 1; i < a.length; i++) { num += (a[i] - m) * (a[i - 1] - m); } for (const v of a) den += (v - m) ** 2;
  check(Math.abs(num / den) < 0.01, `${name}: neighbours are uncorrelated`, (num / den).toFixed(4));
}
{
  const a = h.run(WHITEFN, [0, 0, 7], 4000), b = h.run(XSB, [0, 0, 7], 4000), c = h.run(WHITE, [0, 0, 7], 4000);
  check(a.every((v, i) => v === b[i]) && c.every((v, i) => v === b[i]), "whiteNoise(rng) and WhiteNoise are the generator's nextBipolar");
}

// ---- noise colour: the slope of the power spectrum (log power against log frequency) -------------------------------------------------
const slope = (sig, from = 100) => {
  const N = 1 << 15; let acc = new Float64Array(N / 2);
  for (let k = 0; k + N <= sig.length; k += N) { const p = spectrum(sig.slice(k, k + N)); for (let i = 0; i < p.length; i++) acc[i] += p[i]; }
  // octave bands from 100 Hz to 10 kHz: mean power per bin, regressed on the band's centre frequency
  const pts = [];
  for (let lo = from; lo * 2 <= 12800; lo *= 2) {
    const a = Math.round(lo * N / SR), b = Math.round(lo * 2 * N / SR); let s = 0; for (let i = a; i < b; i++) s += acc[i];
    pts.push([Math.log2(lo * Math.SQRT2), Math.log2(s / (b - a))]);
  }
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  return pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
};
{
  const n = 1 << 18;
  const sw = slope(h.run(WHITE, [0, 0, 1], n)), sp = slope(h.run(PINK, [0, 0, 1], n)), sb = slope(h.run(BROWN, [0, 0, 1], n), 400);
  check(Math.abs(sw) < 0.1, "white noise: flat spectrum (slope 0 per octave)", sw.toFixed(3));
  check(Math.abs(sp + 1) < 0.1, "PinkNoise: power falls 1 per octave in log2 terms (-3 dB per octave)", sp.toFixed(3));
  check(Math.abs(sb + 2) < 0.15, "BrownNoise: -2 (-6 dB per octave) above its 150 Hz corner", sb.toFixed(3));
  const pk = h.run(PINK, [0, 0, 1], 200000), br = h.run(BROWN, [0, 0, 1], 200000);
  check(peak(pk) <= 1 && rms(pk) > 0.05 && rms(pk) < 0.4, "PinkNoise: level inside -1..1", `peak ${peak(pk).toFixed(2)} rms ${rms(pk).toFixed(3)}`);
  check(peak(br) <= 1.0 && rms(br) > 0.05 && Math.abs(mean(br)) < 0.1, "BrownNoise: level inside -1..1 and no DC runaway", `peak ${peak(br).toFixed(2)} rms ${rms(br).toFixed(3)} mean ${mean(br).toFixed(3)}`);
  check(finiteAll(pk) && finiteAll(br), "noise is finite");
}

// ---- SampleAndHold ---------------------------------------------------------------------------------------------------------------------------------
{
  const x = new Float32Array(2000).map((_, i) => i / 2000);
  const out = h.run(SH, [100, 0, 1], 2000, x);   // gate high for 50 samples of each 100
  check(out[0] === 0 || out[0] === x[0] || out[0] === x[1], "SampleAndHold: starts with the first sample taken at the rising edge");
  let ok = true, steps = 0; for (let i = 1; i < 2000; i++) { if (out[i] !== out[i - 1]) { steps++; if ((i + 1) % 100 !== 0) ok = false; } }
  check(ok && steps >= 18 && steps <= 20, "SampleAndHold: changes only at rising gate edges", `${steps} steps`);
  check(out.every((v, i) => v <= x[i] + 1e-6), "SampleAndHold: never ahead of the input");
}

// ---- NoiseLfo ----------------------------------------------------------------------------------------------------------------------------------------
{
  const n = 48000 * 4, rate = 5;
  const smooth = h.run(LFO, [rate, 1], n), stepped = h.run(LFO, [rate, 0], n);
  check(peak(smooth) <= 1 && peak(stepped) <= 1 && peak(smooth) > 0.5 && rms(smooth) > 0.2, "NoiseLfo: bipolar and moving", `peak ${peak(smooth).toFixed(2)} rms ${rms(smooth).toFixed(2)}`);
  let maxStep = 0; for (let i = 1; i < n; i++) maxStep = Math.max(maxStep, Math.abs(smooth[i] - smooth[i - 1]));
  check(maxStep < 2 * 1.5 / (SR / rate), "NoiseLfo smooth: continuous, no jumps", maxStep.toExponential(2));
  let changes = 0; for (let i = 1; i < n; i++) if (stepped[i] !== stepped[i - 1]) changes++;
  check(changes >= rate * 4 - 2 && changes <= rate * 4 + 2, "NoiseLfo stepped: picks `rate` new values a second", String(changes));
  const p = spectrum(smooth.slice(0, 1 << 17)), bin = SR / (1 << 17);
  let low = 0, high = 0; for (let i = 0; i < p.length; i++) (i * bin < 4 * rate ? (low += p[i]) : (high += p[i]));
  check(low > 20 * high, "NoiseLfo smooth: the energy is near the rate, not in the audio band", (low / high).toFixed(0));
  const again = h.run(LFO, [rate, 1], n);
  check(again.every((v, i) => v === smooth[i]), "NoiseLfo: same seed, same wander");
}

// ---- real time -----------------------------------------------------------------------------------------------------------------------------------------
for (let id = 0; id <= 9; id++) {
  e.setup(id, 10, 1, 5, 0, 0, 0);
  const bytes = h.allocated(() => e.process(4096));
  check(bytes === 0, `random unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
void noise;
finish();
