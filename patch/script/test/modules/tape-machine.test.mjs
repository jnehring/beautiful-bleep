// SPDX-License-Identifier: GPL-3.0-only
// Tape Machine: head bump and gap loss per speed, harmonics against input level, bias, level compensation, wow and flutter as vibrato in cents,
// stereo drift, hiss, dropouts, compression, mix phase, aliasing, safety.   node test/modules/tape-machine.test.mjs
import { loadModule, render, sine, gainAt, check, finish, spectrum, db, rms, finiteAll, harmonicsDb } from "./lib.mjs";

const SR = 48000;
const m = await loadModule("tape-machine");
console.log("cost", JSON.stringify(m.cost));
check(m.cost.ops < 150000, "cost estimate below 150,000 ops per chunk", `${m.cost.ops}`);
check(m.spec.type === "tape-machine" && m.spec.params.length >= 14, "module spec");

// a plain tape: no wobble, no noise, no dropouts, no compression, no drift
const clean = { wow: 0, flutter: 0, hiss: 0, dropouts: 0, compress: 0, drift: 0, bias: 0 };
const run = (x, params = {}, extra = {}) => render(m, { inputs: { l: x }, params: { ...clean, ...params }, ...extra });
const g = (f, p = {}, o = {}) => gainAt(m, f, { out: "outL", amp: 0.05, params: { ...clean, drive: 0, ...p }, ...o });
const speeds = [{ name: "7.5 ips", s: 0, bump: 150, loss: 15000 }, { name: "15 ips", s: 1, bump: 90, loss: 15000 }, { name: "30 ips", s: 2, bump: 50, loss: 15000 }];

// ---- head bump: the frequency of the low-frequency peak per speed
const bumpAt = {};
for (const sp of speeds) {
  let best = 0, bestF = 0;
  const ref = g(1000, { speed: sp.s });
  for (let f = 25; f <= 400; f *= 1.04) { const v = g(f, { speed: sp.s }, { n: 16384 }) - ref; if (v > best) { best = v; bestF = f; } }
  bumpAt[sp.s] = bestF;
  console.log(`  ${sp.name}: head bump peak ${bestF.toFixed(0)} Hz, +${best.toFixed(1)} dB over 1 kHz`);
  check(Math.abs(bestF - sp.bump) / sp.bump < 0.2, `${sp.name}: head bump near ${sp.bump} Hz`, `${bestF.toFixed(0)} Hz`);
  check(best > 2 && best < 7, `${sp.name}: head bump of a few dB`, `${best.toFixed(1)} dB`);
}
check(bumpAt[0] > bumpAt[1] && bumpAt[1] > bumpAt[2], "the head bump moves down as the speed goes up");

// ---- gap and spacing loss: high-frequency roll-off per speed
{
  const loss = (s) => g(15000, { speed: s }) - g(1000, { speed: s });
  const l = [0, 1, 2].map(loss);
  console.log("  loss at 15 kHz re 1 kHz (dB) for 7.5 / 15 / 30 ips:", l.map((v) => v.toFixed(1)).join(" / "));
  check(l[0] < l[1] - 4 && l[1] < l[2] - 2, "high-frequency loss is largest at 7.5 ips and smallest at 30 ips");
  check(l[0] < -8 && l[1] < -2.5 && l[2] > -2.5, "gap loss: -8 dB or more at 7.5 ips, a few dB at 15, nearly flat at 30 (15 kHz)");
  const lt = [0, 1, 2].map((ty) => g(12000, { tapeType: ty, speed: 1 }) - g(1000, { tapeType: ty, speed: 1 }));
  console.log("  loss at 12 kHz re 1 kHz for Modern / Vintage / Rough (15 ips):", lt.map((v) => v.toFixed(1)).join(" / "));
  check(lt[0] > lt[1] && lt[1] > lt[2], "tape type: Rough is dullest, Modern brightest");
  const flat = g(1000, { speed: 1 }) - g(300, { speed: 1 });
  check(Math.abs(flat) < 1, "the mid band is flat", `${flat.toFixed(2)} dB`);
}

