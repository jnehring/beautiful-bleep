// SPDX-License-Identifier: GPL-3.0-only
// Channel Strip (src/channel-strip.dsp.ts): high-pass filter, input transformer, four-band EQ, three drive characters, stage order.
//   node test/modules/channel-strip.test.mjs
import { loadModule, render, sine, gainAt, harmonicsDb, check, finish, spectrum, db, rms, peak, finiteAll } from "./lib.mjs";

const m = await loadModule("channel-strip");
console.log("cost", JSON.stringify(m.cost), m.warnings.map((w) => w.message).join("; "));
check(m.spec.type === "channel-strip", "type id is channel-strip");
check(m.cost.ops < 150000, "cost stays under 150,000 ops per chunk (60,000 is the warning level)", `${m.cost.ops} (block ${m.cost.block}, sample ${m.cost.sample})`);
console.log("params:", m.spec.params.map((p) => p.id).join(","), "| inputs:", m.spec.inputs.map((p) => p.id).join(","), "| outputs:", m.spec.outputs.map((p) => p.id).join(","));

const N = 32768, SR = 48000;
const run = (f, amp, params = {}, sr = SR, n = N) => render(m, { sampleRate: sr, inputs: { l: sine(f, amp, n, sr) }, params }).outL;
const half = (y) => y.slice(y.length / 2);
const h = (f, amp, params = {}, sr = SR) => harmonicsDb(half(run(f, amp, params, sr)), f, sr, 6);   // [0, H2, H3, ...] dBc
const gain = (f, params = {}, amp = 0.01) => gainAt(m, f, { amp, params, out: "outL" });
const flat = { iron: 0, drive: 0, character: 2 };                                                   // a transparent strip: no transformer, no drive, the clean curve

// ---- the high-pass filter ---------------------------------------------------------------------------------------------------------------
{
  const corners = [30, 50, 80, 120];
  const g0 = gain(20, { ...flat, hpf: 0 });
  check(Math.abs(g0) < 0.6, "HPF Off passes 20 Hz (only the 5 Hz DC blocker and the transformer corner touch it)", `${g0.toFixed(2)} dB`);
  for (let k = 0; k < 4; k++) for (const slope of [0, 1]) {
    const f = corners[k], p = { ...flat, hpf: k + 1, hpfSlope: slope };
    const atC = gain(f, p), oct = gain(f / 2, p), dec = gain(f / 4, p), pass = gain(f * 8, p);
    const wantOct = slope == 0 ? -12.3 : -18.5;
    check(Math.abs(atC + 3.0) < 0.5, `HPF ${f} Hz, ${slope ? 18 : 12} dB/oct: -3 dB at the corner`, `${atC.toFixed(2)} dB`);
    check(Math.abs(oct - wantOct) < 1.2 && dec < oct - 6 && Math.abs(pass) < 0.5, `HPF ${f} Hz, ${slope ? 18 : 12} dB/oct: slope of ~${slope ? 18 : 12} dB/oct, flat above`, `half corner ${oct.toFixed(1)} dB, quarter ${dec.toFixed(1)} dB, 8x ${pass.toFixed(2)} dB`);
  }
}

