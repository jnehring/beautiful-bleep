// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// The jitter buffer of the web link (bridge-ring.js): clock drift, steps, underrun and overrun, resampling.
// Pure node, no dependencies:  node patch/web/test/bridge-ring-test.mjs
import assert from "node:assert/strict";
import { AudioRing, JitterReader, Packetizer, nextPow2 } from "../js/bridge-ring.js";

const SR = 48000, Q = 128, TARGET = Math.round(0.016 * SR);  // Low latency: 16 ms
const kinds = [["plain", false], ["shared", true]];
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };

/// A sine source: phase-continuous across packets, at `sr` samples per second, 1 kHz.
const sine = (sr, freq = 1000, amp = 0.8) => { let n = 0; return (l, r, count) => { for (let i = 0; i < count; ++i, ++n) l[i] = r[i] = amp * Math.sin(2 * Math.PI * freq * n / sr); }; };

/// Runs a producer (rate `fp(t)` frames/s, packets of Q) and the consumer (SR, Q per read) for `seconds`.
/// `hook(t, ring, reader)` may inject events. Returns what the consumer heard and the fill history.
function simulate({ shared, seconds, fp, srSource = SR, hook, mute, target = TARGET, source }) {
  const ring = AudioRing.create(nextPow2(8 * target * (srSource / SR) + 4 * Q), { shared });
  const reader = new JitterReader(ring, { targetFrames: target, srSource, srSink: SR });
  const gen = source || sine(srSource);
  const pl = new Float32Array(2048), pr = new Float32Array(2048), ol = new Float32Array(Q), or = new Float32Array(Q);
  const heard = new Float32Array(Math.ceil(seconds * SR / Q) * Q), fills = [];
  let nextP = 0, j = 0;  // when the producer's next packet is due; how many reads the consumer did
  for (let tc = 1e-9; tc < seconds; ) {
    if (nextP <= tc) {  // the producer's packet comes first (it wins ties)
      gen(pl, pr, Q);
      if (!mute?.(nextP)) ring.write(pl, pr, Q);
      nextP += Q / fp(nextP);
    } else {
      hook?.(tc, ring, reader, { gen, pl, pr });
      const got = reader.read(ol, or, Q);
      heard.set(ol, j * Q);
      if (reader.primed && got === Q) fills.push(reader.fill);
      j++;
      tc = j * Q / SR;
    }
  }
  return { ring, reader, heard: heard.subarray(0, j * Q), fills };
}
const lo = (a) => a.reduce((m, x) => Math.min(m, x), Infinity), hi = (a) => a.reduce((m, x) => Math.max(m, x), -Infinity);
/// Frame count that gives a constant producer rate; `fp` receives the producer time and returns frames/s.
const constant = (rate) => () => rate;

