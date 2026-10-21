// SPDX-License-Identifier: GPL-3.0-or-later
// Mic Colour: the response of each microphone model against its intended analog curve, proximity and distance, presence, off-axis,
// early reflections, self-noise, level-dependent saturation and aliasing, safety.   node test/modules/mic-colour.test.mjs
import { loadModule, render, sine, gainAt, harmonicsDb, spectrum, check, finish, finiteAll, peak, rms, noise, SR } from "./lib.mjs";

const m = await loadModule("mic-colour");
check(m.cost.ops < 60000 && m.warnings.length === 0, "cost below the warning bound", JSON.stringify(m.cost));
const OUT = { out: "outL" };
const MODELS = ["Ribbon", "Dynamic", "Condenser", "Tube Condenser"];
const flat = { distance: 40, proximity: 50, presence: 30, colour: 50, diaphragm: 50, offAxis: 0, room: 0, selfNoise: -100, output: 0, mix: 100, input: 0 };

// ---- the intended analog curves ---------------------------------------------------------------------------------------------------------------
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const poly = (c, s) => c.reduce((acc, ci, k) => { let p = [1, 0]; for (let i = 0; i < k; i++) p = cmul(p, s); return [acc[0] + ci * p[0], acc[1] + ci * p[1]]; }, [0, 0]);   // c ascending
const proto = (nb, na, f, f0) => cdiv(poly(nb, [0, f / f0]), poly(na, [0, f / f0]));
const hp2 = (f, f0, Q) => proto([0, 0, 1], [1, 1 / Q, 1], f, f0);
const lp2 = (f, f0, Q) => proto([1, 0, 0], [1, 1 / Q, 1], f, f0);
const lowShelf2 = (f, f0, db, Q) => { const A = 10 ** (db / 40), r = Math.sqrt(A) / Q; return proto([A * A, A * r, A], [1, r, A], f, f0); };
const highShelf2 = (f, f0, db, Q) => { const A = 10 ** (db / 40), r = Math.sqrt(A) / Q; return proto([A, A * r, A * A], [A, r, 1], f, f0); };
const bell = (f, f0, db, Q) => { const A = 10 ** (db / 40); return proto([1, A / Q, 1], [1, 1 / (A * Q), 1], f, f0); };
const chain = (...zs) => zs.reduce((a, b) => cmul(a, b), [1, 0]);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const dbOf = (z) => 20 * Math.log10(Math.hypot(z[0], z[1]));

/// the intended response of the microphone at one setting (without the level-dependent saturation, which is negligible at small signals)
function mic(f, model, p = {}) {
  const q = { ...flat, ...p };
  const d = q.distance, prox = q.proximity / 100, pr = q.presence / 100, c2 = q.colour / 100 * 2, dia = q.diaphragm / 100, off = q.offAxis / 100;
  const close = clamp01(Math.log(40 / d) / Math.log(40 / 3)), far = clamp01(Math.log(d / 100) / Math.log(3)), air = 4 * clamp01(Math.log(d / 50) / Math.log(6));
  const diaF = 7500 * Math.pow(13000 / 7500, 1 - dia);
  const parts = [hp2(f, [35, 90, 18, 22][model], 0.7071), lowShelf2(f, 200, prox * close * [10, 7, 4, 5][model] - 2 * far, 0.6)];
  if (model === 0) parts.push(bell(f, 140, 3 * c2, 1.1)); else if (model === 1) parts.push(bell(f, 700, 1.5 * c2, 0.6)); else if (model === 3) parts.push(bell(f, 120, 1.5 * c2, 0.8));
  if (model === 0) parts.push(bell(f, 3200, 6 * pr, 0.8)); else if (model === 1) parts.push(bell(f, 4200, 5 * c2 + 4 * pr, 0.9));
  else if (model === 2) parts.push(bell(f, diaF, 1.5 + 3 * c2 + 4 * pr, 1)); else parts.push(bell(f, diaF, 1 + 2 * c2 + 4 * pr, 1));
  if (model === 0) parts.push(lp2(f, 9500 / Math.sqrt(Math.max(c2, 0.1)), 0.6)); else if (model === 1) parts.push(lp2(f, 15000, 0.7071)); else if (model === 3) parts.push(lp2(f, 18000, 0.6));
  parts.push(highShelf2(f, 7000, (model === 2 ? 3 * c2 : model === 3 ? 1.5 * c2 : 0) - air - off * 8, 0.6));
  const direct = -3 * clamp01(Math.log(d / 40) / Math.log(7.5));
  return dbOf(chain(...parts)) + direct + (q.output ?? 0);
}
const meas = (model, params, f, sr = SR, amp = 0.005) => gainAt(m, f, { amp, params: { ...flat, model, ...params }, n: f < 80 ? 131072 : 32768, sampleRate: sr, ...OUT });
const compare = (name, model, params, freqs, tol, sr = SR) => {
  let worst = 0, at = 0;
  const rows = freqs.map((f) => { const got = meas(model, params, f, sr), want = mic(f, model, params); const e = Math.abs(got - want); if (e > worst) { worst = e; at = f; } return `${f}:${got.toFixed(1)}/${want.toFixed(1)}`; });
  check(worst < tol, `${name}: realised vs analog within ${tol} dB`, `worst ${worst.toFixed(2)} dB at ${at} Hz; got/want ${rows.join(" ")}`);
};