// ---- hysteresis: harmonic content rises with Input Level, odd first, a little even
const hd = (f0, amp, params = {}, n = 32768) => { const x = sine(f0, amp, n); const y = run(x, params).outL; return harmonicsDb(y.subarray(n / 2), f0, SR, 6); };
{
  const levels = [-12, -6, 0, 6, 12, 18];
  const h = levels.map((d) => hd(1000, 0.2, { drive: d }));
  console.log("  harmonics (2nd 3rd 4th 5th) vs Input Level:");
  levels.forEach((d, i) => console.log(`    ${String(d).padStart(3)} dB: ${h[i].slice(1, 5).map((v) => v.toFixed(0).padStart(4)).join(" ")}`));
  let rising = true; for (let i = 1; i < levels.length; i++) if (h[i][2] <= h[i - 1][2]) rising = false;
  check(rising, "3rd harmonic rises with every step of Input Level");
  check(h[5][2] > h[1][2] + 20, "3rd harmonic at +18 dB is 20+ dB above -6 dB", `${h[1][2].toFixed(0)} -> ${h[5][2].toFixed(0)} dB`);
  check(h[3][2] > h[3][1] && h[3][1] > h[3][3], "odd harmonics dominate: 3rd above 2nd, 2nd above 4th", `${h[3][1].toFixed(0)} ${h[3][2].toFixed(0)} ${h[3][3].toFixed(0)}`);
  check(h[3][1] > -60, "a little even harmonic is there (slightly asymmetric tape)", `${h[3][1].toFixed(0)} dB`);
  // vintage tape saturates earlier than modern
  const mod = hd(1000, 0.2, { drive: 6, tapeType: 0 }), vin = hd(1000, 0.2, { drive: 6, tapeType: 1 }), rough = hd(1000, 0.2, { drive: 6, tapeType: 2 });
  console.log("  3rd harmonic at +6 dB: Modern / Vintage / Rough:", mod[2].toFixed(0), vin[2].toFixed(0), rough[2].toFixed(0));
  check(mod[2] < vin[2] - 2 && vin[2] < rough[2] - 1, "tape type: Modern is cleanest, Rough the most distorted");
  // the treble saturates before the bass: the record pre-emphasis pushes it harder into the tape, so its level compresses more
  const squash = (f, speed) => { const lvl = (amp) => { const n = 32768, x = sine(f, amp, n), y = run(x, { drive: 6, speed, tapeType: 0 }).outL; return 20 * Math.log10(rms(y, n / 2) / rms(x, n / 2)); }; return lvl(0.4) - lvl(0.01); };
  const bassSq = squash(200, 0), trebleSq = squash(6000, 0), trebleFast = squash(6000, 2);
  console.log(`  gain change from -40 to -8 dBFS at +6 dB drive, 7.5 ips: 200 Hz ${bassSq.toFixed(1)} dB, 6 kHz ${trebleSq.toFixed(1)} dB; 30 ips 6 kHz ${trebleFast.toFixed(1)} dB`);
  check(trebleSq < bassSq - 2, "the treble saturates earlier than the bass (record pre-emphasis)", `${bassSq.toFixed(1)} dB at 200 Hz, ${trebleSq.toFixed(1)} dB at 6 kHz`);
  check(trebleSq < trebleFast - 1.5, "slower speed saturates the treble earlier (lower pre-emphasis corner)", `${trebleSq.toFixed(1)} dB at 7.5 ips vs ${trebleFast.toFixed(1)} dB at 30 ips`);
}

