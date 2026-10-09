# Pulse Generator

Type id `pulse-generator` · category *Sources* · colour proposal `#facc15`

## 1. Purpose

A laboratory pulse generator: one precisely timed rectangular pulse per
period, with a delay, a width, slewed edges, bursts and double pulses. Used
as a clock it is exact and transport-locked; used as a sound source its edges
excite a **ringing** resonance, like a badly terminated cable, so the pulses
turn into clicks, pings and small drum tones.

Unlike *LFO* and the oscillators, its unit is time, set on a draggable diagram.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Trigger | `trigger` | Starts a burst in *Triggered* mode. |
| Gate | `gate` | Runs the generator while high (*Gated*), or is the signal delayed in *External Width*. |
| Reset | `trigger` | Restarts the period now (4.2). |
| Pitch | `pitch` | Added to *Ring Freq* in octaves, so the ring can be played. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The shaped pulse plus ringing, band-limited (4.6). |
| Gate | `gate` | A clean logic copy of the pulse: high from its start to the start of its fall. |
| Sync | `trigger` | One pulse at each period start, before *Delay*. |
| Ring | `audio` | Only the ringing component, at full strength (4.5). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Period | 20 µs – 10 s (exp.) | 100 ms | Time from one period start to the next when *Sync* is *Free*. |
| Width | 1 µs – 5 s (exp.), or 0–100 % | 10 ms / 10 % | Pulse length (*Time Units*). |
| Delay | 0 – 10 s (skewed, centre 10 ms), or 0–100 % | 0 | Period start to pulse start; with *Double*, the pair spacing. |
| Rise | 0–100 % of Width | 0 % | Leading-edge ramp time. |
| Fall | 0–100 % of Width | 0 % | Trailing-edge ramp time. |
| Amplitude | 0–100 % | 100 % | Pulse height. |
| Offset | −1 … +1 | 0 | Baseline. |
| Jitter | 0–100 % | 0 % | Seeded timing error, up to ±25 % of the period (4.4). |
| Ring | 0–100 % | 0 % | How much ringing is mixed into Out. |
| Ring Freq | 20 Hz – 20 kHz (exp.) | 2 kHz | Frequency of the ringing. |
| Damping | 0–100 % | 50 % | How fast the ringing dies (4.5). |

Width and Delay are two knobs each (`width`/`widthpct`, `delay`/`delaypct`),
one shown per *Time Units* (`.when("units", …)`), since a param has one range.
Period, Jitter and Double are hidden in *External Width*, Sync and Warm-up
outside *Free Run*, Burst outside *Triggered*.

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Free Run, Triggered, Gated, External Width | Free Run |
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars | Free |
| Time Units | Time, % of Period (Width and Delay) | Time |
| Double | Off, On | Off |
| Burst | 1–64 pulses per trigger | 1 |
| Polarity | Normal, Complement | Normal |
| Warm-up | Off, On | Off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 The pulse

Each pulse starts at time `t0` and has width `W`, rise `tr = Rise · W` and
fall `tf = Fall · W`. Its logical shape is a trapezoid

`p(t) = clamp((t − t0) / tr, 0, 1) · (1 − clamp((t − t0 − W) / tf, 0, 1))`

(a zero `tr` or `tf` is a step). Since `tr ≤ W`, the rise ends before the
fall begins; the fall may run past `W`. Overlapping pulses combine with `max`.

`s = p` (*Normal*) or `s = 1 − p` (*Complement*), and

`Out = Offset + Amplitude · (s + Ring · r)`, `Ring out = Amplitude · r`.

Gate is plain logic, high for `t0 ≤ t < t0 + W` (inverted for *Complement*),
without edges, ringing or level. Out is not clipped.

In *Time Units = %*, `W = Width · Period` and `Delay = Delay · Period`. In
*Time*, a Width that would reach the next period start is limited to
`Period − 1 sample` and the view lights its **Duty** lamp.

### 4.2 Modes

- **Free Run:** period starts every `T` seconds. With *Sync* not *Free* and
  the transport playing, period `n = floor(ppq / syncBeats)` starts on the
  grid (`dsp::syncBeats`); stopped, it runs free at the synced length and the
  current tempo. *Reset* restarts the period now (ignored while synced and
  playing); pulses not yet begun are dropped. The pulse starts at
  `t0 = start + Delay`. The period is a sample timer: a shorter Period (or
  modulation) ends the current one at once.