// ---- response per model ---------------------------------------------------------------------------------------------------------------------
const FR = [40, 80, 150, 300, 700, 1500, 3000, 5000, 8000, 11000];
for (const [model, name] of MODELS.entries()) {
  compare(`${name} at the nominal setting`, model, {}, FR, 1.3);
  compare(`${name} at 96 kHz`, model, {}, [40, 150, 700, 3000, 8000, 11000, 14000], 0.7, 96000);
}
compare("Ribbon, close, full proximity and colour (roll-off at 6.7 kHz: the warped top is looser)", 0, { distance: 5, proximity: 100, colour: 100, presence: 60 }, FR, 2.3);
compare("Dynamic, off-axis 70 %, presence 80 %", 1, { offAxis: 70, presence: 80, colour: 30 }, FR, 1.3);
compare("Condenser, small diaphragm, colour 90 %", 2, { diaphragm: 0, colour: 90 }, FR, 1.3);
compare("Tube Condenser, far (250 cm)", 3, { distance: 250, colour: 70 }, FR, 1.3);
{
  const g = (model, f, p = {}) => meas(model, p, f);
  const rib = FR.map((f) => g(0, f)), dyn = FR.map((f) => g(1, f)), con = FR.map((f) => g(2, f)), tub = FR.map((f) => g(3, f));
  const at = (a, f) => a[FR.indexOf(f)];
  console.log("     response at", FR.join(" "), "Hz");
  for (const [n, a] of [["Ribbon", rib], ["Dynamic", dyn], ["Condenser", con], ["Tube", tub]]) console.log(`       ${n.padEnd(10)} ${a.map((v) => v.toFixed(1).padStart(5)).join(" ")} dB`);
  check(at(rib, 11000) < at(rib, 1500) - 4 && at(rib, 150) > at(rib, 1500) + 2, "Ribbon: gentle top roll-off and a soft bass resonance", `${at(rib, 11000).toFixed(1)} dB at 11 kHz, ${at(rib, 150).toFixed(1)} at 150 Hz`);
  check(at(dyn, 3000) > at(dyn, 700) + 2 && at(dyn, 40) < at(dyn, 700) - 10 && at(dyn, 11000) < at(dyn, 3000) - 2, "Dynamic: presence peak at 3-5 kHz, no deep bass, no extreme top", `${at(dyn, 3000).toFixed(1)} / ${at(dyn, 40).toFixed(1)} / ${at(dyn, 11000).toFixed(1)}`);
  check(at(con, 8000) > at(con, 1500) + 3 && at(con, 11000) > at(con, 1500) + 3 && at(con, 40) > at(dyn, 40) + 8, "Condenser: extended top with presence and air lift, extended bottom", `${at(con, 8000).toFixed(1)} dB at 8 kHz`);
  check(at(tub, 150) > at(con, 150) + 0.5 && at(tub, 11000) < at(con, 11000), "Tube Condenser: warmer than the condenser (more low mids, softer top)", `${at(tub, 150).toFixed(1)} vs ${at(con, 150).toFixed(1)} at 150 Hz`);
  // the diaphragm moves the peak
  const peakF = (dia) => { let best = -99, bf = 0; for (let f = 4000; f <= 16000; f *= 1.06) { const v = mic(f, 2, { diaphragm: dia }); if (v > best) { best = v; bf = f; } } return bf; };
  const small = [4000, 6000, 8000, 10000, 12000, 14000, 16000].map((f) => meas(2, { diaphragm: 0 }, f)), large = [4000, 6000, 8000, 10000, 12000, 14000, 16000].map((f) => meas(2, { diaphragm: 100 }, f));
  const fs = [4000, 6000, 8000, 10000, 12000, 14000, 16000], top = (a) => fs[a.indexOf(Math.max(...a))];
  console.log(`     condenser peak: small diaphragm near ${top(small)} Hz, large near ${top(large)} Hz (analog: ${Math.round(peakF(0))} / ${Math.round(peakF(100))} Hz)`);
  check(top(small) >= 10000 && top(large) <= 8000, "Diaphragm size moves the HF peak (small = high, large = low)", "");
}