// ---- level compensation
{
  const out = (drive, amp) => { const n = 32768, x = sine(1000, amp, n), y = run(x, { drive }).outL; return 20 * Math.log10(rms(y, n / 2) / rms(x, n / 2)); };
  const v = [-6, 0, 6, 12].map((d) => out(d, 0.125));
  console.log("  output vs input at -18 dBFS for Input Level -6 / 0 / 6 / 12 dB:", v.map((x) => x.toFixed(1)).join(" "));
  check(Math.max(...v) - Math.min(...v) < 3, "level compensation: -18 dBFS signal comes out within 3 dB for Input Level -6 to +12 dB");
  const v2 = [-6, 0, 6, 12].map((d) => out(d, 0.0316));
  check(Math.max(...v2) - Math.min(...v2) < 7, "quiet signals (-30 dBFS) vary by less than 7 dB over the same range", `${(Math.max(...v2) - Math.min(...v2)).toFixed(1)} dB`);
  const dfl = out(6, 0.125);
  check(Math.abs(dfl) < 4, "defaults are not absurdly louder or quieter", `${dfl.toFixed(1)} dB`);
  // tape type does not change the loudness a lot
  const ty = [0, 1, 2].map((t) => { const n = 32768, x = sine(1000, 0.125, n), y = run(x, { drive: 6, tapeType: t }).outL; return 20 * Math.log10(rms(y, n / 2) / rms(x, n / 2)); });
  check(Math.max(...ty) - Math.min(...ty) < 5, "loudness is similar for the three tapes", ty.map((x) => x.toFixed(1)).join(" "));
}

// ---- bias
{
  const hdq = (bias, ty = 1) => hd(1000, 0.03, { drive: 0, bias, tapeType: ty });
  const under = hdq(-100), opt = hdq(0), over = hdq(100);
  console.log("  3rd harmonic of a -30 dBFS tone, bias -100 / 0 / +100 % (Vintage):", under[2].toFixed(0), opt[2].toFixed(0), over[2].toFixed(0));
  check(under[2] > opt[2] + 5, "under-bias: more low-level distortion", `${opt[2].toFixed(0)} -> ${under[2].toFixed(0)} dB`);
  check(over[2] < opt[2] + 1.5, "over-bias is not dirtier at low level than the optimum", `${over[2].toFixed(0)} dB`);
  const m0 = [-100, 0, 100].map((b) => hdq(b, 0)[2]);
  check(m0[0] > m0[1] + 5 && m0[2] < m0[1] - 5, "Modern tape: distortion falls from under-bias through optimum to over-bias", m0.map((v) => v.toFixed(0)).join(" / "));
  const hf = (bias) => g(12000, { bias, speed: 1 }) - g(1000, { bias, speed: 1 });
  console.log("  12 kHz re 1 kHz, bias -100 / 0 / +100 %:", hf(-100).toFixed(1), hf(0).toFixed(1), hf(100).toFixed(1));
  check(hf(-100) > hf(0) && hf(0) > hf(100) + 1.5, "bias moves the top end: under-bias brighter, over-bias duller");
  const lev = (bias) => g(1000, { bias });
  check(lev(100) < lev(0), "over-bias is a little quieter", `${lev(0).toFixed(1)} -> ${lev(100).toFixed(1)} dB`);
}

// ---- compression
{
  const gainAtLevel = (amp, compress) => { const n = 65536, x = sine(1000, amp, n), y = run(x, { drive: 0, compress }).outL; return 20 * Math.log10(rms(y, n / 2) / rms(x, n / 2)); };
  const d0 = gainAtLevel(0.02, 0) - gainAtLevel(0.5, 0), d100 = gainAtLevel(0.02, 100) - gainAtLevel(0.5, 100);
  console.log("  gain drop from -34 to -6 dBFS at Compress 0 / 100 %:", d0.toFixed(1), d100.toFixed(1));
  check(d100 > d0 + 4, "Compress: loud signals are turned down more than quiet ones", `${d0.toFixed(1)} -> ${d100.toFixed(1)} dB`);
  // slow: attack of a few ms, release over 100+ ms. A burst after silence
  const n = SR, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = (i > 12000 && i < 36000) ? 0.6 * Math.sin(2 * Math.PI * 1000 * i / SR) : 0;
  const y = run(x, { drive: 0, compress: 100 }).outL, win = 480;
  const env = (a) => rms(y, a, a + win) / (rms(x, a, a + win) || 1);
  const early = env(12500 + 177), late = env(34000);
  check(early > late * 1.15, "Compress: gain reduction builds up over a few milliseconds, not instantly", `${early.toFixed(2)} -> ${late.toFixed(2)}`);
}

