// SPDX-License-Identifier: GPL-3.0-only
// bleep/delay: DelayLine reads, table interpolation, TapeDelay, KarplusStrong.   node test/dsp/delay.test.mjs
import { harness, check, finish, SR, rms, peak, finiteAll, responseAt, noise, spectrum } from "./lib.mjs";

const h = await harness("delay"), e = h.exports;
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const LIN = 0, CUBIC = 1, ALLPASS = 2, TAPE = 3, STRING = 4;
const impulse = (n) => { const a = new Float32Array(n); a[0] = 1; return a; };

// ---- DelayLine: whole-sample delays are exact in every mode --------------------------------------------------------------------
for (const [id, name] of [[LIN, "read"], [CUBIC, "readCubic"], [ALLPASS, "readAllpass"]]) {
  const d = 100;
  const out = h.run(id, [d], 400, impulse(400));
  const at = out.indexOf(Math.max(...out));
  check(at === d && near(out[d], 1, id === ALLPASS ? 0.5 : 1e-6), `${name}(${d}) delays an impulse by ${d} samples`, `peak at ${at}, ${out[at].toFixed(3)}`);
}
{
  const out = h.run(LIN, [0], 4, Float32Array.of(0.25, 0.5, 0.75, 1));
  check([...out].join() === "0.25,0.5,0.75,1", "read(0) is the sample just written");
  const x = noise(2000), o = h.run(LIN, [37], 2000, x);
  check([...o].slice(37).every((v, i) => v === x[i]), "read(37) is the input 37 samples ago, bit for bit");
}
{
  const out = h.run(LIN, [10.25], 64, impulse(64));
  check(near(out[10], 0.75, 1e-6) && near(out[11], 0.25, 1e-6), "read: linear interpolation between neighbours", `${out[10]} ${out[11]}`);
  const c = h.run(CUBIC, [10.5], 64, impulse(64));
  check(near(c.reduce((s, v) => s + v, 0), 1, 1e-5) && c[10] > 0.5 && c[11] > 0.5 && c[9] < 0 && c[12] < 0, "readCubic: Catmull-Rom kernel (sums to 1, symmetric, small negative lobes)", [...c.slice(8, 14)].map((v) => v.toFixed(3)).join(" "));
}
{
  // frequency response of the fractional-delay reads: linear dulls the highs, all-pass keeps the level
  const gain = (id, d, f) => responseAt(h, id, [d], f).gain;
  check(gain(LIN, 50.5, 12000) < -2, "read at a half sample dulls 12 kHz (linear interpolation)", gain(LIN, 50.5, 12000).toFixed(2));
  check(gain(CUBIC, 50.5, 12000) > gain(LIN, 50.5, 12000) + 1.5 && gain(CUBIC, 50.5, 5000) > -0.1, "readCubic keeps more of the highs than read", `${gain(CUBIC, 50.5, 12000).toFixed(2)} dB`);
  check(near(gain(ALLPASS, 50.7, 12000), 0, 0.05) && near(gain(ALLPASS, 50.7, 800), 0, 0.05), "readAllpass has a flat response", gain(ALLPASS, 50.7, 12000).toFixed(3));
  // and the delay it makes is the right one at low frequencies: phase = -2 pi f d / SR
  const ph = (id, d, f) => responseAt(h, id, [d], f).phase;
  const want = (d, f) => { let p = -2 * Math.PI * f * d / SR; return p - 2 * Math.PI * Math.round(p / (2 * Math.PI)); };
  check(near(ph(ALLPASS, 50.7, 200), want(50.7, 200), 0.03), "readAllpass delays low frequencies by the fractional amount", `${ph(ALLPASS, 50.7, 200).toFixed(3)} vs ${want(50.7, 200).toFixed(3)}`);
  check(near(ph(CUBIC, 50.3, 1000), want(50.3, 1000), 0.01) && near(ph(LIN, 50.3, 1000), want(50.3, 1000), 0.02), "read and readCubic have the requested delay at 1 kHz");
}
{
  const clamped = h.run(LIN, [1e6], 200, impulse(200));
  check(finiteAll(clamped), "read clamps a delay beyond the line");
  const neg = h.run(CUBIC, [-5], 8, Float32Array.of(1, 2, 3, 4, 5, 6, 7, 8));
  check(finiteAll(neg), "readCubic clamps a negative delay");
}

