// SPDX-License-Identifier: GPL-3.0-or-later
// bleep/util: ranges, pitch conversion, fast approximations, pan and mid/side, Rms.   node test/dsp/util.test.mjs
import { harness, check, finish, SR } from "./lib.mjs";

const h = await harness("util"), e = h.exports;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// pitch
check(near(e.midiToHz(69), 440) && near(e.midiToHz(60), 261.6255653005986) && near(e.midiToHz(81), 880), "midiToHz");
check(near(e.hzToMidi(440), 69) && near(e.hzToMidi(e.midiToHz(33.5)), 33.5), "hzToMidi inverts midiToHz");
check(near(e.hzToPitch(261.6255653005986), 0, 1e-9) && near(e.hzToPitch(523.2511306011972), 1) && near(e.hzToPitch(130.8127826502993), -1), "hzToPitch: C4 = 0, one octave = 1");
check(near(e.semitones(12), 2) && near(e.semitones(-12), 0.5) && near(e.semitones(7), 1.4983070768766815), "semitones is a ratio");
check(Number.isFinite(e.hzToMidi(0)) && Number.isFinite(e.hzToPitch(-5)), "hzToMidi and hzToPitch stay finite at 0 Hz");

// ranges
check(e.clamp(2, -1, 1) === 1 && e.clamp(-2, -1, 1) === -1 && e.clamp(0.25, -1, 1) === 0.25, "clamp");
check(near(e.wrap(1.25, 0, 1), 0.25) && near(e.wrap(-0.25, 0, 1), 0.75) && near(e.wrap(7, 2, 5), 4) && near(e.wrap(1, 0, 1), 0), "wrap");
check(near(e.fold(1.25, -1, 1), 0.75) && near(e.fold(-1.25, -1, 1), -0.75) && near(e.fold(3.5, -1, 1), -0.5) && near(e.fold(0.3, -1, 1), 0.3) && near(e.fold(1, -1, 1), 1), "fold mirrors at both ends");
check(e.mix(2, 4, 0) === 2 && e.mix(2, 4, 1) === 4 && e.mix(2, 4, 0.5) === 3, "mix");
check(near(e.mapRange(5, 0, 10, 100, 200), 150) && near(e.mapRange(0, -1, 1, 0, 1), 0.5) && near(e.mapRange(2, 0, 1, 0, 10), 20), "mapRange");
check(near(e.expMap(0, 20, 20000), 20) && near(e.expMap(1, 20, 20000), 20000) && near(e.expMap(0.5, 20, 20000), Math.sqrt(20 * 20000)), "expMap");

// fast approximations over their ranges
{
  const xs = new Float32Array(2001).map((_, i) => -8 + i * 0.008);
  let worst = 0; const out = h.run(0, [], xs.length, xs);
  xs.forEach((x, i) => { worst = Math.max(worst, Math.abs(out[i] - Math.tanh(x))); });
  check(worst < 1.1e-4, "fastTanh", worst.toExponential(2));
  const big = h.run(0, [], 3, Float32Array.of(100, -100, 0));
  check(big[0] === 1 && big[1] === -1 && big[2] === 0, "fastTanh saturates at +-1 and passes 0");
}
{
  const xs = new Float32Array(2001).map((_, i) => -20 + i * 0.02);
  let worst = 0; const out = h.run(1, [], xs.length, xs);
  xs.forEach((x, i) => { worst = Math.max(worst, Math.abs(out[i] / 2 ** x - 1)); });
  check(worst < 3e-7, "fastExp2 (relative error)", worst.toExponential(2));
  const edge = h.run(1, [], 2, Float32Array.of(-500, 500));
  check(Number.isFinite(edge[0]) && Number.isFinite(edge[1]) && edge[0] >= 0 && edge[1] > 1e30, "fastExp2 clamps instead of overflowing");
}
{
  const xs = new Float32Array(2001).map((_, i) => 0.01 + i * 0.05);
  let worst = 0; const out = h.run(2, [], xs.length, xs);
  xs.forEach((x, i) => { worst = Math.max(worst, Math.abs(out[i] - Math.log2(x))); });
  check(worst < 2e-6, "fastLog2 (absolute error)", worst.toExponential(2));
  const pw = h.run(4, [], 3, Float32Array.of(2, 10, 0.5));
  check(near(pw[0], 2 ** 1.7, 1e-4) && near(pw[1], 10 ** 1.7, 1e-4) && near(pw[2], 0.5 ** 1.7, 1e-4), "fastPow2 is base ^ exponent to about 4 digits", [...pw].join(","));
}

// pan, crossfade, mid/side
{
  const w = (p) => { e.panEq(p); return [e.panLeft(), e.panRight()]; };
  const [cl, cr] = w(0), [ll, lr] = w(-1), [rl, rr] = w(1);
  check(near(cl, Math.SQRT1_2) && near(cr, Math.SQRT1_2), "equal-power pan: -3 dB in the middle");
  check(near(ll, 1) && Math.abs(lr) < 1e-6 && Math.abs(rl) < 1e-6 && near(rr, 1), "equal-power pan: hard left and right");
  let worst = 0; for (let p = -1; p <= 1; p += 0.05) { const [l, r] = w(p); worst = Math.max(worst, Math.abs(l * l + r * r - 1)); }
  check(worst < 1e-6, "equal-power pan keeps the power constant", worst.toExponential(2));
  e.panLin(0.5); check(near(e.panLeft(), 0.25) && near(e.panRight(), 0.75), "linear pan");
  const [ol] = w(5); check(near(ol, 0, 1e-6) || ol < 1e-6, "pan clamps beyond +-1");
}
{
  const m = e.encodeMid(0.8, 0.2), s = e.encodeSide();
  check(near(m, 0.5) && near(s, 0.3), "msEncode");
  const l = e.decodeLeft(m, s), r = e.decodeRight();
  check(near(l, 0.8) && near(r, 0.2), "msDecode inverts msEncode");
}

// Rms
{
  const n = 24000, sine = new Float32Array(n).map((_, i) => Math.sin(2 * Math.PI * 440 * i / SR));
  const out = h.run(3, [0.05], n, sine);
  check(near(out[n - 1], Math.SQRT1_2, 0.02), "Rms of a unit sine is 0.707", out[n - 1].toFixed(4));
  const dc = h.run(3, [0.01], 4800, new Float32Array(4800).fill(0.5));
  check(near(dc[4799], 0.5, 1e-3) && dc[10] < 0.5, "Rms of a constant settles on it");
}

// real time
for (const id of [0, 1, 2, 3, 4]) {
  e.setup(id, 0.05, 0, 0, 0, 0, 0);
  const bytes = h.allocated(() => e.process(4096));
  check(bytes === 0, `util unit ${id} allocates nothing while it runs`, bytes ? bytes + " bytes" : "");
}
finish();
