// SPDX-License-Identifier: GPL-3.0-or-later
// bleep/fx (Reverb, Phaser, Chorus, PitchShift) and bleep/fft.   node test/dsp/fx.test.mjs
import { harness, check, finish, SR, rms, peak, finiteAll, spectrum, db, noise, responseAt } from "./lib.mjs";

const h = await harness("fx"), e = h.exports;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const [REV_L, REV_R, PHASER, PHASER_SWEEP, CHORUS_L, CHORUS_R, SHIFT] = [0, 1, 2, 3, 4, 5, 6];
const sine = (f, amp, n) => new Float32Array(n).map((_, i) => amp * Math.sin(2 * Math.PI * f * i / SR));
const impulse = (n) => { const a = new Float32Array(n); a[0] = 1; return a; };
const peakFreq = (sig, lo = 20, hi = 20000) => { const p = spectrum(sig), bin = SR / sig.length; let best = 0, at = 0; for (let i = Math.round(lo / bin); i < Math.round(hi / bin); i++) if (p[i] > best) { best = p[i]; at = i; } const a = p[at - 1], b = p[at], c = p[at + 1]; return (at + 0.5 * (a - c) / (a - 2 * b + c)) * bin; };

// ---- Reverb --------------------------------------------------------------------------------------------------------------------------------------------
{
  const n = SR * 6;
  const ir = (room, damp = 0.5, width = 1, id = REV_L) => h.run(id, [room, damp, width], n, impulse(n));
  const decayTime = (o) => { // time for the energy envelope (50 ms blocks) to fall 60 dB from its start
    const block = 2400, env = []; for (let i = 0; i + block <= o.length; i += block) env.push(db(rms(o, i, i + block) ** 2)); const top = Math.max(...env);
    for (let i = env.indexOf(top); i < env.length; i++) if (env[i] < top - 60) return (i - env.indexOf(top)) * block / SR; return Infinity;
  };
  const small = ir(0.2), mid = ir(0.7), big = ir(0.95);
  check(finiteAll(small) && finiteAll(mid) && finiteAll(big) && peak(big) < 5, "Reverb: stable at every room size", peak(big).toFixed(3));
  const tSmall = decayTime(small), tMid = decayTime(mid), tBig = decayTime(big);
  check(tSmall < tMid && tMid < tBig && tSmall > 0.2 && tSmall < 3, "Reverb: roomSize lengthens the tail", `${tSmall.toFixed(2)} s / ${tMid.toFixed(2)} s / ${tBig.toFixed(2)} s to -60 dB`);
  check(rms(mid, 0, 4800) > 0 && rms(mid, 4800, 24000) > 0.001, "Reverb: a tail follows the impulse");
  const first = mid.findIndex((v) => Math.abs(v) > 1e-6);
  check(first > 500 && first < 2000, "Reverb: the first reflections arrive after the shortest comb (~ 10-30 ms)", `${first} samples`);
  const L = ir(0.7, 0.5, 1, REV_L), R = ir(0.7, 0.5, 1, REV_R);
  let corr = 0, el = 0, er = 0; for (let i = 0; i < n; i++) { corr += L[i] * R[i]; el += L[i] * L[i]; er += R[i] * R[i]; }
  check(Math.abs(corr / Math.sqrt(el * er)) < 0.3, "Reverb: left and right are decorrelated at width 1", (corr / Math.sqrt(el * er)).toFixed(3));
  const L0 = ir(0.7, 0.5, 0, REV_L), R0 = ir(0.7, 0.5, 0, REV_R);
  check(L0.every((v, i) => Math.abs(v - R0[i]) < 1e-6), "Reverb: width 0 makes the channels equal");
  const bright = ir(0.8, 0.0), dark = ir(0.8, 1.0);
  const hf = (o) => { const p = spectrum(o.slice(12000, 12000 + 32768)); let a = 0, t = 0; for (let i = 0; i < p.length; i++) { t += p[i]; if (i > p.length / 4) a += p[i]; } return a / t; };
  check(hf(dark) < hf(bright) / 4, "Reverb: damping takes the highs out of the tail", `${hf(bright).toExponential(2)} -> ${hf(dark).toExponential(2)}`);
  const noisy = h.run(REV_L, [1.0, 0.0, 1], SR * 4, noise(SR * 4));
  check(finiteAll(noisy) && peak(noisy) < 10, "Reverb: loud noise at the maximum room stays bounded", peak(noisy).toFixed(2));
  const dc = h.run(REV_L, [0.9, 0.5, 1], SR * 2, new Float32Array(SR * 2).fill(1));
  check(finiteAll(dc) && Math.abs(dc[SR * 2 - 1]) < 8, "Reverb: a DC input settles");
}

