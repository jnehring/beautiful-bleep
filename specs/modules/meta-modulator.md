# Meta Mod

Type id `meta-mod` · category *Audio* · colour proposal `#84cc16`

## 1. Purpose

Combines two audio signals, a *Carrier* and a *Modulator*, into one. A single
**Algorithm** knob sweeps continuously through eight ways of combining them,
from a plain crossfade over wavefolding and ring modulation to a band-split
vocoder, and a **Timbre** knob changes the character of whichever algorithm is
selected. An internal oscillator stands in for an unpatched input, so the
module is a complete sound source on its own and a ring modulator or vocoder
for any track with one cable.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Carrier L | `audio` | The carrier. Unpatched: the internal oscillator (see 4.1). |
| Carrier R | `audio` | Right carrier. Unpatched: *Carrier L* feeds both channels. Patched: the module runs in stereo. |
| Modulator | `audio` | The modulator, mono, shared by both channels. Unpatched while the carrier is patched: the internal oscillator. |
| Pitch | `pitch` | 1 V/oct for the internal oscillator, added to *Osc Tune* and *Osc Octave* (0.0 = C4). |
| Sync | `trigger` | Restarts the internal oscillator's cycle (hard sync, as on the Oscillator). |

Every knob is also an input (`specs.md` section 7.3). Cables onto *Algorithm*
and *Timbre* are evaluated per sample, so audio-rate modulation of the
algorithm itself works (and is a sound of its own).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L | `audio` | The combined signal, after *Mix*. |
| Out R | `audio` | Right channel; equals *Out L* when the module runs mono. |
| Osc | `audio` | The internal oscillator, whatever it is used for. Lets the module double as a plain oscillator. |
| Env | `control` (unipolar) | Envelope follower on the modulator (5 ms attack, 120 ms release, the same follower as the Filter's *Env*). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Algorithm | 0–7 (continuous) | 2 (analog ring) | Selects and morphs between the algorithms of 4.2. Between two integers the neighbours crossfade. |
| Timbre | 0–100 % | 50 % | Per-algorithm character (table in 4.2). |
| Carrier Level | 0–200 % (−∞…+6 dB) | 100 % | Gain into the algorithm. Above 100 % the nonlinear algorithms are driven harder. |
| Mod Level | 0–200 % | 100 % | Gain of the modulator into the algorithm. |
| Osc Tune | −24…+24 semitones | 0 | Internal oscillator pitch offset. |
| Osc Shape | 0–100 % | 0 % (sine) | Sine → triangle → saw → square, as the Oscillator's *Shape*. |
| Mix | 0–100 % | 100 % | Dry carrier ↔ result. Dry is the carrier after *Carrier Level*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Osc Octave | −3…+3 | 0 |
| Quality | Eco (1×), Standard (2× oversampled), High (4× oversampled) | Standard |
| Bitwise Op | XOR, AND, OR, Sum mod | XOR |

## 4. Behaviour

### 4.1 Inputs and the internal oscillator

The internal oscillator reuses the Oscillator's core (`OscillatorDsp`:
band-limited saw and square, the same *Shape* morph). Its frequency is
`261.63 Hz × 2^(Osc Octave + Osc Tune/12 + Pitch)`.

It stands in for exactly one input, decided by `ctx.inputConnected`:

| Carrier patched | Modulator patched | Carrier is | Modulator is |
|---|---|---|---|
| no | no | oscillator | silence (0) |
| no | yes | oscillator | Modulator |
| yes | no | Carrier | oscillator |
| yes | yes | Carrier | Modulator |

So a synth voice needs only the *Modulator* cable (the oscillator is the
carrier and plays the notes), and processing a track needs only the *Carrier*
cable (the oscillator is a tunable sine modulator, i.e. a classic ring
modulator). With nothing patched, the module is an oscillator whose output
passes through the algorithm with a silent modulator: Fold and Chebyshev still
shape it, Crossfade at Timbre 0 passes it, and the multiplying algorithms are
silent. A change of the table's row ramps over 5 ms (`specs.md` section 7.7).

Audio is nominally ±1. Each input is scaled by its level knob, then passed
through `x / (1 + |x|/4)` (a gentle limit at about ±4) so the polynomial
algorithms can't explode on hot input.

### 4.2 Algorithms

`a` is the carrier, `b` the modulator, `t` the Timbre (0…1). Every algorithm's
output is level-matched so that two full-scale sines give roughly the same RMS
(within ±2 dB) at every integer position.

