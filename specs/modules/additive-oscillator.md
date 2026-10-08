# Additive Osc

Type id `additive-osc` · category *Sources* · colour proposal `#a3e635`

## 1. Purpose

An additive oscillator: up to 64 sine partials, each with its own frequency
and level, shaped by a handful of spectral knobs instead of 64 sliders.
*Tilt* darkens or brightens, *Odd/Even* moves between hollow and full,
*Stretch* and *Shift* bend the harmonic series into bells and metal, *Comb*
carves moving notches, *Chorus* detunes the partials against each other. A
drawn spectrum can replace the built-in ones. Because partials above Nyquist
are simply dropped, the module never aliases, at any pitch or setting.

It covers sounds a filter can't reach (inharmonic spectra, notch patterns
that move independently of pitch) and pairs well with a VCA and an ADSR, or
with its own per-partial decay for struck sounds.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct of the fundamental (0.0 = C4). Read per sample. |
| Trigger | `trigger` | Restarts the partial phases (per *Phases*) and, with *Decay* < max, strikes the per-partial decay (4.6). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | All partials; spread across the stereo field by *Width* (4.7). |
| Odd | `audio` | Odd partials only (1, 3, 5 …), mono. |
| Even | `audio` | Even partials only (2, 4, 6 …), mono. *Odd* + *Even* = mono sum of *Out*. |
| Fundamental | `audio` | Partial 1 alone, at its level: a clean sine for sub-bass or sync. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Octave | −4…+4 (stepped) | 0 | Whole octaves. |
| Coarse | −12…+12 st | 0 | Semitones. |
| Fine | −100…+100 ct | 0 | Cents. |
| Partials | 1–64 (continuous) | 32 | How many partials sound; the last one fades in fractionally, so modulating it is smooth. |
| Tilt | −24…+12 dB/oct | 0 | Slope applied on top of the base spectrum. |
| Odd/Even | −1…+1 | 0 | −1 odd only, 0 both equal, +1 even only (the fundamental is always kept). |
| Stretch | −1…+1 | 0 | Inharmonicity: partials spread apart (+) or squeeze together (−) (4.3). |
| Shift | −1…+1 | 0 | Adds the same frequency to every partial, ±1 × f0 (4.3). |
| Comb | 0–100 % | 0 % | Depth of periodic notches in the spectrum. |
| Comb Spacing | 2–16 partials | 4 | Distance between notches, in partial numbers (continuous). |
| Comb Phase | 0–100 % | 0 % | Moves the notches along the spectrum; wraps, so an LFO sweeps them endlessly. |
| Chorus | 0–50 ct | 0 | Seeded per-partial detune depth (4.4). |
| Chorus Rate | 0.01–5 Hz | 0.3 Hz | Speed at which each partial's detune wanders. |
| Width | 0–100 % | 0 % | Stereo spread of the partials. |
| Decay | 10 ms – 20 s, ∞ | ∞ | Decay time of the fundamental after a trigger; ∞ = sustained. |
| Damp | 0–100 % | 50 % | How much faster high partials decay than low ones. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Base | Saw (1/n), Square (odd 1/n), Flat, Drawn | Saw |
| Phases | Aligned, Random | Random |
| Normalise | On, Off | On |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Pitch

`f0 = 261.63 Hz × 2^(Octave + Coarse/12 + Fine/1200 + Pitch)`, clamped to
1 Hz…20 kHz. Partial `n` (1-based) runs at `fn = f0 × rn + shift`, where `rn`
is the partial's ratio (4.3).

### 4.2 Amplitudes

For partial `n` the level is the product of:

1. **Base:** Saw `1/n`; Square `1/n` for odd `n`, 0 for even; Flat `1/√n`
   (keeps the energy per octave even); Drawn: the user's bar (5.).
2. **Tilt:** `10^(Tilt × log2(n) / 20)` — dB per octave of partial number.
3. **Odd/Even:** even partials × `clamp(1 + OE, 0, 1)`, odd partials (n > 1)
   × `clamp(1 − OE, 0, 1)`.