// ---- wow and flutter as vibrato (cents)
function pitchTrace(sig, f0 = 1000, from = 0.5) {
  const n = sig.length, win = 960, ci = new Float64Array(n), cq = new Float64Array(n);
  for (let i = 0; i < n; i++) { const w = 2 * Math.PI * f0 * i / SR; ci[i] = sig[i] * Math.cos(w); cq[i] = -sig[i] * Math.sin(w); }
  let si = 0, sq = 0; const ph = [];
  for (let i = 0; i < n; i++) { si += ci[i]; sq += cq[i]; if (i >= win) { si -= ci[i - win]; sq -= cq[i - win]; } if (i >= SR * from && i % 48 === 0) ph.push(Math.atan2(sq, si)); }
  for (let i = 1; i < ph.length; i++) { while (ph[i] - ph[i - 1] > Math.PI) ph[i] -= 2 * Math.PI; while (ph[i] - ph[i - 1] < -Math.PI) ph[i] += 2 * Math.PI; }
  const dt = 48 / SR, cents = [];
  for (let i = 5; i < ph.length - 5; i++) cents.push(1200 * Math.log2(1 + (ph[i + 5] - ph[i - 5]) / (10 * dt) / (2 * Math.PI) / f0));
  return { cents, dt };
}
const band = (tr, a, b) => { let e = 0, c = 0; for (let f = a; f <= b; f += 0.25) { let re = 0, im = 0; tr.cents.forEach((v, i) => { re += v * Math.cos(2 * Math.PI * f * i * tr.dt); im += v * Math.sin(2 * Math.PI * f * i * tr.dt); }); e += (re * re + im * im); c++; } return Math.sqrt(e / c) * 2 / tr.cents.length; };
const peakCents = (tr) => Math.max(...tr.cents.map(Math.abs));
{
  const n = SR * 12, x = sine(1000, 0.1, n);
  const trace = (params, out = "outL") => pitchTrace(run(x, { drive: 0, ...params })[out]);
  const none = trace({}), wow = trace({ wow: 100 }), flu = trace({ flutter: 100 }), wow50 = trace({ wow: 50 });
  console.log(`  pitch peak (cents): none ${peakCents(none).toFixed(2)}, wow 100 % ${peakCents(wow).toFixed(2)}, wow 50 % ${peakCents(wow50).toFixed(2)}, flutter 100 % ${peakCents(flu).toFixed(2)}`);
  check(peakCents(none) < 0.2, "no wobble, steady pitch", `${peakCents(none).toFixed(2)} cents`);
  check(peakCents(wow) > 4 && peakCents(wow) < 20, "Wow 100 % at 15 ips: a few to ~15 cents of slow vibrato", `${peakCents(wow).toFixed(1)} cents`);
  check(peakCents(wow50) > 0.35 * peakCents(wow) && peakCents(wow50) < 0.65 * peakCents(wow), "Wow depth follows the knob");
  check(peakCents(flu) > 1.5 && peakCents(flu) < 9, "Flutter 100 %: a few cents of fast vibrato", `${peakCents(flu).toFixed(1)} cents`);
  const wowSlow = band(wow, 0.4, 2.5), wowFast = band(wow, 5, 16), fluSlow = band(flu, 0.4, 2.5), fluFast = band(flu, 5, 16);
  console.log(`  modulation energy: wow slow ${wowSlow.toFixed(2)} fast ${wowFast.toFixed(2)}; flutter slow ${fluSlow.toFixed(2)} fast ${fluFast.toFixed(2)} (cents)`);
  check(wowSlow > 3 * wowFast, "wow lives at 0.5 - 2 Hz");
  check(fluFast > 3 * fluSlow, "flutter lives at 6 - 15 Hz");
  const speedPeak = [0, 1, 2].map((s) => peakCents(trace({ wow: 100, speed: s })));
  check(speedPeak[0] > speedPeak[1] && speedPeak[1] > speedPeak[2], "the transport is steadier at higher speed", speedPeak.map((v) => v.toFixed(1)).join(" / "));
  // wow is the same in both channels when Stereo Drift is 0, and different when it is 100 %
  const corr = (drift) => { const o = run(x, { drive: 0, wow: 100, flutter: 100, drift }); const a = pitchTrace(o.outL).cents, b = pitchTrace(o.outR).cents; let d = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return d / Math.sqrt(aa * bb); };
  const c0 = corr(0), c20 = corr(20), c100 = corr(100);
  console.log(`  L/R pitch correlation at Stereo Drift 0 / 20 / 100 %: ${c0.toFixed(2)} ${c20.toFixed(2)} ${c100.toFixed(2)}`);
  check(c0 > 0.98, "Stereo Drift 0: both channels wobble together", `${c0.toFixed(3)}`);
  check(c20 > 0.8 && c20 < 0.999, "Stereo Drift 20 %: mostly together", `${c20.toFixed(3)}`);
  check(c100 < 0.5, "Stereo Drift 100 %: independent", `${c100.toFixed(3)}`);
}