| # | Algorithm | Output | Timbre |
|---|---|---|---|
| 0 | Crossfade | equal-power: `a·cos(πt/2) + b·sin(πt/2)` | balance: 0 = carrier, 50 % = both at −3 dB, 100 % = modulator |
| 1 | Fold | `sin(π/2 · g · (a + b))`, `g = 1 + 7t` | fold depth: 1 (soft saturation) to 8 (dense folding) |
| 2 | Analog ring | diode-ring model: `D(a + b) − D(a − b)` (see below) | balance: 0 = matched diodes, clean product; 100 % = mismatched diodes, carrier bleed and odd harmonics |
| 3 | Digital ring | `a · (b + t) / (1 + t)` | 0 = pure product (ring mod), 100 % = amplitude modulation (carrier stays audible) |
| 4 | Bitwise | `Op(q(a), q(b))` on signed integers (see below) | resolution: 16 bits at 0 down to 2 bits at 100 % |
| 5 | Comparator | 0–50 %: `tanh(s · (a − b))`, `s` from 1000 (hard square) down to 4 (soft); 50–100 %: crossfade to `max(a, b)` | hardness, then the diode-maximum |
| 6 | Vocoder | the carrier's bands, each scaled by the modulator's band envelope (4.3) | formant shift: carrier bands ×2^(2t − 1), ±1 octave; 50 % = no shift |
| 7 | Chebyshev | `T_n(a)` with order `n = 1 + 15 · clamp(t + b/2, 0, 1)`, crossfading between neighbouring integer orders | base order; the modulator sweeps the order, so it adds harmonics at audio rate |

**Morphing.** For an *Algorithm* value `x`, `i = floor(x)` and `f = x − i`;
the output is `(1 − f)·A_i + f·A_(i+1)` (position 7 is the end). Only the two
neighbours are computed, so the cost depends on the two active algorithms, not
on all eight. Algorithms with state (the vocoder's filters, the
anti-aliasing filters of 4.4) keep running for 50 ms after their weight falls
to zero, so sweeping back and forth doesn't restart them from silence.

**Analog ring.** `D(v)` is a smooth diode curve: 0 below a threshold `vb`,
quadratic up to `vl`, linear above it. Timbre raises the mismatch between the
two halves (the second branch uses `vb · (1 + 0.6t)`) and adds `0.15t · a` of
carrier leakage. At Timbre 0 the result is close to `a · b` with soft
saturation at high levels; with *Carrier Level* above 100 % it distorts like a
real ring.

**Bitwise.** `q(x)` maps ±1 to a signed integer of *bits* bits (16 → 2,
exponential over Timbre), the operation is applied to the two's-complement
values, and the result is mapped back to ±1. *Sum mod* is wrap-around integer
addition. This algorithm is meant to sound digital; oversampling only keeps the
aliasing from folding back below the original band (4.4).

**Chebyshev.** `T_n(cos θ) = cos(nθ)`: a full-scale sine carrier turns into its
*n*-th harmonic. Polynomials are evaluated with the recurrence
`T_(k+1) = 2a·T_k − T_(k−1)` up to order 16. The carrier is clamped to ±1
first (after the soft limit), so the output stays bounded.

### 4.3 The vocoder

Band-split carrier/modulator vocoder with 12 bands, log-spaced from 100 Hz to
8 kHz (ratio about 1.49, a bit more than a fifth apart):

- **Analysis:** the modulator through 12 band-passes (two cascaded ZDF SVF
  band-passes each, `dsp::Svf`, Q 4), each into a peak follower
  (`dsp::EnvelopeFollower`, 2 ms attack, 40 ms release).
- **Synthesis:** the carrier through 12 band-passes of the same shape, at the
  band frequencies × the formant shift, each multiplied by its envelope.
- An unvoiced helper: the modulator's energy above 8 kHz (a 2-pole high-pass)
  is added straight through at −6 dB, so consonants stay intelligible.

For a deeper vocoder with per-band levels and envelope outputs, see the
Filter Bank (`filter-bank.md`); this one is the one-knob version.

### 4.4 Anti-aliasing

Fold, both rings, Bitwise, Comparator and Chebyshev create frequencies far
above the inputs'. At *Standard* and *High* the whole algorithm stage runs
at 2× or 4× the sample rate:

- **Up:** the two inputs are upsampled with a polyphase half-band IIR
  (two allpass branches, about 100 dB stopband at 4×, a few samples of
  frequency-dependent delay). The same filter is used for both inputs, so
  their phase relation is kept.
- **Algorithm** at the high rate. Fold additionally uses first-order
  antiderivative anti-aliasing (ADAA): the antiderivative of `sin` is
  `−cos`, so `y = (F(u_n) − F(u_(n−1))) / (u_n − u_(n−1))`, falling back to
  the direct value when the difference is tiny.
- **Down** with the same half-band filter.

The vocoder and Crossfade are linear and don't need it, but they run at the
same rate so their output lines up in phase with their neighbours while
morphing. *Eco* skips oversampling (useful in big Voice Cells); a 2× or 4×
setting change resets only the oversampling filters.

### 4.5 Edge cases

- **DC:** the output passes a 5 Hz DC blocker (Comparator, Bitwise and
  analog-ring imbalance produce DC).