// ---- proximity, distance, presence, off-axis --------------------------------------------------------------------------------------------------
{
  const lf = (model, p) => meas(model, p, 100);
  for (const [model, name] of MODELS.entries()) {
    const near = lf(model, { distance: 5, proximity: 100 }), mid = lf(model, { distance: 40, proximity: 100 }), far = lf(model, { distance: 250, proximity: 100 }), zero = lf(model, { distance: 5, proximity: 0 });
    console.log(`     ${name}: 100 Hz at 5 / 40 / 250 cm: ${near.toFixed(1)} / ${mid.toFixed(1)} / ${far.toFixed(1)} dB (proximity 0 at 5 cm: ${zero.toFixed(1)})`);
    check(near > mid + 1.5 && mid > far && near > zero + 1.5, `${name}: proximity effect lifts the bass of a close source and falls away with distance`, "");
  }
  const bump = (model) => lf(model, { distance: 5, proximity: 100 }) - lf(model, { distance: 40, proximity: 100 });
  check(bump(0) > bump(2) + 2, "the figure-8 ribbon has the strongest proximity effect, the condenser the weakest", `${bump(0).toFixed(1)} vs ${bump(2).toFixed(1)} dB`);
  const ps = [0, 25, 50, 75, 100].map((v) => lf(1, { distance: 5, proximity: v }));
  check(ps.every((v, i) => i === 0 || v > ps[i - 1] + 0.3), "Proximity knob raises the close-mic bass monotonically", ps.map((v) => v.toFixed(1)).join(" "));
  const hf = (d) => meas(2, { distance: d }, 12000);
  check(hf(250) < hf(40) - 2 && Math.abs(hf(5) - hf(40)) < 0.3, "far sources lose air (absorption); close ones do not", `${hf(5).toFixed(1)} / ${hf(40).toFixed(1)} / ${hf(250).toFixed(1)} dB at 12 kHz`);
  const lev = (d) => meas(2, { distance: d }, 1000);
  check(lev(250) < lev(40) - 1.5 && Math.abs(lev(5) - lev(40)) < 0.2, "direct level falls with distance", `${lev(250).toFixed(1)} vs ${lev(40).toFixed(1)}`);
  const pf = [0, 50, 100].map((v) => [meas(0, { presence: v }, 3200), meas(1, { presence: v }, 4200), meas(2, { presence: v }, 9900), meas(3, { presence: v }, 9900)]);
  check([0, 1, 2, 3].every((k) => pf[1][k] > pf[0][k] + 1 && pf[2][k] > pf[1][k] + 1), "Presence lifts the presence region of every model", pf.map((r) => r.map((v) => v.toFixed(1)).join("/")).join(" | "));
  const off = [0, 50, 100].map((v) => [meas(2, { offAxis: v }, 200), meas(2, { offAxis: v }, 4000), meas(2, { offAxis: v }, 12000)]);
  check(off[2][2] < off[0][2] - 4 && off[1][2] < off[0][2] - 1.5 && Math.abs(off[2][0] - off[0][0]) < 0.3, "Off-axis dulls the highs and leaves the lows", off.map((r) => r.map((v) => v.toFixed(1)).join("/")).join(" | "));
  // the faint comb: ripple in the response above 1 kHz with off-axis, none without
  const ripple = (v) => { const a = []; for (let f = 1500; f <= 9000; f += 250) a.push(meas(2, { offAxis: v }, f) - mic(f, 2, { offAxis: v })); return Math.max(...a) - Math.min(...a); };
  console.log(`     off-axis comb ripple (response minus the filter curve): ${ripple(0).toFixed(2)} dB without, ${ripple(100).toFixed(2)} dB at 100 %`);
  check(ripple(100) > ripple(0) + 1.5, "Off-axis adds a faint comb on top of the dulling (ripple beyond the filter curve, which itself deviates by the bilinear warping)", "");
}

