# Freq Shifter

Type id `freq-shifter` · category *Audio* · colour proposal `#65a30d`

## 1. Purpose

Moves every frequency of a sound up or down by the same number of hertz. Unlike
a pitch shift, which keeps the ratios between partials, a frequency shift
breaks them: small shifts give slow phasing and beating, larger ones turn
harmonic sounds into bells, metal and detuned radio. With feedback the shifted
signal spirals up or down endlessly (the barber-pole effect). The shift can
lock to the song's tempo, run in opposite directions on the two channels, and
its quadrature oscillator is available as a two-phase LFO.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is unpatched. |
| In R | `audio` | Right input. |
| Reset | `trigger` | Sets the shift oscillator's phase to 0 (both channels). |

Every knob is also an input (`specs.md` section 7.3). *Shift* is linear in
hertz, so an audio cable on it is linear (through-zero) frequency modulation of
the shift.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | Dry/wet mix of the shifted signal (the *Up* sideband for the current Shift), stereo. |
| Up L, Up R | `audio` | Input shifted by +Shift (up for positive Shift, down for negative). Always 100 % wet. |
| Down L, Down R | `audio` | Input shifted by −Shift: the mirror sideband. |
| Sin, Cos | `control` (bipolar) | The left channel's shift oscillator, in quadrature. At sub-audio shifts, a two-phase LFO; at audio shifts, two sines 90° apart. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Shift | −Range…+Range Hz (linear) | 0 Hz | Amount of shift. |
| Fine | −10…+10 Hz (linear) | 0 Hz | Added to *Shift*; for slow phasing at wide *Range*. |
| Feedback | −100…+100 % | 0 % | Amount of the wet signal fed back into the input. Negative inverts it. |
| FB Delay | 0–1000 ms (exponential, 0 at the bottom) | 0 ms | Delay in the feedback loop. 0 = one sample (dense spirals), longer = echoes that each step further up or down. |
| Spread | 0–100 % | 0 % | Moves the right channel's shift from the same as the left (0 %) to the opposite (100 %). |
| Mix | 0–100 % | 100 % | Dry ↔ wet for *Out*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Range | ±10 Hz, ±200 Hz, ±2 kHz, ±10 kHz | ±200 Hz |
| Sync | Free, 1/16 … 8 bars (as the LFO's Sync list) | Free |
| Anti-alias | Off, On | On |

## 4. Behaviour

### 4.1 Signal path

Per channel, per sample:

```
 in ─► DC block (10 Hz) ─► (+ feedback) ─► soft limit ─► Hilbert ─► I, Q
                                                                    │
     cos φ, sin φ ◄── quadrature oscillator (phase φ) ───────────────┤
                                                                    ▼
                             Up   = I·cos φ − Q·sin φ
                             Down = I·cos φ + Q·sin φ
```

- **Hilbert transform:** two parallel chains of 8 first-order allpass
  sections each; the outputs differ by 90° ±0.2° from 15 Hz to `0.45 · fs`
  (the standard elliptic-function design for allpass phase-difference
  networks). The coefficients are computed in `prepare()` for the actual
  sample rate, never at run time. `I` and `Q` have the same delay, so the
  shifted outputs are phase-coherent with each other but not with the dry
  input (a few samples, frequency-dependent: *Mix* at 50 % gives phasing on
  its own, which is part of the sound).
- **Quadrature oscillator:** a double-precision phase accumulator,
  `φ += 2π · f / fs`, with `f = Shift + Fine` (Free) or the synced rate
  (4.2). Negative `f` runs the phase backwards, so the shift passes through
  zero smoothly. Sine and cosine come from a 4096-point table with linear
  interpolation (error below −110 dB, cheaper than `std::sin`).
- **Sideband suppression:** about 45 dB across 30 Hz–15 kHz at 48 kHz.
  Below 15 Hz both sidebands leak through (the Hilbert network can't reach
  0 Hz); the DC blocker removes what would otherwise become a tone at the
  shift frequency.

### 4.2 Tempo sync

With *Sync* set, the shift frequency is `1 / (cycle length in seconds)`, signed
by *Shift*'s sign (*Shift* ≥ 0 shifts up), and *Fine* is ignored. With the
transport playing, the oscillator phase is derived from the song position,
`φ = 2π · frac(ppq / cycleBeats)`, exactly like the LFO (`lfo.md` section 4.1),
so a barber-pole phaser turns once per bar and lands in the same place after a
loop jump. Stopped: runs free at the synced rate. Sync is useful only for small
shifts; the longest synced cycle (8 bars) is a fraction of a hertz.

### 4.3 Feedback

The fed-back signal is the wet *Up* signal of the same channel, delayed by
*FB Delay* (one sample at 0; a fractional, linearly interpolated delay line of
up to 1 s otherwise), times *Feedback*. Before the Hilbert network the sum
passes `tanh`, so feedback at ±100 % is loud but bounded.

- **0 ms, small shift (0.1–2 Hz):** the barber-pole phaser: a comb of notches
  that moves endlessly up (positive) or down (negative).
- **50–500 ms:** each echo is shifted further: rising or falling spirals.
  With a synced delay value (e.g. 1/8 note at the current tempo; see Later)
  this becomes a rhythmic effect.
- The feedback path has its own DC blocker, so a shifted DC offset can't
  build up.

The feedback is internal and sample-accurate; it does not use the board's
feedback cables (`specs.md` section 7.5).

### 4.4 Stereo

The right channel uses its own oscillator with frequency
`f_R = f_L · (1 − 2 · Spread)`: equal at 0 %, stopped at 50 %, opposite at
100 %. With a mono input and Spread at 100 %, a 0.3 Hz shift rotates the
phasing in opposite directions in the two ears. Both oscillators start at the
same phase on *Reset* and on transport start (synced).

### 4.5 Anti-aliasing

Shifting up can push content past Nyquist, where it folds back as inharmonic
noise. With *Anti-alias* on, the input passes a 4-pole ZDF low-pass (two
`dsp::Svf` at Butterworth Q) at `0.45 · fs − |f|` (never below 1 kHz) before the Hilbert network. This removes only what would alias in the
*Up* output; the *Down* output loses the same top end. Content shifted below
0 Hz is not aliasing: it reflects back as positive frequencies with inverted
phase motion (through-zero shifting), which is kept as a musical effect.

### 4.6 Edge cases

- **Shift = 0:** Up and Down equal the input (delayed by the Hilbert network).
- **Range change** keeps the knob's normalised position, so the shift jumps;
  this is a setting change (not modulatable), same as other ranges.
- **Reset** jumps the oscillator phase; the outputs ramp over 2 ms to hide the
  phase step.
- **Silence and denormals:** the allpass states are flushed to zero below
  1e−20.

### 4.7 CPU

Per channel: 16 first-order allpasses, one table lookup, two multiplies per
sideband, optional 4-pole low-pass. About a tenth of a Filter module's ladder
types; stereo with feedback delay is still well under 0.5 % of a core at 48
kHz. The 1 s delay line costs 192 KB per channel at 48 kHz (float) and is
allocated in `prepare()`.

## 5. Module view

The usual knobs and settings, plus:

- **Spectrum strip:** a 4096-point FFT of the input (grey) and *Out* (colour)
  on a log axis, updated at 15 Hz from the module's live values, so the shift
  is visible as a translation.
- **Phase dial:** two dots circling (left and right oscillator) at the actual
  shift rate; at sub-hertz shifts you see the phaser's direction.
- *Shift* shows its value in Hz with one decimal below 10 Hz, and the synced
  note value when *Sync* is on.

## 6. Saved state

Only knob and setting values; no node data. The oscillator phase is not saved
(Reset or transport sync recovers it).

```json
{
  "type": "freq-shifter",
  "params": { "shift": 0.5, "fine": 0.5, "feedback": 0.5, "fbDelay": 0.0,
              "spread": 0.0, "mix": 1.0, "range": 0.3333, "sync": 0.0,
              "antiAlias": 1.0 }
}
```

`shift` 0.5 is 0 Hz (bipolar knob).

## 7. Engine requirements

1. **Hilbert pair** in `patch/common/dsp/Hilbert.h`: coefficient design for a
   given sample rate, order and band, plus the two-chain processor. Unit-tested
   on its own; reusable by future modules (envelope detection, a phase-shift
   stereo widener).
2. **Tempo sync** via `ctx.ppqAt` and `patch/common/dsp/Tempo.h` (exists).
3. **Live values:** `Module::liveValues` adds `phaseL`, `phaseR` and a
   downsampled spectrum handle for the view (the spectrum is computed on the
   message thread from a lock-free ring buffer of output samples; this ring is
   a small new engine helper shared with future scope views).
4. **Inside Voice Cells:** works per voice; the delay line makes it memory-
   heavier (384 KB per voice for stereo), acceptable for 16 voices.

## 8. Tests

- Sine 1 kHz in, Shift +100 Hz: *Up* has its peak at 1100 Hz, the 900 Hz
  component at least 40 dB lower; *Down* the reverse. Repeat at 100 Hz input
  and 10 kHz input (suppression at least 35 dB).
- Shift −300 Hz on a 200 Hz sine: *Up* contains 100 Hz (reflected through
  zero).
- Through-zero: sweeping Shift from −5 to +5 Hz produces a continuous output
  (no sample step larger than the input's slope allows).
- Sync: with the transport playing, oscillator phase equals
  `2π · frac(ppq / cycleBeats)` for every Sync value, and after a loop jump.
- Spread 100 %: the right channel's oscillator frequency is exactly −f_L; at
  50 % it is 0.
- Feedback ±100 % with full-scale noise stays bounded (|out| < 4) for 60 s of
  rendering; no NaN.
- FB Delay 250 ms with Feedback 50 % and a click: echoes at 250 ms spacing,
  each shifted by a further Shift Hz.
- Anti-alias on: a 20 kHz sine shifted +5 kHz at 48 kHz leaves no component
  above −60 dB below 20 kHz; off: the alias is present (documents the switch).
- Sin/Cos outputs are 90° apart and in −1…+1.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Tempo-synced *FB Delay* values (1/32 … 1 bar, dotted, triplet).
- An exponential (pitch-like) shift mode where Shift follows a `pitch` input
  as a fraction of the input's frequency (only meaningful for monophonic
  input with a known pitch).
- A filter in the feedback loop (tone control for spirals).
- Quad output mode: four sidebands with the oscillator at 0°, 90°, 180°, 270°
  for multichannel rotation.
