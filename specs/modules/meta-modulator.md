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

The internal oscillator reuses the Oscillator's core (`dsp::OscCore`:
band-limited saw and square, the same *Shape* morph, hard sync). Its frequency is
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
through a limit that leaves ±1 untouched and bends smoothly towards ±4 above
it (`sign(x)·(1 + 3·tanh((|x| − 1)/3))`), so the polynomial algorithms can't
explode on hot input while full-scale signals stay undistorted (a gentler
`x / (1 + |x|/4)` would already bend a full-scale sine, and Chebyshev would
no longer turn it into a clean harmonic).

### 4.2 Algorithms

`a` is the carrier, `b` the modulator, `t` the Timbre (0…1). Every algorithm's
output is level-matched by a measured gain so that two full-scale sines
(440 Hz carrier, 110 Hz modulator) at Timbre 50 % give the same RMS (within
±0.2 dB) at every integer position. The vocoder can't be matched with two
sines (they share no band); it is matched with a noise carrier and a buzzing,
amplitude-modulated modulator.

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

**Analog ring.** `D(v)` is a smooth diode-pair curve, even in `v`: 0 below a
threshold `vb` = 0.02, quadratic up to `vl` = 0.4, linear (slope 1) above it,
and the ring is `D(a + b) − D(a − b)`. Being even, matched pairs cancel the
carrier and the modulator completely. Timbre raises the mismatch between the
two halves (the second branch uses `vb · (1 + 0.6t)`) and adds `0.15t · a` of
carrier leakage. At Timbre 0 the result is close to `a · b` with soft
saturation at high levels; with *Carrier Level* above 100 % it distorts like a
real ring.

**Bitwise.** `q(x) = floor(x · 2^(bits−1))` maps ±1 to a signed integer of
*bits* bits (16 → 2, `round(16 · 8^−t)`), the operation is applied to the
two's-complement values, and the result `r / 2^(bits−1)` is mapped back. *Sum mod* is wrap-around integer
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
  band-passes each, `dsp::Svf`, Q 4, unity gain at the centre), each into a
  peak follower (`dsp::EnvelopeFollower`, 2 ms attack, 40 ms release).
- **Synthesis:** the carrier through 12 band-passes of the same shape, at the
  band frequencies × the formant shift (retuned at most every 16 samples),
  each **levelled by its own follower** (`band / (follower + 0.01)`, same
  times) and multiplied by the modulator's envelope. Levelling makes the
  carrier's spectrum irrelevant (only where it has energy matters), keeps the
  output proportional to the modulator, and avoids the 30 dB level spread a
  plain product has between noise and sine carriers.
- An unvoiced helper: the modulator's energy above 8 kHz (a 2-pole high-pass)
  is added straight through at −6 dB, so consonants stay intelligible.
- The sum passes the input limit (identity within ±1) after its level gain.
- The vocoder runs at the base rate (it is linear in the carrier) and is
  delayed like the dry signal (4.4).

For a deeper vocoder with per-band levels and envelope outputs, see the
Filter Bank (`filter-bank.md`); this one is the one-knob version.

### 4.4 Anti-aliasing

Fold, both rings, Bitwise, Comparator and Chebyshev create frequencies far
above the inputs'. At *Standard* and *High* the whole algorithm stage runs
at 2× or 4× the sample rate:

- **Up:** the two inputs are upsampled with the 95-tap linear-phase
  half-band FIR of `dsp/Oversampler.h`, run in polyphase form (48
  multiply-adds per 2× step; latency 47 base samples at 2×, 70.5 at 4×). The
  same filter is used for both inputs, so their phase relation is kept.
- **Algorithm** at the high rate. Fold additionally uses first-order
  antiderivative anti-aliasing (ADAA): the antiderivative of `sin` is
  `−cos`, so `y = (F(u_n) − F(u_(n−1))) / (u_n − u_(n−1))`, falling back to
  the direct value when the difference is tiny.
- **Down** with the same half-band filter.

The vocoder and Crossfade are linear and don't need it: they run at the base
rate and, like the dry signal for *Mix*, go through a delay of the same
latency (4-point Lagrange for the half sample at 4×), so their output lines
up in phase with their neighbours while morphing. Of the stateful parts, the
vocoder keeps running 50 ms after its weight falls to zero; the fold's ADAA
holds one sample and simply restarts. *Eco* skips oversampling (useful in big
Voice Cells); a quality change resets only the oversampling filters.

Measured (Fold of a 5 kHz sine at Timbre 100 %, strongest alias): Eco
−13 dB, Standard −47 dB, High −100 dB.

### 4.5 Edge cases

- **DC:** the output passes a 5 Hz DC blocker (Comparator, Bitwise and
  analog-ring imbalance produce DC), then a limit that is the identity within
  ±2 and bends into ±4 (a ring of two hot inputs would reach ±16 otherwise).
- **Silence:** when both effective inputs are below −120 dB for longer than
  the oversampling pipeline (256 samples), the oversampled algorithm stage and
  the vocoder are skipped (the output then only carries what the delays still
  hold).
- **NaN or infinite input** is replaced by 0 before the soft limit.
- **Algorithm at audio rate:** allowed; the crossfade weights are computed per
  sample at the oversampled rate (linear interpolation of the knob value).

### 4.6 CPU

Target at 48 kHz, *Standard*: under 1 % of one core for any single
algorithm, vocoder included. Measured (one core, mono carrier): Standard ring
0.55 %, vocoder 0.6 %, vocoder↔Chebyshev morph 0.9 % (stereo 0.8 / 0.8 /
1.4 %); High ring 0.9 %, morph 1.3 % (stereo 1.9 %); Eco 0.4–0.75 %. The
module harness (random settings, stereo) measures about 3 %.

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
- A line under the scope says what the carrier and the modulator are
  (input, *Osc* or silent; live values `carrierIsOsc`, `modulatorSource`).

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
   half-band FIR up/down, fixed-size state, no allocation (exists). Meta Mod
   uses its taps in polyphase form (`metamod::Halfband` in `MetaModDsp.h`,
   the same class as the Folder's `HalfbandPoly`), about 4× cheaper than
   running the full FIR on every zero-stuffed sample; Oversampler.h could
   adopt it, and then both modules would drop their copy.
2. **Sharing the oscillator core:** `patch/common/dsp/OscCore.h` (exists).
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
    such that `n = 3` gives the 3rd harmonic as the strongest partial (the
    others 40 dB below).
  - Bitwise XOR of a signal with itself is 0; 2-bit resolution yields at most 4
    output levels.
  - Comparator at Timbre 0 is a ±1 square at the carrier/modulator crossings.
  - Vocoder: a noise carrier and a modulator sine at 1 kHz produce most energy
    in the band around 1 kHz.
- Morphing: at Algorithm 2.5 the output equals the average of algorithms 2 and
  3 computed separately (within float tolerance).
- Level matching: RMS at every integer position within ±2 dB of algorithm 0 (the vocoder with a noise carrier and a buzzing modulator).
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