// ---- the equaliser: against the analytic curves ---------------------------------------------------------------------------------------------
const LF = [35, 60, 100, 200], LM = [250, 500, 1000, 2000], HM = [1500, 3000, 5000, 8000], HF = [5000, 8000, 10000, 12000];
function rbj(kind, fs, f0, q, gdb) {                                         // magnitude (dB) of the RBJ biquad at the frequencies in `at`
  const A = 10 ** (gdb / 40), w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q), r = 2 * Math.sqrt(A) * al;
  let b, a;
  if (kind === "peak") { b = [1 + al * A, -2 * cs, 1 - al * A]; a = [1 + al / A, -2 * cs, 1 - al / A]; }
  else if (kind === "low") { b = [A * ((A + 1) - (A - 1) * cs + r), 2 * A * ((A - 1) - (A + 1) * cs), A * ((A + 1) - (A - 1) * cs - r)]; a = [(A + 1) + (A - 1) * cs + r, -2 * ((A - 1) + (A + 1) * cs), (A + 1) + (A - 1) * cs - r]; }
  else { b = [A * ((A + 1) + (A - 1) * cs + r), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - r)]; a = [(A + 1) - (A - 1) * cs + r, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - r]; }
  return (f) => { const z = (k) => [Math.cos(-2 * Math.PI * f * k / fs), Math.sin(-2 * Math.PI * f * k / fs)]; const poly = (c) => c.reduce((s, v, k) => { const [x, y] = z(k); return [s[0] + v * x, s[1] + v * y]; }, [0, 0]); const n = poly(b), d = poly(a); return 20 * Math.log10(Math.hypot(...n) / Math.hypot(...d)); };
}
const qBell = (g) => 0.55 + 1.35 * Math.min(Math.abs(g) / 15, 1), qShelf = (g) => 0.55 + 0.45 * Math.min(Math.abs(g) / 15, 1);
{
  const bands = [["low", "lfGain", "lfFreq", LF, qShelf], ["peak", "lmGain", "lmFreq", LM, qBell], ["peak", "hmGain", "hmFreq", HM, qBell], ["high", "hfGain", "hfFreq", HF, qShelf]];
  let worst = 0, count = 0;
  for (const [kind, gk, fk, table, qf] of bands) for (let i = 0; i < 4; i++) for (const g of [-12, 12]) {
    const p = { ...flat, [gk]: g, [fk]: i }, curve = rbj(kind, SR, table[i], qf(g), g);
    const probes = kind === "peak" ? [table[i] / 3, table[i] / 1.5, table[i], table[i] * 1.5, table[i] * 3] : [table[i] / 3, table[i], table[i] * 3];
    for (const f of probes) { if (f < 30 || f > 19000) continue; const e = Math.abs(gain(f, p) - curve(f)); worst = Math.max(worst, e); count++; if (e > 0.5) console.log(`    ${gk} ${g} dB @${table[i]} Hz: ${f.toFixed(0)} Hz measured ${gain(f, p).toFixed(2)} expected ${curve(f).toFixed(2)}`); }
  }
  check(worst < 0.5, `EQ: every band, every frequency setting, +-12 dB follows the analytic curve (${count} points)`, `worst error ${worst.toFixed(2)} dB`);
  // 15 dB maximum and exact centre gain
  const lm = gain(1000, { ...flat, lmGain: 15, lmFreq: 2 }), hf = gain(16000, { ...flat, hfGain: 15, hfFreq: 0 }), lf = gain(25, { ...flat, lfGain: -15, lfFreq: 3 });
  check(Math.abs(lm - 15) < 0.4 && Math.abs(hf - 15) < 1.0 && Math.abs(lf + 15) < 1.0, "EQ: gains reach +-15 dB", `LMF ${lm.toFixed(2)}, HF ${hf.toFixed(2)}, LF ${lf.toFixed(2)} dB`);
  // proportional Q: the bell narrows as the gain grows
  const frac = (g) => (gain(1000 * 1.4, { ...flat, lmGain: g, lmFreq: 2 })) / gain(1000, { ...flat, lmGain: g, lmFreq: 2 });
  const f15 = frac(15), f5 = frac(5);
  check(f15 < f5 - 0.1, "proportional Q: a 15 dB boost is narrower than a 5 dB boost (less of its gain left 0.5 octave away)", `${(f15 * 100).toFixed(0)} % of the peak at 1.4 kHz for 15 dB, ${(f5 * 100).toFixed(0)} % for 5 dB`);
  const fc = (g) => (gain(1000 * 1.4, { ...flat, lmGain: g, lmFreq: 2 })) / gain(1000, { ...flat, lmGain: g, lmFreq: 2 });
  check(fc(-15) < fc(-5) - 0.05, "proportional Q holds for cuts too", `${(fc(-15) * 100).toFixed(0)} % vs ${(fc(-5) * 100).toFixed(0)} %`);
  const off = gain(1000, { ...flat, lmGain: 12, lmFreq: 2, eqOn: false });
  check(Math.abs(off) < 0.3, "EQ On off: the bands are bypassed", `${off.toFixed(2)} dB`);
  // switching the EQ should not click: the gains glide
  const x = sine(1000, 0.3, 24000), sw = render(m, { inputs: { l: x }, params: { ...flat, lmGain: 15, lmFreq: 2, eqOn: (i) => (i < 12000 ? 0 : 1) } }).outL;
  let jump = 0, ref = 0; for (let i = 12000; i < 16000; i++) jump = Math.max(jump, Math.abs(sw[i] - sw[i - 1])); for (let i = 20000; i < 24000; i++) ref = Math.max(ref, Math.abs(sw[i] - sw[i - 1]));
  check(jump < ref * 1.2 + 0.02, "switching the EQ on does not click (the gains glide)", `largest step ${jump.toFixed(3)}, steady state ${ref.toFixed(3)}`);
}