// ---- room: early reflections -----------------------------------------------------------------------------------------------------------------
{
  const click = new Float32Array(4800); click[10] = 1;
  const ir = (p, ch = "outL") => render(m, { inputs: { l: click, r: click }, params: { ...flat, model: 2, input: 1, ...p } })[ch];
  const irDyn = (p) => render(m, { inputs: { l: click, r: click }, params: { ...flat, model: 1, input: 1, ...p } }).outL;
  const dry = ir({ room: 0, distance: 200 }), wet = ir({ room: 100, distance: 200 }), wetR = ir({ room: 100, distance: 200 }, "outR");
  const diff = Float32Array.from(wet, (v, i) => v - dry[i]);
  const ms = (t) => Math.round(t * SR / 1000);
  const before = peak(diff, 0, 10 + ms(2.5)), after = peak(diff, 10 + ms(2.5)), direct = peak(dry);
  console.log(`     room 100 % at 2 m: direct peak ${direct.toFixed(3)}, reflections peak ${after.toFixed(3)}, before the first reflection ${before.toExponential(1)}`);
  check(before < 1e-6 && after > 0.03 && after < 0.6 * direct, "Room adds delayed early reflections, quieter than the direct sound, none before the first delay", "");
  // six reflections between 3 and 30 ms: energy in each window
  const win = [[2.5, 4], [5, 6.5], [8, 10], [12.5, 14.5], [19, 21], [26, 28.5]].map(([a, b]) => peak(diff, 10 + ms(a), 10 + ms(b)));
  check(win.every((v) => v > 0.2 * Math.max(...win) * 0.3 && v > 0.003), "a train of early reflections out to about 30 ms", win.map((v) => v.toFixed(3)).join(" "));
  check(peak(diff.map((v, i) => v - Float32Array.from(wetR, (w, j) => w - dry[j])[i])) > 0.01, "left and right reflections differ (decorrelated)", "");
  const closeWet = peak(Float32Array.from(ir({ room: 100, distance: 5 }), (v, i) => v - ir({ room: 0, distance: 5 })[i]));
  check(closeWet < after * 0.7, "a close source gets less room than a far one at the same Room setting", `${closeWet.toFixed(3)} vs ${after.toFixed(3)}`);
  const dd = Float32Array.from(irDyn({ room: 100, distance: 200 }), (v, i) => v - irDyn({ room: 0, distance: 200 })[i]);   // the dynamic model's short high-pass leaves no long tail
  const tailEnergy = dd.slice(10 + ms(60)).reduce((a, v) => a + v * v, 0);
  check(tailEnergy < 1e-10, "the reflections end by 40 ms (no feedback)", tailEnergy.toExponential(1));
}

