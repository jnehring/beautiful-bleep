# Wobble

Type id `wobble` · category *Modulation* · colour proposal `#34d399`

## 1. Purpose

A random source with three related outputs from one stream of random values:
**Stepped** jumps to each new value, **Smooth** glides to it, and **Wobble**
glides with momentum, overshooting and wobbling before it settles. Around them
sit **Burst** (clusters of quick triggers), **Clock** and **Compare** gates, an
internal clock or an external one, and a **Chaos** knob that feeds the module
back into itself until it becomes erratic.

It differs from *Random*: Random's point is its looping memory; Wobble has no
memory, and is about **motion**: three shapes of the same movement that you
can patch to related destinations (e.g. Stepped to pitch, Wobble to the
filter), plus gates that come out of that movement.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Clock | `trigger` | Each pulse takes a new value. Overrides the internal clock. |
| Sample | `control` | When patched, each step samples this signal instead of the internal random source (a sample & hold with three output shapes). |
| Hold | `gate` | While high, no new values are taken; Smooth and Wobble still settle. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Stepped | `control` | The current value, held until the next step. |
| Smooth | `control` | The values, glided (critically damped: no overshoot). |
| Wobble | `control` | The values, glided with overshoot and ringing (4.3). Soft-limited to ±1.5. |
| Burst | `trigger` | Clusters of pulses (4.4). |
| Clock | `trigger` | One pulse per step (after *Chaos*, see 4.5). |
| Compare | `gate` | High while Stepped > Smooth: an irregular gate whose rhythm follows the movement. |

All three value outputs follow *Level* and *Polarity*.

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Rate | 0.02–40 Hz (exp.) | 1 Hz | Internal clock rate when *Sync* is *Free*. |
| Smooth | 0–100 % | 50 % | How slowly Smooth and Wobble follow the steps (4.3). |
| Wobble | 0–100 % | 60 % | Resonance of the Wobble output: 0 % behaves like Smooth, 100 % rings for several wobbles. |
| Chaos | 0–100 % | 0 % | Feedback from the outputs into the clock and the values (4.5). |
| Burst | 0–100 % | 25 % | Chance per step of a burst. |
| Level | 0–100 % | 100 % | Output range. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars | Free |
| Burst Size | 2–8 pulses (maximum) | 4 |
| Polarity | Bipolar (−1…+1), Unipolar (0…1) | Bipolar |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Steps

Steps come from *Clock* if patched, else from the transport-locked grid
(`step = floor(ppq / syncBeats)` while playing, as in Random), else from the
internal clock at *Rate*. On each step (unless *Hold* is high):

- **Value:** `v = 2 · uniform01(Seed, step, 1) − 1`, or *Sample* when patched
  (clamped to ±1). *Chaos* bends it (4.5).
- **Stepped** jumps to `v`.
- **Clock** fires; **Burst** may start (4.4).

The step period `T` (seconds) is the synced length, `1/Rate`, or the measured
time between Clock pulses (first: 1/Rate).

### 4.2 Smooth

Smooth is a critically damped two-pole low-pass on Stepped with cutoff

`fc = 2^(4 − 8 · Smooth) / T`

so at 0 % it reaches each new value in a small fraction of a step (almost
Stepped), at 50 % it arrives just in time for the next step, and at 100 % it
barely moves before the next value: a slow, wandering line. The cutoff
follows the step period, so the character is the same at any rate or tempo.

### 4.3 Wobble

Wobble is the same two-pole low-pass with the same cutoff, but with resonance:
`Q = 0.5 + 7.5 · Wobble²` (0.5 = critically damped, up to 8). It overshoots
each new value and wobbles around it at roughly `fc`, then settles. When the
next step comes before it settles, the wobbles of successive steps overlap,
which is where the lively, bouncing movement comes from.

Overshoot can exceed ±1; Wobble passes values within ±1 unchanged and
compresses beyond that with a smooth (quadratic) knee, `1 + d − d²/2` for an
excess `d` up to 1, to a maximum of ±1.5.

Both filters are computed per sample in zero-delay-feedback form and keep
working while *Hold* is high or the transport is stopped.

### 4.4 Burst

On each step, with probability *Burst* (`uniform01(Seed, step, 2) < Burst`),
a burst of `n = 2 + floor(uniform01(Seed, step, 3) × (Burst Size − 1))`
pulses fires, evenly spaced over the first half of the step (`T / (2n)`
apart). With *Chaos* above 0 the spacing accelerates or decelerates randomly
(each gap scaled by `1 + Chaos × 0.5 × (2u − 1)`, `u = uniform01(Seed,
8·step + k, 4)`). A burst that would run past the next step (held or not) is
cut off there. Bursts are ratchet-like rolls for drums or quick
re-triggers of an envelope.