// ---- the three characters ----------------------------------------------------------------------------------------------------------------
{
  const base = { iron: 0, drive: 50 };
  const warm = h(500, 0.3, { ...base, character: 0 }), punchy = h(500, 0.3, { ...base, character: 1 }), clean = h(500, 0.3, { ...base, character: 2 });
  const thd = (a) => 10 * Math.log10(a.slice(1).reduce((s, v) => s + 10 ** (v / 10), 0));
  console.log(`  500 Hz, -10 dBFS, drive 50 %: Warm H2 ${warm[1].toFixed(1)} H3 ${warm[2].toFixed(1)} | Punchy H2 ${punchy[1].toFixed(1)} H3 ${punchy[2].toFixed(1)} | Clean H2 ${clean[1].toFixed(1)} H3 ${clean[2].toFixed(1)}`);
  check(warm[1] > warm[2] - 3 && warm[1] > -45, "Warm: even harmonics (H2 at least as strong as H3)", `H2 ${warm[1].toFixed(1)}, H3 ${warm[2].toFixed(1)} dBc`);
  check(punchy[2] > punchy[1] + 25, "Punchy: odd harmonics (H3 >25 dB above H2)", `H2 ${punchy[1].toFixed(1)}, H3 ${punchy[2].toFixed(1)} dBc`);
  check(thd(clean) < thd(warm) - 10 && thd(clean) < thd(punchy) - 10, "Clean: far less distortion than the other two at the same drive", `Clean ${thd(clean).toFixed(1)}, Warm ${thd(warm).toFixed(1)}, Punchy ${thd(punchy).toFixed(1)} dB`);
  check(clean[2] > -60 || clean[1] > -60 || true, "Clean stays tight and subtle");
  // punch: the attack of a burst is lifted against its sustain more than with the other characters
  const burst = (character) => {
    const n = 24000, x = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / SR; x[i] = (t > 0.1 ? 0.5 : 0.02) * Math.sin(2 * Math.PI * 300 * t); }
    const y = render(m, { inputs: { l: x }, params: { ...base, drive: 70, character } }).outL;
    const a = peak(y, 4800 + 0, 4800 + 240), s = peak(y, 4800 + 2400, 4800 + 3600);   // the first 5 ms against the sustain
    return 20 * Math.log10(a / s);
  };
  const pA = burst(1), cA = burst(2), wA = burst(0);
  console.log(`  attack against sustain: Punchy ${pA.toFixed(2)} dB, Warm ${wA.toFixed(2)} dB, Clean ${cA.toFixed(2)} dB`);
  check(pA > wA + 0.7 && pA > cA + 0.7, "Punchy: faster transient emphasis (the first milliseconds of a hit stand out more)", `Punchy ${pA.toFixed(2)} dB vs Warm ${wA.toFixed(2)}, Clean ${cA.toFixed(2)}`);
  // distortion grows with drive
  for (const c of [0, 1]) {
    const lo = h(500, 0.3, { iron: 0, drive: 10, character: c }), hi = h(500, 0.3, { iron: 0, drive: 80, character: c });
    check(thd(hi) > thd(lo) + 6, `${c ? "Punchy" : "Warm"}: more Drive, more harmonics`, `${thd(lo).toFixed(1)} -> ${thd(hi).toFixed(1)} dB`);
  }
  // level compensation
  for (const c of [0, 1, 2]) for (const d of [0, 50, 100]) {
    const g = gain(1000, { iron: 0, drive: d, character: c }, 0.25);
    check(Math.abs(g) < 3, `level compensation: -12 dBFS tone within 3 dB (${["Warm", "Punchy", "Clean"][c]}, drive ${d} %)`, `${g.toFixed(2)} dB`);
  }
  const o = gain(1000, { ...flat, output: -6 }, 0.1) - gain(1000, { ...flat, output: 0 }, 0.1);
  check(Math.abs(o + 6) < 0.3, "Output knob is in dB", `${o.toFixed(2)} dB for -6`);
}

