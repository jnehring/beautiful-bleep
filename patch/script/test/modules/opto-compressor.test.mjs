// SPDX-License-Identifier: GPL-3.0-or-later
// Opto Compressor: static curve, attack and release time constants measured from step responses (program dependence, two-stage release with
// memory), detector options, make-up stage colour, safety.   node test/modules/opto-compressor.test.mjs
import { loadModule, render, sine, harmonicsDb, spectrum, check, finish, finiteAll, peak, rms, SR } from "./lib.mjs";

const m = await loadModule("opto-compressor");
check(m.cost.ops < 60000 && m.warnings.length === 0, "cost below the warning bound", JSON.stringify(m.cost));

const base = { peakReduction: 50, gain: 0, mode: 0, emphasis: 0, mix: 100, link: 100, sidechain: 0, input: 0 };
/// a 1 kHz tone made of [amplitude, seconds] segments
const segs = (parts, sr = SR, f = 1000) => {
  const out = new Float32Array(Math.round(parts.reduce((a, p) => a + p[1], 0) * sr));
  let o = 0;
  for (const [amp, sec] of parts) { const n = Math.round(sec * sr); for (let i = 0; i < n; i++) out[o + i] = amp * Math.sin(2 * Math.PI * f * (o + i) / sr); o += n; }
  return out;
};
/// the gain reduction (dB) at time t, from the Reduction output (24 dB = 1)
const grAt = (r, t, sr = SR) => r.reduction[Math.round(t * sr)] * 24;
const run = (parts, params = {}, sr = SR) => render(m, { sampleRate: sr, inputs: { l: segs(parts, sr) }, params: { ...base, ...params } });
const timeTo = (r, from, to, level, sr = SR) => { for (let i = Math.round(from * sr); i < Math.round(to * sr); i++) if (r.reduction[i] * 24 >= level) return i / sr - from; return Infinity; };

// ---- static curve --------------------------------------------------------------------------------------------------------------------------
{
  const levels = [-60, -50, -40, -30, -20, -10, 0];
  const staticGr = (db, p) => { const r = run([[0.001, 0.5], [10 ** (db / 20), 12]], p); return grAt(r, 12.4); };
  const comp = levels.map((db) => staticGr(db, { mode: 0 })), lim = levels.map((db) => staticGr(db, { mode: 1 }));
  console.log("     steady gain reduction at PR 50 (dB), levels -60..0 dBFS: Compress", comp.map((v) => v.toFixed(1)).join(" "), "| Limit", lim.map((v) => v.toFixed(1)).join(" "));
  check(comp.every((v, i) => i === 0 || v >= comp[i - 1] - 0.05) && lim.every((v, i) => i === 0 || v >= lim[i - 1] - 0.05), "gain reduction grows with level", "");
  check(comp[0] < 0.05 && lim[0] < 0.05 && comp[1] < 0.2, "quiet signals are left alone", "");
  const slope = (a) => (a[6] - a[5]) / 10;
  check(slope(comp) > 0.45 && slope(comp) < 0.75, "Compress: ratio of about 3:1 at the top (slope 0.67)", slope(comp).toFixed(2));
  check(slope(lim) > 0.8 && slope(lim) < 0.97, "Limit: ratio of about 10:1 at the top (slope 0.9)", slope(lim).toFixed(2));
  check(lim[5] > comp[5], "Limit reduces more than Compress at the same level", "");
  const prs = [0, 25, 50, 75, 100].map((pr) => grAt(run([[0.001, 0.5], [0.316, 10]], { peakReduction: pr }), 10.4));
  console.log("     Peak Reduction 0/25/50/75/100 at -10 dBFS:", prs.map((v) => v.toFixed(1)).join(" "), "dB");
  check(prs.every((v, i) => i === 0 || v > prs[i - 1] + 0.3) && prs[0] < 0.1, "Peak Reduction raises the compression amount", "");
}