### 4.5 Chaos

*Chaos* closes three feedback paths inside the module, so no feedback cable
(and no 32-sample delay) is needed:

1. **Values:** `v' = fold(v · (1 − Chaos) + Chaos · 2.4 · Smooth_prev)`,
   where `fold` reflects back into ±1. Above about 40 % the fold acts like a
   chaotic map and the values stop being independent: they cluster, run in
   streaks and then break away.
2. **Clock** (Free and transport-stopped modes only): the step rate is
   multiplied by `2^(3 · Chaos · Wobble_out)`, so fast wobbles make faster
   steps: up to ±3 octaves of rate modulation at 100 %.
3. **Bursts:** irregular spacing (4.4).

In transport-locked mode, the clock path is off so the steps stay on the grid;
paths 1 and 3 still apply. With an external Clock, path 2 is off as well.

### 4.6 Determinism, transport and seeking

- Raw values and burst decisions are pure functions of (*Seed*, step).
  With *Chaos* at 0 and *Sample* unpatched, Stepped is a pure function of the
  song position, like Random with *Loop* 0 %.
- Smooth and Wobble are filters (history). On transport start they are set to
  the current step's value with zero velocity, so playback starts calm.
  On a jump they simply continue from where they are and glide to the new
  value, which is musically fine and never clicks.
- With *Chaos* above 0 the values depend on the filter state. On transport
  start and on a jump, the module replays the last 64 steps from rest (the
  Smooth filter at 0, run at 128 points per step at the current *Smooth*) to
  find the current value, so a render from the same start position is always
  identical, though not the same as having played through from earlier. On a
  jump the filters themselves continue as above.
- In Free mode with *Chaos* above 0 the clock itself is history: renders repeat
  exactly from the same start, but there is no song-position lock.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────┐
 │  scope, last 4 steps:                                    │
 │   Stepped ▔▔▁▁▁▇▇▇▃▃   Smooth ╱‾‾╲_   Wobble ∿∿~_        │
 │   Burst ┃┃┃      ┃┃    Compare ▄▄  ▄▄▄                   │
 │  Rate  Smooth  Wobble  Chaos  Burst  Level               │
 └──────────────────────────────────────────────────────────┘
```

A small three-trace scope (Stepped, Smooth, Wobble in one plot, distinct
colours) over the last four steps, with burst pulses as ticks below. It shows
at a glance how *Smooth* and *Wobble* relate. The step response of the two
filters at the current settings is drawn faintly behind the traces, computed
in the view.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

1. A **sub-audio two-pole filter**: done, `dsp::SvfLow` in `Svf.h` (double
   state, cutoffs down to 0.0001 Hz, `resetTo` for a calm start).
2. **Live arrays** (exist) feed the scope: the module keeps the last four steps
   of Stepped, Smooth, Wobble and Burst in 192 points each (`liveArrays`
   stepped, smooth, wobble, burst), so fast rates don't alias in the view.
3. **Inside Voice Cells:** each voice runs its own clock and filters; raw
   values would use `stream + voice index`, but a module can't see its voice
   index yet (no engine field), so voices share the stream. Patch *Voice In › Trigger* into *Clock*
   for one new value per note, wobbling into place.

## 8. Tests

- Stepped equals the seeded value sequence; same Seed twice → identical
  outputs; Sample patched → Stepped equals the input at each step.
- Transport mode: steps land on `floor(ppq / syncBeats)`; Chaos > 0 never moves
  a step off the grid.
- Smooth never overshoots a step from rest (monotone step response); Wobble
  with Wobble 100 % overshoots by more than 30 %; Wobble 0 % equals Smooth.
- The filter cutoff scales with the step period: the step response measured in
  steps is the same at 1 Hz and at 8 Hz.
- Wobble output stays within ±1.5; values within ±1 pass the soft knee unchanged.
- Hold: no new values and no Clock pulses while high; filters still settle.
- Burst: probability ≈ *Burst* over 10,000 steps; pulse count in 2…Burst Size;
  no burst pulse after the next step starts.
- Compare is high exactly while Stepped > Smooth.
- Chaos 0 → Stepped independent of filter state; Chaos > 0 → output identical
  for two renders from the same start.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A second, slower Wobble output (half the cutoff) for two related wobbles.
- A *Distribution* control (bell, uniform, extremes) for the raw values.
- An audio-rate mode: Rate up to 2 kHz for random tones and textures.
