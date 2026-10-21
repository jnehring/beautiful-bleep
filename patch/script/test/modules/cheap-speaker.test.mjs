// SPDX-License-Identifier: GPL-3.0-or-later
// Cheap Speaker: corners of every device, level-dependent behaviour, noise, wobble, mix phase, aliasing, safety.   node test/modules/cheap-speaker.test.mjs
import { loadModule, render, sine, gainAt, check, finish, spectrum, db, rms, finiteAll, harmonicsDb } from "./lib.mjs";

const SR = 48000;
const m = await loadModule("cheap-speaker");
console.log("cost", JSON.stringify(m.cost));
check(m.cost.ops < 150000, "cost estimate below 150,000 ops per chunk", `${m.cost.ops}`);
check(m.spec.type === "cheap-speaker" && m.spec.params.length >= 9, "module spec");

const clean = { resonance: 0, distortion: 0, noise: 0, wobble: 0 };   // a plain filter: for measuring corners
const g = (f, p = {}, o = {}) => gainAt(m, f, { out: "outL", amp: 0.01, params: { ...clean, ...p }, ...o });
const devices = [
  { name: "Telephone", d: 0, hp: 300, lp: 3400 },
  { name: "AM Radio", d: 1, hp: 120, lp: 4500 },
  { name: "Car Speaker", d: 2, hp: 80, lp: 7500 },
  { name: "Cassette Player", d: 3, hp: 50, lp: 9000 },
  { name: "Tiny Speaker", d: 4, hp: 300, lp: 9500 },
  { name: "Megaphone", d: 5, hp: 500, lp: 4000 },
];

// ---- realised corners: -3 dB points of the fourth-order sections, relative to the middle of the band
for (const dev of devices) {
  const ref = g(Math.sqrt(dev.hp * dev.lp), { device: dev.d });
  const lo = g(dev.hp, { device: dev.d }) - ref, hi = g(dev.lp, { device: dev.d }) - ref;
  check(Math.abs(lo + 3.01) < 0.6, `${dev.name}: low corner ${dev.hp} Hz is -3 dB`, `${lo.toFixed(2)} dB`);
  check(Math.abs(hi + 3.01) < 0.6, `${dev.name}: high corner ${dev.lp} Hz is -3 dB`, `${hi.toFixed(2)} dB`);
  const slopeLo = g(dev.hp / 2, { device: dev.d }) - ref;
  check(slopeLo < -20, `${dev.name}: steep low cut (an octave below the corner)`, `${slopeLo.toFixed(1)} dB`);
}

// ---- Bandwidth scales the corners
{
  const ref = g(1000, { device: 0, bandwidth: 200 });
  const lo = g(150, { device: 0, bandwidth: 200 }) - ref, hi = g(6800, { device: 0, bandwidth: 200 }) - ref;
  check(Math.abs(lo + 3.01) < 0.7 && Math.abs(hi + 3.01) < 0.7, "Bandwidth 200 %: telephone corners at 150 Hz and 6.8 kHz", `${lo.toFixed(2)} / ${hi.toFixed(2)} dB`);
  const ref2 = g(1000, { device: 0, bandwidth: 50 });
  const lo2 = g(600, { device: 0, bandwidth: 50 }) - ref2, hi2 = g(1700, { device: 0, bandwidth: 50 }) - ref2;
  check(Math.abs(lo2 + 3.01) < 0.7 && Math.abs(hi2 + 3.01) < 0.7, "Bandwidth 50 %: corners at 600 Hz and 1.7 kHz", `${lo2.toFixed(2)} / ${hi2.toFixed(2)} dB`);
}