// ---- attack: program dependent, then a slow creep -----------------------------------------------------------------------------------------------
{
  const step = (amp, params = {}) => run([[0.001, 0.5], [amp, 14]], params);
  const a = step(0.2), b = step(1.0);
  // the fast stage: time to half of the reduction reached after 150 ms, for a small and a large step
  const half = (r) => { const target = 0.5 * grAt(r, 0.5 + 0.15); return timeTo(r, 0.5, 2, target); };
  const tSmall = half(a), tBig = half(b);
  console.log(`     fast attack (time to half of the 150 ms reduction): -14 dBFS step ${(tSmall * 1000).toFixed(1)} ms, 0 dBFS step ${(tBig * 1000).toFixed(1)} ms`);
  check(tSmall < 0.03 && tBig < 0.03, "the fast stage attacks within milliseconds", "");
  check(tBig < tSmall * 0.85, "program-dependent attack: a bigger step is caught faster", "");
  const g015 = grAt(a, 0.65), g10 = grAt(a, 10.5), gEnd = grAt(a, 14.4);
  check(g10 > g015 + 1.0, "after the fast stage the reduction keeps creeping deeper (slow stage)", `${g015.toFixed(2)} dB at 150 ms -> ${g10.toFixed(2)} dB at 10 s`);
  // the slow stage's attack time constant: time from 150 ms until 63 % of the remaining creep
  const creep = gEnd - g015, t63 = timeTo(a, 0.65, 14, g015 + 0.632 * creep);
  console.log(`     slow stage attack time constant ${t63.toFixed(2)} s`);
  check(t63 > 0.3 && t63 < 3.5, "slow stage attack time constant between 0.3 and 3.5 s", t63.toFixed(2));
}

// ---- release: fast then slow, depending on how long and how hard the signal was compressed -----------------------------------------------
{
  const afterLoud = (loudSec, amp = 0.5, params = {}) => run([[0.001, 1], [amp, loudSec], [0.001, 14]], params);
  const rem = (r, loudSec, dt) => grAt(r, 1 + loudSec + dt) / grAt(r, 1 + loudSec - 0.001);
  const cases = [0.1, 0.3, 2, 6, 20].map((s) => [s, afterLoud(s)]);
  console.log("     release: fraction of the reduction left after 50 ms / 200 ms / 1 s / 3 s / 6 s");
  for (const [s, r] of cases) console.log(`       after ${s} s of compression (${grAt(r, 1 + s - 0.001).toFixed(1)} dB): ${[0.05, 0.2, 1, 3, 6].map((d) => (100 * rem(r, s, d)).toFixed(0) + " %").join("  ")}`);
  const left1 = cases.map(([s, r]) => rem(r, s, 1));
  check(left1.every((v, i) => i === 0 || v > left1[i - 1] - 0.01), "the longer the compression, the more is left after 1 s (photocell memory)", left1.map((v) => v.toFixed(2)).join(" "));
  check(left1[1] < 0.2 && left1[4] > 0.3, "a short burst recovers quickly (<20 % left after 1 s), long compression lingers (>30 %)", `${left1[1].toFixed(2)} vs ${left1[4].toFixed(2)}`);
  const left3 = cases.map(([s, r]) => rem(r, s, 3));
  check(left3[4] > 0.12 && left3[1] < 0.04, "the slow tail is still there after 3 s of release only after long compression", `${left3[1].toFixed(3)} vs ${left3[4].toFixed(3)}`);
  const half = (r, s) => timeTo(r, 1 + s, 14, 0) < 0 ? 0 : (() => { const g0 = grAt(r, 1 + s - 0.001); for (let i = 0; i < 14 * SR; i++) if (grAt(r, 1 + s + i / SR) <= g0 / 2) return i / SR; return Infinity; })();
  const hBurst = half(cases[1][1], 0.3), hLong = half(cases[4][1], 20);
  check(hLong > hBurst * 1.8, "time to half release is much longer after long compression", `${hBurst.toFixed(2)} s after 0.3 s, ${hLong.toFixed(2)} s after 20 s`);
  // the tail's time constant after long compression, from 1 s to 3 s of release (the fast stage is long gone)
  const r = cases[4][1], g1 = grAt(r, 21 + 1), g3 = grAt(r, 21 + 3), tau = 2 / Math.log(g1 / g3);
  console.log(`     slow release tail after 20 s of compression: time constant ${tau.toFixed(2)} s`);
  check(tau > 1.0 && tau < 6, "slow release tail has a time constant of a few seconds", tau.toFixed(2));
  // the fast stage: most of a short burst's reduction is gone within 150 ms
  check(rem(cases[1][1], 0.3, 0.15) < 0.55, "fast release stage: a short burst loses half its reduction within 150 ms", rem(cases[1][1], 0.3, 0.15).toFixed(2));
  // harder compression leaves a longer tail too
  const soft = run([[0.001, 1], [0.12, 20], [0.001, 14]]), hard = run([[0.001, 1], [1.0, 20], [0.001, 14]], { peakReduction: 80 });
  const tailLeft = (r) => grAt(r, 21 + 3) / grAt(r, 20.999);
  check(tailLeft(hard) > tailLeft(soft) + 0.02, "harder compression leaves a longer tail", `${tailLeft(soft).toFixed(2)} vs ${tailLeft(hard).toFixed(2)} left after 3 s`);
}