// ---- table interpolation -----------------------------------------------------------------------------------------------------------------------
{
  e.fillTable(1);   // ramp 0..63
  check(near(e.interp(0, 10.5), 10.5, 1e-5) && near(e.interp(1, 10.5), 10.5, 1e-4) && near(e.interp(2, 10.5), 10.5, 1e-4), "interpolators are exact on a ramp");
  check(near(e.interp(0, 63.5), 31.5, 1e-4), "interpLinear wraps around the end of the table (63 -> 0)");
  check(near(e.interp(0, 64 + 10.5), 10.5, 1e-5) && near(e.interp(0, -53.5), 10.5, 1e-4), "positions beyond the table wrap, negative ones too");
  check(near(e.interp(1, 7), 7, 1e-6) && near(e.interp(2, 7), 7, 1e-6) && near(e.interp(0, 7), 7, 1e-6), "all three pass through the table values");
  e.fillTable(2);   // cubic polynomial
  check(near(e.interp(2, 20.37), (20.37 ** 3) * 0.001, 2e-4), "interpLagrange is exact on a cubic polynomial", `${e.interp(2, 20.37)} vs ${(20.37 ** 3) * 0.001}`);
  e.fillTable(0);   // one sine over 64 points
  const err = (kind) => { let w = 0; for (let p = 0; p < 64; p += 0.137) w = Math.max(w, Math.abs(e.interp(kind, p) - Math.sin(2 * Math.PI * p / 64))); return w; };
  check(err(1) < err(0) / 5 && err(2) < err(0) / 5, "on a sine, cubic and Lagrange are far more accurate than linear", `linear ${err(0).toExponential(1)}, cubic ${err(1).toExponential(1)}, Lagrange ${err(2).toExponential(1)}`);
}

// ---- TapeDelay -------------------------------------------------------------------------------------------------------------------------------------
{
  const out = h.run(TAPE, [0.1, 0.5, 20000], 48000, impulse(48000));
  const echoes = []; for (let i = 1; i < out.length; i++) if (out[i] > 0.01 && out[i] >= out[i - 1] && out[i] >= out[i + 1]) echoes.push(i);
  check(near(echoes[0], 4800, 3) && near(echoes[1], 9600, 4) && out[echoes[1]] < out[echoes[0]] * 0.6 && out[echoes[1]] > out[echoes[0]] * 0.35, "TapeDelay: echoes at the delay time, each softer by the feedback", `${echoes.slice(0, 4).join(",")} ${out[echoes[0]].toFixed(3)} ${out[echoes[1]].toFixed(3)}`);
  const dark = h.run(TAPE, [0.1, 0.5, 800], 48000, impulse(48000));
  check(peak(dark, 0, 4700) === 0 || peak(dark, 0, 4700) < 1e-6, "TapeDelay: wet only (silent before the first echo)");
  // a burst of noise, one delay long: the first echo is the burst, the second has been round the loop once
  const burst = new Float32Array(30000); burst.set(noise(2400), 0);
  const hf = (s) => { const p = spectrum(s); let a = 0; for (let i = p.length / 2; i < p.length; i++) a += p[i]; return a; };
  const ratio = (tone) => { const o = h.run(TAPE, [0.05, 0.9, tone], 30000, burst); return hf(o.slice(4864, 4864 + 2048)) / hf(o.slice(2464, 2464 + 2048)); };
  check(ratio(500) < ratio(20000) / 20, "TapeDelay: tone darkens the repeats (the second echo has fewer highs than the first)", `${ratio(500).toExponential(2)} vs ${ratio(20000).toExponential(2)}`);
  const loud = h.run(TAPE, [0.01, 1.1, 20000], 48000, noise(48000));
  check(finiteAll(loud) && peak(loud) < 20, "TapeDelay: feedback above 1 stays bounded (the saturation limits it)", peak(loud).toFixed(2));
  // the delay time glides: a sine through a delay whose time changes bends in pitch, without a jump
  e.setup(TAPE, 0.05, 0, 20000, 0, 0, 0);
  const tone = new Float32Array(48000).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR));
  h.process(12000, tone);
  e.setTime(0.2);
  const bend = h.process(24000, tone.subarray(12000));
  let jump = 0; for (let i = 1; i < bend.length; i++) jump = Math.max(jump, Math.abs(bend[i] - bend[i - 1]));
  check(jump < 0.5 * 2 * Math.PI * 1500 / SR * 1.05, "TapeDelay: changing the time glides (no click)", jump.toFixed(3));
  let crossings = 0; for (let i = 1; i < 6000; i++) if (bend[i - 1] < 0 && bend[i] >= 0) crossings++;
  check(crossings < 6000 / 48, "TapeDelay: a lengthening delay lowers the pitch of the output while it glides", `${crossings} cycles in 6000 samples vs 125 for 1 kHz`);
}

