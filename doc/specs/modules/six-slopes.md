# Six Slopes

Type id `six-slopes` · category *Modulation* · colour proposal `#d97706`

## 1. Purpose

Six slope generators that share one set of controls. A single *Harmonics*
knob spreads their speeds: all equal at the centre, overtone ratios
(1 : 2 : 3 : 4 : 5 : 6) to one side, undertone ratios (1 : ½ : ⅓ … ⅙) to the
other. Each channel has its own trigger, and unpatched triggers take the one
above, so one gate can fire all six at once. Modes turn the six into one-shot
envelopes, sustained envelopes, looping LFOs or, at audio rate, six
oscillators tuned to a chord of harmonics. A *Sum* output mixes them.

Where *Function* is one slope with four derived outputs and *Tidal* derives
four outputs from one phase, Six Slopes runs six **independent** slopes, each
started by its own event: six envelopes for six rhythm parts, or six partials
of one tone.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Trig 1 … Trig 6 | `gate` | Starts (AR), holds (ASR), resets (Loop) or syncs (Sound) its channel. Unpatched, a jack takes the signal of the nearest patched jack above it (4.3). |
| Pitch | `pitch` | Added to *Rate* in octaves, for all six channels. Default amount 1. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out 6 | `control` (unipolar 0…1; bipolar in Sound and, by *Polarity*, in Loop) | Each channel's slope. |
| Sum | `control` | The six outputs mixed (4.5). |
| End 1 | `trigger` | A pulse when channel 1 finishes its slope (AR, ASR) or its cycle (Loop, Sound). |
| Active | `gate` | High while any channel is moving (AR, ASR); always high in Loop and Sound. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Rate | slope modes: 0.02–1000 Hz, shown as time 1 ms – 50 s (exponential, centre ≈ 4.5 Hz / 220 ms); Sound: 16 Hz – 4 kHz (exponential on each half, C4 at the centre) | 2 Hz | Speed of channel 1; the others follow through *Harmonics*. Declared in the slope modes' range; the view shows the time, note or note value. |
| Harmonics | −1 … +1 | 0 | Spreads the six rates (4.2). |
| Skew | 0–100 % | 25 % | Share of each slope spent rising. 25 % is a quick rise and a longer fall. |
| Curve | −1 … +1 | 0 | Bends the slopes: −1 logarithmic, 0 linear, +1 exponential (the Function curve). |
| Level | 0–100 % | 100 % | Output scale of all six channels. |
| Tilt | −1 … +1 | 0 | Level balance across channels: + favours the higher channels, − the lower ones (4.5). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | AR, ASR, Loop, Sound | AR |
| Snap | Off, Integer, Just | Off |
| Sync (hidden in Sound) | Free, 8 bars … 1/32T (the shared note values) | Free |
| Polarity (shown in Loop) | Unipolar, Bipolar (Loop only; Sound is always bipolar) | Unipolar |

## 4. Behaviour

### 4.1 One slope

Each channel `k` (1…6) has its own phase. A slope rises over
`Skew / f_k` and falls over `(1 − Skew) / f_k`, shaped by
`curve(u, Curve)` = `u^(1+3c)` for `c ≥ 0`, `1 − (1−u)^(1−3c)` for `c < 0`.
Skew is limited to 0.5–99.5 %. The slopes are `dsp::Slope` with
`morphCurve = false` (AR → `SlopeMode::AD`, ASR → `SlopeMode::AR`, Loop and
Sound → `SlopeMode::Loop`).

### 4.2 Harmonics

`f_k = f_1 × ratio_k`, `f_1 = Rate × 2^Pitch`, `h` = *Harmonics*:

- `h ≥ 0`: `ratio_k = 1 + (k − 1) · h` → at +1: 1, 2, 3, 4, 5, 6 (overtones).
- `h < 0`: `ratio_k = 1 / (1 + (k − 1) · |h|)` → at −1: 1, ½, ⅓, ¼, ⅕, ⅙ (undertones).
- Between 0 and ±1 the ratios are inharmonic, so looping channels drift in and
  out of phase: slow phasing patterns from one knob.

*Snap* rounds the ratios: *Integer* snaps `1 + (k−1)·h` to the nearest whole
number (with `h < 0`, the denominator), so turning the knob steps through
whole-number chords; *Just* snaps each ratio to the nearest of
1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2 times a power of two, so the six channels
form a just-tuned chord in Sound mode. The snap is done per sample on the
modulated value, so modulating *Harmonics* steps cleanly.

In slope modes the ratios scale **speed**: with overtones, channel 6 is six
times as short as channel 1.

### 4.3 Trigger normalling

Each Trig jack, if unpatched, reads the nearest patched jack with a lower
number; if none is patched above it, it reads nothing. Examples:

- Only Trig 1 patched: one gate starts all six (an envelope burst whose six
  slopes end at the harmonic times: a natural "strum" of decays).
- Trig 1 and Trig 4 patched: channels 1–3 follow Trig 1, 4–6 follow Trig 4.

This is the engine's input normalling: Trig k is `normalledTo("trig k−1")`
and the compiler follows the chain to the nearest patched jack. The node shows
the source in the jack's tooltip ("Unpatched: follows Trig 1").