// ---- sample rate independence ---------------------------------------------------------------------------------------------------------------
{
  const parts = [[0.001, 0.5], [0.4, 3], [0.001, 3]];
  const ref = run(parts, {}, 48000);
  for (const sr of [44100, 96000]) {
    const r = run(parts, {}, sr);
    const worst = Math.max(...[0.51, 0.55, 0.7, 1.5, 3.4, 3.55, 4, 5, 6].map((t) => Math.abs(grAt(r, t, sr) - grAt(ref, t, 48000))));
    check(worst < 0.5, `gain reduction trajectory at ${sr} Hz matches 48 kHz`, `worst difference ${worst.toFixed(2)} dB`);
  }
}

// ---- detector options -------------------------------------------------------------------------------------------------------------------------
{
  const tone = (f, amp, n = SR * 6) => sine(f, amp, n);
  const grFor = (f, emphasis) => grAt(render(m, { inputs: { l: tone(f, 0.15) }, params: { ...base, emphasis } }), 5.9);
  const lo0 = grFor(200, 0), hi0 = grFor(6000, 0), lo12 = grFor(200, 12), hi12 = grFor(6000, 12);
  console.log(`     HF emphasis: 200 Hz / 6 kHz reduction: 0 dB ${lo0.toFixed(2)} / ${hi0.toFixed(2)}, 12 dB ${lo12.toFixed(2)} / ${hi12.toFixed(2)}`);
  check(Math.abs(lo0 - hi0) < 0.3 && hi12 > lo12 + 2 && Math.abs(lo12 - lo0) < 0.3, "HF emphasis makes the detector hear the highs harder, the lows unchanged", "");
  // the audio path is not filtered
  const out = render(m, { inputs: { l: tone(6000, 0.002) }, params: { ...base, emphasis: 12, peakReduction: 0 } });
  check(Math.abs(20 * Math.log10(rms(out.outL, SR * 3, SR * 6) / (0.002 / Math.SQRT2))) < 0.2, "the emphasis shelf is only in the detector", "");
}
{ // stereo link
  const n = SR * 8, loud = sine(300, 0.5, n), quiet = sine(500, 0.01, n);
  const gainOf = (link, ch) => { const o = render(m, { inputs: { l: loud, r: quiet }, params: { ...base, link, input: 1 } }); const y = ch === "r" ? o.outR : o.outL, x = ch === "r" ? quiet : loud; return 20 * Math.log10(rms(y, n - SR, n) / rms(x, n - SR, n)); };
  const l100 = gainOf(100, "l"), r100 = gainOf(100, "r"), l0 = gainOf(0, "l"), r0 = gainOf(0, "r"), r50 = gainOf(50, "r");
  console.log(`     link: L/R gain at 100 %: ${l100.toFixed(1)} / ${r100.toFixed(1)} dB, 50 %: R ${r50.toFixed(1)}, 0 %: ${l0.toFixed(1)} / ${r0.toFixed(1)}`);
  check(Math.abs(l100 - r100) < 0.3 && l100 < -2, "Link 100 %: both channels get the same reduction", "");
  check(Math.abs(r0) < 0.3 && l0 < -2, "Link 0 %: the quiet channel is untouched", "");
  check(r50 < r0 - 0.5 && r50 > r100 + 0.5, "Link 50 % is in between", "");
}
{ // external sidechain
  const n = SR * 6, key = sine(100, 0.6, n), main = sine(800, 0.05, n);
  const g = (sidechain) => { const o = render(m, { inputs: { l: main, key }, params: { ...base, sidechain } }); return 20 * Math.log10(rms(o.outL, n - SR, n) / rms(main, n - SR, n)); };
  const gi = g(0), ge = g(1);
  console.log(`     sidechain: Internal ${gi.toFixed(1)} dB, External (loud key, quiet programme) ${ge.toFixed(1)} dB`);
  check(Math.abs(gi) < 0.3 && ge < -4, "External sidechain ducks the programme from the key; Internal does not", "");
  const sil = render(m, { inputs: { l: main, key: new Float32Array(n) }, params: { ...base, sidechain: 1 } });
  check(Math.abs(20 * Math.log10(rms(sil.outL, n - SR, n) / rms(main, n - SR, n))) < 0.2, "External with a silent key: no reduction", "");
}