4. **Count:** 1 for `n ≤ floor(Partials)`, the fractional part for the next
   one, 0 above.
5. **Comb:** `1 − Comb × ½(1 + cos(2π (n / Spacing + CombPhase)))`. At
   *Comb* 100 % each notch silences the partial at its centre.
6. **Band limit:** 1 below 0.40 × fs, a raised-cosine fade to 0 at 0.45 × fs,
   then the partial is skipped entirely (no CPU).

Each partial's level is smoothed with a 2 ms one-pole, so every knob above
can be modulated at audio-ish rates without zipper noise.

**Normalise On** divides by `√(Σ an²)` (smoothed over 20 ms) and scales to
an RMS of 0.3, so *Partials*, *Tilt* and *Comb* change the colour, not the
loudness. Off keeps the raw sum (a saw at 64 partials peaks near ±1.1; the
output is soft-clipped at ±1.5 only as a safety net).

### 4.3 Frequencies: Stretch and Shift

- **Stretch** `s`: `rn = n × (1 + B n²)^½` with `B = 0.0005 × s × |s|` for
  `s ≥ 0` (string-like stiffness: upper partials go sharp), and
  `rn = n^(1 + 0.3 s)` for `s < 0` (compressed, darker, bell-like when
  extreme). The fundamental always stays at `f0`, so the note stays in tune.
- **Shift** adds `Shift × f0` Hz to every partial: the series becomes
  inharmonic while the spacing stays; a partial pushed to or below 0 Hz
  fades out over its last 20 Hz instead of reflecting.

Partials whose final frequency exceeds the band limit are dropped (4.2 step
6) every sub-block, so stretched spectra stay alias-free.

### 4.4 Chorus

Each partial gets its own detune `dn(t)` in cents: a smoothed random walk
from `hash(Seed, n, voice index)` at *Chorus Rate*, scaled by *Chorus*.
The fundamental gets half the depth. The result is the thick, shimmering
ensemble sound of many slightly detuned sines, with no beating pattern that
repeats. The walks reset to their seeded start at transport start, so
renders repeat.

### 4.5 Phases

*Random* starts each partial at a seeded phase: low crest factor, no
"buzzy" peak at the cycle start. *Aligned* starts all at 0 (sine phase): the
sharp, pulse-like waveform of a true saw. A *Trigger* resets the phases to
their start values (aligned or the seeded random set) at the trigger's sample.

### 4.6 Per-partial decay

With *Decay* below its maximum, a *Trigger* starts an envelope per partial:
level × `exp(−t / τn)` with `τn = Decay / 6.9 × n^(−2 × Damp)`. *Damp* 0 %
decays all partials together; 100 % lets partial 10 die 100× faster than the
fundamental — a plucked or struck tone. Without triggers (or *Decay* ∞) the
sound sustains. The envelope adds to the ringing on retrigger (level jumps
back to 1 from where it is), no click.

### 4.7 Stereo

With *Width* `w`, partial `n` is panned with constant power to
`±w × (0.3 + 0.7 × min(n / 16, 1))`, alternating sides (odd left, even
right). The fundamental stays centred. The mono sum equals the *Width* 0 %
sound within ±1.5 dB.

### 4.8 DSP and CPU

- Phase accumulators per partial (float32 per lane, re-wrapped each sample),
  sine by a 5th-order odd polynomial on the wrapped phase (error < −100 dB),
  processed 8 partials at a time with SIMD.
- Per sample: the fundamental increment from *Pitch*; per sub-block (32
  samples): ratios, shift, chorus and band-limit are recomputed, and each
  partial's increment is `inc0 × rn + shift/fs`. Audio-rate *Pitch* FM is
  therefore exact for harmonic spectra, and the ratio-dependent parts follow
  within one sub-block.
- Skipped partials cost nothing; at C6 and above, few partials remain.
- Target: 64 partials at C2 ≤ 2.5 % of one core per voice at 48 kHz;
  16 partials ≤ 0.8 %. The view warns when a Voice Cell has more than 8
  voices at 64 partials.