### 4.4 Modes

- **AR (one-shot):** a rising edge starts the rise from the current level; the
  fall follows on its own. Retrigger during the fall rises again from there.
- **ASR (sustain):** rise while the gate is high, hold at 1, fall on the
  falling edge from the current level. A gate that ends during the rise falls
  from where it is.
- **Loop:** the channels cycle continuously. A rising edge resets that
  channel's phase to 0. Unpatched and with no normal source, channels run
  free from the module's start (all in phase at the start).
- **Sound:** six oscillators. Each channel cycles at audio rate; *Skew* moves
  the wave from saw to triangle to ramp, *Curve* bends it (+0.5 gives a
  sine-like tone). A Trig rising edge hard-syncs its channel (phase to 0),
  so patching an oscillator into Trig 1 makes six synced partials. Output is
  bipolar. Frequencies above `sr / 4` are muted (a fade over the octave below
  `sr / 4`) instead of aliasing.

**Sync** (slope and Loop modes): the length of channel 1's cycle (or slope) is
one sync value at the current tempo; the others keep their ratios. *Pitch*
then shifts in whole octaves (so the lock holds). In Loop
with the transport playing, each phase is derived from the song:
`p_k = frac(ppq · ratio_k / cycleBeats)`, so with integer ratios the channels
realign on every sync length and every render is identical. A Trig reset in
that state only affects the channel until the next transport start. Sync is
ignored in Sound.

### 4.5 Levels and Sum

Channel output = `slope_k × Level × tilt_k`, with
`tilt_k = clamp(1 + t · (k − 3.5) / 2.5, 0, 1)` (t = *Tilt*): at +1 channel 1
is silent and channel 6 full; at −1 the other way. In Sound mode a negative
Tilt gives a darker chord, as with natural overtone amplitudes.

**Sum** = `Σ out_k / 6 × 2`, clipped to the output range (unipolar 0…1, or
−1…+1; in Sound mode a `tanh` soft clip instead, so the mixed tone doesn't
buzz): six equal unipolar slopes sum to full scale when about half are up.
In Loop with inharmonic ratios it's a complex, slowly evolving contour; in
Sound mode it's the mixed tone (patch it into a VCA's audio input).

### 4.6 Edge cases

- Changing *Mode* keeps each phase; slopes in progress continue in the new
  mode (an ASR at hold switched to AR falls at once).
- A trigger and its normalled copy are the same event: one edge, one start.
- Inside a Voice Cell: Sound mode with *Voice In › Pitch* on *Pitch* is a
  six-partial voice; ASR mode with *Voice In › Gate* on Trig 1 gives six
  envelopes per voice. Patch *Active* to *Voice Out › Active* in AR/ASR.

## 5. Module view

```
 ┌ Six Slopes ────────────────────────────────┐
 │ 1 ▁▂▅█▆▄▂▁ ▏  ratio 1                      │
 │ 2 ▁▅█▄▁▅█▄▁▏  ratio 2                      │
 │ …                                          │
 │ 6 █▄█▄█▄█▄█▏  ratio 6        Sum ▂▅▇▅▃▅▇   │
 │ Rate ◯  Harmonics ◯  Skew ◯  Curve ◯       │
 │ Level ◯  Tilt ◯   Mode [AR▾] Snap [Off▾]   │
 └────────────────────────────────────────────┘
```

- Six thin lanes, one per channel, each with a short running scope (about
  four seconds of the live output) and its current ratio (e.g. *3/2*, or a
  note name in Sound mode, where the lane draws the channel's wave instead).
  The Sum's scope sits below them. The Rate knob shows a time, a note (Sound)
  or the note value (Sync).
- Turning *Harmonics* updates the ratio labels live; with *Snap* on, the
  label shows the snapped fraction.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

- Trigger normalling between a module's own inputs: `JackSpec::normalledTo`
  (done; chains resolve to the nearest patched jack).
- `liveArrays`: `ratios`, `hz` and `phases` (six each) for the lane labels;
  the lanes scroll the engine's per-output values.

## 8. Tests

- Harmonics 0: all six channels identical. +1: Loop *End 1* counts and per-channel cycle counts are 1 : 2 : … : 6 over a second; −1 the reciprocals.
- Snap Integer: Harmonics 0.4 gives ratios 1, 1, 2, 2, 3, 3; Just gives only ratios from the table.
- Normalling: one trigger on all six (as the normals deliver it) fires all six; separate triggers into 1–3 and 4–6 split them. (The engine's normal chain itself is covered by `patch.engine-features`.)
- AR retrigger from mid-fall, ASR early release: no discontinuity.
- Sound: Rate C4 gives 261.63 Hz on channel 1; a channel above `sr / 4` is muted.
- Sync + Loop + transport: phases follow `frac(ppq · ratio / cycleBeats)`; identical after a loop jump.
- Tilt ±1 levels; Sum stays in range.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-channel *Rate* trims (modulatable) on top of Harmonics.
- A *Strum* control: delays the normalled triggers by increasing amounts.
- Velocity-sensitive slopes (a Velocity input scaling each start).
- Stereo Sum for Sound mode (odd channels left, even right).