// ---- Phaser ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const gains = (stages, fb, centre) => { const out = []; for (let f = 100; f < 12000; f *= 1.04) out.push([f, responseAt(h, PHASER, [stages, fb, centre], f, { n: 8192 }).gain]); return out; };
  const notches = (g) => g.filter((p, i) => i > 0 && i < g.length - 1 && p[1] < g[i - 1][1] && p[1] < g[i + 1][1] && p[1] < -6).map((p) => p[0]);
  for (const stages of [2, 4, 6, 8]) {
    const g = gains(stages, 0, 0.5), nn = notches(g);
    check(nn.length === stages / 2, `Phaser ${stages} stages: ${stages / 2} notch${stages > 2 ? "es" : ""} in the spectrum`, nn.map((f) => f.toFixed(0)).join(", "));
  }
  const g0 = gains(4, 0, 0.5), g9 = gains(4, 0.9, 0.5);
  const top = (g) => Math.max(...g.map((p) => p[1]));
  check(top(g9) > top(g0) + 6 && top(g9) > 6, "Phaser: feedback sharpens the peaks between the notches", `${top(g0).toFixed(1)} -> ${top(g9).toFixed(1)} dB`);
  const lowC = notches(gains(4, 0, 0)), highC = notches(gains(4, 0, 1));
  check(lowC[0] < highC[0] * 0.5, "Phaser: `centre` moves the notches", `${lowC[0].toFixed(0)} Hz vs ${highC[0].toFixed(0)} Hz`);
  check(near(responseAt(h, PHASER, [4, 0, 0.5], 50).gain, 0, 0.5) , "Phaser: bass passes unchanged (all-pass sum with dry is in phase)");
  const swept = h.run(PHASER_SWEEP, [6, 0.5], SR * 4, noise(SR * 4));
  check(finiteAll(swept) && rms(swept) > 0.3 && rms(swept) < 1.2, "Phaser: sweeping, it is audible and bounded", rms(swept).toFixed(3));
  const notchAt = (from) => { const o = h.run(PHASER_SWEEP, [2, 1], SR * 2, noise(SR * 2, 7)); const p = spectrum(o.slice(from, from + 4096)); let m = Infinity, k = 0; for (let i = 6; i < 600; i++) { const v = p[i] + p[i + 1] + p[i + 2]; if (v < m) { m = v; k = i; } } return k * SR / 4096; };
  const seen = new Set([0, 1, 2, 3].map((k) => Math.round(notchAt(2000 + k * 24000) / 100)));
  check(seen.size >= 2, "Phaser: with the LFO running, the notch moves", [...seen].join(" "));
  const long = h.run(PHASER, [4, 0.9, 0.5], SR * 4, noise(SR * 4));
  check(finiteAll(long) && peak(long) < 20, "Phaser: stable at feedback 0.9", peak(long).toFixed(2));
}

// ---- Chorus ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const n = SR * 2;
  const x = sine(1000, 0.5, n);
  const wet = h.run(CHORUS_L, [3, 1], n, x), dry = h.run(CHORUS_L, [3, 0], n, x);
  check(dry.every((v, i) => v === x[i]), "Chorus: mix 0 is the dry signal");
  const p = spectrum(wet.slice(12000, 12000 + 32768)), bin = SR / 32768;
  const around = (f, w) => { let s = 0; for (let i = Math.round((f - w) / bin); i < Math.round((f + w) / bin); i++) s += p[i]; return s; };
  check(around(1000, 12) < around(1000, 300) * 0.9 && around(1020, 40) > around(1000, 300) * 0.02 && around(1000, 300) > 0, "Chorus: the sweep spreads a sine into sidebands (pitch wobble)");
  let r = rms(wet, 12000, n) / rms(x, 12000, n);
  check(r > 0.6 && r < 1.1, "Chorus: loudness stays about the same", r.toFixed(3));
  const L = h.run(CHORUS_L, [3, 1], n, noise(n)), R = h.run(CHORUS_R, [3, 1], n, noise(n));
  check(L.some((v, i) => Math.abs(v - R[i]) > 0.05), "Chorus: the channels differ with 3 voices");
  const still = h.run(CHORUS_L, [0, 1], 4800, impulse(4800));
  const at = still.findIndex((v) => Math.abs(v) > 0.1);
  check(Math.abs(at - 720) <= 1, "Chorus: at depth 0 the voice is the dry signal delayed by delayMs (15 ms = 720 samples)", String(at));
  check(finiteAll(wet), "Chorus is finite");
}