// ---- Resonance: the characteristic peaks
{
  const flat = g(1200, { device: 0 }) - g(700, { device: 0 });
  const peaked = g(1200, { device: 0, resonance: 50 }) - g(700, { device: 0, resonance: 50 });
  check(peaked > flat + 3, "Telephone: the nasal mid peak rises with Resonance", `${flat.toFixed(1)} -> ${peaked.toFixed(1)} dB`);
  const tiny = g(2200, { device: 4, resonance: 50 }) - g(1000, { device: 4, resonance: 50 });
  check(tiny > 5, "Tiny Speaker: sharp resonance near 2.2 kHz", `${tiny.toFixed(1)} dB over 1 kHz`);
  const tiny0 = g(2200, { device: 4 }) - g(1000, { device: 4 });
  check(tiny0 < 1, "Tiny Speaker: no peak at Resonance 0", `${tiny0.toFixed(1)} dB`);
  const box = g(300, { device: 2, resonance: 50 }) - g(300, { device: 2, resonance: 0 });
  check(box > 2, "Car Speaker: boxy cavity peak near 300 Hz", `${box.toFixed(1)} dB`);
  const horn = g(1500, { device: 5, resonance: 50 }) - g(1500, { device: 5, resonance: 0 });
  check(horn > 4, "Megaphone: horn resonance near 1.5 kHz", `${horn.toFixed(1)} dB`);
}

// ---- Cabin reflection (car): a comb ripple that appears with Resonance and is absent at 0
{
  const ripple = (res) => { const v = []; for (let f = 400; f <= 1600; f += 50) v.push(g(f, { device: 2, resonance: res })); return Math.max(...v) - Math.min(...v); };
  console.log("  car passband ripple (res 0 / 50):", ripple(0).toFixed(2), ripple(50).toFixed(2));
  check(ripple(50) > ripple(0) + 1, "Car Speaker: a cabin reflection adds comb ripple");
}

// ---- Distortion: level-dependent, with the character of each device
const hd = (dev, f0, amp, dist, extra = {}) => {
  const n = 32768, x = sine(f0, amp, n);
  const y = render(m, { inputs: { l: x }, params: { ...clean, device: dev, distortion: dist, ...extra } }).outL;
  return harmonicsDb(y.subarray(n / 2), f0, SR, 6);
};
{
  const quiet = hd(0, 500, 0.02, 100), loud = hd(0, 500, 0.5, 100);
  console.log("  telephone harmonics (dB re fundamental) quiet:", quiet.map((v) => v.toFixed(0)).join(" "), " loud:", loud.map((v) => v.toFixed(0)).join(" "));
  check(loud[2] > quiet[2] + 10, "Telephone: 3rd harmonic grows with level", `${quiet[2].toFixed(1)} -> ${loud[2].toFixed(1)} dB`);
  check(loud[1] > -40 && loud[1] > loud[2] - 14, "Telephone: carbon-style asymmetry gives strong even (2nd) harmonic", `h2 ${loud[1].toFixed(1)} h3 ${loud[2].toFixed(1)}`);
  const d0 = hd(0, 500, 0.5, 0), d100 = hd(0, 500, 0.5, 100);
  check(d100[2] > d0[2] + 6, "Telephone: Distortion knob raises the harmonics", `${d0[2].toFixed(1)} -> ${d100[2].toFixed(1)} dB`);
}
{
  const am = hd(1, 400, 0.4, 100);
  console.log("  AM harmonics:", am.map((v) => v.toFixed(0)).join(" "));
  check(am[1] > am[2] - 6 && am[1] > -45, "AM Radio: detector-like asymmetry (strong 2nd harmonic)", `h2 ${am[1].toFixed(1)} h3 ${am[2].toFixed(1)}`);
  const mega = hd(5, 700, 0.5, 100);
  console.log("  megaphone harmonics:", mega.map((v) => v.toFixed(0)).join(" "));
  check(mega[2] > -22 && mega[1] < mega[2] - 12, "Megaphone: hard symmetric clipping (odd harmonics, weak 2nd)", `h2 ${mega[1].toFixed(1)} h3 ${mega[2].toFixed(1)}`);
}
{
  // output level compression: peak of a loud tone is limited
  const x = sine(700, 0.9, 16384), y = render(m, { inputs: { l: x }, params: { ...clean, device: 5, distortion: 100 } }).outL;
  const q = render(m, { inputs: { l: sine(700, 0.02, 16384) }, params: { ...clean, device: 5, distortion: 100 } }).outL;
  const ratio = (rms(y, 8192) / 0.9) / (rms(q, 8192) / 0.02);
  check(ratio < 0.5, "Megaphone: strong gain compression at high level", `loud/quiet gain ${(20 * Math.log10(ratio)).toFixed(1)} dB`);
}