// ---- hiss
const hissRms = (params) => { const n = 65536; return rms(run(new Float32Array(n), { hiss: 100, ...params }).outL, 8192); };
{
  const lv = [0, 1, 2].map((s) => 20 * Math.log10(hissRms({ speed: s, tapeType: 1 })));
  console.log("  hiss at 100 % (dBFS) for 7.5 / 15 / 30 ips (Vintage):", lv.map((v) => v.toFixed(1)).join(" / "));
  check(lv[0] > lv[1] + 2 && lv[1] > lv[2] + 1, "hiss gets lower as the speed goes up");
  const lt = [0, 1, 2].map((t) => 20 * Math.log10(hissRms({ tapeType: t })));
  console.log("  hiss at 100 % (dBFS) for Modern / Vintage / Rough (15 ips):", lt.map((v) => v.toFixed(1)).join(" / "));
  check(lt[0] < lt[1] - 3 && lt[2] > lt[1] + 3, "hiss: Modern is quietest, Rough noisiest");
  check(lv[1] > -60 && lv[1] < -35, "hiss at 100 % sits at a tape-like level", `${lv[1].toFixed(1)} dBFS`);
  const k = [25, 50, 100].map((h) => 20 * Math.log10(hissRms({ hiss: h })));
  check(k[1] > k[0] + 3 && k[2] > k[1] + 3, "hiss follows the knob", k.map((v) => v.toFixed(0)).join(" / "));
  check(hissRms({ hiss: 0 }) < 1e-7, "Hiss 0: silent", `${hissRms({ hiss: 0 }).toExponential(1)}`);
  // shaped: the playback curve and gap loss darken it
  const n = 65536, y = run(new Float32Array(n), { hiss: 100, speed: 0 }).outL;
  const p = spectrum(y.subarray(8192, 8192 + 32768)), bin = SR / 32768;
  const bandAvg = (a, b2) => { let e = 0; const k0 = Math.round(a / bin), k1 = Math.round(b2 / bin); for (let i = k0; i < k1; i++) e += p[i]; return e / (k1 - k0); };
  check(bandAvg(500, 2000) > bandAvg(14000, 20000) * 10, "hiss is shaped (less at the very top than in the mids)", `${(db(bandAvg(500, 2000)) - db(bandAvg(14000, 20000))).toFixed(0)} dB`);
  // independent channels
  const o = run(new Float32Array(n), { hiss: 100 }); let d = 0, a = 0, b = 0; for (let i = 8192; i < n; i++) { d += o.outL[i] * o.outR[i]; a += o.outL[i] ** 2; b += o.outR[i] ** 2; }
  check(Math.abs(d / Math.sqrt(a * b)) < 0.1, "hiss is independent in the two channels", `correlation ${(d / Math.sqrt(a * b)).toFixed(3)}`);
  // modulation noise: Rough tape makes the signal itself noisy
  const sig = sine(1000, 0.2, 65536);
  const mod = (ty) => { const y2 = run(sig, { drive: 0, tapeType: ty, hiss: 0 }).outL; const pp = spectrum(y2.subarray(16384, 16384 + 32768)); const bn = SR / 32768; const k0 = Math.round(1000 / bn); let side = 0; for (let i = k0 - 40; i <= k0 + 40; i++) if (Math.abs(i - k0) > 4) side += pp[i]; return db(side) - db(pp[k0]); };
  console.log("  sidebands around 1 kHz (modulation noise) Modern / Vintage / Rough:", [0, 1, 2].map(mod).map((v) => v.toFixed(0)).join(" "));
  check(mod(2) > mod(0) + 6, "Rough tape has modulation noise around the signal");
}

