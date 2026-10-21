// SPDX-License-Identifier: GPL-3.0-or-later
// Vinyl: RIAA curves, bass mono, crosstalk, tracking distortion, noise, dust statistics, scratches once per revolution, warp, mix, safety.
//   node test/modules/vinyl.test.mjs
import { loadModule, render, sine, check, finish, spectrum, db, rms, finiteAll, harmonicsDb } from "./lib.mjs";

const SR = 48000;
const m = await loadModule("vinyl");
console.log("cost", JSON.stringify(m.cost));
check(m.cost.ops < 150000, "cost estimate below 150,000 ops per chunk", `${m.cost.ops}`);
check(m.spec.type === "vinyl" && m.spec.params.length >= 12, "module spec");

// everything off, a flat pick-up: the record chain alone
const off = { dust: 0, noise: 0, rumble: 0, warp: 0, crosstalk: 0, bassMono: 0, inner: 0, cartridge: 0 };
const run = (x, params = {}, extra = {}) => render(m, { inputs: { l: x }, params: { ...off, ...params }, ...extra });

// the RIAA playback curve (3180 / 318 / 75 us) and its inverse, both taken to 0 dB at 1 kHz
const pbMag = (f) => { const w = 2 * Math.PI * f; return Math.hypot(1, w * 318e-6) / (Math.hypot(1, w * 3180e-6) * Math.hypot(1, w * 75e-6)); };
const riaaPlay = (f) => 20 * Math.log10(pbMag(f) / pbMag(1000));
const riaaRec = (f) => -riaaPlay(f);

// gain of a tone including the sidebands the pitch wobble spreads it into (energy within +-25 Hz of the tone)
function toneGain(params, f, { amp = 0.1, sr = SR, n = 65536 } = {}) {
  const x = sine(f, amp, n, sr);
  const y = render(m, { sampleRate: sr, inputs: { l: x }, params: { ...off, ...params } }).outL;
  const bandEnergy = (s) => { const p = spectrum(s.subarray(n / 2)), bin = sr / (n / 2); let e = 0; for (let k = Math.round((f - 25) / bin); k <= Math.round((f + 25) / bin); k++) e += p[k]; return e; };
  return 10 * Math.log10(bandEnergy(y) / bandEnergy(x));
}

// ---- RIAA: the signal in the groove follows the record curve (read from the groove meter)
{
  let worst = 0, line = [];
  for (const f of [50, 100, 200, 500, 1000, 2000, 3000, 5000, 8000, 10000]) {
    const o = run(sine(f, 0.1, SR), {});
    const g = 20 * Math.log10(o.instance.live().values.groove / 0.1);
    const err = g - riaaRec(f);
    worst = Math.max(worst, Math.abs(err));
    line.push(`${f}:${g.toFixed(1)}(${err >= 0 ? "+" : ""}${err.toFixed(2)})`);
  }
  console.log("  groove level vs record curve:", line.join(" "));
  check(worst < 1.3, "RIAA record curve in the groove within 1.3 dB of the standard from 50 Hz to 10 kHz", `${worst.toFixed(2)} dB`);
  const g1 = 20 * Math.log10(run(sine(1000, 0.1, SR)).instance.live().values.groove / 0.1);
  check(Math.abs(g1) < 0.1, "RIAA: 0 dB at 1 kHz", `${g1.toFixed(3)} dB`);
  const bass = riaaRec(50), treble = riaaRec(10000);
  check(bass < -8 && treble > 10, "the cut stage thins the bass and boosts the treble", `${bass.toFixed(1)} dB at 50 Hz, ${treble.toFixed(1)} dB at 10 kHz`);
}