// ---- Excursion: bass is lost at high level (car and tiny speaker), the treble is not
{
  const lvl = (dev, f, amp, dist) => { const x = sine(f, amp, 32768), y = render(m, { inputs: { l: x }, params: { ...clean, device: dev, distortion: dist } }).outL; return 20 * Math.log10(rms(y, 16384) / rms(x, 16384)); };
  for (const [dev, name, fb] of [[2, "Car Speaker", 120], [4, "Tiny Speaker", 400]]) {
    const bassQ = lvl(dev, fb, 0.02, 80) - lvl(dev, 2500, 0.02, 80);
    const bassL = lvl(dev, fb, 0.6, 80) - lvl(dev, 2500, 0.1, 80);
    check(bassL < bassQ - 1.5, `${name}: bass relative to treble drops at high level (excursion limit)`, `${bassQ.toFixed(1)} -> ${bassL.toFixed(1)} dB`);
  }
  // rattle: energy between the harmonics of a loud bass tone
  const rat = (amp) => { const f0 = 187.5, x = sine(f0, amp, 32768), y = render(m, { inputs: { l: x }, params: { ...clean, device: 4, distortion: 80 } }).outL; const p = spectrum(y.subarray(16384)); const binHz = SR / 16384; let e = 0; for (let k = Math.round(1000 / binHz); k < Math.round(2600 / binHz); k++) { const h = (k * binHz) / f0, nearest = Math.abs(h - Math.round(h)) * f0; if (nearest > 40) e += p[k]; } return db(e); };
  const rq = rat(0.05), rl = rat(0.8);
  check(rl > rq + 15, "Tiny Speaker: rattle (non-harmonic buzz) appears when the cone is overdriven", `${rq.toFixed(0)} -> ${rl.toFixed(0)} dB`);
}

// ---- Noise
const silent = (dev, p, n = 65536) => render(m, { n, inputs: { l: new Float32Array(n) }, params: { ...clean, device: dev, ...p } });
{
  const z = silent(0, { noise: 0 });
  check(rms(z.outL) < 1e-6, "Noise 0: silence in, silence out", `${rms(z.outL).toExponential(1)}`);
  const lv = [30, 100].map((nv) => rms(silent(0, { noise: nv }).outL));
  check(lv[1] > lv[0] * 3 && lv[0] > 1e-5 && lv[1] < 0.2, "Telephone: noise level follows the knob", `${lv.map((v) => (20 * Math.log10(v)).toFixed(1)).join(" / ")} dBFS`);
  // line noise is shaped by the 300 Hz - 3.4 kHz band: much less above 6 kHz than inside
  const p = spectrum(silent(0, { noise: 100 }).outL), bin = SR / 65536;
  const band = (a, b) => { let e = 0; for (let k = Math.round(a / bin); k < Math.round(b / bin); k++) e += p[k]; return e / (Math.round(b / bin) - Math.round(a / bin)); };
  const inside = band(600, 2500), outside = band(8000, 16000);
  check(db(inside) - db(outside) > 40, "Telephone: the hiss is shaped by the band", `${(db(inside) - db(outside)).toFixed(0)} dB`);
  const hum = band(45, 55) / Math.max(band(600, 2500), 1e-30);
  console.log("  telephone hum region vs mid band:", db(hum).toFixed(1), "dB (HP-free hum is added after the band)");
  check(db(band(45, 55)) > db(inside) + 10, "Telephone: mains hum is present below the band", `${(db(band(45, 55)) - db(inside)).toFixed(0)} dB over the hiss`);
  // AM whistle: a tone near 2.5 kHz
  const pa = spectrum(silent(1, { noise: 100 }).outL);
  let peakK = 0; for (let k = Math.round(1500 / bin); k < Math.round(3500 / bin); k++) if (pa[k] > pa[peakK]) peakK = k;
  const around = []; for (let k = peakK - 400; k <= peakK + 400; k++) if (Math.abs(k - peakK) > 20) around.push(pa[k]);
  const floor = around.sort((a, b) => a - b)[Math.floor(around.length / 2)];
  check(peakK * bin > 2200 && peakK * bin < 3000 && db(pa[peakK]) - db(floor) > 20, "AM Radio: heterodyne whistle near 2.5 kHz", `${(peakK * bin).toFixed(0)} Hz, ${(db(pa[peakK]) - db(floor)).toFixed(0)} dB over the floor`);
  // static: crackle makes the AM noise spiky; the cassette hiss is steady
  const crest = (y) => { let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v)); return pk / rms(y); };
  const am = silent(1, { noise: 100 }).outL, cs = silent(3, { noise: 100 }).outL;
  check(crest(am) > crest(cs) + 0.8, "AM Radio static is spikier than cassette hiss", `crest ${crest(am).toFixed(1)} vs ${crest(cs).toFixed(1)}`);
  // tape hiss is high-frequency heavy, road rumble low
  const pc = spectrum(cs), pcar = spectrum(silent(2, { noise: 100 }).outL);
  const bandOf = (p2, a, b) => { let e = 0; const k0 = Math.round(a / bin), k1 = Math.round(b / bin); for (let k = k0; k < k1; k++) e += p2[k]; return e / (k1 - k0); };
  check(db(bandOf(pc, 4000, 8000)) > db(bandOf(pc, 1000, 2000)) + 5, "Cassette: hiss bed is bright (more energy 4-8 kHz than 1-2 kHz)", `${(db(bandOf(pc, 4000, 8000)) - db(bandOf(pc, 1000, 2000))).toFixed(1)} dB`);
  check(db(bandOf(pcar, 20, 100)) > db(bandOf(pcar, 2000, 8000)) + 10, "Car Speaker: road noise is low-frequency");
  // independent noise on both channels
  const sr = silent(5, { noise: 100 });
  let dot = 0; for (let i = 0; i < sr.outL.length; i++) dot += sr.outL[i] * sr.outR[i];
  const corr = dot / (sr.outL.length * rms(sr.outL) * rms(sr.outR));
  check(Math.abs(corr) < 0.1, "noise is independent on the two channels (hiss and static; hum and the whistle are common)", `correlation ${corr.toFixed(3)}`);
}