// ---- dropouts
{
  const n = SR * 60, x = sine(1000, 0.3, n);
  const y = run(x, { drive: 0, dropouts: 100, tapeType: 1 }).outL;
  const win = 480; let dips = 0, inDip = false, worst = 0;
  const ref = rms(y, SR * 2, SR * 2 + 4800);
  for (let a = 0; a + win <= n; a += 240) { const e = rms(y, a, a + win); const low = e < ref * 0.8; if (low && !inDip) dips++; inDip = low; if (e < ref * 0.8) worst = Math.min(worst || 1, e / ref); }
  const perSecond = dips / 60;
  console.log(`  dropouts at 100 % (Vintage): ${perSecond.toFixed(2)} per second, deepest ${(20 * Math.log10(worst || 1)).toFixed(1)} dB`);
  check(perSecond > 0.7 && perSecond < 2.2, "Dropouts 100 %: about 1 to 2 dips per second (Vintage)", `${perSecond.toFixed(2)} / s`);
  check(worst < 0.5, "dropouts are deep enough to hear", `${(20 * Math.log10(worst || 1)).toFixed(1)} dB`);
  const none = run(x.subarray(0, SR * 10), { drive: 0, dropouts: 0, tapeType: 0 }).outL;
  let mn = 9; for (let a = SR; a + win <= none.length; a += 240) mn = Math.min(mn, rms(none, a, a + win)); let mx = 0; for (let a = SR; a + win <= none.length; a += 240) mx = Math.max(mx, rms(none, a, a + win));
  check(mn > 0.97 * mx, "Dropouts 0: the level is steady", `${(mn / mx).toFixed(3)}`);
  const rate = (ty) => { const nn = SR * 20; const yy = run(sine(1000, 0.3, nn), { drive: 0, dropouts: 100, tapeType: ty }).outL; let d = 0, ind = false; const rr = rms(yy, SR * 2, SR * 2 + 4800); for (let a = 0; a + win <= nn; a += 240) { const low = rms(yy, a, a + win) < rr * 0.8; if (low && !ind) d++; ind = low; } return d / 20; };
  const r0 = rate(0), r2 = rate(2);
  check(r2 > r0 * 2, "Rough tape drops out more often than Modern", `${r2.toFixed(2)} vs ${r0.toFixed(2)} per second`);
  // the dips are smooth: no click at the edges
  let step = 0; for (let i = 1; i < y.length; i++) step = Math.max(step, Math.abs(y[i] - y[i - 1]));
  check(step < 0.3 * 0.3 * 2 * Math.PI * 1000 / SR * 3 + 0.01, "dropouts are smooth (no clicks)", `max step ${step.toFixed(3)}`);
}

// ---- mix: dry delayed by the wet latency, in phase
{
  const n = 8192, x = new Float32Array(n); let s = 4242; for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = (s / 4294967296 - 0.5) * 0.5; }
  for (const [quality, lat] of [[1, 34], [0, 23]]) {
    const y = run(x, { mix: 0, quality }).outL, d = Math.round(0.006 * SR) + lat;
    let err = 0; for (let i = d; i < n; i++) err = Math.max(err, Math.abs(y[i] - x[i - d]));
    check(err < 1e-6, `Mix 0 is the input delayed by exactly ${d} samples (quality ${quality ? "Normal" : "Eco"})`, `max error ${err.toExponential(1)}`);
  }
  // wet and dry add in phase: a low tone, linear settings
  const t = (mix) => { const xs = sine(400, 0.03, 32768), ys = run(xs, { drive: -6, mix }).outL; return rms(ys, 16384) / rms(xs, 16384); };
  const a0 = t(0), a1 = t(100), a5 = t(50);
  console.log(`  amplitude at mix 0 / 50 / 100 %: ${a0.toFixed(3)} ${a5.toFixed(3)} ${a1.toFixed(3)}`);
  check(Math.abs(a5 - (a0 + a1) / 2) < 0.04 * Math.max(a0, a1), "Mix 50 %: wet and dry add in phase", `${a5.toFixed(3)} vs ${((a0 + a1) / 2).toFixed(3)}`);
}

