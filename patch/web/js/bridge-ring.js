// SPDX-License-Identifier: MIT
//
// bridge-ring.js — the jitter buffer of the web link (doc/specs/bridges.md §10.4), as plain classes that work
// on a Float32Array ring. The ring lives in one ArrayBuffer or SharedArrayBuffer, with its write and read
// counters in the same buffer and accessed with Atomics, so a Worker can write while an AudioWorklet reads
// (single producer, single consumer, no locks). The same code runs on a plain ArrayBuffer for the "Safe"
// path and under node.
//
//   AudioRing      the ring: write (producer) / read, skip, available (consumer)
//   JitterReader   the consumer side of an incoming channel: target fill, ratio nudge, interpolation,
//                  underrun → silence and re-prime, overrun → drop the oldest
//   Packetizer     the producer side of an outgoing channel: cuts quanta into packets

const HEADER_INTS = 8;                    // Int32 slots: 0 write counter, 1 read counter, 2 frames dropped by the writer
const HEADER_BYTES = HEADER_INTS * 4;
const W = 0, R = 1, DROPPED = 2;

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/// Planar stereo ring of `capacity` frames (a power of two: the counters run free over 32 bits and wrap, and
/// that only agrees with an index mask when the capacity divides 2³²).
export class AudioRing {
  static bytesFor(capacity) { return HEADER_BYTES + capacity * 2 * 4; }

  /// A new ring. `shared`: back it with a SharedArrayBuffer (needs cross-origin isolation in a browser).
  static create(minFrames, { shared = false } = {}) {
    const capacity = nextPow2(Math.max(2, minFrames));
    const bytes = AudioRing.bytesFor(capacity);
    return new AudioRing(shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));
  }

  /// Wraps a buffer made by `create` (possibly in another thread).
  constructor(buffer) {
    const capacity = (buffer.byteLength - HEADER_BYTES) / 8;
    if (!Number.isInteger(capacity) || capacity < 2 || (capacity & (capacity - 1)) !== 0) throw new RangeError("not an AudioRing buffer");
    this.buffer = buffer;
    this.capacity = capacity;
    this.mask = capacity - 1;
    this.ctl = new Int32Array(buffer, 0, HEADER_INTS);
    const data = new Float32Array(buffer, HEADER_BYTES, capacity * 2);
    this.L = data.subarray(0, capacity);
    this.R = data.subarray(capacity);
  }

  get shared() { return typeof SharedArrayBuffer !== "undefined" && this.buffer instanceof SharedArrayBuffer; }
  /// Frames waiting to be read.
  available() { return (Atomics.load(this.ctl, W) - Atomics.load(this.ctl, R)) | 0; }
  free() { return this.capacity - this.available(); }
  /// Frames the writer had to drop because the ring was full (nobody was reading).
  get dropped() { return Atomics.load(this.ctl, DROPPED) >>> 0; }

  /// Producer. Writes up to `n` frames from `l`/`r` (from `at`); returns how many fit. A full ring means the
  /// reader is not running: the newest frames are dropped (the reader drops the oldest when it comes back).
  write(l, r, n, at = 0) {
    const w = Atomics.load(this.ctl, W), free = this.capacity - ((w - Atomics.load(this.ctl, R)) | 0);
    const m = Math.min(n, free);
    if (m < n) Atomics.add(this.ctl, DROPPED, n - m);
    if (m <= 0) return 0;
    const i = w & this.mask, first = Math.min(m, this.capacity - i);
    const src = r || l;
    this.L.set(l.subarray(at, at + first), i);
    this.R.set(src.subarray(at, at + first), i);
    if (m > first) {
      this.L.set(l.subarray(at + first, at + m), 0);
      this.R.set(src.subarray(at + first, at + m), 0);
    }
    Atomics.store(this.ctl, W, (w + m) | 0);  // publishes the samples above
    return m;
  }

  /// Consumer. Copies up to `n` frames out and consumes them; returns how many were there.
  read(l, r, n) {
    const rd = Atomics.load(this.ctl, R), m = Math.min(n, (Atomics.load(this.ctl, W) - rd) | 0);
    if (m <= 0) return 0;
    const i = rd & this.mask, first = Math.min(m, this.capacity - i);
    l.set(this.L.subarray(i, i + first), 0);
    r.set(this.R.subarray(i, i + first), 0);
    if (m > first) {
      l.set(this.L.subarray(0, m - first), first);
      r.set(this.R.subarray(0, m - first), first);
    }
    Atomics.store(this.ctl, R, (rd + m) | 0);
    return m;
  }

  /// Consumer: throws away the `n` oldest frames (n ≤ available).
  skip(n) { Atomics.store(this.ctl, R, (Atomics.load(this.ctl, R) + n) | 0); }
  readCounter() { return Atomics.load(this.ctl, R); }
}

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/// The consumer of an incoming audio channel. §10.4: per read of `n` frames it measures the fill, computes
/// `err = (fill − target) / target` and reads at ratio `r = 1 + clamp(0.02 × err, ±0.005)`, smoothed with a
/// one-pole filter (time constant 0.5 s) and interpolated linearly. Sample-rate differences are part of the
/// same ratio (`r × srSource / srSink`). Underrun: silence and re-prime to the target. Overrun (fill above 4 ×
/// target): drop the oldest frames down to the target.
export class JitterReader {
  constructor(ring, { targetFrames, srSource = 48000, srSink = 48000, gain = 0.02, maxNudge = 0.005, tau = 0.5, overrunFactor = 4 }) {
    if (!(targetFrames >= 1)) throw new RangeError("targetFrames must be positive");
    this.ring = ring;
    this.target = targetFrames;
    this.srSource = srSource;
    this.srSink = srSink;
    this.gain = gain;
    this.maxNudge = maxNudge;
    this.tau = tau;
    this.overrunAt = overrunFactor * targetFrames;
    if (this.overrunAt + 2 > ring.capacity) throw new RangeError("ring too small for 4 × the target fill");
    this.reset();
    this.stats = { reads: 0, underruns: 0, overruns: 0, droppedFrames: 0, silentFrames: 0 };
  }