// ---- Wobble: slow pitch drift measured as vibrato in cents
const vibrato = (dev, wob, f0 = 1000) => {
  const n = SR * 3, x = sine(f0, 0.3, n);
  const y = render(m, { inputs: { l: x }, params: { ...clean, device: dev, wobble: wob } }).outL;
  const win = 960, ci = new Float64Array(n), cq = new Float64Array(n);
  for (let i = 0; i < n; i++) { const w = 2 * Math.PI * f0 * i / SR; ci[i] = y[i] * Math.cos(w); cq[i] = -y[i] * Math.sin(w); }
  let si = 0, sq = 0; const ph = [];
  for (let i = 0; i < n; i++) { si += ci[i]; sq += cq[i]; if (i >= win) { si -= ci[i - win]; sq -= cq[i - win]; } if (i >= SR / 2 && i % 48 === 0) ph.push(Math.atan2(sq, si)); }
  for (let i = 1; i < ph.length; i++) { while (ph[i] - ph[i - 1] > Math.PI) ph[i] -= 2 * Math.PI; while (ph[i] - ph[i - 1] < -Math.PI) ph[i] += 2 * Math.PI; }
  let pk = 0; const dt = 48 / SR;
  const cents = []; for (let i = 5; i < ph.length - 5; i++) { const fdev = (ph[i + 5] - ph[i - 5]) / (10 * dt) / (2 * Math.PI); cents.push(1200 * Math.log2(1 + fdev / f0)); }
  for (const c of cents) pk = Math.max(pk, Math.abs(c));
  return pk;
};
{
  const w0 = vibrato(3, 0), w100 = vibrato(3, 100), w50 = vibrato(3, 50), mega = vibrato(5, 100), am = vibrato(1, 100);
  console.log("  vibrato peak (cents): cassette 0 / 50 / 100 %:", w0.toFixed(2), w50.toFixed(2), w100.toFixed(2), " megaphone 100 %:", mega.toFixed(2), " am 100 %:", am.toFixed(2));
  check(w0 < 0.5, "Cassette: no pitch wobble at Wobble 0", `${w0.toFixed(2)} cents`);
  check(w100 > 3 && w100 < 60, "Cassette: slow wow of a few to tens of cents at Wobble 100 %", `${w100.toFixed(1)} cents`);
  check(w50 < w100 && w50 > w0 + 0.5, "Cassette: wow depth follows the knob");
  check(mega < 0.5, "Megaphone: no pitch wobble (only level drift)", `${mega.toFixed(2)} cents`);
  check(am > 0.5 && am < w100, "AM Radio: only a little tuning wobble", `${am.toFixed(2)} cents`);
}

