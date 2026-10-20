// SPDX-License-Identifier: GPL-3.0-or-later
// bleep/filters and the new Biquad modes: frequency response, stability, allocation-free processing.   node test/dsp/filters.test.mjs
import { harness, check, finish, SR, responseAt, gainAt, rms, peak, finiteAll, spectrum, db, noise } from "./lib.mjs";

const h = await harness("filters");
const [BQ_LP, BQ_HP, BQ_BP, BQ_NOTCH, BQ_AP, OP_LP, OP_HP] = [0, 1, 2, 3, 4, 5, 6];
const [SVF_LOW, SVF_HIGH, SVF_BAND, SVF_BANDU, SVF_NOTCH, SVF_PEAK, SVF_ALL] = [7, 8, 9, 10, 11, 12, 13];
const [LADDER, RESONZ, FORMANT, AP1, AP2, COMB] = [20, 21, 22, 23, 24, 25];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const g = (id, params, f) => gainAt(h, id, params, f);
const BUTTER = Math.SQRT1_2;

// ---- Biquad modes ------------------------------------------------------------------------------------------------------------------------
check(near(g(BQ_LP, [1000, BUTTER], 1000), -3.01, 0.1) && g(BQ_LP, [1000, BUTTER], 100) > -0.1 && g(BQ_LP, [1000, BUTTER], 8000) < -30, "Biquad lowpass: -3 dB at the cutoff, flat below, steep above");
check(near(g(BQ_HP, [1000, BUTTER], 1000), -3.01, 0.1) && g(BQ_HP, [1000, BUTTER], 10000) > -0.1 && g(BQ_HP, [1000, BUTTER], 125) < -30, "Biquad highpass: -3 dB at the cutoff, flat above, steep below");
check(near(g(BQ_BP, [1000, 4], 1000), 0, 0.1) && g(BQ_BP, [1000, 4], 250) < -10 && g(BQ_BP, [1000, 4], 4000) < -10, "Biquad bandpass: 0 dB at the centre, down away from it");
{
  const bw = (q) => { let lo = 0, hi = 0; for (let f = 300; f < 1000; f += 1) if (!lo && g(BQ_BP, [1000, q], f) > -3.01) lo = f; for (let f = 3000; f > 1000; f -= 1) if (!hi && g(BQ_BP, [1000, q], f) > -3.01) hi = f; return hi - lo; };
  check(near(bw(5), 200, 8), "Biquad bandpass: bandwidth is centre / q", String(bw(5)));
}
check(g(BQ_NOTCH, [1000, 2], 1000) < -45 && near(g(BQ_NOTCH, [1000, 2], 100), 0, 0.3) && near(g(BQ_NOTCH, [1000, 2], 10000), 0, 0.3), "Biquad notch: silent at the centre, flat elsewhere");
for (const f of [50, 500, 1000, 3000, 15000]) check(near(g(BQ_AP, [1000, 1], f), 0, 0.01), `Biquad allpass: unit gain at ${f} Hz`);
check(Math.abs(Math.abs(responseAt(h, BQ_AP, [1000, 1], 1000).phase) - Math.PI) < 0.05, "Biquad allpass: half a cycle of phase at the centre");

// ---- OnePole ---------------------------------------------------------------------------------------------------------------------------------
check(near(g(OP_LP, [2000], 2000), -3.01, 0.3) && g(OP_LP, [2000], 100) > -0.1, "OnePole lowpass: -3 dB at the cutoff, flat below", g(OP_LP, [2000], 2000).toFixed(2));
check(near(g(OP_LP, [200], 2000) - g(OP_LP, [200], 4000), 6, 0.6), "OnePole lowpass: 6 dB per octave", (g(OP_LP, [200], 2000) - g(OP_LP, [200], 4000)).toFixed(2));
check(near(g(OP_HP, [2000], 2000), -3.01, 0.3) && g(OP_HP, [2000], 20000) > -0.5, "OnePole highpass: -3 dB at the cutoff, flat above", g(OP_HP, [2000], 2000).toFixed(2));
check(near(g(OP_HP, [2000], 100) - g(OP_HP, [2000], 200), -6, 0.3), "OnePole highpass: 6 dB per octave");
{
  const out = h.run(OP_LP, [100], 48000, new Float32Array(48000).fill(1));
  check(near(out[47999], 1, 1e-4) && out[0] < 0.02, "OnePole lowpass settles on a DC step");
  const hp = h.run(OP_HP, [100], 48000, new Float32Array(48000).fill(1));
  check(Math.abs(hp[47999]) < 1e-4, "OnePole highpass removes DC");
}