// ---- aliasing: bright tones, hard drive
{
  const alias = (f0, amp, params) => {
    const n = 32768, x = sine(f0, amp, n), y = run(x, params).outL;
    const p = spectrum(y.subarray(n / 2)), bin = SR / (n / 2), fund = p[Math.round(f0 / bin)];
    let worst = 0, at = 0;
    for (let k = 20; k < p.length - 2; k++) {
      const f = k * bin; let near = false;
      for (let h = 1; h <= 4; h++) if (Math.abs(f - h * f0) < 10 * bin) near = true;
      if (near) continue;
      if (p[k] > worst) { worst = p[k]; at = f; }
    }
    return { rel: db(worst) - db(fund), at };
  };
  const cases = [["5 kHz, +12 dB drive, Vintage 15 ips", 5003, { drive: 12 }], ["7 kHz, +12 dB drive, Vintage 15 ips", 7003, { drive: 12 }]];
  const got = {};
  for (const [name, f0, p] of cases) for (const q of [0, 1]) {
    const r = alias(f0, 0.5, { ...p, tapeType: 1, speed: 1, quality: q });
    got[name + q] = r.rel;
    console.log(`  ${name}, ${q ? "Normal (4x)" : "Eco (2x)"}: strongest non-harmonic component ${r.rel.toFixed(1)} dB at ${r.at.toFixed(0)} Hz`);
  }
  check(got[cases[0][0] + 0] < -45, "Eco (2x): non-harmonic components below -45 dB for a hard-driven 5 kHz tone", `${got[cases[0][0] + 0].toFixed(1)} dB`);
  check(got[cases[0][0] + 1] < -50, "Normal (4x): non-harmonic components below -50 dB for a hard-driven 5 kHz tone", `${got[cases[0][0] + 1].toFixed(1)} dB`);
  check(got[cases[1][0] + 1] < -50, "Normal (4x): below -50 dB for a hard-driven 7 kHz tone", `${got[cases[1][0] + 1].toFixed(1)} dB`);
  check(got[cases[1][0] + 1] < got[cases[1][0] + 0] - 10, "Normal (4x) aliases at least 10 dB less than Eco (2x) on a bright, hard-driven tone", `${got[cases[1][0] + 0].toFixed(1)} vs ${got[cases[1][0] + 1].toFixed(1)} dB`);
  const extreme = alias(11003, 0.5, { drive: 12, tapeType: 1, speed: 1, quality: 1 });
  console.log(`  (limit: an 11 kHz tone at +12 dB drive is squared by the tape; at 4x the strongest alias is ${extreme.rel.toFixed(1)} dB at ${extreme.at.toFixed(0)} Hz)`);
}

// ---- determinism, stereo, input modes
{
  const x = sine(300, 0.3, 48000);
  const p = { wow: 60, flutter: 60, hiss: 60, dropouts: 60, drift: 50 };
  const a = render(m, { inputs: { l: x }, params: p }), b = render(m, { inputs: { l: x }, params: p });
  check(a.outL.every((v, i) => v === b.outL[i]) && a.outR.every((v, i) => v === b.outR[i]), "two renders are identical (seeded)");
  const st = render(m, { n: 30000, inputs: { l: x }, params: { ...clean, tapeType: 0, input: 0 } });
  let dmax = 0; for (let i = 9000; i < 30000; i++) dmax = Math.max(dmax, Math.abs(st.outL[i] - st.outR[i]));
  check(dmax < 1e-5 && rms(st.outR, 9000) > 0.05, "Input Auto: nothing in In R, so R follows L", `${dmax.toExponential(1)}`);
  const stereo = render(m, { n: 30000, inputs: { l: x, r: new Float32Array(30000) }, params: { ...clean, tapeType: 0, input: 1 } });
  check(rms(stereo.outR, 9000) < 1e-6 && rms(stereo.outL, 9000) > 0.05, "Input Stereo: a silent R stays silent");
  const mono = render(m, { n: 30000, inputs: { l: x, r: sine(500, 0.3, 30000) }, params: { ...clean, tapeType: 0, input: 2 } });
  let dm = 0; for (let i = 9000; i < 30000; i++) dm = Math.max(dm, Math.abs(mono.outL[i] - mono.outR[i]));
  check(dm < 1e-5, "Input Mono: R is ignored", `${dm.toExponential(1)}`);
  const r = new Float32Array(30000); for (let i = 15000; i < 30000; i++) r[i] = 0.3 * Math.sin(2 * Math.PI * 500 * i / SR);
  const sw = render(m, { n: 30000, inputs: { l: x, r }, params: { ...clean, tapeType: 0, input: 0 } });
  let d2 = 0, jump = 0; for (let i = 24000; i < 30000; i++) d2 = Math.max(d2, Math.abs(sw.outL[i] - sw.outR[i]));
  for (let i = 1; i < 30000; i++) jump = Math.max(jump, Math.abs(sw.outR[i] - sw.outR[i - 1]));
  check(d2 > 0.05 && jump < 0.4, "Input Auto: R is used as soon as it carries a signal, without a click", `${d2.toFixed(2)}, step ${jump.toFixed(2)}`);
}