// ---- round trip: cut then playback is flat
for (const sr of [44100, 48000, 96000]) {
  let worst = 0;
  for (const f of [60, 100, 300, 1000, 3000, 6000, 10000]) worst = Math.max(worst, Math.abs(toneGain({}, f, { sr })));
  check(worst < 0.3, `${sr} Hz: cut + playback round trip flat within 0.3 dB (60 Hz - 10 kHz, flat pick-up)`, `${worst.toFixed(3)} dB`);
}
{
  const f = [100, 200, 400, 1000, 2000, 4000, 7000, 10000];
  const dflt = f.map((hz) => toneGain({ dust: 0, noise: 0, rumble: 0, bassMono: 0, crosstalk: 0, inner: 20, cartridge: 1, warp: 25 }, hz, { amp: 0.1 }));
  console.log("  defaults (Standard cartridge, inner 20 %):", f.map((hz, i) => `${hz}:${dflt[i].toFixed(2)}`).join(" "));
  check(Math.max(...dflt.map(Math.abs)) < 1.5, "default cartridge: response within +-1.5 dB from 100 Hz to 10 kHz", `${Math.max(...dflt.map(Math.abs)).toFixed(2)} dB`);
  const cheap = f.map((hz) => toneGain({ cartridge: 2 }, hz));
  check(Math.max(...cheap) > Math.max(...dflt) + 1 || Math.min(...cheap) < Math.min(...dflt) - 0.5, "Cheap cartridge deviates more than the Standard one", `${Math.min(...cheap).toFixed(1)}..${Math.max(...cheap).toFixed(1)} dB`);
}

// ---- the playback curve shapes the hiss (the stylus noise is added in the groove, so de-emphasis darkens it)
{
  const n = 262144, y = run(new Float32Array(n), { noise: 100 }).outL;
  const seg = 16384, avg = new Float64Array(seg / 2);
  for (let s = 0; s + seg <= n; s += seg) { const p = spectrum(y.subarray(s, s + seg)); for (let k = 0; k < p.length; k++) avg[k] += p[k]; }
  const bin = SR / seg, band = (a, b) => { let e = 0, c = 0; for (let k = Math.round(a / bin); k < Math.round(b / bin); k++) { e += avg[k]; c++; } return 10 * Math.log10(e / c); };
  // analytic: white noise tilted by (1 - 0.6 z^-1), through the playback curve
  const expected = (f) => { const w = 2 * Math.PI * f / SR; return 20 * Math.log10(pbMag(f) * Math.hypot(1 - 0.6 * Math.cos(w), 0.6 * Math.sin(w))); };
  const centres = [250, 500, 1000, 2000, 4000, 8000];
  const meas = centres.map((c) => band(c / 1.26, c * 1.26)), exp = centres.map(expected);
  const off0 = meas[2] - exp[2];
  const err = centres.map((c, i) => meas[i] - exp[i] - off0);
  console.log("  hiss spectrum vs RIAA playback x treble tilt, error per band (dB):", err.map((e, i) => `${centres[i]}:${e.toFixed(2)}`).join(" "));
  check(Math.max(...err.map(Math.abs)) < 2, "hiss spectrum follows the RIAA playback curve (250 Hz - 8 kHz) within 2 dB");
  check(band(1000, 2000) > band(8000, 16000) + 5, "hiss is dark: clearly more energy at 1-2 kHz than at 8-16 kHz", `${(band(1000, 2000) - band(8000, 16000)).toFixed(1)} dB`);
  const lvl = (nv) => 20 * Math.log10(rms(run(new Float32Array(48000), { noise: nv }).outL, 4800));
  const l40 = lvl(40), l100 = lvl(100);
  console.log("  hiss level dBFS: noise 40 %:", l40.toFixed(1), " 100 %:", l100.toFixed(1));
  check(l100 > l40 + 6 && l100 < -25 && l40 > -80, "hiss level follows the knob and sits at a record-like level");
}

// ---- rumble
{
  const n = 262144, o = run(new Float32Array(n), { rumble: 100 });
  const p = spectrum(o.outL.subarray(n - 65536)), bin = SR / 65536;
  const band = (a, b) => { let e = 0; for (let k = Math.round(a / bin); k < Math.round(b / bin); k++) e += p[k]; return e / (Math.round(b / bin) - Math.round(a / bin)); };
  check(band(5, 40) > band(200, 2000) * 1e3, "Rumble: energy sits at 5-40 Hz (30+ dB above the midrange)", `${(db(band(5, 40)) - db(band(200, 2000))).toFixed(0)} dB`);
  const lv = 20 * Math.log10(rms(o.outL, 65536));
  const lv25 = 20 * Math.log10(rms(run(new Float32Array(n), { rumble: 25 }).outL, 65536));
  console.log("  rumble level dBFS: 100 %", lv.toFixed(1), " 25 %", lv25.toFixed(1));
  check(lv > -40 && lv < -15 && lv25 < lv - 10, "Rumble: level follows the knob");
  let dot = 0, ll = 0, rr = 0; for (let i = 65536; i < n; i++) { dot += o.outL[i] * o.outR[i]; ll += o.outL[i] ** 2; rr += o.outR[i] ** 2; }
  check(Math.abs(dot / Math.sqrt(ll * rr)) < 0.6, "Rumble: vertical motion makes the channels differ", `correlation ${(dot / Math.sqrt(ll * rr)).toFixed(2)}`);
}