for (const [label, shared] of kinds) {
  // 1. ±200 ppm, 10 simulated minutes: the fill stays within ±25 % of the target, nothing glitches.
  for (const ppm of [+200, -200, 0]) {
    const s = simulate({ shared, seconds: ppm ? 600 : 60, fp: constant(SR * (1 + ppm * 1e-6)) });
    const lo_ = lo(s.fills), hi_ = hi(s.fills);
    ok(lo_ >= 0.75 * TARGET && hi_ <= 1.25 * TARGET, `${label} ${ppm} ppm: fill ${lo_.toFixed(0)}..${hi_.toFixed(0)} outside ±25 % of ${TARGET}`);
    ok(s.reader.stats.underruns === 0 && s.reader.stats.overruns === 0, `${label} ${ppm} ppm: glitches ${JSON.stringify(s.reader.stats)}`);
    ok(s.ring.dropped === 0, `${label}: writer dropped frames`);
    ok(Math.abs(s.reader.ratio - 1 - 0) < 0.005 + 1e-9, "ratio stays within the nudge limit");
  }

  // 2. Step changes: the producer clock jumps from +200 to −200 ppm, then a 512-frame burst arrives at once
  //    (a stalled main thread), then the producer pauses for a moment (but less than the buffer holds).
  {
    let burst = false;
    const s = simulate({ shared, seconds: 120, fp: (t) => (t < 40 ? SR * 1.0002 : SR * 0.9998),
      hook: (t, ring, _r, { gen, pl, pr }) => { if (!burst && t > 80) { burst = true; for (let i = 0; i < 4; ++i) { gen(pl, pr, Q); ring.write(pl, pr, Q); } } } });
    ok(s.reader.stats.underruns === 0 && s.reader.stats.overruns === 0, `${label} steps: glitches ${JSON.stringify(s.reader.stats)}`);
    const settled = s.fills.slice(-Math.floor(10 * SR / Q));  // the last 10 s
    ok(lo(settled) >= 0.75 * TARGET && hi(settled) <= 1.25 * TARGET, `${label} steps: did not settle (${lo(settled).toFixed(0)}..${hi(settled).toFixed(0)})`);
    ok(hi(s.fills) > 1.4 * TARGET, "the burst was seen");
    ok(hi(s.fills) < 4 * TARGET, "a 512-frame burst is not an overrun");
  }

  // 3. Underrun: the producer stops for 200 ms: silence (never garbage), then re-priming to the target.
  {
    const s = simulate({ shared, seconds: 6, fp: constant(SR), mute: (t) => t > 2 && t < 2.2 });
    ok(s.reader.stats.underruns >= 1, `${label}: the stop was not noticed`);
    ok(s.reader.primed, `${label}: did not re-prime`);
    // after the gap the reader waits for the target again before it plays
    const tail = s.fills.slice(-100);
    ok(lo(tail) >= 0.7 * TARGET && hi(tail) <= 1.3 * TARGET, `${label}: fill after the gap ${lo(tail).toFixed(0)}..${hi(tail).toFixed(0)}`);
    ok(s.heard.every((x) => Number.isFinite(x) && Math.abs(x) <= 0.81), "output is bounded");
  }
  // a direct underrun: read more than there is
  {
    const ring = AudioRing.create(8192, { shared }), r = new JitterReader(ring, { targetFrames: 512 });
    const one = new Float32Array(600).fill(0.5), ol = new Float32Array(Q).fill(9), or = new Float32Array(Q).fill(9);
    ring.write(one, one, 600);
    assert.equal(r.read(ol, or, Q), Q);           // primed (600 ≥ 512), plays
    let got = Q;
    for (let i = 0; i < 4; ++i) got = r.read(ol, or, Q);  // runs dry: 600 frames hold only ~4 reads
    ok(r.stats.underruns === 1 && !r.primed && got < Q, "ran dry once");
    ok(ol.subarray(got).every((x) => x === 0) && or.subarray(got).every((x) => x === 0), "an underrun is silence from there on");
    r.read(ol, or, Q);
    ring.write(one, one, 200);
    r.read(ol, or, Q);
    ok(!r.primed && ol.every((x) => x === 0), "no playing before the buffer is back at the target");
    ring.write(one, one, 400);
    r.read(ol, or, Q);
    ok(r.primed, "primed again at the target");
  }

  // 4. Overrun: more than 4 × the target waiting → the oldest frames go, down to the target.
  {
    const ring = AudioRing.create(16384, { shared }), r = new JitterReader(ring, { targetFrames: 768 });
    const ramp = new Float32Array(4000).map((_, i) => i / 4000), ol = new Float32Array(Q), or = new Float32Array(Q);
    ring.write(ramp, ramp, 4000);  // 4000 > 4 × 768
    r.read(ol, or, Q);
    ok(r.stats.overruns === 1, "overrun counted");
    ok(r.stats.droppedFrames === 4000 - 768, `dropped ${r.stats.droppedFrames}`);
    ok(ol[0] > (4000 - 768) / 4000 - 0.01, "what plays is the newest data, not the oldest");
    ok(r.fill <= 768 + 1, "fill is back at the target");
  }
}

// 5. The counters wrap (int32 overflow) without a hiccup, with a ring much smaller than the data.
for (const [label, shared] of kinds) {
  for (const start of [0x7fffff00, 0xffffff00 | 0]) {
    const ring = AudioRing.create(256, { shared });
    Atomics.store(ring.ctl, 0, start); Atomics.store(ring.ctl, 1, start);
    const w = new Float32Array(100), o = new Float32Array(100), o2 = new Float32Array(100);
    let next = 0;
    for (let round = 0; round < 50; ++round) {
      for (let i = 0; i < 100; ++i) w[i] = next++;
      assert.equal(ring.write(w, w, 100), 100);
      assert.equal(ring.read(o, o2, 100), 100);
      for (let i = 0; i < 100; ++i) assert.equal(o[i], next - 100 + i);
    }
    ok(ring.available() === 0, `${label}: counters wrapped cleanly`);
    ok(ring.write(new Float32Array(300), null, 300) === 256 && ring.dropped === 44, `${label}: a full ring drops the newest, counted`);
  }
}

