# XY Scope

Type id `xy-scope` · category *Utility* · colour proposal `#4ade80`

## 1. Purpose

An oscilloscope with a round-cornered green screen, made for the old bench
trick of comparing two oscillators by eye: X against Y draws a Lissajous
figure that stands still when the two are in a simple ratio and turns slowly
when they are slightly off. A Y-T mode shows ordinary waveforms.

It also turns what you see into signals: **Phase**, **Correlation**, **Ratio**
and a **Still** gate. Patch Still into a sequencer's clock and the music moves
on whenever two drifting oscillators happen to lock.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| X | `audio` | Horizontal deflection; the reference for Phase and Ratio. |
| Y | `audio` | Vertical deflection; the signal compared with X. |
| Z | `control` | Beam brightness: 0 normal, −1 blanks the beam, +1 doubles it. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out X, Out Y | `audio` | The inputs, unchanged, so the scope can sit in a signal path. |
| Phase | `control` (bipolar) | Phase of the figure, −1…+1 = −180…+180° (4.3). |
| Correlation | `control` (bipolar) | Normalised correlation of X and Y, −1…+1 (4.4). |
| Ratio | `pitch` | Frequency ratio Y/X as an interval: 1.0 = one octave, 0.585 = a fifth (4.2). |
| Still | `gate` | High while the figure is stationary (4.5). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| X Gain | 0.1–10 × (exp., centre 1 ×) | 1 × | Horizontal size; 1 × puts ±1 at the edge of the graticule. |
| Y Gain | 0.1–10 × (exp., centre 1 ×) | 1 × | Vertical size. |
| Timebase | 1 ms – 2 s per screen (exp.) | 20 ms | Sweep length in Y-T mode. |
| Persistence | 10 ms – 5 s (exp.) | 150 ms | Phosphor decay: time for a trace to fade by 40 dB. |
| Focus | 0–100 % | 80 % | Beam sharpness: 100 % is a fine line, 0 % a soft, wide glow. |
| Intensity | 0–100 % | 60 % | Beam brightness. |

The gains, Persistence, Focus and Intensity affect only the screen, never
the measurement outputs.

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | X-Y, Y-T | X-Y |
| Trigger | Y Rising, Auto, Beat | Y Rising |
| Phosphor | Green, Amber, Blue-White | Green |
| Character | Clean, Vintage | Vintage |
| Still Tolerance | Tight, Normal, Loose | Normal |

## 4. Behaviour

### 4.1 Frequency estimates

X and Y each pass a DC blocker (one-pole high-pass at 0.2 Hz) and a peak
follower `env` (instant attack, 500 ms release). A rising zero crossing is
counted when the signal goes from below `−0.1 · env` to at or above 0, with
the crossing time linearly interpolated between samples. The period is the
time between successive crossings; the frequency estimate `f` is one over the
mean of the periods that fall within the last 50 ms (at least 1, at most 16).

A channel is **valid** while patched, `env` > 0.001 (−60 dBFS) and a
crossing came within 5 s. The range is about 0.2 Hz to 10 kHz.

### 4.2 Ratio

`r = fy / fx`. The **Ratio** output is `log2 r` through a one-pole smoother
(30 ms, `dsp::OnePole`). While either channel is invalid it holds its last
value.

The **figure ratio** `p/q` (lowest terms, `1 ≤ p, q ≤ 8`) is the fraction
with the smallest `p + q` within 3 % of `r`; if none, `p = q = 1`. To stop it
flickering between neighbours, a new fraction takes over only after it has
been the choice for 200 ms. After a stretch where either channel was invalid,
the first choice is taken at once (so a fresh lock is found quickly).

### 4.3 Phase

A reference phasor `ψ` advances at `fx / q`, the fundamental of the whole
figure. X is demodulated at harmonic `q` and Y at harmonic `p`:

`Xc = LP(x · e^(−j·q·ψ))`, `Yc = LP(y · e^(−j·p·ψ))`

where `LP` is two complex one-pole low-passes in series, each with time
constant `τd / 2`, `τd = clamp(4 / fx, 20 ms, 2 s)` (the second pole cuts
the demodulation ripple at twice the carrier, which a single pole leaves at
about ±0.02 · max(p, q) in Phase). The figure phase is