// ---- Svf ----------------------------------------------------------------------------------------------------------------------------------------
check(near(g(SVF_LOW, [1000, BUTTER], 1000), -3.01, 0.15) && g(SVF_LOW, [1000, BUTTER], 100) > -0.1 && g(SVF_LOW, [1000, BUTTER], 8000) < -30, "Svf low-pass matches a Butterworth 2-pole");
check(near(g(SVF_HIGH, [1000, BUTTER], 1000), -3.01, 0.15) && g(SVF_HIGH, [1000, BUTTER], 10000) > -0.1 && g(SVF_HIGH, [1000, BUTTER], 125) < -30, "Svf high-pass");
check(near(g(SVF_BANDU, [1000, 4], 1000), 0, 0.1) && near(g(SVF_BAND, [1000, 4], 1000), 12.04, 0.2), "Svf band-pass: peak gain q (raw) or 1 (bandUnity)");
check(g(SVF_NOTCH, [1000, 2], 1000) < -45 && near(g(SVF_NOTCH, [1000, 2], 100), 0, 0.3), "Svf notch");
check(Number.isFinite(g(SVF_PEAK, [1000, 2], 100)) && near(g(SVF_PEAK, [1000, 2], 100), 0, 1) && g(SVF_PEAK, [1000, 2], 1000) > 3, "Svf peak: flat away from the cutoff, boosted at it");
for (const f of [100, 1000, 9000]) check(near(g(SVF_ALL, [1000, 3], f), 0, 0.01), `Svf all-pass: unit gain at ${f} Hz`);
{
  // modulating the cutoff fast must stay stable and bounded
  const n = 48000, nz = noise(n);
  const out = h.run(SVF_LOW, [18000, 20], n, nz);
  check(finiteAll(out) && peak(out) < 200, "Svf with q = 20 at 18 kHz stays bounded on nz", peak(out).toFixed(2));
  const hi = h.run(SVF_LOW, [30000, 0.5], 4096, nz);
  check(finiteAll(hi), "Svf with a cutoff above Nyquist is clamped, not unstable");
}

// ---- Ladder ------------------------------------------------------------------------------------------------------------------------------------
{
  const lp = (res, drive = 0.01) => (f) => gainAt(h, LADDER, [1000, res, drive], f, { amp: 1 }) - 20 * Math.log10(drive);   // small signals so tanh is linear
  const low = lp(0);
  check(near(low(50), 0, 0.3), "Ladder: unity gain in the passband (resonance 0)", low(50).toFixed(2));
  check(near(low(1000), -12, 1.5), "Ladder: -12 dB at the cutoff with no resonance (four poles, -3 dB each)", low(1000).toFixed(2));
  check(near(low(8000) - low(4000), -24, 4), "Ladder: 24 dB per octave", (low(8000) - low(4000)).toFixed(2));
  const res = lp(0.9);
  let best = -99, at = 0; for (let f = 400; f < 1600; f += 25) { const v = res(f); if (v > best) { best = v; at = f; } }
  check(best - res(50) > 15 && near(at, 1000, 250), "Ladder: resonance 0.9 makes a peak near the cutoff", `${best.toFixed(1)} dB at ${at} Hz`);
  check(res(50) < low(50) - 3, "Ladder: the passband level drops as the resonance rises (like the real thing)");
  const n = 96000, nz = noise(n);
  const hot = h.run(LADDER, [3000, 1.2, 4], n, nz);
  check(finiteAll(hot) && peak(hot) < 3, "Ladder: stays bounded with resonance 1.2 and drive 4 on nz (tanh limits it)", peak(hot).toFixed(2));
  const click = new Float32Array(48000); click[0] = 0.5;
  const ring = h.run(LADDER, [1000, 1.0, 1], 48000, click);
  check(rms(ring, 40000, 48000) > 0.01, "Ladder: self-oscillates at resonance 1 (the ring does not die away)", rms(ring, 40000, 48000).toExponential(2));
  const calm = h.run(LADDER, [1000, 0.3, 1], 48000, click);
  check(rms(calm, 40000, 48000) < 1e-5, "Ladder: rings out at resonance 0.3");
  const sine = (amp) => new Float32Array(16384).map((_, i) => amp * Math.sin(2 * Math.PI * 1000.5 * i / SR));
  const third = (drive, amp) => { const p = spectrum(h.run(LADDER, [8000, 0, drive], 16384, sine(amp))), bin = SR / 16384, at = (f) => Math.max(...p.slice(Math.round(f / bin) - 3, Math.round(f / bin) + 4)); return db(at(3001.5) / at(1000.5)); };
  check(third(1, 0.01) < -70 && third(10, 1) > -40, "Ladder: the tanh stages distort loud, driven signals and leave quiet ones clean", `${third(1, 0.01).toFixed(1)} dB vs ${third(10, 1).toFixed(1)} dB third harmonic`);
}