// ---- self-noise ---------------------------------------------------------------------------------------------------------------------------------
{
  const silent = new Float32Array(SR * 2);
  const hiss = (db, p = {}) => render(m, { inputs: { l: silent, r: silent }, params: { ...flat, model: 2, input: 1, selfNoise: db, ...p } });
  const lvl = (a) => 20 * Math.log10(rms(a, 4800));
  const h60 = hiss(-60), h90 = hiss(-90), off = hiss(-100);
  console.log(`     self-noise rms: setting -60 dB -> ${lvl(h60.outL).toFixed(1)} / ${lvl(h60.outR).toFixed(1)} dB, -90 -> ${lvl(h90.outL).toFixed(1)}, off -> ${peak(off.outL)}`);
  check(Math.abs(lvl(h60.outL) + 60) < 2.5 && Math.abs(lvl(h90.outL) + 90) < 2.5 && Math.abs(lvl(h60.outR) + 60) < 2.5, "Self-Noise sets the hiss level (rms within 2.5 dB)", "");
  check(peak(off.outL) === 0 && peak(off.outR) === 0, "the lowest setting is exactly off", "");
  const x = h60.outL, y = h60.outR; let sxy = 0, sxx = 0, syy = 0; for (let i = 4800; i < x.length; i++) { sxy += x[i] * y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; }
  check(Math.abs(sxy / Math.sqrt(sxx * syy)) < 0.02, "the two channels' hiss is independent", (sxy / Math.sqrt(sxx * syy)).toFixed(3));
  const sp = spectrum(h60.outL.slice(8192, 8192 + 32768)), band = (a, b) => { let s = 0; for (let k = Math.round(a * 32768 / SR); k < Math.round(b * 32768 / SR); k++) s += sp[k]; return 10 * Math.log10(s / (Math.round(b * 32768 / SR) - Math.round(a * 32768 / SR))); };
  check(band(500, 2000) > band(12000, 20000) + 3, "the hiss falls towards the top", `${band(500, 2000).toFixed(1)} vs ${band(12000, 20000).toFixed(1)} dB`);
  const again = hiss(-60);
  check(again.outL.every((v, i) => v === h60.outL[i]), "the hiss is deterministic", "");
  const h60b = render(m, { inputs: { l: noise(SR, 3) }, params: { ...flat, model: 2, selfNoise: -100 } });
  check(finiteAll(h60b.outL), "ok with a noise input", "");
}