### 4.9 Transport

Free-running. At transport start the chorus walks and the random phases are
reset to their seeded state.

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │  Spectrum   ▇▅▄▃▃▂▂▂▁▁ ▁ ▁▁ ▁ …   (64 bars, log-pitch x-axis)  │
 │  ‾‾‾‾‾‾‾‾‾  comb notches ∪  ∪  ∪   Nyquist ┆                    │
 │  [Base: Saw ▾]  [Draw]  [Phases ▾]  [Normalise ✓]  Seed 1     │
 │  Oct Coarse Fine │ Partials Tilt Odd/Even │ Stretch Shift      │
 │  Comb Spacing Phase │ Chorus Rate Width │ Decay Damp           │
 └───────────────────────────────────────────────────────────────┘
```

- **Spectrum:** the final level of each partial, at its real frequency
  (log x-axis), drawn from the modulated values, with the band limit marked.
  Dropped partials are hidden.
- **Draw mode:** with *Base* = *Drawn*, drag across the bars to paint the
  64 levels (Shift: fine, relative). Double-click a bar: reset to 1/n. Menu:
  *Copy from Saw / Square / Flat*, *Smooth*, *Randomize* (UI random). A drag
  is one undo step (`beginGesture`).
- Width 600 px.

## 6. Saved state

Knob and setting values, plus the drawn spectrum when used:

```json
{
  "type": "additive-osc",
  "params": { "partials": 0.4921, "tilt": 0.6667, "base": 1.0, … },
  "data": { "drawn": [1.0, 0.5, 0.333, …64 values 0…1…] }
}
```

Missing or short `drawn` arrays are padded with `1/n`; values are clamped
to 0…1. A new module has no `data`; it is created when *Drawn* is first
edited.

## 7. Engine requirements

1. `patch/common/dsp/Partials.h`: the SIMD partial bank (phases, polynomial
   sine, band limit, smoothing), shared with the Macro Osc's *Harmonic* model
   and the Swarm.
2. **Node data** (exists): `sanitiseData` pads/clamps `drawn`; `setData`
   hands the 64 levels to the audio thread like the Step Sequencer's steps.
3. **Live values:** the final partial levels (64 floats, decimated to 30 Hz)
   for the spectrum view.
4. Inside Voice Cells: per voice; the chorus differs per voice via the voice
   index.

## 8. Tests

- Pitch: partial 1 at 261.63 Hz ±0.1 cent; partial n at n × f0 when Stretch and Shift are 0.
- Band limit: for f0 = 2 kHz at 48 kHz, no energy above 0.45 × fs; sweeping f0 across a partial's cutoff never jumps more than 0.01 between samples.
- Base Saw, 64 partials, Aligned, Normalise Off, at a low pitch matches a reference band-limited saw to −50 dB.
- Odd/Even −1 removes even partials (< −90 dB); +1 removes odd partials above the fundamental; *Odd* + *Even* outputs sum to the mono *Out*.
- Comb 100 %: the partial at each notch centre is below −90 dB; moving *Comb Phase* by 1/Spacing shifts the notches by one partial.
- Normalise On: RMS stays within ±1 dB while *Partials* sweeps 4→64 and *Tilt* sweeps its range.
- Stretch keeps partial 1 at f0; positive stretch raises partial 20 by the formula's amount (±1 cent).
- Decay: after a trigger, partial 1 falls by 60 dB in *Decay* (±5 %); Damp 0 % keeps all partials' ratios constant over time.
- Determinism: same Seed → identical renders, including Chorus and Random phases.
- Drawn data round-trips; short arrays load safely; demo types file includes the module.

## 9. Later

- Two spectra (A and B) with a *Morph* knob between them.
- Resynthesis: analyse a dropped audio file into a drawn spectrum.
- Per-partial pitch/level from a *Notes* stream (each held note adds a partial).
- More than 64 partials for very low notes (e.g. 256 at C1) with a CPU budget control.