// ---- bass mono
{
  const side = (f, params) => { const n = 32768, x = sine(f, 0.2, n), neg = x.map((v) => -v); const o = render(m, { inputs: { l: x, r: neg }, params: { ...off, input: 1, ...params } }); return 20 * Math.log10(rms(o.outL, n / 2) / rms(x, n / 2)); };
  const mid = (f, params) => { const n = 32768, x = sine(f, 0.2, n); const o = render(m, { inputs: { l: x, r: x }, params: { ...off, input: 1, ...params } }); return 20 * Math.log10(rms(o.outL, n / 2) / rms(x, n / 2)); };
  const s60 = side(60, { bassMono: 120 }), s120 = side(120, { bassMono: 120 }), s1k = side(1000, { bassMono: 120 }), sOff = side(60, { bassMono: 0 });
  console.log("  side gain (dB): 60 Hz", s60.toFixed(1), " 120 Hz (corner)", s120.toFixed(1), " 1 kHz", s1k.toFixed(1), " off, 60 Hz", sOff.toFixed(1));
  check(s60 < -9 && Math.abs(s1k) < 0.3 && Math.abs(sOff) < 0.3, "Bass Mono: out-of-phase bass is removed below the corner, the rest is left alone");
  check(Math.abs(s120 + 3) < 1, "Bass Mono: the corner is the -3 dB point of the difference signal", `${s120.toFixed(2)} dB`);
  const c60 = mid(60, { bassMono: 120 });
  check(Math.abs(c60) < 0.3, "Bass Mono: centred bass is untouched", `${c60.toFixed(2)} dB`);
  const s30 = side(30, { bassMono: 120 });
  check(s30 < s60 - 6, "Bass Mono: second-order slope (about 12 dB per octave)", `${s60.toFixed(1)} -> ${s30.toFixed(1)} dB`);
}

// ---- crosstalk
{
  const n = 32768, x = sine(1000, 0.2, n), z = new Float32Array(n);
  const xt = (c) => { const o = render(m, { inputs: { l: x, r: z }, params: { ...off, input: 1, crosstalk: c } }); return o; };
  const o100 = xt(100), o0 = xt(0), o50 = xt(50);
  const lvl = (o) => 20 * Math.log10(rms(o.outR, n / 2) / rms(o.outL, n / 2));
  console.log("  channel leak (dB): 100 %", lvl(o100).toFixed(1), " 50 %", lvl(o50).toFixed(1), " 0 %", lvl(o0).toFixed(1));
  check(Math.abs(lvl(o100) + 12) < 0.5, "Crosstalk 100 %: the leak is 12 dB down", `${lvl(o100).toFixed(2)} dB`);
  check(lvl(o0) < -80, "Crosstalk 0: perfect separation", `${lvl(o0).toFixed(0)} dB`);
  check(lvl(o50) < lvl(o100) - 3 && lvl(o50) > lvl(o0) + 20, "Crosstalk follows the knob");
  // phase shift of the leak against the main signal at 1 kHz
  const h = n / 2; let rr = 0, ri = 0, lr = 0, li = 0;
  for (let i = h; i < n; i++) { const c = Math.cos(2 * Math.PI * 1000 * i / SR), s = Math.sin(2 * Math.PI * 1000 * i / SR); rr += o100.outR[i] * c; ri -= o100.outR[i] * s; lr += o100.outL[i] * c; li -= o100.outL[i] * s; }
  let ph = (Math.atan2(ri, rr) - Math.atan2(li, lr)) * 180 / Math.PI; while (ph > 180) ph -= 360; while (ph < -180) ph += 360;
  check(Math.abs(ph) > 25 && Math.abs(ph) < 130, "Crosstalk: the leak is phase-shifted against the signal", `${ph.toFixed(0)} degrees at 1 kHz`);
}