// ---- level-dependent saturation -------------------------------------------------------------------------------------------------------------------
{
  const lvlGain = (model, f, amp, p = {}) => gainAt(m, f, { amp, params: { ...flat, model, ...p }, ...OUT, n: f < 120 ? 65536 : 32768 });
  // ribbon: loud bass saturates, treble does not
  const d80 = lvlGain(0, 80, 0.7) - lvlGain(0, 80, 0.005), d4k = lvlGain(0, 4000, 0.7) - lvlGain(0, 4000, 0.005);
  console.log(`     ribbon level dependence (gain at amp 0.7 minus gain at 0.005): 80 Hz ${d80.toFixed(2)} dB, 4 kHz ${d4k.toFixed(2)} dB`);
  check(d80 < -0.8 && d80 < d4k - 0.5, "Ribbon: loud bass compresses softly, treble much less", "");
  const harm = (model, f, amp, p = {}) => harmonicsDb(render(m, { inputs: { l: sine(f, amp, 16384) }, params: { ...flat, model, ...p } }).outL, f, SR, 5);
  const hr = [0.05, 0.3, 0.8].map((a) => harm(0, 80, a)), ht = [0.05, 0.3, 0.8].map((a) => harm(3, 1000, a)), hd = [0.05, 0.3, 0.8].map((a) => harm(1, 1000, a)), hc = [0.05, 0.3, 0.8].map((a) => harm(2, 1000, a));
  const f = (a) => a.map((r) => `[${r.slice(1, 4).map((v) => v.toFixed(0))}]`).join(" ");
  console.log(`     harmonics 2-4 at amp .05/.3/.8: Ribbon 80 Hz ${f(hr)}; Dynamic 1 kHz ${f(hd)}; Condenser 1 kHz ${f(hc)}; Tube 1 kHz ${f(ht)}`);
  check(hr[2][2] > hr[0][2] + 15 && hr[2][2] > harm(0, 4000, 0.8)[2] + 6, "Ribbon: saturation grows with level and is a bass effect", "");
  check(ht[2][1] > ht[2][2] + 3 && ht[2][1] > ht[0][1] + 15 && ht[2][1] < -15, "Tube Condenser: even harmonics lead and grow with level, still soft", `${ht[2][1].toFixed(0)} dB 2nd at .8`);
  check(hd[2][2] > hd[2][1] + 3 && hd[2][2] > hd[0][2] + 10, "Dynamic: symmetric (odd-harmonic) saturation that grows with level", `${hd[2][1].toFixed(0)} / ${hd[2][2].toFixed(0)}`);
  check(hc[2][1] < ht[2][1] - 3 && hc[2][1] < -28, "Condenser: only a hint of FET-style saturation, clean next to the tube model", `${hc[2][1].toFixed(0)} dB`);
  // dynamic: fast transient softening
  const burst = (model) => { const x = new Float32Array(9600); for (let i = 2400; i < 9600; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR); const y = render(m, { inputs: { l: x }, params: { ...flat, model } }).outL; return [peak(y, 2400, 2400 + 100), peak(y, 2400 + 100, 2400 + 400), peak(y, 7000)]; };
  const bd = burst(1), bc = burst(2);
  console.log(`     onset peaks (first 2 ms / next 6 ms / steady): Dynamic ${bd.map((v) => v.toFixed(3))}  Condenser ${bc.map((v) => v.toFixed(3))}`);
  check(bd[0] / bd[2] < 0.85 && bd[0] / bd[2] < bc[0] / bc[2] - 0.15, "Dynamic: the onset of a loud note is softened", `${(bd[0] / bd[2]).toFixed(2)} vs ${(bc[0] / bc[2]).toFixed(2)} of the steady peak`);
  // no DC from the asymmetric models
  for (const model of [2, 3]) { const y = render(m, { inputs: { l: sine(200, 0.8, 48000) }, params: { ...flat, model } }).outL; check(Math.abs(y.slice(24000).reduce((a, v) => a + v, 0) / 24000) < 0.003, `${MODELS[model]}: no DC offset from the asymmetry`, ""); }
}
{ // aliasing
  const n = 16384, f0 = 7000;
  const alias = (y) => {
    const sp = spectrum(y), bin0 = Math.round(f0 * n / SR), fund = Math.max(...sp.slice(bin0 - 3, bin0 + 4));
    let p = 0;
    for (let h = 2; h <= 10; h++) { const hf = h * f0; if (hf < SR / 2) continue; const fold = hf % SR > SR / 2 ? SR - (hf % SR) : hf % SR, k = Math.round(fold * n / SR); p += Math.max(...sp.slice(k - 3, k + 4)); }
    return 10 * Math.log10(p / fund);
  };
  for (const model of [0, 1, 2, 3]) for (const amp of [0.25, 0.9]) {
    const y = render(m, { inputs: { l: sine(f0, amp, 2 * n) }, params: { ...flat, model, colour: 100, presence: 0 } }).outL.slice(n);
    const a = alias(y);
    if (amp > 0.5) { const yn = render(m, { inputs: { l: sine(f0, amp, 2 * n) }, params: { ...flat, model, presence: 0 } }).outL.slice(n); check(alias(yn) < -42, `${MODELS[model]}: at the nominal Colour a near full-scale 7 kHz tone aliases below -42 dB`, alias(yn).toFixed(1)); }
    console.log(`     ${MODELS[model]}, 7 kHz at ${amp}: folded harmonics ${a.toFixed(1)} dB re the fundamental`);
    check(a < (amp < 0.5 ? -60 : -35), `${MODELS[model]}: alias products of a driven 7 kHz tone at ${amp} (Colour 100 %) stay low`, "");
  }
}