// ---- mix, make-up stage -------------------------------------------------------------------------------------------------------------------
{
  const x = sine(440, 0.5, SR * 3);
  const dry = render(m, { inputs: { l: x }, params: { ...base, mix: 0 } });
  let d = 0; for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(dry.outL[i] - x[i]));
  check(d < 1e-6, "Mix 0 passes the dry signal untouched and in phase", d.toExponential(1));
  const half = render(m, { inputs: { l: x }, params: { ...base, mix: 50, peakReduction: 100, gain: 0 } }), full = render(m, { inputs: { l: x }, params: { ...base, mix: 100, peakReduction: 100, gain: 0 } });
  const gr = 1 - rms(full.outL, SR * 2, SR * 3) / rms(x, SR * 2, SR * 3);
  const gh = 1 - rms(half.outL, SR * 2, SR * 3) / rms(x, SR * 2, SR * 3);
  check(gr > 0.15 && Math.abs(gh - gr / 2) < 0.03, "Mix 50 % is the parallel blend, in phase (half the level change)", `${gr.toFixed(3)} / ${gh.toFixed(3)}`);
}
{
  const run2 = (amp, gain, f = 1000, n = 16384) => render(m, { inputs: { l: sine(f, amp, n) }, params: { ...base, peakReduction: 0, gain } }).outL;
  const gdb = (amp, gain) => 20 * Math.log10(rms(run2(amp, gain), 8192) / (amp / Math.SQRT2));
  check(Math.abs(gdb(0.002, 20) - 20) < 0.3 && Math.abs(gdb(0.002, 0)) < 0.2 && Math.abs(gdb(0.002, -12) + 12) < 0.2, "Gain is make-up gain (unity small-signal gain through the valve stage)", `${gdb(0.002, 20).toFixed(2)} / ${gdb(0.002, -12).toFixed(2)} dB`);
  const h = (amp, gain) => harmonicsDb(run2(amp, gain), 1000, SR, 5);
  const lo = h(0.01, 24), mid = h(0.05, 24), hi = h(0.2, 24), none = h(0.2, 0);
  console.log(`     make-up harmonics at 24 dB gain (dB re fundamental), 1 kHz: input .01 [${lo.slice(1).map((v) => v.toFixed(0))}]  .05 [${mid.slice(1).map((v) => v.toFixed(0))}]  .2 [${hi.slice(1).map((v) => v.toFixed(0))}]; 0 dB gain at .2: [${none.slice(1).map((v) => v.toFixed(0))}]`);
  check(hi[1] > hi[2] + 3 && mid[1] > mid[2], "even (2nd) harmonic dominates the 3rd: valve-style asymmetry", `${hi[1].toFixed(1)} vs ${hi[2].toFixed(1)} dB`);
  check(mid[1] > lo[1] + 6 && hi[1] > mid[1] + 6, "colour grows with level", `${lo[1].toFixed(0)} -> ${mid[1].toFixed(0)} -> ${hi[1].toFixed(0)} dB`);
  check(none[1] < hi[1] - 8 && hi[1] < -12, "more gain, more colour; and it stays subtle", `2nd at 0 dB gain ${none[1].toFixed(0)} dB`);
  // transformer: low frequencies saturate before mids at the same level
  const hl = harmonicsDb(run2(0.2, 24, 50, 32768), 50, SR, 4), hm = harmonicsDb(run2(0.2, 24, 1000, 32768), 1000, SR, 4);
  check(hl[2] > hm[2] + 3, "the core saturates earlier on bass (3rd harmonic of 50 Hz above that of 1 kHz)", `${hl[2].toFixed(0)} vs ${hm[2].toFixed(0)} dB`);
  const dcm = run2(0.3, 24, 1000, 65536).slice(32768).reduce((a, v) => a + v, 0) / 32768;
  check(Math.abs(dcm) < 0.002, "no DC offset from the asymmetry", dcm.toExponential(1));
}
{ // aliasing in the make-up stage
  const n = 16384, f0 = 7000;
  const alias = (y) => {
    const sp = spectrum(y), bin0 = Math.round(f0 * n / SR), fund = Math.max(...sp.slice(bin0 - 3, bin0 + 4));
    let p = 0;
    for (let h = 2; h <= 10; h++) { const hf = h * f0; if (hf < SR / 2) continue; const fold = hf % SR > SR / 2 ? SR - (hf % SR) : hf % SR, k = Math.round(fold * n / SR); p += Math.max(...sp.slice(k - 3, k + 4)); }
    return 10 * Math.log10(p / fund);
  };
  for (const [amp, gain, limit] of [[0.05, 24, -60], [0.25, 12, -60], [0.02, 24, -75]]) {
    const y = render(m, { inputs: { l: sine(f0, amp, 2 * n) }, params: { ...base, peakReduction: 0, gain } }).outL.slice(n);
    const a = alias(y);
    console.log(`     7 kHz at ${amp} with ${gain} dB make-up: folded harmonics ${a.toFixed(1)} dB re the fundamental`);
    check(a < limit, `alias products of the make-up stage at ${amp} with ${gain} dB gain stay below ${limit} dB`, "");
  }
}