- **Silence:** when both effective inputs are below −120 dB for one sub-block,
  the algorithm stage is skipped and the output is 0 (the filters still decay).
- **NaN or infinite input** is replaced by 0 before the soft limit.
- **Algorithm at audio rate:** allowed; the crossfade weights are computed per
  sample at the oversampled rate (linear interpolation of the knob value).

### 4.6 CPU

Measured target at 48 kHz, *Standard*: under 1 % of one core for any
single algorithm, vocoder included (48 SVF ticks per sample at 2×, stereo).
*High* roughly doubles it. Inside a Voice Cell with 8 voices, *Eco* is
recommended for the vocoder positions.

## 5. Module view

The usual knobs and settings, plus two displays above them:

```
 ┌───────────────────────────────────────────────────────────────┐
 │ Xfade  Fold  ARing  DRing  Bits  Comp  Vocod  Cheby           │
 │ ──────────────────▲─────────────────────────────────          │
 │ ┌─ scope ───────────────────────────────────────────────────┐ │
 │ │ carrier ~~~~   modulator ~~~~   out ~~~~                  │ │
 │ └───────────────────────────────────────────────────────────┘ │
 └───────────────────────────────────────────────────────────────┘
```

- **Algorithm strip:** the eight names; a marker follows the modulated
  *Algorithm* value, and the two active neighbours are highlighted with
  brightness ∝ their weight. Clicking a name sets the knob to that integer.
- **Scope:** carrier, modulator and output over the last 20 ms, triggered on
  the carrier's rising zero crossing, so stable tones stand still.
- **Vocoder bands:** when the vocoder has a weight above 0, the scope area
  shows 12 bars with the band envelopes instead.
- A small label under *Carrier L* / *Modulator* says *Osc* when the internal
  oscillator stands in.

## 6. Saved state

Only knob and setting values; no node data.

```json
{
  "type": "meta-mod",
  "params": { "algorithm": 0.2857, "timbre": 0.5, "carrierLevel": 0.5,
              "modLevel": 0.5, "oscTune": 0.5, "oscShape": 0.0, "mix": 1.0,
              "oscOctave": 0.5, "quality": 0.5, "bitwiseOp": 0.0 }
}
```

## 7. Engine requirements

1. **A shared oversampler** in `patch/common/dsp/Oversampler.h`: 2× and 4×
   polyphase half-band IIR up/down, fixed-size state, no allocation. Also used
   by the Freq Shifter's optional anti-alias path and available to future
   distortion modules.
2. **Sharing the oscillator core:** move the band-limited core out of
   `patch/modules/oscillator/dsp/OscillatorDsp.h` into `patch/common/dsp/` (or
   include it from there) so Meta Mod doesn't copy it.
3. `ctx.inputConnected` (exists) decides what the internal oscillator replaces.
4. **Inside Voice Cells:** works per voice like any module; nothing new.

## 8. Tests

- Each integer Algorithm with two sines (carrier 440 Hz, modulator 110 Hz):
  - Crossfade at Timbre 0 / 100 % passes the carrier / modulator exactly.
  - Digital ring at Timbre 0: energy at 330 and 550 Hz, carrier and modulator
    below −80 dB; at Timbre 100 % the carrier is present.
  - Analog ring at Timbre 0: carrier suppression better than 40 dB at
    moderate level; at 100 % less than 20 dB.
  - Chebyshev with a full-scale sine carrier and silent modulator: Timbre
    such that `n = 3` gives the 3rd harmonic as the strongest partial.
  - Bitwise XOR of a signal with itself is 0; 2-bit resolution yields at most 4
    output levels.
  - Comparator at Timbre 0 is a ±1 square at the carrier/modulator crossings.
  - Vocoder: a noise carrier and a modulator sine at 1 kHz produce most energy
    in the band around 1 kHz.
- Morphing: at Algorithm 2.5 the output equals the average of algorithms 2 and
  3 computed separately (within float tolerance).
- Level matching: RMS at every integer position within ±2 dB of algorithm 0.
- Aliasing: Fold of a 5 kHz sine at Timbre 100 %, *High*: aliased components
  below −60 dB relative to the fundamental; *Eco* is measurably worse (the test
  documents the difference).
- Fallback table of 4.1 for all four patch states; switching ramps without a
  click (no sample step above 0.05).
- Bounded output: random signals and random knob values at audio rate never
  exceed ±4 and never produce NaN.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A second Timbre dimension (an XY pad: Timbre × Algorithm) with stored
  snapshots.
- User-reorderable algorithm list, or more algorithms (phase modulation,
  spectral cross-synthesis via FFT).
- Stereo modulator input and a stereo spread of the algorithm position
  (left and right at slightly different Algorithm values).
- Vocoder band count (8/12/16/24) and a freeze button that holds the band
  envelopes.
