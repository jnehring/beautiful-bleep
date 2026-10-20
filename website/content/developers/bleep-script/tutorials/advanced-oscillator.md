---
title: An advanced oscillator
description: Four waveforms with PolyBLEP anti-aliasing, pulse width, audio-rate FM and hard sync, and a sync output for chaining oscillators.
order: 35
---

# An advanced oscillator

The [sine oscillator](sine-oscillator.md) had one waveform and a pitch. This one has what a real synth oscillator has:

- **four waveforms:** sine, triangle, saw and a square with pulse width;
- **anti-aliasing** on the saw and the square (PolyBLEP);
- an **FM input**, per sample, for frequency modulation;
- a **sync input**: a rising edge restarts the oscillator (hard sync);
- a **sync output** that pulses at the start of each cycle, so that one oscillator can sync another.

Read [Rates and timing](../rates.md) and the [drive tutorial](drive.md) first; this page uses the block-rate / sample-rate split and the idea of aliasing.

## The module

```ts compile
import { Smoother, pitchToHz } from "./bleep/dsp";

/// The PolyBLEP residual: a small curve that, added around a jump, replaces the jump by a band-limited step. It is nonzero only within one
/// phase step `dt` of the jump. `t` is the phase relative to the jump (0 to 1).
function polyBlep(t: f64, dt: f64): f64 {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1.0; }
  if (t > 1.0 - dt) { const x = (t - 1.0) / dt; return x * x + x + x + 1.0; }
  return 0.0;
}

@module({
  name: "Oscillator",
  category: "Sources/Script",
  description: "Sine, triangle, saw and pulse with PolyBLEP, audio-rate FM and hard sync.",
})
export class Oscillator {
  @input({ name: "Pitch", type: "pitch" }) pitch: f32 = 0;
  @input({ name: "FM", type: "audio" }) fm: f32 = 0;
  @input({ name: "Sync", type: "trigger" }) sync: f32 = 0;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @output({ name: "Sync out", type: "trigger" }) syncOut: f32 = 0;

  @param({ name: "Waveform", choices: ["Sine", "Triangle", "Saw", "Square"] }) waveform: i32 = 2;
  @param({ name: "Octave", min: -3, max: 3, init: 0 }) octave: i32 = 0;
  @param({ name: "Semitones", min: -12, max: 12, init: 0 }) semitones: i32 = 0;
  @param({ name: "Fine", min: -100, max: 100, init: 0, unit: "cents", decimals: 0 }) fine: f32 = 0;
  @param({ name: "Pulse width", min: 0.05, max: 0.95, init: 0.5 }) width: f32 = 0.5;
  @param({ name: "FM amount", min: 0, max: 5000, init: 0, map: "skew", centre: 300, unit: "Hz", decimals: 0 }) fmAmount: f32 = 0;
  @param({ name: "Level", min: 0, max: 1, init: 0.5 }) level: f32 = 0.5;

  private phase: f64 = 0;
  private base: f64 = 0;               // the frequency of the pitch and tuning, in Hz
  private inverse: f64;                // 1 / sampleRate
  private gain: Smoother;
  private pulseWidth: Smoother;
  private pulse: i32 = 0;              // samples left of the sync output pulse
  constructor(sampleRate: f64) {
    this.inverse = 1.0 / sampleRate;
    this.gain = new Smoother(sampleRate, 0.01);
    this.pulseWidth = new Smoother(sampleRate, 0.01);
    this.pulseWidth.target = 0.5;
    this.pulseWidth.snap();
  }

  reset(): void { this.phase = 0; this.pulse = 0; }

  /// Hard sync: a rising edge on the Sync input restarts the cycle, at the sample where the edge happens.
  @on("sync", { rising: 0.5 }) restart(): void { this.phase = 0; }

  block(): void {
    const volts = <f64>this.pitch + <f64>this.octave + <f64>this.semitones / 12.0 + <f64>this.fine / 1200.0;
    this.base = pitchToHz(volts);                           // the expensive part, once per block
    this.gain.target = this.level;
    this.pulseWidth.target = this.width;
  }

  sample(): void {
    // frequency modulation: the FM input adds Hz to the frequency, every sample. It can go negative: the oscillator then runs backwards.
    const step = (this.base + <f64>this.fm * <f64>this.fmAmount) * this.inverse;   // phase per sample
    const dt = abs(step);                                                          // how far the phase moves, whichever direction
    const direction: f64 = step < 0.0 ? -1.0 : 1.0;
    const t = this.phase;
    const w = <f64>this.pulseWidth.next();

    let v: f64;
    if (this.waveform == 0) {
      v = Math.sin(2.0 * Math.PI * t);
    } else if (this.waveform == 1) {
      v = 1.0 - 4.0 * abs(t - 0.5);                         // -1 at the start, +1 half way
    } else if (this.waveform == 2) {
      v = 2.0 * t - 1.0 - direction * polyBlep(t, dt);      // a saw, with its jump at the wrap smoothed
    } else {
      v = t < w ? 1.0 : -1.0;
      v += direction * polyBlep(t, dt);                     // the rising edge, at the wrap
      let u = t - w;
      if (u < 0.0) u += 1.0;
      v -= direction * polyBlep(u, dt);                     // the falling edge, at the pulse width
    }
    this.out = <f32>v * this.gain.next();

    // advance, and tell the world when the cycle starts again
    this.phase += step;
    if (this.phase >= 1.0 || this.phase < 0.0) {
      this.phase -= Math.floor(this.phase);
      this.pulse = 8;
    }
    this.syncOut = this.pulse > 0 ? 1 : 0;
    if (this.pulse > 0) this.pulse--;
  }
}
```