// ---- tracking distortion: level- and frequency-dependent, worse towards the centre
const hd = (f0, amp, params = {}) => { const n = 32768, x = sine(f0, amp, n); const y = run(x, params).outL; return harmonicsDb(y.subarray(n / 2), f0, SR, 4); };
{
  const lowF = hd(300, 0.7, {}), highF = hd(3000, 0.7, {});
  console.log("  harmonics (dB re fundamental), 300 Hz:", lowF.slice(1).map((v) => v.toFixed(0)).join(" "), " 3 kHz:", highF.slice(1).map((v) => v.toFixed(0)).join(" "));
  check(highF[2] > lowF[2] + 15, "Tracking distortion: a bright tone distorts far more than the same-level bass tone", `3rd: ${lowF[2].toFixed(0)} -> ${highF[2].toFixed(0)} dB`);
  const quiet = hd(3000, 0.05, {});
  check(highF[2] > quiet[2] + 20, "Tracking distortion grows with level", `3rd: ${quiet[2].toFixed(0)} -> ${highF[2].toFixed(0)} dB`);
  const innerA = hd(2000, 0.4, { inner: 0 }), innerB = hd(2000, 0.4, { inner: 100 });
  console.log("  inner 0 / 100 % harmonics at 2 kHz:", innerA.slice(1).map((v) => v.toFixed(0)).join(" "), "/", innerB.slice(1).map((v) => v.toFixed(0)).join(" "));
  check(innerB[2] > innerA[2] + 10 && innerB[1] > innerA[1] + 10, "Inner Groove raises the distortion (2nd and 3rd harmonics)");
  check(innerB[1] > innerB[2] - 20, "Inner Groove: the asymmetry adds even harmonics", `2nd ${innerB[1].toFixed(0)} 3rd ${innerB[2].toFixed(0)}`);
  const g0 = toneGain({ inner: 0 }, 8000, { amp: 0.02 }), g100 = toneGain({ inner: 100 }, 8000, { amp: 0.02 });
  check(g100 < g0 - 6, "Inner Groove rolls off the top end", `${g0.toFixed(1)} -> ${g100.toFixed(1)} dB at 8 kHz`);
  const cp = hd(2000, 0.4, { cartridge: 2 }), ch = hd(2000, 0.4, { cartridge: 0 });
  check(cp[2] > ch[2] + 3, "Cheap cartridge tracks worse than Hi-Fi", `${ch[2].toFixed(0)} vs ${cp[2].toFixed(0)} dB`);
}

// ---- aliasing: a bright tone pushed past what the stylus tracks
{
  const f0 = 7003, n = 32768, x = sine(f0, 0.5, n);
  const y = run(x, { inner: 100 }).outL;
  const p = spectrum(y.subarray(n / 2)), bin = SR / (n / 2), fund = p[Math.round(f0 / bin)];
  let worst = 0, at = 0;
  for (let k = 20; k < p.length - 2; k++) {
    const f = k * bin; let near = false;
    for (let h = 1; h <= 3; h++) if (Math.abs(f - h * f0) < 10 * bin) near = true;
    if (near) continue;
    if (p[k] > worst) { worst = p[k]; at = f; }
  }
  console.log(`  strongest component away from the first harmonics: ${(db(worst) - db(fund)).toFixed(1)} dB re fundamental at ${at.toFixed(0)} Hz`);
  check(db(worst) - db(fund) < -40, "aliasing: components that are not harmonics stay below -40 dB for a hard-driven 7 kHz tone", `${(db(worst) - db(fund)).toFixed(1)} dB`);
}

