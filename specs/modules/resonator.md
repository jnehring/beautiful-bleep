# Resonator

Type id `resonator` · category *Audio* · colour proposal `#0891b2`

## 1. Purpose

A tuned resonant body that rings when something hits it. Feed it any audio (a
drum loop, noise bursts, a voice, a sequenced click) and it answers with
pitched, physical-sounding tone: a struck bar, a plate, a plucked string, or a
set of strings ringing in sympathy. Without input, its internal exciter plays
it from the *Strum* input like an instrument. Up to four internal voices take
turns on each strum, so chords and overlapping notes ring out naturally, and
odd/even outputs give a wide stereo image from a mono source.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In | `audio` | The excitation signal. Feeds the most recently strummed voice (4.5). |
| Strum | `trigger` | Starts a new voice (round robin over *Polyphony*), samples *Pitch* for it, and fires the internal exciter if *Exciter* is on. |
| Pitch | `pitch` | 1 V/oct, 0.0 = C4, added to *Frequency*. The newest voice tracks it continuously; older voices keep the pitch they were strummed at. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Odd | `audio` | Odd modes / odd strings / the first pickup, after *Width* (4.6). Use as the left channel. |
| Even | `audio` | Even modes / even strings / the second pickup. Use as the right channel. |
| Mix | `audio` | Odd + Even, mono, for when stereo isn't wanted. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Frequency | −48…+48 semitones around C4 | 0 (C4) | Fundamental of the resonator; *Pitch* adds to it. Modulation in semitones. |
| Structure | 0–100 % | 25 % | Ratios between the partials: harmonic → stiff → bar → plate → bell (Modal); stiffness/dispersion (String); the tuning of the sympathetic set (Sympathetic). See 4.2–4.4. |
| Brightness | 0–100 % | 60 % | High-frequency content: tilts the mode amplitudes and makes the high modes decay faster; colours the internal exciter. |
| Damping | 0–100 % | 45 % | Decay time T60 of the fundamental, exponential: 0 % = 30 s, 50 % ≈ 1.2 s, 100 % ≈ 50 ms. |
| Position | 0–100 % | 30 % | Where the body is excited and picked up: shapes the spectrum like a comb (0 % and 100 % are the ends, 50 % the middle, which cancels the even partials). |
| Input Gain | −24…+24 dB | 0 dB | Level of *In* into the resonator. |
| Exciter | 0–100 % | 50 % | Level of the internal exciter on each strum. 0 % switches it off. |
| Width | 0–100 % | 100 % | Stereo width: 0 % gives both outputs the mono sum, 100 % fully separates odd and even. |
| Dry | 0–100 % | 0 % | The input signal mixed into both outputs. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Model | Modal, Sympathetic, String | Modal |
| Polyphony | 1, 2, 4 | 1 |
| Modes | 16, 32, 64 (Modal only) | 32 |
| Strum Source | Jack, Input onsets | Jack |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Common

Each voice has a fundamental `f0 = C4 · 2^((Frequency + 12·Pitch) / 12)`,
clamped to 16 Hz … 0.4 × sample rate. The decay time of the fundamental is
`T60 = 30 s · 0.0017^Damping`. Brightness `b` and Position `p` are used by all
models as described below. Knobs are read every 16 samples and the modal
coefficients are interpolated linearly across each 16-sample sub-block (the
strings take their new loop at the sub-block start), so every knob can be
modulated, *Frequency* up to a fast vibrato or sweep. Only coefficients whose
inputs changed are recomputed (`ModalBank::set` costs one sin/cos per mode
when only the pitch moves).

### 4.2 Modal

A bank of `M` = *Modes* parallel resonators per voice. Mode `k` (1…M) has

- **frequency** `fₖ = f0 · rₖ(Structure)`. *Structure* morphs between five
  ratio tables, interpolating in log-frequency between neighbours:

  | Structure | Body | Ratios rₖ |
  |---|---|---|
  | 0 % | ideal string / tube | k |
  | 25 % | stiff string | k · √(1 + B k²), B = 0.0004 |
  | 50 % | free bar | 1, 2.756, 5.404, 8.933, 13.34, …, then (2k + 1)² / 9 |
  | 75 % | membrane / plate | zeros of Bessel functions: 1, 1.594, 2.136, 2.296, 2.653, 2.918, … (a fixed table of 64) |
  | 100 % | bell-like inharmonic | seeded: rₖ = rₖ₋₁ · (1 + 0.15 + 0.6 · uniform01(Seed, k, 1)), r₁ = 1 |

- **decay** `T60ₖ = T60 / (1 + 0.5 · (1 − b)² · (rₖ − 1))`: high modes
  die faster when it's dark, and almost as slowly as the fundamental when it's
  bright.
- **amplitude** `aₖ = |sin(π · k · p')| · (fₖ / f0)^(−1.5 · (1 − b))`, with
  `p' = 0.02 + 0.96 · p`, so the excitation and pickup position cut the
  partials whose nodes fall there, and *Brightness* tilts the spectrum.