// ---- Reduction output, determinism, input choice, safety -----------------------------------------------------------------------------------------
{
  const r = run([[0.001, 0.5], [0.5, 6]]);
  check(peak(r.reduction) <= 1 && r.reduction.every((v) => v >= 0), "Reduction output stays within 0..1", "");
  check(Math.abs(grAt(r, 6) - grAt(r, 6.4)) < 1 && grAt(r, 6) > 3, "Reduction output follows the gain reduction (24 dB = 1)", `${grAt(r, 6.4).toFixed(1)} dB`);
  const r2 = run([[0.001, 0.5], [0.5, 6]]);
  check(r.outL.every((v, i) => v === r2.outL[i]) && r.reduction.every((v, i) => v === r2.reduction[i]), "deterministic: two renders are identical", "");
  const quiet = render(m, { inputs: { l: new Float32Array(48000) }, params: base });
  check(peak(quiet.outL) === 0 && peak(quiet.reduction) === 0, "silence in, silence out", "");
}
{
  const x = sine(300, 0.3, 24000);
  const auto = render(m, { inputs: { l: x }, params: { ...base, input: 0 } }), mono = render(m, { inputs: { l: x }, params: { ...base, input: 2 } }), st = render(m, { inputs: { l: x }, params: { ...base, input: 1 } });
  let dA = 0, dM = 0, dS = 0; for (let i = 12000; i < 24000; i++) { dA = Math.max(dA, Math.abs(auto.outL[i] - auto.outR[i])); dM = Math.max(dM, Math.abs(mono.outL[i] - mono.outR[i])); dS = Math.max(dS, Math.abs(st.outR[i])); }
  check(dA < 1e-4 && dM < 1e-4 && dS < 1e-12, "Input: Auto and Mono use the left signal for both channels, Stereo keeps the right one silent", `${dA.toExponential(1)} ${dM.toExponential(1)} ${dS.toExponential(1)}`);
}
{
  const square = Float32Array.from({ length: 96000 }, (_, i) => (Math.floor(i / 60) % 2 ? 1 : -1));
  const burst = Float32Array.from({ length: 240000 }, (_, i) => (i < 4000 ? square[i] : 0));
  const extremes = [{ peakReduction: 100, gain: 30, mode: 1, emphasis: 12, link: 100, mix: 100 }, { peakReduction: 100, gain: -12, mode: 0, emphasis: 12, link: 0, mix: 50 }, { peakReduction: 0, gain: 30, mode: 0, emphasis: 0, link: 50, mix: 100 }];
  for (const sr of [44100, 96000]) for (const [i, p] of extremes.entries()) {
    const s = render(m, { sampleRate: sr, inputs: { l: square, r: Float32Array.from(square, (v) => -v), key: square }, params: { ...base, ...p } });
    const dc = render(m, { sampleRate: sr, inputs: { l: 1, r: -1 }, n: 96000, params: { ...base, ...p } });
    const t = render(m, { sampleRate: sr, inputs: { l: burst }, params: { ...base, ...p } });
    check(finiteAll(s.outL) && finiteAll(s.outR) && finiteAll(s.reduction) && finiteAll(dc.outL) && finiteAll(t.outL) && peak(s.outL) < 100, `finite and bounded at extreme settings #${i} (${sr} Hz)`, `peak ${peak(s.outL).toFixed(1)}`);
    check(peak(t.outL, 200000) < 1e-3, `silence after a burst decays (#${i}, ${sr} Hz)`, `${peak(t.outL, 200000).toExponential(1)}`);
  }
  const x = sine(300, 0.4, SR * 3);
  const sweep = render(m, { inputs: { l: x }, params: { ...base, peakReduction: (i) => 100 * i / x.length, gain: (i) => 12 * i / x.length } }).outL;
  let j = 0; for (let i = 1; i < sweep.length; i++) j = Math.max(j, Math.abs(sweep[i] - sweep[i - 1]));
  check(j < 0.2, "sweeping Peak Reduction and Gain while playing is smooth", `max step ${j.toFixed(3)}`);
}
finish();