// ---- KarplusStrong ----------------------------------------------------------------------------------------------------------------------------------
{
  const pitchOf = (sig) => {   // fundamental by autocorrelation: the first lag whose peak is within 10% of the best, refined by a parabola
    const n = sig.length, r = new Float64Array(2000);
    for (let lag = 20; lag < 2000; lag++) { let s = 0; for (let i = 0; i + lag < n; i++) s += sig[i] * sig[i + lag]; r[lag] = s; }
    let best = 0; for (let lag = 20; lag < 1999; lag++) best = Math.max(best, r[lag]);
    let lag = 21; while (lag < 1998 && !(r[lag] > 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1])) lag++;
    const a = r[lag - 1], b = r[lag], c = r[lag + 1];
    return SR / (lag + 0.5 * (a - c) / (a - 2 * b + c));
  };
  for (const f of [110, 220, 440, 880, 1760]) {
    const out = h.run(STRING, [f, 0.2, 0.999], 6000);
    const got = pitchOf(out.slice(2400, 6000));
    const cents = 1200 * Math.log2(got / f);
    check(Math.abs(cents) < 4, `KarplusStrong plays ${f} Hz in tune`, `${got.toFixed(2)} Hz (${cents.toFixed(2)} cents)`);
  }
  const ring = (damping, decay) => { const o = h.run(STRING, [220, damping, decay], 48000); return [rms(o, 0, 4800), rms(o, 43200, 48000)]; };
  const [a0, a1] = ring(0.2, 0.9995), [b0, b1] = ring(0.2, 0.95);
  check(a0 > 0.05 && a1 < a0 && a1 > b1 * 10, "KarplusStrong: decay sets how long the note rings", `${a1.toExponential(2)} vs ${b1.toExponential(2)}`);
  const bright = h.run(STRING, [220, 0.0, 0.999], 24000), mellow = h.run(STRING, [220, 0.5, 0.999], 24000);
  const hf = (s) => { const p = spectrum(s.slice(8192, 16384)); let a = 0, t = 0; for (let i = 0; i < 4096; i++) { t += p[i]; if (i > 800) a += p[i]; } return a / t; };
  check(hf(mellow) < hf(bright) / 5, "KarplusStrong: damping takes the highs away");
  const o = h.run(STRING, [220, 0.3, 0.998], 4000);
  check(peak(o) > 0.2 && peak(o) <= 1, "KarplusStrong: the pluck has the requested level", peak(o).toFixed(3));
  e.setup(STRING, 220, 0.3, 0.998, 0, 0, 0); h.process(4800);
  e.pluck(330);
  const second = h.process(6000);
  check(near(pitchOf(second.slice(2400)), 330, 330 * 0.004), "KarplusStrong: a second pluck retunes the string");
}

// ---- real time ---------------------------------------------------------------------------------------------------------------------------------------
for (const id of [LIN, CUBIC, ALLPASS, TAPE, STRING]) {
  e.setup(id, id === STRING ? 220 : 100.5, 0.5, 0.99, 0, 0, 0);
  const bytes = h.allocated(() => e.process(4096));
  check(bytes === 0, `delay unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
{
  e.setup(STRING, 220, 0.3, 0.998, 0, 0, 0);
  const bytes = h.allocated(() => e.pluck(440));
  check(bytes === 0, "KarplusStrong.pluck allocates nothing");
}
finish();