- **Triggered:** each Trigger (or the view's **Single** button) starts a
  burst of *Burst* periods, `T` apart, each with its pulse at `+Delay`. A
  trigger during a burst restarts it; *Reset* stops it. Between bursts the
  output rests.
- **Gated:** the rising edge of Gate starts a period at once (synchronous
  start), and periods follow while Gate is high. On the falling edge no new
  period starts, but a pulse already begun finishes, so the last one is never
  cut short. A pulse whose Delay would start it after the falling edge never
  starts. *Reset* while Gate is high restarts the period.
- **External Width:** a gate delay line. Gate's edges reappear *Delay* later,
  with `W` the input's high time (`tr`, `tf` stay fractions of the *Width*
  knob). Up to 256 pending edges are queued; more are dropped and Duty lights.
  Unpatched Gate: each Trigger (or **Single**) becomes a pulse of *Width*,
  *Delay* later. Sync fires at the input's rising edges; *Period*, *Double*,
  *Burst* and *Jitter* are unused (jitter scales with a period this mode
  doesn't have). If an edge's fall cuts into a long Rise, the fall starts from
  the level reached (the pulse is `min(rise, fall)`).

**Double:** each period gives two pulses, at the period start and *Delay* later.

The period is at least 4 samples (83 µs at 48 kHz); the dial still reaches
20 µs and shows the effective value in brackets.

At most 32 pulses can be alive or waiting for their Delay at once (a Delay
longer than 32 periods); further pulses are dropped and Duty lights.

### 4.3 Warm-up

With *Warm-up* on (Free Run, *Sync Free* only) the period settles like a cold
instrument: `T' = T · (1 + 0.05 · e^(−t / 12 s))`, `t` in seconds since
transport start (or since the module was added). A "Warming" lamp stays lit
until the error is under 0.1 %.

### 4.4 Jitter

Each pulse's start moves by `Δ = Jitter · 0.25 · T · (u1 + u2 − 1)` with
`u_i = uniform01(Seed, k, 8·(voice + 1) + i)`, i = 1, 2 (a triangular
distribution; `voice` is −1 outside Voice Cells), where `k` is the pulse
index: the period index `n` in Free Run (`2n` and `2n + 1` for the two pulses
of *Double*), and the count of pulses since transport start in Triggered and
Gated. Jitter moves the
pulse, never the period grid, so errors don't accumulate and synced clocks stay
on the beat. A pulse never starts before the event that caused it (`Δ` is
folded to `|Δ|` when Delay is smaller). Sync is never jittered.

### 4.5 Ringing

`s` (after band-limiting) feeds a two-pole resonator: the band-pass output of
a `dsp::Svf` at `fr = RingFreq · 2^Pitch`. Its step response is a decaying
sine of unit height, so an edge of size `Δs` adds

`r(t) = Δs · e^(−π · fr · t / Q) · sin(2π · fr · t)`.

Damping sets how many cycles the ring lasts to −60 dB:
`N = 200 · (1/400)^Damping` (200 cycles down to 0.5), and
`Q = max(0.5, π · N / 6.91)`. Rising and falling edges ring with opposite sign,
so a short pulse gives a two-edge ping whose colour follows the Width (a
width of half a ring cycle reinforces it, a whole cycle cancels it). Slow
edges (*Rise*, *Fall*) excite the ring less, as a real cable would.

The band-pass gain at resonance is Q (up to 91), so a pulse train with a
harmonic on a high-Q ring builds up far beyond unit height. `r` is therefore
softly limited: unchanged up to ±4, then a tanh knee to ±6 (both outputs stay
well inside ±64). The resonator itself stays linear.

### 4.6 Band-limiting

Edge times are computed in double precision, so every corner lands at a
fractional position `d ∈ [0, 1)` inside a sample:

- A **step** (`tr` or `tf` under one sample) is placed at the ramp's midpoint
  and corrected with a two-sample polyBLEP residual scaled by its height.
- A **ramp** of one sample or more is drawn as a straight line, and each of
  its two corners gets a polyBLAMP residual scaled by the slope change.

Residuals straddle the edge, so all outputs are delayed by one sample.

Each pulse is `min(rise, fall)` of its two ramps (equal to the product above
when `tr ≤ W`), and pulses combine with `max`; at every corner time the jump
and slope change are taken from the one-sided limits of that combined
function, so coinciding corners (Double with Delay 0, % Width 100 %) cancel
correctly. Not corrected: the kink where one pulse's falling ramp crosses the
next one's rising ramp (only with overlapping slopes). Events that only exist
at whole samples (a Trigger, a Gate edge, a polarity switch, a seek) are
steps at the sample, corrected with `d = 1`.

### 4.7 Determinism, transport and seeking

- Synced Free Run is a pure function of the song position: pulse times,
  jitter and widths come from `n` and *Seed*. Seeking re-derives them (every
  period whose pulse still reaches the new position, up to 16 back); a pulse
  that is mid-way at the new position starts there, and the jump in `s` is
  band-limited and rings like any other edge. Sync fires on a start exactly
  at a period start (e.g. playing from bar 1).
- Unsynced Free Run restarts its period, period count and warm-up at
  transport start.
- The other modes count pulses from transport start, so renders from the same
  start are identical. The queue and resonator are kept across jumps.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────────┐
 │ SYNC  ▌                                            ▌         │
 │        ◄──── Delay ────►                                     │
 │ OUT  ───────────────────╱‾‾‾‾‾‾‾‾‾‾‾‾╲∿∿~────────────────╱‾‾ │
 │                         ◄── Width ──►                        │
 │      ◄──────────────────── Period ─────────────────►         │
 │ [Duty ●] [Warming ○]   Mode: Free Run   Burst 1   [Single]   │
 │ Period  Width  Delay  Rise  Fall  Ring  Ring Freq  Damping   │
 └──────────────────────────────────────────────────────────────┘
```

A front-panel timing diagram over one period (log-compressed when Width or
Delay is under 2 % of it): Sync tick, trapezoid, the ringing (computed in the
view from 4.5), and Period, Delay and Width as dimension lines with values.
Dragging an arrow's end edits that knob, dragging a slope Rise or Fall. The
Period dial is a decade switch plus a vernier, both moving the same knob.

As built (`ui/pulse-generator.js`): the compression is piecewise linear, not
logarithmic: the segments between period start, pulse corners and period end
each get at least 10 % of the width, which keeps the drag mapping exactly
invertible. The decade switch is a pair of ÷10 / ×10 buttons next to the
lamps (the Period knob is the vernier); **Single** is a module button in the
view's button bar. The module sends `duty` (latched until read), `warming`,
the effective `period`, `width`, `delay` (seconds) and `pos` (0..1, a
playhead) as live values; the diagram uses them while no drag is on.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

1. **Event-based band-limiting:** a shared `patch/common/dsp/Blep.h` with
   polyBLEP and polyBLAMP residuals for an edge at a fractional sample position
   and a one-sample look-ahead buffer (Drums.h and the Oscillator could share it).
   *Not done yet:* the module was built without touching shared files, so the
   residuals (the same two-sample polynomials as `SyncOsc::correct` in
   OscCore.h) live in `PulseGeneratorDsp.h::residual()`; moving them to
   `Blep.h` is a follow-up.
2. **Resonator:** `dsp::Svf` band-pass as is (its 5 Hz clamp is below the
   20 Hz minimum). Jitter uses `dsp::uniform01` (Random.h); sync uses
   `dsp::syncBeats` (Tempo.h); Gate edges use `dsp::GateEdge` (Smoothing.h).
3. **Live values** (exist): the Duty and Warming flags for the lamps.
4. **Inside Voice Cells:** each voice runs its own generator; jitter uses
   `stream + voice index`. Patch *Voice In › Trigger* into *Trigger* and pitch
   into *Pitch* for one ringing ping per note.

## 8. Tests

- Free Run at 100 ms: Sync every 4800 samples at 48 kHz; Gate high for exactly
  `W`, starting `Delay` after Sync, within one sample.
- Synced: period starts land on the grid even at Jitter 100 %; same Seed twice
  → identical output.
- Triggered with Burst 5: exactly five pulses `T` apart; a retrigger restarts.
- Gated: no pulse starts after the falling edge; the last one is full width.
- External Width: output equals the Gate input delayed by Delay, within one
  sample, for random gates; overflow past 256 edges lights Duty.
- Double: two pulses per period, *Delay* apart; Complement: `s + s_normal = 1`.
- Band-limiting: a 1 kHz zero-rise pulse train (at 44.1 kHz, so aliases fall
  between the harmonics) aliases at least 30 dB less than the naive one below
  10 kHz (measured 33 dB; over the whole band a two-sample polyBLEP gains
  about 18 dB, the remaining aliases sitting near Nyquist); a half-sample
  edge shift moves the centroid 0.5 samples.
- Ringing: a single step at Damping 50 % rings at `fr` ± 1 % and reaches
  −60 dB after `N` cycles ± 10 %; Ring out is 0 when no edge has occurred
  (also in *Complement*: the resonator starts settled at the resting level).
- Warm-up: period 5 % long at start, under 0.1 % after 60 s.
- The demo types file includes the module (`patch.ui-types`): needs
  `bleep_dump_types --write patch/board/ui/demo-types.json` once the module
  is merged (not regenerated here: a shared file).

## 9. Later

- Free-running bursts: groups of *Burst* pulses with a separate burst period.
- A *Cable Length* control: a reflecting delay line instead of the ring.
- A second, independently delayed output channel, as on two-channel generators.
