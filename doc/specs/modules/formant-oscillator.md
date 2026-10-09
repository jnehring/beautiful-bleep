# Formant Osc

Type id `formant-osc` · category *Sources* · colour proposal `#e879f9`

## 1. Purpose

A pulse-formant oscillator: each cycle of a fundamental pitch fires one short
burst of a second, higher oscillation, the *formant*. The fundamental sets
the note; the formant sets a resonant peak in the spectrum, like the mouth
shape of a voice or the body of an instrument. Sweeping the formant gives
vocal, filter-like sweeps with no filter in the patch; narrowing the bursts
makes the sound brighter and buzzier. It pairs with the Function or an ADSR
on *Formant* for talking, wah-like envelopes.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct of the fundamental (0.0 = C4). |
| Formant CV | `pitch` | Moves the formant in octaves (1.0 = one octave), added to *Formant*. |
| Formant FM | `audio` | Linear, through-zero FM of the formant frequency, scaled by *FM Depth*. |
| Sync | `trigger` | Restarts the fundamental cycle (and with it a new burst). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | Square (at half level) and formant mixed by *Body*. R uses the second formant (4.5); with *Spread* 0 L = R. |
| Formant | `audio` | The burst train alone (mono, first formant). |
| Square | `audio` | A band-limited square at the fundamental, in phase with the bursts. |
| Sub | `audio` | Square one octave below. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Octave | −4…+4 (stepped) | 0 | Whole octaves of the fundamental. |
| Coarse | −12…+12 st | 0 | Semitones. |
| Fine | −100…+100 ct | 0 | Cents. |
| Formant | −6…+6 oct (bipolar, through zero) | +2 oct | Formant frequency relative to the fundamental (*Ratio* tracking) or to 261.63 Hz (*Fixed*), see 4.2. |
| Narrow | 0–100 % | 30 % | Shortens each burst and sharpens its window: brighter, buzzier, wider formant peak. |
| Body | 0–100 % | 70 % | Mix at *Out*: 0 % square only, 100 % formant only. |
| Reset | 0–100 % | 100 % | How strongly each fundamental cycle resets the formant phase (4.3). |
| Roll | 0–100 % | 0 % | Moves the burst's position inside the cycle; wraps around (4.4). |
| Spread | −1…+1 oct | 0 | Second formant (R channel) offset from the first. |
| FM Depth | 0–100 % | 0 % | Depth of *Formant FM*; 100 % = ±4× the formant frequency. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Tracking | Ratio, Fixed | Ratio |
| Start | Sine (0°), Cosine (90°) | Cosine |
| Quality | Normal (1×), High (2×) | Normal |

## 4. Behaviour

### 4.1 Fundamental

`f0 = 261.63 Hz × 2^(Octave + Coarse/12 + Fine/1200 + Pitch)`. A double
precision phase `φ ∈ [0, 1)` runs at `f0`. *Square* is a polyBLEP square from
φ, *Sub* flips at every wrap. A rising edge at *Sync* resets φ (and the
formant phase by the *Reset* rule) at its sample; the old cycle crossfades
into the restarted one over 0.25 ms, so square, sub and a burst cut mid-way
never click.

### 4.2 The formant

The formant frequency:

- *Ratio:* `ff = f0 × s(F)` with `s(F) = sign(F) × 2^|F|` for `|F| ≥ 0.1`,
  blended linearly to 0 between −0.1 and +0.1 oct, so the knob passes
  **through zero** smoothly (F = 0 is a 0 Hz formant, F = +1 is twice the
  fundamental). The formant tracks the note: same timbre on every key.
- *Fixed:* the same with 261.63 Hz in place of `f0`: the formant stays put while the pitch moves, like a vowel sung on different notes.

`Formant CV` scales by `2^CV` (adds octaves to |F|, and scales smoothly near
zero); *Formant FM* multiplies: `ff × (1 + 4 × FMDepth × fm)` (through zero).

Each fundamental cycle produces one burst:

    burst(φ) = w((φ − roll) mod 1) × sin(2π ψ + θ)

- `ψ` is the formant phase, advanced by `ff / fs` every sample (it can run
  backwards for negative `ff`).
- `θ` = 0 (*Sine* start) or π/2 (*Cosine* start). With *Cosine*, a formant
  at 0 Hz is the window itself: a smooth pulse train, so sweeping through
  zero goes formant → plain pulse → inverted formant without a gap.
- The window `w(u)` is a Hann-shaped pulse of length
  `L = 1 − 0.95 × Narrow` (a share of the cycle) and sharpness
  `p = 1 + 3 × Narrow`: `w(u) = sin²(π u / L)^p` for `u < L`, else 0.
  Shorter bursts contain fewer formant cycles: a wider peak and more
  brightness.

`dsp::FormantOsc` normalises the burst by the window's RMS (gain `g`, capped
at 4). The module scales it by `0.8 / √max(g, 1)`, so narrow bursts don't
peak far above 1: the peak stays ≤ 1.6 and the loudness falls by at most
about 6 dB from the widest to the narrowest window. *Body* mixes
`0.5 × Square` and the burst.

*Roll* and *Narrow* glide over 2 ms (one-pole), so jumping them (e.g. a fast
square LFO) doesn't click.

### 4.3 Reset

At each fundamental wrap, the formant phase becomes `ψ ← (1 − Reset) × ψ`
(fractional part). *Reset* 100 % is the strict pulse-formant: every burst
starts identically, the spectrum is purely harmonic and the formant is a
clean peak. Lower values let the formant drift against the fundamental:
inharmonic, ring-modulated and chorused colours. 0 % is a free-running
formant, gated by the window.