// ---- Mix: the dry path is delayed by the wet path's fixed latency
{
  const n = 8192, x = new Float32Array(n); let s = 12345; for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; x[i] = (s / 4294967296 - 0.5) * 0.5; }
  const y = render(m, { inputs: { l: x }, params: { ...clean, device: 3, mix: 0 } }).outL;
  const lat = Math.round(0.0032 * SR) + 23;
  let err = 0; for (let i = lat; i < n; i++) err = Math.max(err, Math.abs(y[i] - x[i - lat]));
  check(err < 1e-6, `Mix 0 passes the dry signal, delayed by exactly the wet latency (${lat} samples)`, `max error ${err.toExponential(1)}`);
  // wet and dry add in phase (cassette is nearly flat and linear at 1 kHz)
  const t = (mix) => { const xs = sine(1000, 0.05, 32768), ys = render(m, { inputs: { l: xs }, params: { ...clean, device: 3, mix } }).outL; return rms(ys, 16384) / rms(xs, 16384); };
  const a0 = t(0), a1 = t(100), a5 = t(50);
  check(Math.abs(a5 - (a0 + a1) / 2) < 0.03 * a1, "Mix 50 %: wet and dry add in phase", `${a0.toFixed(3)} ${a5.toFixed(3)} ${a1.toFixed(3)}`);
}

// ---- Aliasing: a bright tone driven hard
{
  const f0 = 5003, n = 32768, x = sine(f0, 0.9, n);
  for (const [dev, name] of [[4, "Tiny Speaker"], [5, "Megaphone"], [0, "Telephone"]]) {
    const y = render(m, { inputs: { l: x }, params: { ...clean, device: dev, distortion: 100, bandwidth: 200 } }).outL;
    const p = spectrum(y.subarray(n / 2)), bin = SR / (n / 2);
    const fund = p[Math.round(f0 / bin)];
    let worst = 0, worstF = 0;
    for (let k = 20; k < p.length - 2; k++) {
      const f = k * bin;
      let near = false; for (let h = 1; h <= 9; h++) if (Math.abs(f - h * f0) < 12 * bin || Math.abs(f - (h * f0) % SR) < 12 * bin) near = true;
      if (near) continue;
      // true harmonics fold into (SR - h f0) mod SR too; treat anything not within the first nine harmonics as alias and keep the worst
      if (p[k] > worst) { worst = p[k]; worstF = f; }
    }
    // The first nine harmonics (up to 45 kHz) are real harmonics (many fold into the audio band with 5 kHz); remaining peaks are the check.
    console.log(`  ${name}: strongest non-harmonic component ${(db(worst) - db(fund)).toFixed(1)} dB re fundamental at ${worstF.toFixed(0)} Hz`);
    check(db(worst) - db(fund) < -45, `${name}: aliasing/other components below -45 dB under heavy drive of a 5 kHz tone`, `${(db(worst) - db(fund)).toFixed(1)} dB`);
  }
}

// ---- Level: no device is absurdly louder or quieter than the input at defaults (a broadband test signal)
{
  const n = 32768, x = new Float32Array(n);
  for (const f of [150, 300, 600, 1200, 2400, 4800]) { const s = sine(f * 1.013, 0.08, n); for (let i = 0; i < n; i++) x[i] += s[i]; }
  for (const dev of devices) {
    const y = render(m, { inputs: { l: x }, params: { device: dev.d } }).outL;
    const d = 20 * Math.log10(rms(y, n / 2) / rms(x, n / 2));
    check(Math.abs(d) < 8, `${dev.name}: default loudness within 8 dB of the input`, `${d.toFixed(1)} dB`);
  }
}