// ---- dust: crackle statistics
const SECONDS = 120;
function events(y, th, gap = 0.02) {
  const ev = []; let last = -1e9;
  for (let i = 0; i < y.length; i++) {
    const a = Math.abs(y[i]);
    if (a > th) { if (i - last > gap * SR) ev.push([i, a]); else if (a > ev[ev.length - 1][1]) ev[ev.length - 1][1] = a; last = i; }
  }
  return ev;
}
{
  check(rms(run(new Float32Array(48000), { dust: 0 }).outL) === 0 || rms(run(new Float32Array(48000), { dust: 0 }).outL) < 1e-9, "Dust 0: a mint record is silent");
  const n = SR * SECONDS;
  const o = run(new Float32Array(n), { dust: 30 });
  const pops = events(o.outL, 0.15).length / SECONDS, expected = 12 * 0.3 * 0.3;
  console.log(`  dust 30 %: ${pops.toFixed(2)} pops per second (model: ${expected.toFixed(2)}), ticks above 0.04: ${(events(o.outL, 0.04).length / SECONDS).toFixed(1)} per second`);
  check(Math.abs(pops - expected) < 0.35 * expected, "Dust 30 %: pops per second match the model within 35 %", `${pops.toFixed(2)} vs ${expected.toFixed(2)}`);
  const o2 = run(new Float32Array(SR * 30), { dust: 60 });
  const pops2 = events(o2.outL, 0.15).length / 30;
  check(pops2 > 3 * pops, "Dust 60 %: far more pops than at 30 % (quadratic law)", `${pops2.toFixed(1)} vs ${pops.toFixed(1)} per second`);
  const o78 = run(new Float32Array(SR * 60), { dust: 30, speed: 2 });
  const pops78 = events(o78.outL, 0.15).length / 60;
  check(pops78 > pops * 1.2, "78 rpm: busier surface than 33 1/3 rpm", `${pops78.toFixed(2)} vs ${pops.toFixed(2)} per second`);
  // amplitude distribution: pops are rare, small ticks are common
  const small = events(o.outL, 0.03).length / SECONDS;
  check(small > 3 * pops, "many more small ticks than big pops", `${small.toFixed(1)} vs ${pops.toFixed(2)} per second`);
  // a crackle bed raises the noise floor between the events but stays far below the pops
  const bed = run(new Float32Array(SR * 4), { dust: 100, noise: 100 });
  check(finiteAll(bed.outL) && finiteAll(bed.outR), "dust at 100 % is finite");
}

// ---- scratches: once per revolution, at the same place on every turn
for (const [speed, rpm] of [[0, 100 / 3], [1, 45], [2, 78]]) {
  const period = SR * 60 / rpm, turns = 3, n = Math.ceil(period * turns) + 2000;
  const y = run(new Float32Array(n), { dust: 100, speed }).outL;
  const positions = [0.137, 0.512, 0.861];
  let ok = true, detail = [];
  for (let t = 0; t < turns; t++) for (const p of positions) {
    const centre = Math.round((t + p) * period); let best = 0;
    for (let i = centre - 4; i <= centre + 4; i++) best = Math.max(best, Math.abs(y[i]));
    if (best < 0.2) ok = false;
    if (t === 0) detail.push(best.toFixed(2));
  }
  check(ok, `${rpm.toFixed(1)} rpm: the three scratches come back every ${(60 / rpm).toFixed(3)} s at the same places`, `peaks ${detail.join(" ")}`);
  // the scratch waveform itself repeats
  const w = 400, a0 = Math.round(positions[1] * period), a1 = Math.round((1 + positions[1]) * period);
  let dot = 0, e0 = 0, e1 = 0;
  for (let i = -20; i < w; i++) { const u = y[a0 + i], v = y[a1 + i]; dot += u * v; e0 += u * u; e1 += v * v; }
  check(dot / Math.sqrt(e0 * e1) > 0.8, `${rpm.toFixed(1)} rpm: the scratch sounds the same on every turn`, `correlation ${(dot / Math.sqrt(e0 * e1)).toFixed(2)}`);
}
{
  // below 40 % dust there are no scratches
  const period = SR * 60 / (100 / 3), y = run(new Float32Array(Math.ceil(period) * 2), { dust: 20 }).outL;
  const strongest = (c) => { let b = 0; for (let i = c - 4; i <= c + 4; i++) b = Math.max(b, Math.abs(y[i])); return b; };
  check(strongest(Math.round(0.137 * period)) < 0.4 || strongest(Math.round((1.137) * period)) < 0.4, "no scratches on a clean record (Dust 20 %)");
}