## How it works

### The phase and the three waveform families

The phase runs from 0 to 1 as before. The waveforms are all functions of it:

| Waveform | Function of the phase `t` | Aliasing |
|---|---|---|
| Sine | `sin(2π t)` | none: it has no harmonics |
| Triangle | a ramp up and down, `1 − 4·|t − 0.5|` | very little: its harmonics fall off as 1/n² |
| Saw | `2t − 1` | strong: a jump at the wrap, harmonics fall off as 1/n |
| Square | `+1` below the pulse width, `−1` above | strong: two jumps |

The sine and the triangle need nothing more. The saw and the square have **jumps**, and a jump is an infinite number of harmonics: sampled naively, those above Nyquist fold back and make the inharmonic grit described in the [drive tutorial](drive.md#what-aliasing-is).

### PolyBLEP

**PolyBLEP** ("polynomial band-limited step") is the cheap fix. A band-limited jump is smooth: it is a step run through a low-pass filter. PolyBLEP approximates what that filter would do to the **two samples around the jump** with a small parabola and adds the difference to the naive waveform. Away from the jump `polyBlep` returns 0, so it costs a comparison; near the jump it is a few multiplications.

- `t < dt`: the sample just **after** the jump, `dt` is how much the phase moves per sample, so `t / dt` says how far into the sample the jump happened;
- `t > 1 − dt`: the sample just **before** it.

For the saw, the jump is at the wrap, so the correction is subtracted at the phase's start and end. For the square there are two jumps: the rising edge at the wrap and the falling edge at the pulse width. The second one calls `polyBlep` with the phase **relative to the pulse width**, which is `t − w`, brought back into 0 to 1.

The documentation test measures it: a saw at about 3.3 kHz carries roughly 16 dB less folded (non-harmonic) energy with PolyBLEP than the naive saw. The test also checks the other parts: all four waveforms at the right pitch, a pulse width of 0.25 being high a quarter of the time, FM with a modulation index of 2 giving exactly the sideband amplitudes theory predicts (0.22 at the carrier, 0.58 at each first sideband), and a synced slave repeating with the master's period.

The triangle has no jump but a corner, whose harmonics fall off fast; correcting it is possible (PolyBLAMP) and unnecessary for most uses.

### FM: audio-rate frequency modulation

The **FM** input is an audio signal that is added to the frequency, in hertz, **every sample**: `step = (base + fm · amount) / sampleRate`. With a sine on *FM* and a sine on the carrier you get the classic bell and electric-piano sounds.

Two things matter for FM:

- It must be read **per sample**. If the pitch were read per block (as `base` is), the modulation would be sampled 1,500 times a second and anything above about 750 Hz would alias. This is why the pitch is block rate and FM is sample rate: the pitch moves slowly, the modulator does not.
- The frequency can go **below zero**. The phase then runs backwards (*through-zero FM*), which is musically interesting. For that reason the step is signed, the wrap code handles both directions, and the PolyBLEP corrections use `abs(step)` for their width and the sign for their direction: a saw running backwards has its jump with the opposite sign.

The FM amount is a `skew` knob: most of its travel is below 300 Hz, where the useful settings are, with the rest reaching 5 kHz.

### Hard sync

`@on("sync", { rising: 0.5 })` runs at the sample where the *Sync* input rises through 0.5 and restarts the phase at 0. Feeding it the **sync output of another oscillator** (the *master*) makes the *slave* restart with the master's period, while the slave's own pitch sets how much of its waveform fits in that period. Sweeping the slave's pitch with the master fixed gives the classic sync sweep.

The *Sync out* output is a short trigger pulse (8 samples) each time the phase wraps, so a master is just another copy of this module with its *Sync out* cabled to the slave's *Sync*.

Because the restart is a jump, hard sync has the same aliasing problem as a saw. This version does not correct it: the first sample after the restart is a discontinuity. A better one adds a PolyBLEP-style correction of the size of the jump at the restart; that is a good extension.

### The pulse width

The pulse width knob is smoothed (`pulseWidth.next()` once per sample): a stepped width is a click, and an automated width (PWM) from a slow control signal sounds smoother. Its value is only used by the square.

## Try it

1. Compile it, cable *Pitch* from a **Keyboard** and *Out* to the speakers. Change the *Waveform*.
2. Put a second **Oscillator** (this module, added twice) as the modulator, cable its *Out* into the first one's *FM*, and raise *FM amount*.
3. For sync, cable the master's *Sync out* into the slave's *Sync*, set the master to a low note and sweep the slave's *Semitones*.

## Ideas to extend it

- **Detune and unison:** several phases at slightly different frequencies, summed. A `StaticArray<f64>` of phases and a loop with a constant bound.
- **A PolyBLAMP triangle**, or **a wavetable** read at the phase, with the table switched by frequency to avoid aliasing.
- **Corrected sync**, as described above.
- **A phase modulation input** (add the input to the phase instead of the frequency), as in DX-style synths; it is the same line in `sample()`.