// ---- PitchShift ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const n = SR * 2, x = sine(1000, 0.5, n);
  for (const [ratio, name] of [[2 ** (7 / 12), "up a fifth"], [0.5, "down an octave"], [2, "up an octave"], [2 ** (-3 / 12), "down a minor third"]]) {
    const o = h.run(SHIFT, [ratio], n, x);
    const f = peakFreq(o.slice(20000, 20000 + 32768), 100, 10000);
    check(near(f / (1000 * ratio), 1, 0.01), `PitchShift ${name}: a 1 kHz sine comes out at ${(1000 * ratio).toFixed(0)} Hz`, `${f.toFixed(1)} Hz`);
    const p = spectrum(o.slice(20000, 20000 + 32768)), bin = SR / 32768;
    let main = 0, all = 0; for (let i = 0; i < p.length; i++) { all += p[i]; if (Math.abs(i * bin - 1000 * ratio) < 60) main += p[i]; }
    check(main / all > 0.8, `PitchShift ${name}: most of the energy is at the shifted pitch`, (main / all).toFixed(3));
    check(near(rms(o, 20000, n) / rms(x, 20000, n), 1, 0.2), `PitchShift ${name}: level is kept`, (rms(o, 20000, n) / rms(x, 20000, n)).toFixed(3));
  }
  const same = h.run(SHIFT, [1], n, x);
  check(near(peakFreq(same.slice(20000, 20000 + 32768)) / 1000, 1, 0.002) && near(rms(same, 20000, n) / rms(x, 20000, n), 1, 0.02), "PitchShift ratio 1: passes the pitch and the level");
  check(finiteAll(h.run(SHIFT, [3.7], n, noise(n))) && finiteAll(h.run(SHIFT, [0.2], n, noise(n))), "PitchShift: extreme ratios are finite");
}

// ---- Fft ---------------------------------------------------------------------------------------------------------------------------------------------------
{
  const mem = () => new Float32Array(e.memory.buffer);
  const IN = () => e.inPtr() >>> 2, OUT = () => e.outPtr() >>> 2;
  const transform = (re, im, inverse = false) => {
    const m = mem(), n = re.length; m.set(re, IN()); m.set(im, IN() + n);
    inverse ? e.fftInverse() : e.fftForward();
    return [m.slice(OUT(), OUT() + n), m.slice(OUT() + n, OUT() + 2 * n)];
  };
  const dft = (re, im) => { const n = re.length, or = new Float64Array(n), oi = new Float64Array(n); for (let k = 0; k < n; k++) for (let t = 0; t < n; t++) { const a = -2 * Math.PI * k * t / n; or[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a); oi[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a); } return [or, oi]; };
  for (const n of [2, 8, 64, 256]) {
    e.fftSetup(n);
    const re = noise(n, 3), im = noise(n, 4);
    const [fr, fi] = transform(re, im), [dr, di] = dft(re, im);
    let worst = 0; for (let k = 0; k < n; k++) worst = Math.max(worst, Math.abs(fr[k] - dr[k]), Math.abs(fi[k] - di[k]));
    check(worst < 1e-4 * n, `Fft ${n}: forward matches the DFT`, worst.toExponential(2));
    const [br, bi] = transform(fr, fi, true);
    let back = 0; for (let k = 0; k < n; k++) back = Math.max(back, Math.abs(br[k] - re[k]), Math.abs(bi[k] - im[k]));
    check(back < 1e-5, `Fft ${n}: inverse(forward(x)) is x`, back.toExponential(2));
  }
  for (const n of [1024, 4096]) {
    e.fftSetup(n);
    const f0 = 37.5 * SR / n, re = sine(f0, 1, n), im = new Float32Array(n);
    const [fr, fi] = transform(re, im);
    let bestK = 0, best = 0; for (let k = 0; k < n / 2; k++) { const m = Math.hypot(fr[k], fi[k]); if (m > best) { best = m; bestK = k; } }
    check(bestK === 38 || bestK === 37, `Fft ${n}: a sine shows up in the right bin`, `bin ${bestK}`);
    e.fftSetup(n); transform(re, im);
    check(near(e.fftMagnitude(bestK), best, 1e-3 * best), `Fft ${n}: magnitude(k)`);
    let timeE = 0, freqE = 0; for (let i = 0; i < n; i++) { timeE += re[i] * re[i]; freqE += fr[i] * fr[i] + fi[i] * fi[i]; }
    check(near(freqE / n / timeE, 1, 1e-3), `Fft ${n}: Parseval`, (freqE / n / timeE).toFixed(5));
  }
  e.fftSetup(256); e.fftHann();
  const w = mem().slice(OUT(), OUT() + 256);
  check(near(w[0], 0, 1e-6) && near(w[128], 1, 1e-6) && near(w[64], 0.5, 1e-4), "Fft.applyHann");
  const [ir, ii] = transform(Float32Array.from({ length: 256 }, (_, i) => (i === 0 ? 1 : 0)), new Float32Array(256));
  check(ir.every((v) => near(v, 1, 1e-6)) && ii.every((v) => near(v, 0, 1e-6)), "Fft: an impulse has a flat spectrum");
  e.fftSetup(1024);
  mem().fill(0.25, IN(), IN() + 2048);
  const bytes = h.allocated(() => { e.fftForward(); e.fftInverse(); });
  check(bytes === 0, "Fft: forward and inverse allocate nothing", bytes ? bytes + " bytes" : "");
}

// ---- real time ----------------------------------------------------------------------------------------------------------------------------------------------
for (let id = 0; id <= 6; id++) {
  e.setup(id, id === PHASER || id === PHASER_SWEEP ? 4 : 0.5, 0.5, 1, 0, 0, 0);
  const bytes = h.allocated(() => e.process(4096));
  check(bytes === 0, `fx unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
finish();