// ---- warp: pitch wobble once per revolution
function pitchTrace(params, f0 = 1000, seconds = 8) {
  const n = SR * seconds, x = sine(f0, 0.3, n);
  const y = run(x, params).outL;
  const win = 960, ci = new Float64Array(n), cq = new Float64Array(n);
  for (let i = 0; i < n; i++) { const w = 2 * Math.PI * f0 * i / SR; ci[i] = y[i] * Math.cos(w); cq[i] = -y[i] * Math.sin(w); }
  let si = 0, sq = 0; const ph = [];
  for (let i = 0; i < n; i++) { si += ci[i]; sq += cq[i]; if (i >= win) { si -= ci[i - win]; sq -= cq[i - win]; } if (i >= SR / 2 && i % 48 === 0) ph.push(Math.atan2(sq, si)); }
  for (let i = 1; i < ph.length; i++) { while (ph[i] - ph[i - 1] > Math.PI) ph[i] -= 2 * Math.PI; while (ph[i] - ph[i - 1] < -Math.PI) ph[i] += 2 * Math.PI; }
  const dt = 48 / SR, cents = [];
  for (let i = 5; i < ph.length - 5; i++) cents.push(1200 * Math.log2(1 + (ph[i + 5] - ph[i - 5]) / (10 * dt) / (2 * Math.PI) / f0));
  return { cents, dt };
}
{
  const amp = (tr, f) => { let a = 0, b = 0; tr.cents.forEach((c, i) => { a += c * Math.cos(2 * Math.PI * f * i * tr.dt); b += c * Math.sin(2 * Math.PI * f * i * tr.dt); }); return Math.hypot(a, b) * 2 / tr.cents.length; };
  const w0 = pitchTrace({ warp: 0 }), w100 = pitchTrace({ warp: 100 }), w50 = pitchTrace({ warp: 50 });
  const pk = (tr) => Math.max(...tr.cents.map(Math.abs));
  console.log("  pitch peak (cents): warp 0 / 50 / 100 %:", pk(w0).toFixed(2), pk(w50).toFixed(2), pk(w100).toFixed(2));
  check(pk(w0) < 0.3, "Warp 0: steady pitch", `${pk(w0).toFixed(2)} cents`);
  check(pk(w100) > 8 && pk(w100) < 22, "Warp 100 %: about +-14 cents", `${pk(w100).toFixed(1)} cents`);
  check(pk(w50) > 0.35 * pk(w100) && pk(w50) < 0.65 * pk(w100), "Warp depth follows the knob", `${pk(w50).toFixed(1)} vs ${pk(w100).toFixed(1)}`);
  for (const [speed, rot] of [[0, 100 / 3 / 60], [1, 0.75], [2, 1.3]]) {
    const tr = pitchTrace({ warp: 100, speed }, 1000, 10);
    const main = amp(tr, rot), off1 = Math.max(amp(tr, rot * 0.5), amp(tr, rot * 1.5), amp(tr, rot * 0.75));
    check(main > 2.5 * off1, `speed ${["33 1/3", "45", "78"][speed]} rpm: the wobble is at the rotation frequency ${rot.toFixed(3)} Hz`, `${main.toFixed(2)} vs ${off1.toFixed(2)} cents`);
  }
}

// ---- mix: the dry signal is delayed by the same fixed delay
{
  const n = 8192, x = new Float32Array(n); let s = 777; for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = (s / 4294967296 - 0.5) * 0.5; }
  const y = run(x, { mix: 0, dust: 50, noise: 50 }).outL, lat = Math.round(0.004 * SR) + 23;
  let err = 0; for (let i = lat; i < n; i++) err = Math.max(err, Math.abs(y[i] - x[i - lat]));
  check(err < 1e-6, `Mix 0 passes the original, delayed by ${lat} samples, even with bass mono and dust on`, `max error ${err.toExponential(1)}`);
  const half = toneGain({ mix: 50 }, 1000), full = toneGain({ mix: 100 }, 1000);
  check(Math.abs(half - full) < 0.1, "Mix 50 %: wet and dry add in phase (flat chain)", `${half.toFixed(2)} vs ${full.toFixed(2)} dB`);
}

