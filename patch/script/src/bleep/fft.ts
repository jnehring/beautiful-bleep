// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// bleep/fft — a fixed-size FFT that allocates in its constructor and nowhere else.

/// A complex FFT of `size` points (a power of two, 2 to 65536), in place, on the public arrays `re` and `im`. Fill them, call `forward()`, read the
/// bins; or fill bins and call `inverse()` for samples (it divides by `size`, so inverse(forward(x)) is x). One transform costs about 5 size log2(size)
/// operations: do it once per hop in block(), not per sample. Bin k of a transform at sample rate sr is at k * sr / size Hz; bins above size / 2 mirror
/// those below for real input.
export class Fft {
  readonly size: i32;
  re: StaticArray<f32>;
  im: StaticArray<f32>;
  private cosTable: StaticArray<f32>;
  private sinTable: StaticArray<f32>;
  private reverse: StaticArray<i32>;
  constructor(size: i32) {
    this.size = size;
    this.re = new StaticArray<f32>(size);
    this.im = new StaticArray<f32>(size);
    this.cosTable = new StaticArray<f32>(size / 2);
    this.sinTable = new StaticArray<f32>(size / 2);
    this.reverse = new StaticArray<i32>(size);
    for (let i = 0; i < size / 2; i++) {
      const a = -2.0 * Math.PI * <f64>i / <f64>size;
      this.cosTable[i] = <f32>Math.cos(a);
      this.sinTable[i] = <f32>Math.sin(a);
    }
    let bits = 0;
    while ((1 << bits) < size) bits++;
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.reverse[i] = r;
    }
  }
  /// Zeroes the imaginary part (call before forward() on real samples).
  clearImag(): void { for (let i = 0; i < this.size; i++) this.im[i] = 0.0; }
  forward(): void { this.transform(false); }
  inverse(): void {
    this.transform(true);
    const s = <f32>(1.0 / <f64>this.size);
    for (let i = 0; i < this.size; i++) { this.re[i] *= s; this.im[i] *= s; }
  }
  /// The magnitude of bin k.
  magnitude(k: i32): f32 { return <f32>Math.sqrt(<f64>(this.re[k] * this.re[k] + this.im[k] * this.im[k])); }
  /// The phase of bin k, in radians.
  phase(k: i32): f32 { return <f32>Math.atan2(<f64>this.im[k], <f64>this.re[k]); }
  /// Multiplies `re` by a Hann window (apply before forward() on a block of samples).
  applyHann(): void {
    const n = this.size;
    for (let i = 0; i < n; i++) this.re[i] *= <f32>(0.5 - 0.5 * Math.cos(2.0 * Math.PI * <f64>i / <f64>n));
  }
  private transform(inverse: bool): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) {
        const tr = this.re[i]; this.re[i] = this.re[j]; this.re[j] = tr;
        const ti = this.im[i]; this.im[i] = this.im[j]; this.im[j] = ti;
      }
    }
    const sign: f32 = inverse ? -1.0 : 1.0;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = this.cosTable[k * step], wi = sign * this.sinTable[k * step];
          const a = i + k, b = a + half;
          const xr = this.re[b] * wr - this.im[b] * wi;
          const xi = this.re[b] * wi + this.im[b] * wr;
          this.re[b] = this.re[a] - xr; this.im[b] = this.im[a] - xi;
          this.re[a] += xr; this.im[a] += xi;
        }
      }
    }
  }
}