`φ = wrap(q · arg Yc − p · arg Xc)` in (−π, π], and **Phase** = `φ / π`.

Errors in `fx` cancel, so φ is constant whenever Y is exactly `p/q` times
X. At 1:1 it reads the plain phase difference: 0 for a
diagonal line, ±0.5 for a circle (Y leading is positive), ±1 for the other
diagonal. When the oscillators are slightly off, φ turns steadily, and Phase
becomes a sawtooth at the slip rate `|q · fy − p · fx|`: two detuned
oscillators make a slow LFO from their own beating. Slip rates above about
`1 / (2π · τd)` read less reliably. While a channel is invalid, Phase holds.

### 4.4 Correlation

`ρ = <xy> / sqrt(<x²> · <y²>)`, each average a one-pole with a 200 ms time
constant on the DC-blocked signals (0 when the denominator is below 1e−8).

### 4.5 Still

The slip `ω` (turns per second) is the change of unwrapped φ over the last
50 ms, with φ first smoothed by a one-pole of `τd / 2` (so the remaining
ripple doesn't read as slip). The slip history starts only once the
demodulator had `τd` to settle after a channel became valid or the figure
ratio changed; until 5 ms of history exist the slip counts as unknown. **Still** goes high once, for 100 ms without a break, both channels are
valid, `|r − p/q| / (p/q) < 0.25 %` and `|ω|` is below the tolerance (Tight
0.05, Normal 0.2, Loose 1 turn/s); it goes low once either condition has
failed for 50 ms. A figure that turns once every five seconds is still enough
at *Normal*.

### 4.6 Y-T mode

The sweep runs left to right over *Timebase*. **Y Rising** starts a sweep at
the next rising crossing of Y (4.1) after the previous sweep ends; **Auto**
does too, but free-runs if no crossing comes within one sweep length (a
triggered sweep starts at the interpolated crossing, to the sub-sample);
**Beat** starts a sweep on every beat while the transport plays
(`floor(ppq)` changes) and free-runs while it is stopped. Y is drawn as the
main trace; X, when patched, as a second trace at half brightness. The
measurement outputs work the same in both modes.

### 4.7 Determinism and transport

Everything is a function of the inputs: no random values and no reset on
transport start or jumps. Two renders of the same input are identical. The *Vintage* screen
effects (5.3) are computed in the view from the sample counter and never
reach an output.

## 5. Module view

```
 ┌────────────────────────────────────────────────────┐
 │ ╭────────────────────────────────────────────────╮ │
 │ │ ┊     ┊     ┊   ╭───╮   ╭───╮   ┊     ┊     ┊  │ │
 │ │┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╱┈┈┈┈┈╲┈╱┈┈┈┈┈╲┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │ │
 │ │┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╲┈┈┈┈┈╱┈╲┈┈┈┈┈╱┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │ │
 │ │ ┊     ┊     ┊   ╰───╯   ╰───╯   ┊     ┊     ┊  │ │
 │ ╰────────────────────────────────────────────────╯ │
 │  X 220.0 Hz  Y 330.1 Hz  3:2  φ +42°  ρ 0.12  ●    │
 │  X Gain  Y Gain  Timebase  Persist  Focus  Intens. │
 └────────────────────────────────────────────────────┘
```

### 5.1 Points from the audio thread

The audio thread writes (x, y, z, s) points (before gain; s is the Y-T
sweep position 0…1, or −1 while the beam waits for a trigger) into a
wait-free single-producer ring of 8192 entries (`XyPointRing`), keeping every `D`th sample with
`D = max(1, ceil(sampleRate / 61,440))`, i.e. up to 1024 points per 60 Hz
UI frame (every sample at 44.1 and 48 kHz, every second at 96 kHz). The
board sends live state about 30 times a second; each time `liveArrays`
drains what is new as `pts` (at most 4096 points; if the view fell behind,
older points are dropped) plus `meta` = [point rate, 50 Hz hum phase of the
first point, dropped count]. The view queues the points and draws, each
animation frame, the ones that belong to the time that passed (keeping about
45 ms queued), so the beam moves smoothly at the screen's frame rate.

### 5.2 Drawing the beam

The screen is an accumulation buffer (floating point, screen resolution).
Each frame it is multiplied by `0.01^(Δt / Persistence)`, then new points are
drawn as a Catmull-Rom curve through the points, four segments per point
interval. Each segment of length `L` (in screen widths) deposits energy

`E = Intensity · b · Δts / max(L, s)`

where `Δts` is the segment's duration, `b = clamp(1 + z, 0, 2)` and `s` the
spot size: brightness is inversely proportional to beam speed, so slow parts
of a figure glow and fast edges are faint, as on a real tube. Lines are drawn
with additive blending at a width of `1 + 5 · (1 − Focus)` pixels with a
Gaussian edge (`E` is the deposit per pixel along the segment, so the
dwell time per pixel is kept). The buffer is shown through a tone curve
`1 − e^(−k·E)` in the phosphor colour (Green `#4ade80`, Amber `#fbbf24`,
Blue-White `#c7d2fe`), with a faint bloom around the brightest parts.
`k = 14 · (1 − f) / Δt` for the frame's fade `f`, so a still figure is
equally bright at any Persistence (longer persistence only lengthens trails).

### 5.3 Screen and character

An 8 × 10 division graticule with minor ticks on the centre lines, drawn
behind the trace as if engraved on the glass, inside a dark round-cornered
bezel. Below, a readout line: X and Y frequencies, the figure ratio, φ in
degrees, ρ and a Still lamp. *Vintage* adds the tube's flaws: slight
pincushion distortion (`x' = x · (1 + 0.06 · y²)`, likewise for y), focus
softening by up to 40 % towards the corners, a 0.4 % mains-hum ripple on the
vertical deflection at 50 Hz, and a two-second warm-up when the view opens,
during which brightness and focus rise from nothing. *Clean* draws none of
these.

## 6. Saved state

Only knob and setting values; the screen buffer is not saved.

## 7. Engine requirements

1. A **bulk live buffer**: no engine change was needed. The module keeps a
   wait-free ring (`XyPointRing` in `XyScopeDsp.h`) and drains it in
   `liveArrays` on the message thread (as Chart Recorder does with its ink).
   It could move to `common/` once another scope-like module needs it.
2. One-pole filters: the module uses its own double-precision one-pole with
   a cached coefficient (`XyPole`) instead of `dsp::OnePole`, which
   recomputes `exp` every sample and runs in float (too coarse for the
   0.2 Hz DC blocker).
3. Inside Voice Cells each voice measures its own pair; the view shows the
   voice the board shows (the one that started last).

## 8. Tests

- Out X and Out Y equal the inputs. Frequency estimates within 0.1 % for sines at 1, 110 and 5000 Hz; invalid
  below −60 dBFS and with Y unpatched (Ratio and Phase hold, Still low).
- Ratio: Y a fifth (×1.5) above X reads 0.585 ± 0.002; an octave reads 1.0.
- Figure ratio: 3:2 for r = 1.5, 7:4 for r = 1.73, 1:1 for r = 1.07 (no
  fraction within 3 %), and no flicker for r swept slowly through 1.49–1.51.
- Phase at 1:1: Y lagging/leading X by 0°, 90°, −90°, 179° reads 0, +0.5,
  −0.5, ≈ +0.99. At 3:2 with a fixed offset, Phase is constant over 10 s.
- Detuned 1:1 (220 vs 220.5 Hz): Phase is a rising saw at 0.5 Hz.
- Correlation: identical signals +1, inverted −1, quadrature sines ≈ 0.
- Still: high for exact 2:1 within 150 ms; low for 220 vs 221 Hz at
  *Normal*; high for 220 vs 220.1 Hz at *Normal*, low at *Tight*.
- Point ring: 1024 points per frame at 48 kHz; overflow drops oldest, never
  blocks the audio thread.
- Y-T: sweeps start at Y's rising crossings; Auto free-runs; Beat sweeps on
  every beat.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- X and Y position knobs and an AC/DC input coupling switch.
- Phase as a direct correction output: a pitch signal that, patched into Y's
  oscillator, locks it to the nearest ratio (a phase-locked loop).