// ---- determinism, stereo, input modes
{
  const x = sine(300, 0.3, 48000);
  const p = { dust: 80, noise: 70, rumble: 50, warp: 60 };
  const a = render(m, { inputs: { l: x }, params: p }), b = render(m, { inputs: { l: x }, params: p });
  check(a.outL.every((v, i) => v === b.outL[i]) && a.outR.every((v, i) => v === b.outR[i]), "two renders are identical (seeded)");
  const diff = a.outL.some((v, i) => v !== a.outR[i]);
  check(diff, "the channels carry independent noise");
  const st = render(m, { n: 30000, inputs: { l: x }, params: { ...off, input: 0 } });
  let dmax = 0; for (let i = 9000; i < 30000; i++) dmax = Math.max(dmax, Math.abs(st.outL[i] - st.outR[i]));
  check(dmax < 1e-5 && rms(st.outR, 9000) > 0.05, "Input Auto: nothing in In R, so R follows L", `${dmax.toExponential(1)}`);
  const stereo = render(m, { n: 30000, inputs: { l: x, r: new Float32Array(30000) }, params: { ...off, input: 1 } });
  check(rms(stereo.outR, 9000) < 1e-6 && rms(stereo.outL, 9000) > 0.05, "Input Stereo: a silent R stays silent");
  const r = new Float32Array(30000); for (let i = 15000; i < 30000; i++) r[i] = 0.3 * Math.sin(2 * Math.PI * 500 * i / SR);
  const sw = render(m, { n: 30000, inputs: { l: x, r }, params: { ...off, input: 0 } });
  let d2 = 0, jump = 0; for (let i = 24000; i < 30000; i++) d2 = Math.max(d2, Math.abs(sw.outL[i] - sw.outR[i]));
  for (let i = 1; i < 30000; i++) jump = Math.max(jump, Math.abs(sw.outR[i] - sw.outR[i - 1]));
  check(d2 > 0.05 && jump < 0.4, "Input Auto: R is used as soon as it carries a signal, without a click", `${d2.toFixed(2)}, step ${jump.toFixed(2)}`);
}

// ---- safety
{
  const n = 9600, sq = Float32Array.from({ length: n }, (_, i) => ((i >> 5) & 1 ? 1 : -1));
  const dc = new Float32Array(n).fill(1), big = Float32Array.from({ length: n }, (_, i) => 1000 * Math.sin(i * 0.37));
  let ok = true, worst = 0;
  for (const sig of [sq, dc, big]) for (const sp of [0, 1, 2]) for (const p of [{ dust: 100, noise: 100, rumble: 100, warp: 100, crosstalk: 100, bassMono: 400, inner: 100, cartridge: 2, speed: sp, outputDb: 12 }, { dust: 0, noise: 0, rumble: 0, warp: 0, crosstalk: 0, bassMono: 0, inner: 0, cartridge: 0, speed: sp, mix: 50 }]) {
    const o = render(m, { inputs: { l: sig, r: sig }, params: p });
    ok = ok && finiteAll(o.outL) && finiteAll(o.outR); if (!p.mix) worst = Math.max(worst, ...o.outL.map(Math.abs));
  }
  check(ok && worst <= 16.001, "finite and bounded for square, DC and huge input at extreme settings", `peak ${worst.toFixed(1)}`);
  const z = render(m, { n: 20000, inputs: { l: new Float32Array(20000) }, params: { ...off } });
  check(rms(z.outL) < 1e-9 && rms(z.outR) < 1e-9, "silence in, silence out for a clean chain (no startup transient)", `${rms(z.outL).toExponential(1)}`);
}

// ---- other sample rates: scratch period and groove curve
for (const sr of [44100, 96000]) {
  const period = sr * 60 / (100 / 3), y = render(m, { sampleRate: sr, n: Math.ceil(period * 2) + 100, inputs: { l: new Float32Array(Math.ceil(period * 2) + 100) }, params: { ...off, dust: 100 } }).outL;
  let best = 0; const c = Math.round(1.512 * period); for (let i = c - 4; i <= c + 4; i++) best = Math.max(best, Math.abs(y[i]));
  check(best > 0.2, `${sr} Hz: scratch period is still one revolution`, `${best.toFixed(2)}`);
}
finish();