// 6. Resampling: the sample-rate ratio is part of the same ratio; the result is a clean sine.
const rates = [[44100, 48000], [48000, 44100], [32000, 48000], [48000, 48000]];
for (const [label, shared] of kinds) {
  for (const [srSource, srSink] of rates) {
    const target = Math.round(0.016 * srSource);
    const ring = AudioRing.create(nextPow2(8 * target + 4 * Q), { shared });
    const reader = new JitterReader(ring, { targetFrames: target, srSource, srSink });
    const gen = sine(srSource, 1000, 0.8);
    const pl = new Float32Array(Q), pr = new Float32Array(Q), ol = new Float32Array(Q), or = new Float32Array(Q);
    const seconds = 20, out = [];
    let produced = 0, j = 0;
    while (j * Q / srSink < seconds) {
      const tc = j * Q / srSink;
      while (produced / srSource <= tc) { gen(pl, pr, Q); ring.write(pl, pr, Q); produced += Q; }
      reader.read(ol, or, Q);
      if (reader.primed) out.push(...ol);
      j++;
    }
    let maxJump = 0, crossings = 0;
    for (let i = 1; i < out.length; ++i) { maxJump = Math.max(maxJump, Math.abs(out[i] - out[i - 1])); if (out[i - 1] < 0 && out[i] >= 0) crossings++; }
    // a 1 kHz sine of amplitude 0.8 at the sink rate steps by at most 0.8 × 2π × 1000 / srSink
    const bound = 0.8 * 2 * Math.PI * 1000 / srSink * 1.03;
    ok(maxJump <= bound, `${label} ${srSource}→${srSink}: max jump ${maxJump.toFixed(4)} > ${bound.toFixed(4)}`);
    ok(maxJump > 0.5 * bound, "and the signal is really there");
    const hz = crossings / (out.length / srSink);
    ok(Math.abs(hz - 1000) < 8, `${label} ${srSource}→${srSink}: pitch ${hz.toFixed(1)} Hz`);
    ok(reader.stats.underruns === 0 && reader.stats.overruns === 0, `${label} ${srSource}→${srSink}: glitches`);
  }
}

// 7. The packetizer: quanta in, packets out.
{
  const pk = new Packetizer({ channel: 7, packetFrames: 128 });
  const q = new Float32Array(128).map((_, i) => i);
  const a = pk.push(q, q, 128), b = pk.push(q, null, 128);
  ok(a.length === 1 && b.length === 1, "one packet per quantum");
  ok(a[0].seq === 0 && b[0].seq === 1 && a[0].sampleTime === 0 && b[0].sampleTime === 128 && a[0].channel === 7, "seq and sampleTime run on");
  ok(b[0].right[5] === 5, "mono source goes to both sides");
  const big = new Packetizer({ channel: 1, packetFrames: 512, startSampleTime: 1000 });
  let got = [];
  for (let i = 0; i < 9; ++i) got.push(...big.push(q, q, 128));
  ok(got.length === 2 && got[1].sampleTime === 1512 && got[0].left.length === 512, "512-frame packets from 128-frame quanta");
  ok(got[0].left[128] === 0 && got[0].left[129] === 1, "quanta are laid end to end");
  const rest = big.flush();
  ok(rest.left.length === 128 && rest.sampleTime === 2024 && big.flush() === null, "flush hands out the partial packet once");
  const odd = new Packetizer({ channel: 2, packetFrames: 100 });
  const o = odd.push(q, q, 128);
  ok(o.length === 1 && odd.filled === 28, "odd sizes carry over");
  const w = new Packetizer({ channel: 3, packetFrames: 128 });
  w.seq = 0xffffffff;
  w.push(q, q, 128);
  ok(w.seq === 0, "seq wraps at u32");
  // fresh arrays: a packet can be transferred while the next one is collected
  const c = new Packetizer({ channel: 3, packetFrames: 128 });
  const [p1] = c.push(q, q, 128), [p2] = c.push(q, q, 128);
  ok(p1.left !== p2.left, "packets do not share storage");
}

console.log(`bridge-ring-test: ${checks} checks passed`);