### 4.4 Roll

*Roll* shifts the window's start inside the cycle. Because the window is
read modulo 1, a burst that runs past the end of the cycle continues at the
start of the next one, so turning *Roll* never cuts a burst. Modulating
*Roll* with an LFO gives a phasing, Doppler-like movement of the formant
against the square, audible mainly when *Body* is around 50 %.

### 4.5 Second formant

The R channel computes a second burst with `ff × 2^Spread` sharing the
fundamental, window and roll. *Spread* 0 makes L = R; small values (±0.1 oct)
give width; larger values put two formant peaks, one in each ear. *Formant*
(the output) always carries the first formant.

### 4.6 Band-limiting

- The window is smooth (it and its first derivative reach 0 at both ends),
  so the bursts themselves need no BLEP while *Reset* is 100 %. With
  *Reset* < 100 % the phase jump at the wrap happens where the window is 0,
  so it's still click-free.
- When *Narrow* is near 100 % the window approaches an impulse of 5 % of
  the cycle; at high pitches that window has energy above Nyquist. The
  module therefore limits *Narrow* so the window stays at least 12 samples
  long at the burst generator's rate (4 samples aliased at −21 dB at C6, 8 at
  −44 dB, 12 meets −60 dB), and `FormantOsc` fades the formant down when
  `|ff| > 0.4 × fs`.
- *High* quality runs the burst generator at 2× with a half-band decimator,
  for bright patches above C6.

### 4.7 Edge cases and transport

- `|ff|` far below `f0` (e.g. −6 oct): less than one formant cycle per burst;
  the sound becomes a soft, pulsing tone (expected, not an error).
- `f0` is clamped to 0.5 Hz…0.45 × fs. Below ~20 Hz the module is a rhythmic
  burst generator: useful as a pinging modulation source.
- Transport is ignored: free-running.

### 4.8 CPU

One phase, one or two formant sines and one `pow` per sample (the window is
read from `dsp::FormantOsc`'s 1024-point `sin²` table). Measured at 48 kHz
(one core): 0.36 % Normal (target ≤ 0.6 %), 2.9 % High with all five outputs
patched: the High cost is the `Oversampler.h` decimators, one per patched
output.

## 5. Module view

```
 ┌───────────────────────────────────────────────────────┐
 │  ┌── one cycle ───────────────┐   ┌── spectrum ─────┐ │
 │  │ ▁▂▇█▇▂▁ ____________        │   │ │|||▌▌█▌|| ...  │ │
 │  │ window ∩, square ⌐¬         │   │  formant ▲ peak  │ │
 │  └─────────────────────────────┘   └──────────────────┘ │
 │  Octave  Coarse  Fine │ Formant  Narrow  Body           │
 │  Reset  Roll  Spread  FM Depth │ [Ratio▾] [Cos▾] [Normal▾]│
 └───────────────────────────────────────────────────────┘
```

- **Cycle view:** one fundamental cycle with the window outline, the burst
  inside it and the square behind it, computed in the view from the
  modulated values and the live values `f0`, `ff`, `ff2` (Hz).
- **Spectrum:** the first 64 harmonics of that cycle (a DFT in the view) as
  bars, with a marker at the formant frequency (and the second formant when
  *Spread* ≠ 0).
- Width 520 px (`ui/formant-osc.js`).

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "formant-osc",
  "params": { "formant": 0.6667, "narrow": 0.3, "body": 0.7, "reset": 1.0,
              "roll": 0.0, "spread": 0.5, "tracking": 0.0, "start": 1.0, … } }
```

## 7. Engine requirements

1. `patch/common/dsp/Formant.h`: the burst generator (`FormantOsc`: window
   table, phase handling, RMS gain), shared with the Macro Osc's *Grain* model.
2. `Oversampler.h` (shared with the other source modules).
3. Nothing else: a standard audio module. Inside Voice Cells it runs per voice.

## 8. Tests

- Pitch: fundamental at 0 V = 261.63 Hz ±0.1 cent; *Formant* output with *Reset* 100 % has energy only at multiples of f0 (harmonic), checked by FFT.
- Formant peak: the strongest harmonic is the one nearest `ff` (±1 harmonic) for F = +1, +2, +3 oct in Ratio mode; in Fixed mode the peak stays within ±1 harmonic of the fixed frequency across pitches C3–C5.
- Through zero: sweeping *Formant* from −1 to +1 oct produces no sample jump above 0.05 (Cosine start).
- Click-free: modulating *Roll*, *Narrow* and *Reset* with a fast square raises the largest sample step by less than 0.1 (at C2).
- Through zero is checked at C2 (largest step < 0.05).
- Aliasing: at C6 with *Narrow* 90 %, aliased energy stays below −60 dB (Normal) and −80 dB (High).
- *Spread* 0 gives L = R exactly; *Body* 0 % gives Out = 0.5 × Square; after a *Sync* (Reset 100 %) the output equals a freshly started oscillator.
- Saved params round-trip; demo types file includes the module.

## 9. Later

- Three formants with vowel presets and a vowel morph knob.
- A *Notes*-aware glide of the formant independent of the pitch glide.
- Window shapes beyond Hann (Gaussian, exponential decay, rectangular with BLEP).
- Formant burst triggered by an external trigger instead of the fundamental (pinged formants).