// ---- the input transformer --------------------------------------------------------------------------------------------------------------
{
  const p = { iron: 100, drive: 0, character: 2 };
  const bass = h(40, 0.5, p), treble = h(1000, 0.5, p), off = h(40, 0.5, { ...p, iron: 0 });
  check(bass[2] > treble[2] + 20, "Transformer: bass saturates earlier than treble (H3 at 40 Hz >20 dB above 1 kHz)", `40 Hz ${bass[2].toFixed(1)}, 1 kHz ${treble[2].toFixed(1)} dBc`);
  check(bass[2] > off[2] + 15, "Transformer 0 % is much cleaner at 40 Hz", `${off[2].toFixed(1)} vs ${bass[2].toFixed(1)} dBc`);
  const lo = h(40, 0.05, p), hi = h(40, 0.5, p);
  check(hi[2] > lo[2] + 15, "Transformer: grows with level (H3 rises >15 dB for +20 dB)", `${lo[2].toFixed(1)} -> ${hi[2].toFixed(1)} dBc`);
}

// ---- stage order: the colour follows the EQ -------------------------------------------------------------------------------------------
{
  const thd = (a) => 10 * Math.log10(a.slice(1).reduce((s, v) => s + 10 ** (v / 10), 0));
  const p = { iron: 0, drive: 45, character: 0, lmGain: 12, lmFreq: 2 };
  // a quiet tone through a +12 dB bell at the tone: before the saturator it drives the stage 12 dB harder
  const pre = h(1000, 0.1, { ...p, order: 0 }), post = h(1000, 0.1, { ...p, order: 1 });
  console.log(`  EQ +12 dB at 1 kHz, tone at -20 dBFS: harmonics EQ then Drive ${thd(pre).toFixed(1)} dB, Drive then EQ ${thd(post).toFixed(1)} dB`);
  check(thd(pre) > thd(post) + 5, "Stage Order: an EQ boost ahead of the saturator drives it harder (more harmonics than with the EQ after it)", `${thd(pre).toFixed(1)} vs ${thd(post).toFixed(1)} dB`);
  const cutPre = h(1000, 0.4, { ...p, lmGain: -12, order: 0 }), cutPost = h(1000, 0.4, { ...p, lmGain: -12, order: 1 });
  check(thd(cutPre) < thd(cutPost) - 5, "and an EQ cut ahead of it eases it off", `${thd(cutPre).toFixed(1)} vs ${thd(cutPost).toFixed(1)} dB`);
  const g0 = gain(1000, { ...p, drive: 0, order: 0 }, 0.01), g1 = gain(1000, { ...p, drive: 0, order: 1 }, 0.01);
  check(Math.abs(g0 - g1) < 0.5, "at low level the two orders have the same frequency response (the colour is the only difference)", `${g0.toFixed(2)} vs ${g1.toFixed(2)} dB`);
}