// ---- Resonz, Formant ------------------------------------------------------------------------------------------------------------------------
{
  check(near(g(RESONZ, [1000, 100], 1000), 0, 0.15), "Resonz: unity gain at the centre", g(RESONZ, [1000, 100], 1000).toFixed(2));
  check(near(g(RESONZ, [1000, 100], 950), -3, 1.0) && near(g(RESONZ, [1000, 100], 1050), -3, 1.0), "Resonz: -3 dB at centre +- bandwidth / 2", `${g(RESONZ, [1000, 100], 950).toFixed(2)} / ${g(RESONZ, [1000, 100], 1050).toFixed(2)}`);
  check(g(RESONZ, [1000, 100], 100) < -20 && g(RESONZ, [1000, 100], 10000) < -20, "Resonz: far frequencies are cut");
}
{
  const n = 16384, nz = noise(n);
  const peakAt = (vowel) => { const p = spectrum(h.run(FORMANT, [vowel, 1], n, nz)); let best = 0, at = 0; for (let b = 20; b < n / 2 * 0.25; b++) if (p[b] > best) { best = p[b]; at = b; } return at * SR / n; };
  const a = peakAt(0), i = peakAt(2);
  check(a > 600 && a < 1300 && i < 500 || i > 1500, "Formant: the strongest peak sits at the vowel's first formants (a near 800-1150 Hz, i near 350 or 1700 Hz)", `a ${a.toFixed(0)} Hz, i ${i.toFixed(0)} Hz`);
  const mid = h.run(FORMANT, [1.5, 1], n, nz), end = h.run(FORMANT, [4, 1], n, nz), past = h.run(FORMANT, [9, 1], n, nz);
  check(finiteAll(mid) && finiteAll(end) && finiteAll(past) && rms(mid) > 0 && rms(past) > 0, "Formant: morphing and out-of-range positions are fine");
  const lowF = peakAt(0), shifted = (() => { const p = spectrum(h.run(FORMANT, [0, 1.5], n, nz)); let best = 0, at = 0; for (let b = 20; b < n / 2 * 0.25; b++) if (p[b] > best) { best = p[b]; at = b; } return at * SR / n; })();
  check(shifted > lowF * 1.2, "Formant: shift raises the formants", `${lowF.toFixed(0)} -> ${shifted.toFixed(0)} Hz`);
}

// ---- Allpass1, Allpass2 ---------------------------------------------------------------------------------------------------------------------
for (const f of [60, 800, 5000, 16000]) check(near(g(AP1, [800], f), 0, 0.01), `Allpass1: unit gain at ${f} Hz`);
check(near(responseAt(h, AP1, [800], 800).phase, -Math.PI / 2, 0.05), "Allpass1: a quarter cycle of lag at the frequency", responseAt(h, AP1, [800], 800).phase.toFixed(3));
check(Math.abs(responseAt(h, AP1, [800], 40).phase) < 0.15 && Math.abs(responseAt(h, AP1, [800], 20000).phase) > 2.5, "Allpass1: no phase at DC, half a cycle at Nyquist");
for (const f of [60, 800, 5000, 16000]) check(near(g(AP2, [800, 2], f), 0, 0.01), `Allpass2: unit gain at ${f} Hz`);
check(Math.abs(Math.abs(responseAt(h, AP2, [800, 2], 800).phase) - Math.PI) < 0.05, "Allpass2: half a cycle of lag at the frequency");

// ---- CombFilter ----------------------------------------------------------------------------------------------------------------------------------
{
  const D = 48;   // 1 ms: lines at 1 kHz multiples
  check(g(COMB, [D, 1, 0], 500) < -40 && near(g(COMB, [D, 1, 0], 1000), 6.02, 0.1), "CombFilter feedforward: notch at 500 Hz, +6 dB at 1 kHz");
  check(near(g(COMB, [D, 0, 0.9], 1000), 20, 0.5) && near(g(COMB, [D, 0, 0.9], 500), -5.58, 0.3), "CombFilter feedback: peaks of 1 / (1 - g) at multiples of sampleRate / D", `${g(COMB, [D, 0, 0.9], 1000).toFixed(2)} / ${g(COMB, [D, 0, 0.9], 500).toFixed(2)}`);
  const click = new Float32Array(9600); click[0] = 1;
  const ir = h.run(COMB, [D, 0, 0.5], 9600, click);
  check(near(ir[0], 1, 1e-6) && near(ir[D], 0.5, 1e-6) && near(ir[2 * D], 0.25, 1e-6), "CombFilter feedback: the echoes decay by the feedback", `${ir[D]} ${ir[2 * D]}`);
  const fir = h.run(COMB, [D, 0.7, 0], 9600, click);
  check(near(fir[D], 0.7, 1e-6) && fir[2 * D] === 0, "CombFilter feedforward: one echo");
  const frac = h.run(COMB, [10.5, 1, 0], 64, click);
  check(near(frac[10], 0.5, 1e-6) && near(frac[11], 0.5, 1e-6), "CombFilter: fractional delay is interpolated");
  const nz = noise(48000);
  check(finiteAll(h.run(COMB, [2000, 0.5, 0.99], 48000, nz)) && peak(h.run(COMB, [2000, 0.5, 0.99], 48000, nz)) < 200, "CombFilter at feedback 0.99 stays finite");
}

// ---- real time ------------------------------------------------------------------------------------------------------------------------------------
for (const id of [0, 1, 2, 3, 4, 5, 6, 7, 10, 13, 20, 21, 22, 23, 24, 25]) {
  h.exports.setup(id, 1000, 1, 1, 0, 0, 0);
  const bytes = h.allocated(() => h.exports.process(4096));
  check(bytes === 0, `filter unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
void db;
finish();