// ---- safety
{
  const n = 9600, sq = Float32Array.from({ length: n }, (_, i) => ((i >> 5) & 1 ? 1 : -1));
  const dc = new Float32Array(n).fill(1), big = Float32Array.from({ length: n }, (_, i) => 1000 * Math.sin(i * 0.37));
  let ok = true, worst = 0;
  for (const sig of [sq, dc, big]) for (const sp of [0, 1, 2]) for (const ty of [0, 1, 2]) for (const q of [0, 1]) {
    for (const p of [{ drive: 24, bias: -100, compress: 100, wow: 100, flutter: 100, drift: 100, hiss: 100, dropouts: 100, outputDb: 12 }, { drive: -12, bias: 100, compress: 0, wow: 0, flutter: 0, drift: 0, hiss: 0, dropouts: 0, mix: 50 }]) {
      const o = render(m, { inputs: { l: sig, r: sig }, params: { speed: sp, tapeType: ty, quality: q, ...p } });
      ok = ok && finiteAll(o.outL) && finiteAll(o.outR); if (!p.mix) worst = Math.max(worst, ...o.outL.map(Math.abs));
    }
  }
  check(ok && worst <= 16.001, "finite and bounded for square, DC and huge input at extreme settings, all speeds, tapes and qualities", `peak ${worst.toFixed(1)}`);
  const z = render(m, { n: 20000, inputs: { l: new Float32Array(20000) }, params: { ...clean } });
  check(rms(z.outL) < 1e-9 && rms(z.outR) < 1e-9, "silence in, silence out for a clean tape (no startup transient)", `${rms(z.outL).toExponential(1)}`);
  // DC does not pass
  const dcOut = render(m, { n: 48000, inputs: { l: new Float32Array(48000).fill(0.3) }, params: { ...clean, drive: 0 } }).outL;
  check(Math.abs(dcOut[47999]) < 0.01, "DC is blocked (a tape does not record DC)", `${dcOut[47999].toFixed(4)}`);
  // after loud input, silence decays to nothing
  const burst = new Float32Array(48000); for (let i = 0; i < 4800; i++) burst[i] = Math.sin(i * 0.2);
  const tail = run(burst, { drive: 24 }).outL;
  check(rms(tail, 40000) < 1e-6, "no residue after a loud burst", `${rms(tail, 40000).toExponential(1)}`);
}

// ---- sample rates: head bump and corner stay put
for (const sr of [44100, 96000]) {
  const gs = (f, p = {}) => gainAt(m, f, { out: "outL", amp: 0.05, params: { ...clean, drive: 0, ...p }, sampleRate: sr, n: 32768 });
  let best = 0, bestF = 0; const ref = gs(1000);
  for (let f = 30; f <= 300; f *= 1.05) { const v = gs(f) - ref; if (v > best) { best = v; bestF = f; } }
  check(Math.abs(bestF - 90) / 90 < 0.2, `${sr} Hz: head bump at 15 ips is still near 90 Hz`, `${bestF.toFixed(0)} Hz`);
  const l = gs(15000) - ref;
  check(l < -2.5 && l > -9, `${sr} Hz: gap loss at 15 kHz is the same (15 ips)`, `${l.toFixed(1)} dB`);
}
finish();