  /// Back to "waiting for the buffer to fill" (a ghost channel, a reconnect). The ratio keeps its value.
  reset() {
    this.primed = false;
    this.pos = 0;             // fractional read position in source frames, ahead of the ring's read counter
    this.ratio = this.ratio || 1;
    this.fill = 0;            // the last measured fill, in source frames
  }

  /// Fills `outL`/`outR` (first `n` frames) and returns how many of them hold audio (the rest is silence).
  read(outL, outR, n) {
    const ring = this.ring, st = this.stats;
    st.reads++;
    let avail = ring.available();
    if (!this.primed) {
      if (avail < this.target) { outL.fill(0, 0, n); outR.fill(0, 0, n); st.silentFrames += n; this.fill = avail; return 0; }
      this.primed = true;
      this.pos = 0;
    }
    if (avail > this.overrunAt) {
      const drop = avail - this.target;
      ring.skip(drop);
      avail = this.target;
      st.overruns++;
      st.droppedFrames += drop;
    }
    const fill = avail - this.pos;
    this.fill = fill;
    const err = (fill - this.target) / this.target;
    const desired = 1 + clamp(this.gain * err, -this.maxNudge, this.maxNudge);
    this.ratio += (desired - this.ratio) * (1 - Math.exp(-n / (this.tau * this.srSink)));
    const step = this.ratio * this.srSource / this.srSink;

    const L = ring.L, Rr = ring.R, mask = ring.mask, base = ring.readCounter();
    let pos = this.pos, k = 0;
    for (; k < n; ++k) {
      const i0 = Math.floor(pos);
      if (i0 + 1 >= avail) break;  // the interpolation needs the next frame too
      const a = (base + i0) & mask, b = (a + 1) & mask, f = pos - i0;
      outL[k] = L[a] + (L[b] - L[a]) * f;
      outR[k] = Rr[a] + (Rr[b] - Rr[a]) * f;
      pos += step;
    }
    if (k < n) {  // underrun
      outL.fill(0, k, n);
      outR.fill(0, k, n);
      st.underruns++;
      st.silentFrames += n - k;
      this.primed = false;
      this.pos = 0;
      ring.skip(Math.min(avail, Math.floor(pos)));  // what is left is too little to play: re-prime from fresh frames
      return k;
    }
    const used = Math.floor(pos);
    ring.skip(used);
    this.pos = pos - used;
    return n;
  }
}

/// The producer side of an outgoing channel: collects the worklet's 128-frame quanta and cuts them into
/// packets of `packetFrames` (§10.2: the web sends 128-frame packets). `seq` counts packets, `sampleTime` the
/// sender's running frame counter at the first frame of a packet.
export class Packetizer {
  constructor({ channel, packetFrames = 128, startSampleTime = 0 }) {
    this.channel = channel;
    this.packetFrames = packetFrames;
    this.seq = 0;
    this.sampleTime = startSampleTime;  // of the first frame in the packet being collected
    this.fillL = new Float32Array(packetFrames);
    this.fillR = new Float32Array(packetFrames);
    this.filled = 0;
  }

  /// Adds `n` frames (from `at`); returns the packets that became complete, in order. Their arrays are fresh
  /// (the caller may transfer or encode them at once).
  push(l, r, n, at = 0) {
    const out = [], src = r || l;
    while (n > 0) {
      const m = Math.min(n, this.packetFrames - this.filled);
      this.fillL.set(l.subarray(at, at + m), this.filled);
      this.fillR.set(src.subarray(at, at + m), this.filled);
      this.filled += m; at += m; n -= m;
      if (this.filled === this.packetFrames) out.push(this.#cut());
    }
    return out;
  }

  /// The partial packet collected so far, or null (on a stop; it is shorter than packetFrames).
  flush() { return this.filled ? this.#cut() : null; }

  #cut() {
    const frames = this.filled;
    const p = { channel: this.channel, seq: this.seq, sampleTime: this.sampleTime,
      left: frames === this.packetFrames ? this.fillL : this.fillL.slice(0, frames),
      right: frames === this.packetFrames ? this.fillR : this.fillR.slice(0, frames) };
    this.seq = (this.seq + 1) >>> 0;
    this.sampleTime += frames;
    this.fillL = new Float32Array(this.packetFrames);
    this.fillR = new Float32Array(this.packetFrames);
    this.filled = 0;
    return p;
  }
}