// ---- mix, output, determinism, input choice, safety -------------------------------------------------------------------------------------------
{
  const x = sine(440, 0.3, SR * 2);
  const dry = render(m, { inputs: { l: x }, params: { ...flat, model: 3, mix: 0, room: 100, selfNoise: -50, offAxis: 100 } });
  let d = 0; for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(dry.outL[i] - x[i]));
  check(d < 1e-6, "Mix 0 passes the dry signal untouched and in phase", d.toExponential(1));
  const wet = render(m, { inputs: { l: x }, params: { ...flat, model: 2, mix: 100 } }).outL, half = render(m, { inputs: { l: x }, params: { ...flat, model: 2, mix: 50 } }).outL;
  let e = 0; for (let i = 24000; i < x.length; i++) e = Math.max(e, Math.abs(half[i] - 0.5 * (wet[i] + x[i])));
  check(e < 1e-4, "Mix 50 % is the average of dry and microphone signal", e.toExponential(1));
  check(Math.abs(meas(2, { output: 6 }, 1000) - meas(2, { output: 0 }, 1000) - 6.02) < 0.05, "Output is a gain in dB", "");
  const a = render(m, { inputs: { l: x }, params: { ...flat, model: 1, room: 40, selfNoise: -70, offAxis: 30 } }), b = render(m, { inputs: { l: x }, params: { ...flat, model: 1, room: 40, selfNoise: -70, offAxis: 30 } });
  check(a.outL.every((v, i) => v === b.outL[i]) && a.outR.every((v, i) => v === b.outR[i]), "deterministic: two renders are identical", "");
  const x1 = x.slice(0, 4000), c = render(m, { inputs: { l: x }, n: 4000, params: { ...flat, model: 2, room: 40, selfNoise: -70 } }), c2 = render(m, { inputs: { l: x }, n: 3001, params: { ...flat, model: 2, room: 40, selfNoise: -70 } });
  check(c.outL.slice(0, 3001).every((v, i) => v === c2.outL[i]) && x1.length === 4000, "output does not depend on the render length", "");
}
{
  const x = sine(300, 0.3, 24000);
  const auto = render(m, { inputs: { l: x }, params: { ...flat, model: 2, input: 0, selfNoise: -100 } }), mono = render(m, { inputs: { l: x }, params: { ...flat, model: 2, input: 2, selfNoise: -100 } }), st = render(m, { inputs: { l: x }, params: { ...flat, model: 2, input: 1, selfNoise: -100 } });
  let dA = 0, dM = 0, dS = 0; for (let i = 12000; i < 24000; i++) { dA = Math.max(dA, Math.abs(auto.outL[i] - auto.outR[i])); dM = Math.max(dM, Math.abs(mono.outL[i] - mono.outR[i])); dS = Math.max(dS, Math.abs(st.outR[i])); }
  check(dA < 1e-3 && dM < 1e-3 && dS < 1e-12, "Input: Auto and Mono use the left signal for both channels (up to the different room taps), Stereo keeps the right one silent", `${dA.toExponential(1)} ${dM.toExponential(1)} ${dS.toExponential(1)}`);
  const autoNoRoom = render(m, { inputs: { l: x }, params: { ...flat, model: 2, input: 0, room: 0, selfNoise: -100 } });
  let dd = 0; for (let i = 12000; i < 24000; i++) dd = Math.max(dd, Math.abs(autoNoRoom.outL[i] - autoNoRoom.outR[i]));
  check(dd < 1e-4, "Auto with nothing on In R: identical channels when no room is added", dd.toExponential(1));
  const r2 = new Float32Array(24000); for (let i = 12000; i < 24000; i++) r2[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / SR);
  const sw = render(m, { inputs: { l: x, r: r2 }, params: { ...flat, model: 2, input: 0, selfNoise: -100 } });
  let jump = 0; for (let i = 12000; i < 14000; i++) jump = Math.max(jump, Math.abs(sw.outR[i] - sw.outR[i - 1]));
  check(jump < 0.08, "switching from the left signal to a real right signal is smooth", `max step ${jump.toFixed(4)}`);
}
{
  const square = Float32Array.from({ length: 48000 }, (_, i) => (Math.floor(i / 40) % 2 ? 1 : -1));
  const burst = Float32Array.from({ length: 96000 }, (_, i) => (i < 2000 ? square[i] : 0));
  const extremes = [
    { distance: 3, proximity: 100, presence: 100, colour: 100, diaphragm: 0, offAxis: 100, room: 100, selfNoise: -50, output: 12, mix: 100 },
    { distance: 300, proximity: 0, presence: 0, colour: 0, diaphragm: 100, offAxis: 0, room: 100, selfNoise: -100, output: -12, mix: 50 },
    { distance: 20, proximity: 100, presence: 100, colour: 100, diaphragm: 50, offAxis: 100, room: 0, selfNoise: -50, output: 12, mix: 100 },
  ];
  for (const sr of [44100, 96000]) for (const model of [0, 1, 2, 3]) for (const [i, p] of extremes.entries()) {
    const params = { ...flat, ...p, model };
    const s = render(m, { sampleRate: sr, inputs: { l: square, r: Float32Array.from(square, (v) => -v) }, params });
    const dc = render(m, { sampleRate: sr, inputs: { l: 1, r: -1 }, n: 48000, params });
    const t = render(m, { sampleRate: sr, inputs: { l: burst }, params: { ...params, selfNoise: -100 } });
    check(finiteAll(s.outL) && finiteAll(s.outR) && finiteAll(dc.outL) && finiteAll(t.outL) && peak(s.outL) < 100, `${MODELS[model]} finite and bounded at extreme settings #${i} (${sr} Hz)`, `peak ${peak(s.outL).toFixed(1)}`);
    check(peak(t.outL, 90000) < 1e-3, `${MODELS[model]}: silence after a burst decays (#${i}, ${sr} Hz)`, `${peak(t.outL, 90000).toExponential(1)}`);
  }
  const x = sine(400, 0.3, 48000);
  const sw = render(m, { inputs: { l: x }, params: { ...flat, selfNoise: -100, model: (i) => Math.floor(i / 12000) % 4 } }).outL;
  let jump = 0; for (let i = 1; i < sw.length; i++) jump = Math.max(jump, Math.abs(sw[i] - sw[i - 1]));
  check(finiteAll(sw) && jump < 0.1, "switching the model while playing does not click", `max step ${jump.toFixed(3)}`);
  const sweep = render(m, { inputs: { l: sine(200, 0.3, 48000) }, params: { ...flat, model: 2, selfNoise: -100, distance: (i) => 3 * Math.pow(100, i / 48000), proximity: 100, offAxis: (i) => 100 * i / 48000, colour: (i) => 100 * i / 48000 } }).outL;
  let sj = 0; for (let i = 1; i < sweep.length; i++) sj = Math.max(sj, Math.abs(sweep[i] - sweep[i - 1]));
  check(sj < 0.1, "sweeping Distance, Off-Axis and Colour while playing is smooth", `max step ${sj.toFixed(3)}`);
}
finish();