// ---- Determinism, stereo, Input modes
{
  const x = sine(440, 0.3, 24000);
  const a = render(m, { inputs: { l: x }, params: { device: 1, noise: 80, wobble: 60 } }), b = render(m, { inputs: { l: x }, params: { device: 1, noise: 80, wobble: 60 } });
  check(a.outL.every((v, i) => v === b.outL[i]) && a.outR.every((v, i) => v === b.outR[i]), "two renders are identical (seeded)");
  // Auto: R unpatched -> both channels carry the left signal; with no noise they are equal
  const st = render(m, { n: 24000, inputs: { l: x }, params: { ...clean, device: 5, input: 0 } });
  let dmax = 0; for (let i = 9000; i < 24000; i++) dmax = Math.max(dmax, Math.abs(st.outL[i] - st.outR[i]));
  check(dmax < 1e-5 && rms(st.outR) > 0.01, "Input Auto: nothing in In R, so R follows L", `${dmax.toExponential(1)}`);
  const stereo = render(m, { n: 24000, inputs: { l: x, r: new Float32Array(24000) }, params: { ...clean, device: 5, input: 1 } });
  check(rms(stereo.outR, 4000) < 1e-5 && rms(stereo.outL, 4000) > 0.01, "Input Stereo: a silent R stays silent");
  const mono = render(m, { n: 24000, inputs: { l: x, r: sine(300, 0.3, 24000) }, params: { ...clean, device: 5, input: 2 } });
  let dm = 0; for (let i = 9000; i < 24000; i++) dm = Math.max(dm, Math.abs(mono.outL[i] - mono.outR[i]));
  check(dm < 1e-4, "Input Mono: R is ignored", `${dm.toExponential(1)}`);
  // Auto -> stereo the moment R becomes non-zero
  const r = new Float32Array(24000); for (let i = 12000; i < 24000; i++) r[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / SR);
  const sw = render(m, { n: 24000, inputs: { l: x, r }, params: { ...clean, device: 5, input: 0 } });
  let d2 = 0; for (let i = 20000; i < 24000; i++) d2 = Math.max(d2, Math.abs(sw.outL[i] - sw.outR[i]));
  let jump = 0; for (let i = 1; i < 24000; i++) jump = Math.max(jump, Math.abs(sw.outR[i] - sw.outR[i - 1]));
  check(d2 > 0.01, "Input Auto: R is used as soon as it carries a signal", `${d2.toFixed(3)}`);
  check(jump < 0.3, "Input Auto: no click when R appears", `max step ${jump.toFixed(3)}`);
}

// ---- Safety: finite, bounded, for any knob combination and nasty input
{
  const n = 9600, sq = Float32Array.from({ length: n }, (_, i) => ((i >> 5) & 1 ? 1 : -1));
  const dc = new Float32Array(n).fill(1), big = Float32Array.from({ length: n }, (_, i) => 1000 * Math.sin(i * 0.37));
  let ok = true, worst = 0;
  for (const dev of devices) for (const sig of [sq, dc, big]) for (const p of [{ distortion: 100, noise: 100, wobble: 100, resonance: 100, bandwidth: 200 }, { distortion: 0, noise: 0, wobble: 0, resonance: 0, bandwidth: 50, mix: 50, outputDb: 12 }]) {
    const o = render(m, { inputs: { l: sig, r: sig }, params: { device: dev.d, ...p } });
    ok = ok && finiteAll(o.outL) && finiteAll(o.outR); if (!p.mix) worst = Math.max(worst, ...o.outL.map(Math.abs));
  }
  check(ok && worst <= 16.001, "finite and bounded for square, DC and huge input at extreme settings, all devices", `peak ${worst.toFixed(1)}`);
  const z = render(m, { n: 20000, inputs: { l: new Float32Array(20000) }, params: { noise: 0 } });
  check(finiteAll(z.outL) && rms(z.outL) === 0 || rms(z.outL) < 1e-9, "no NaN or residue after silence");
}

// ---- Sample rates
for (const sr of [44100, 96000]) {
  const gs = (f) => gainAt(m, f, { out: "outL", amp: 0.01, params: clean, sampleRate: sr });
  const ref = gs(1000);
  const lo = gs(300) - ref, hi = gs(3400) - ref;
  check(Math.abs(lo + 3.01) < 0.6 && Math.abs(hi + 3.01) < 0.6, `${sr} Hz: telephone corners still 300 Hz and 3.4 kHz`, `${lo.toFixed(2)} / ${hi.toFixed(2)} dB`);
}
finish();