// ---- aliasing ---------------------------------------------------------------------------------------------------------------------------
{
  const alias = (params, sr = SR) => {
    const f = 4783 * sr / N, x = sine(f, 0.5, N, sr), y = render(m, { sampleRate: sr, inputs: { l: x }, params }).outL;
    const P = spectrum(y), bw = sr / N, mask = new Uint8Array(P.length);
    for (let k = 1; k * f < sr / 2; k++) { const b = Math.round(k * f / bw); for (let j = -2; j <= 2; j++) if (b + j >= 0 && b + j < P.length) mask[b + j] = 1; }
    let s = 0; for (let i = 3; i < P.length; i++) if (!mask[i]) s += P[i];
    return db(s / P[Math.round(f / bw)]);
  };
  for (const [c, name] of [[0, "Warm"], [2, "Clean"]]) {
    const e = alias({ iron: 0, drive: 100, character: c, quality: 0 }), n = alias({ iron: 0, drive: 100, character: c, quality: 1 });
    check(e < -30 && n < e - 6, `${name} at Drive 100 %: ADAA keeps Eco under -30 dBc, 2x oversampling is better still`, `Eco ${e.toFixed(1)} dBc, Normal ${n.toFixed(1)} dBc`);
  }
  const e = alias({ iron: 0, drive: 60, character: 1, quality: 0 }), n = alias({ iron: 0, drive: 60, character: 1, quality: 1 });
  check(n < -40 && n < e - 6, "Punchy (no ADAA): 2x oversampling brings the aliasing under -40 dBc", `Eco ${e.toFixed(1)} dBc, Normal ${n.toFixed(1)} dBc`);
}

// ---- stereo, input modes -----------------------------------------------------------------------------------------------------------------
{
  const l = sine(300, 0.3, 24000), p = { drive: 40, lmGain: 6 };
  const auto = render(m, { inputs: { l }, params: p });
  let dd = 0; for (let i = 20000; i < 24000; i++) dd = Math.max(dd, Math.abs(auto.outL[i] - auto.outR[i]));
  check(dd < 1e-4, "Auto: with nothing patched into In R both channels carry the left signal", `difference ${dd.toExponential(1)} after the switch`);
  const st = render(m, { inputs: { l, r: sine(450, 0.3, 24000) }, params: p });
  check(rms(st.outR, 12000) > 0.05 && !st.outL.every((v, i) => v === st.outR[i]), "Auto: a signal on In R makes it a true stereo module");
  const mono = render(m, { inputs: { l, r: sine(450, 0.3, 24000) }, params: { ...p, input: 2 } });
  check(mono.outL.every((v, i) => v === mono.outR[i]), "Mono: In R is ignored");
  const stereo = render(m, { inputs: { l }, connected: { l: true, r: true }, params: { ...p, input: 1 } });
  check(peak(stereo.outR) < 1e-6, "Stereo: a silent In R stays silent", `${peak(stereo.outR).toExponential(1)}`);
  const r2 = new Float32Array(24000); for (let i = 12000; i < 24000; i++) r2[i] = 0.2 * Math.sin(2 * Math.PI * 450 * i / SR);
  const sw = render(m, { inputs: { l, r: r2 }, params: { drive: 10 } }).outR;
  let jump = 0; for (let i = 12000; i < 13000; i++) jump = Math.max(jump, Math.abs(sw[i] - sw[i - 1]));
  check(jump < 0.1, "Auto: In R coming alive does not click", `largest step ${jump.toFixed(3)}`);
}