Each mode is a complex one-pole resonator (rotation by `2π fₖ / fs` times
`decayCoef(T60ₖ)`, the same structure as `dsp::Resonator` in `Drums.h`): its
level doesn't depend on frequency, so sweeping *Frequency* while ringing keeps
the energy. The bank is the shared `dsp::ModalBank` (struck input). The
input is injected energy-normalised, scaled by `aₖ · 2 · √(2 (1 − |coef₁|))`
(`coef₁` the fundamental's decay per sample): white noise in gives about the
same output level at any *Damping*, a transient rings longer but softer at
long decays (its energy stays the same), and a steady input in tune with a
mode builds up (the output limiter, 4.6, catches it). The plain
`(1 − |coef|)` scaling made drum loops ring 40–50 dB below the input at
musical decays. Modes whose frequency
is above 0.45 × sample rate are skipped, and the ones between 0.40 and 0.45
fade out, so nothing aliases when the pitch rises. Modes are processed in SIMD
groups of 4.

### 4.3 Sympathetic

Eight strings per voice, each a waveguide string (4.4) with fixed loss and no
excitation of its own: *In* (and the internal exciter) is fed to all eight
through a gentle 300 Hz high-pass, so they ring in sympathy with whatever
matches their tuning. *Structure* picks the tuning of the set, stepping through
(interpolated where neighbours share a string count):

| Structure | Intervals above f0 (semitones) |
|---|---|
| 0–12 % | octaves: 0 12 24 36 0 12 24 36, the second four detuned +3 cents |
| 12–25 % | fifths: 0 7 12 19 24 31 36 43 |
| 25–37 % | major: 0 4 7 12 16 19 24 28 |
| 37–50 % | minor: 0 3 7 12 15 19 24 27 |
| 50–62 % | sus / quartal: 0 5 7 10 12 17 19 22 |
| 62–75 % | add9 spread: 0 7 14 16 19 23 26 28 |
| 75–87 % | detuned unisons: 0, ±4, ±8, ±12, +16 cents |
| 87–100 % | seeded inharmonic: 0 and seven seeded ratios in 1.1…6 |

Within the last fifth of each step the intervals glide linearly into the next
tuning, so sweeping *Structure* never jumps. The set is the shared
`dsp::SympatheticStrings`, which scales each string's input by
`1 − loop gain` (a steady sine in tune comes out at about its own level);
the module adds ×10 on *In* and ×28 on the exciter so transients and strums
ring at a useful level. *Damping* sets the strings' decay, *Brightness*
their loop filter, *Position* the pickup on each string. Odd strings go to
*Odd*, even strings to *Even*.

### 4.4 String

A plucked-string waveguide per voice, in the Karplus-Strong family:

- A delay line of length `N = fs / f0` minus the loop-filter delay, with a
  first-order allpass for the fractional part, solved exactly for the phase
  delay at f0 (close to Thiran's), so tuning is exact to a fraction of a cent
  across the range (the shared `dsp::WaveguideString`).
- **Loop filter:** a one-pole low-pass whose cutoff rises with *Brightness*
  (from `2 · f0` to 0.45 · fs), and a loop gain `g = 10^(−3 / (T60 · f0))`
  compensated for the filter's loss at f0, so *Damping* sets the real T60.
- **Dispersion:** four first-order allpasses in the loop, coefficient from
  *Structure* (0 = none, 100 % = strongly stiff, piano-wire to metal-bar).
  Their phase delay at f0 is subtracted from `N`, so the fundamental stays in
  tune.
- **Position:** the excitation is combed (`x[n] − 0.95 · x[n − p·N]`) and the
  two pickups read at `p·N` (*Odd*) and `(1 − p)·N` (*Even*).
- A DC blocker (5 Hz) in the loop keeps long decays clean.
- The internal exciter goes into the loop as is; *In* is scaled by
  `15 · (1 − loop gain)`, so a steady input in tune doesn't explode.

Changing *Frequency* while ringing reads the delay line at a moving length
(with the allpass state reset smoothly), which gives a natural pitch bend.

### 4.5 Voices, strums and the exciter

- With *Polyphony* 1, there is one voice; *Strum* only fires the exciter and
  re-samples the pitch.
- With 2 or 4, each *Strum* moves to the next voice (round robin). The new voice
  becomes **active**: *In* feeds it alone (crossfading away from the previous
  voice over 5 ms) and it tracks *Pitch*. Earlier voices keep their pitch and
  ring out freely. A strum on a still-ringing voice doesn't reset it; the new
  excitation adds to the ringing, like hitting a string again.
- **Internal exciter**, on each strum when *Exciter* > 0: a 3 ms burst of white
  noise times a raised-cosine window, low-passed by a one-pole whose cutoff
  follows *Brightness* (500 Hz … 16 kHz), plus a single-sample click of half
  the level (`dsp::NoiseBurst`, seeded per strum from *Seed* and a strum
  counter that restarts with the transport). Its level is *Exciter* (trigger
  has no velocity; patch an envelope or *Voice In › Velocity* onto *Exciter*
  for dynamics). The levels are calibrated so a default strum peaks around
  0.5 in every model.
- **Strum Source *Input onsets*:** a transient detector on *In* (a fast
  envelope, 0.5 ms / 10 ms, more than 6 dB above a slow one, 30 ms / 150 ms,
  and above −50 dB; 30 ms hold-off; it re-arms only once the two envelopes
  have come back within 3 dB) generates strums, so a drum loop played into a
  4-voice resonator spreads its hits over the voices and the current *Pitch*
  is captured per hit. The *Strum* jack still works too.
- A *Strum* button in the view strums like the jack.
- Without *In* and without strums the resonator is silent.
- A voice sleeps (no CPU) when its output stays below −100 dB for 50 ms with
  no input and no exciter running; its states are then cleared. All states
  are flushed to zero below 1e-15 (no denormals).
- Changing *Model* dips the outputs (2.5 ms out, switch and clear all voices,
  2.5 ms in); when nothing rings it switches at once.

### 4.6 Outputs and level

Odd = Σ odd modes (or strings, or pickup 1) over all voices, Even = Σ even
ones. With *Width* `w`: Odd' = (1+w)/2 · Odd + (1−w)/2 · Even, and vice versa.
In Modal mode the fundamental (mode 1, odd) is mixed 50/50 into both outputs
so low notes stay centred. Each output passes a soft limiter
(`softClip`, threshold at ±1) because a resonant body fed with a loud input in
tune with its modes can build up far above the input level. *Dry* adds the
input (after *Input Gain*) to both outputs.

### 4.7 CPU

| Model | Cost per voice (approx.) |
|---|---|
| Modal 16 / 32 / 64 | 0.5 / 1 / 2 Oscillators-worth |
| Sympathetic | ≈ 1.5 (eight short waveguides) |
| String | ≈ 0.3 |

Four voices of Modal 64 cost about eight Oscillators. Inside a Voice Cell use
*Polyphony* 1 and let the cell provide the voices.

## 5. Module view

The usual knobs and settings, plus a **partial display** above them: one
vertical line per mode (or string) of the active voice, placed on a log
frequency axis (16 Hz – 20 kHz), its height the amplitude `aₖ` and its
brightness the remaining energy, so *Structure*, *Position* and *Brightness*
can be seen as well as heard. A row of four dots shows which voices ring and
which one is active. In String mode the display shows the string with markers
for the position and the two pickups. The settings come first (the model
decides what *Structure* means; its name follows the model: *Structure*,
*Tuning*, *Stiffness*). A *Strum* button fires the exciter.

## 6. Saved state

Only knob and setting values; no node data. Ringing voices are not saved.

```json
{ "type": "resonator",
  "params": { "frequency": 0.5, "structure": 0.25, "brightness": 0.6, "damping": 0.45, "position": 0.3, … } }
```

## 7. Engine requirements

1. **Shared modal bank** `patch/common/dsp/ModalBank.h`: SIMD complex one-pole
   bank with ratio tables, amplitude and decay laws of 4.2. Also used by
   *Modal Voice*; *Ring Drums*' `dsp::Resonator` stays as is.
2. **Shared waveguide string** `patch/common/dsp/Waveguide.h` (delay line,
   Thiran allpass, loop filter, dispersion chain), used by String, Sympathetic
   and later by other physical models.
3. **Live values:** `active` and `voiceEnergy1…4` (output level per voice);
   live arrays `modeHz`, `modeAmp`, `modeLevel` for the active voice's modes
   (Modal, up to 64) or strings (Sympathetic, 8; empty for String), updated
   about 30 times a second.

## 8. Tests

- Tuning: the String and Modal models at Structure 0 ring within ±2 cents of f0 for C1, C4 and C7 at 44.1, 48 and 96 kHz.
- Decay: the fundamental's T60 matches the *Damping* formula within 10 % in all three models.
- Structure: mode frequencies at 0 %, 50 %, 75 % match the ratio tables; 100 % gives the same table for the same Seed and a different one for another.
- Position 50 % cancels even modes (Modal) and the second harmonic (String) by at least 30 dB.
- Anti-aliasing: sweeping Frequency upward over four octaves, no processed mode is ever above 0.45 fs.
- Round robin: four strums use voices 1, 2, 3, 4, 1; each holds its pitch; *In* reaches only the active voice.
- Input onsets: a click train at 4 Hz yields 4 strums per second; a second click 10 ms after each is suppressed.
- Levels: a default strum peaks between 0.2 and 1 in every model; white noise in gives a useful level.
- Changing *Model* while ringing doesn't click.
- Stability: white noise at +12 dB with Damping 0 stays bounded by the limiter; silence after input stops decays to sleep; no denormals (timing check).
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- More bodies: tube with open/closed ends, a coupled string-plus-body model.
- A nonlinear "buzz" (string against a fret or bridge) for sitar-like tones.
- Freeze: infinite sustain of the current ringing.
- Per-voice outputs and a *Notes* input that strums chords directly.
- Stereo input (L into odd, R into even voices).