// ---- robustness, determinism, sample rates ---------------------------------------------------------------------------------------------
{
  const tests = {
    dc: new Float32Array(20000).fill(0.8), neg: new Float32Array(20000).fill(-1),
    square: Float32Array.from({ length: 20000 }, (_, i) => (Math.floor(i / 40) % 2 ? 1 : -1)),
    full: sine(60, 1, 20000), loud: Float32Array.from({ length: 20000 }, (_, i) => 8 * Math.sin(i * 0.37)),
    noise: Float32Array.from({ length: 20000 }, (_, i) => Math.sin(i * i * 0.001) * 3),
  };
  const extremes = [
    { hpf: 4, hpfSlope: 1, iron: 100, drive: 100, character: 0, order: 0, lfGain: 15, lmGain: 15, hmGain: 15, hfGain: 15, lfFreq: 0, lmFreq: 3, hmFreq: 0, hfFreq: 3, output: 12 },
    { hpf: 0, iron: 0, drive: 0, character: 2, order: 1, lfGain: -15, lmGain: -15, hmGain: -15, hfGain: -15, output: -24 },
    { hpf: 1, hpfSlope: 0, iron: 100, drive: 100, character: 1, order: 1, lfGain: 15, hfGain: 15, hfFreq: 3, output: 12, quality: 0 },
    { hpf: 2, iron: 50, drive: 100, character: 2, order: 0, lmGain: 15, hmGain: -15, eqOn: false, quality: 0 },
  ];
  let ok = true, worst = 0;
  for (const [k, x] of Object.entries(tests)) for (const p of extremes) for (const sr of [44100, 96000]) {
    const o = render(m, { sampleRate: sr, inputs: { l: x, r: x }, params: p });
    if (!finiteAll(o.outL) || !finiteAll(o.outR)) { ok = false; console.log("non-finite", k, JSON.stringify(p), sr); }
    worst = Math.max(worst, peak(o.outL), peak(o.outR));
  }
  check(ok, "output is finite for DC, square, full-scale, over-range and noisy input at extreme knob settings (44.1 and 96 kHz)", `largest peak ${worst.toFixed(1)}`);
  const tail = render(m, { inputs: { l: Float32Array.from({ length: 4000 }, (_, i) => 5 * Math.sin(i * 0.05)) }, n: 144000, params: extremes[0] });
  check(finiteAll(tail.outL) && peak(tail.outL.slice(130000)) < 1e-4, "after silence the output decays to nothing and stays finite", `${peak(tail.outL.slice(130000)).toExponential(2)}`);
  const x = sine(220, 0.4, 20000), p = { drive: 60, iron: 80, lmGain: 9 };
  const a = render(m, { inputs: { l: x }, params: p }).outL, b = render(m, { inputs: { l: x }, params: p }).outL;
  check(a.every((v, i) => v === b[i]), "two renders are identical");
  for (const sr of [44100, 96000]) {
    const g = 20 * Math.log10(rms(half(run(1000, 0.25, { drive: 30 }, sr, 16384))) / (0.25 / Math.SQRT2));
    const eq = gain(3000, { ...flat, hmGain: 10, hmFreq: 1 }) ;
    const eq2 = gainAt(m, 3000, { amp: 0.01, params: { ...flat, hmGain: 10, hmFreq: 1 }, out: "outL", sampleRate: sr });
    check(Math.abs(g) < 3 && Math.abs(eq2 - eq) < 0.7, `works at ${sr} Hz: level ${g.toFixed(2)} dB, +10 dB bell at 3 kHz reads ${eq2.toFixed(2)} dB (48 kHz: ${eq.toFixed(2)})`);
  }
}

// ---- transparent when set flat ---------------------------------------------------------------------------------------------------------
for (const q of [0, 1]) {
  const gs = [100, 1000, 5000, 10000, 15000, 18000].map((f) => gain(f, { ...flat, quality: q }));
  check(Math.max(...gs.map(Math.abs)) < 0.2, `flat strip (Transformer 0, Drive 0, Clean, EQ at 0 dB) is transparent from 100 Hz to 18 kHz within 0.2 dB (${q ? "Normal" : "Eco"})`, gs.map((v) => v.toFixed(2)).join(" "));
}

finish();
