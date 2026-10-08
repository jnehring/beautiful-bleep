# Sweep Generator

Type id `sweep-generator` · category *Sources* · colour proposal `#fb923c`

## 1. Purpose

A function generator with a built-in frequency sweep, modelled on the bench
instruments that measure a circuit's response across the audio band. It
glides from *Start* to *Stop* over a set time or a number of bars, and puts
out what other gear needs to follow: the sweep ramp, the frequency as pitch
(so a filter can track it), and triggers at markers, sweep ends and cycles.

Musically it is a riser, a siren, a tone-burst source and a tracking test
signal for feedback patches. The old benches' character is kept on purpose:
*Drift*, a warm-up that settles after transport start, and an audible
*Retrace* as the sweep flies back.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Trigger | `trigger` | Starts a sweep (*Triggered*), a burst (*Burst*), or restarts the sweep (*Continuous*, *Gated*). |
| Gate | `gate` | In *Gated* mode the sweep runs only while high. |
| Hold | `gate` | While high, the sweep position freezes; the tone keeps running. |
| Pitch | `pitch` | Shifts *Start*, *Stop* and the markers together (1.0 = one octave). |
| FM | `audio` | Linear frequency modulation, depth set by *FM* (4.4). |
| AM | `audio` | Amplitude modulation: gain × max(0, 1 + AM). Unpatched = 0. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The waveform, phase continuous and band-limited (4.5), times *Level*. |
| Sweep | `control` (unipolar) | The sweep position `s` (0 at *Start*, 1 at *Stop*): the sweep ramp. |
| Freq | `pitch` | The current frequency as 1 V/oct: `log2(f / 261.626)`, drift included. |
| Marker | `trigger` | A pulse whenever the frequency crosses an active marker. |
| Marker Gate | `gate` | High for *Marker Width* after each marker pulse. |
| End | `trigger` | A pulse at the end of each sweep (each half in *Up-Down*). |
| Sync | `trigger` | A pulse on every waveform cycle (phase wrap). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Start | 0.01 Hz – 20 kHz (exp.) | 100 Hz | Frequency at `s = 0`. |
| Stop | 0.01 Hz – 20 kHz (exp.) | 5 kHz | Frequency at `s = 1`. May be below *Start*. |
| Sweep Time | 10 ms – 100 s (exp.) | 4 s | Length of one sweep when *Sweep Sync* is *Free*. |
| Symmetry | −100 … +100 % | 0 % | Skew of sine and triangle, duty of square and pulse, curve of the ramps (4.5). |
| Marker 1–3 | 0.01 Hz – 20 kHz (exp.) | 250 Hz, 1 kHz, 4 kHz | Marker frequencies. |
| FM | 0–100 % | 0 % | Depth of the *FM* input. |
| Drift | 0–100 % | 15 % | Slow seeded frequency wander and warm-up offset (4.6). |
| Level | 0–100 % | 80 % | Output level of *Out*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Waveform | Sine, Triangle, Square, Ramp Up, Ramp Down, Pulse | Sine |
| Mode | Continuous, Triggered, Gated, Burst | Continuous |
| Sweep Sync | Free, 1/4, 1/2, 1 bar, 2, 4, 8, 16 bars | Free |
| Law | Log, Lin | Log |
| Direction | Up, Down, Up-Down | Up |
| Retrace | Instant, Glide | Instant |
| Burst Count | 1–64 cycles | 4 |
| Markers | 0–3 (active markers) | 0 |
| Marker Width | 1, 5, 10, 25, 50, 100 ms | 10 ms |
| Phase Reset | Off, On | Off |
| Warm-up | Off, 10 s, 30 s, 2 min | 30 s |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Sweep progress and position

A progress value `p` runs from 0 to 1 over one sweep cycle of length `L`:
*Sweep Time* when *Sweep Sync* is *Free*, else the synced length in seconds
at the current tempo (`syncBeats · 60 / bpm`, 1 bar = 4 beats). The position
`s` follows *Direction*: **Up** `s = p`; **Down** `s = 1 − p`; **Up-Down**
`s = 1 − |2p − 1|` (up then down within `L`, so it still spans its bars).

### 4.2 Frequency law

With `a = Start · 2^Pitch` and `b = Stop · 2^Pitch`:

**Log** `f = a · (b / a)^s` (equal time per octave); **Lin**
`f = a + (b − a) · s` (equal time per hertz: it rushes through the bass and
lingers in the treble). The drift factor (4.6) multiplies `f`; markers shift
by `2^Pitch` too.

### 4.3 Modes

- **Continuous:** in *Free* `p` advances by `1/(L · sr)` per sample and
  wraps; synced and playing, `p = wrap01((ppq − o) / syncBeats)`, a pure
  function of song position. *Trigger* resets `p` to 0 (synced: sets the
  offset `o` to the trigger's ppq; transport start sets `o = 0`).
- **Triggered:** waits at *Start* until a trigger, then runs one sweep of
  length `L` (tempo at the trigger); at `p = 1` *End* fires and the tone holds
  at the final frequency. A retrigger mid-sweep restarts from 0.
- **Gated:** `p` advances only while *Gate* is high (wrapping as in
  Continuous) and pauses while low. *Trigger* resets `p` to 0.
- **Burst:** each trigger plays *Burst Count* whole cycles from phase 0 at
  the current sweep frequency, with 0.5 ms raised-cosine fades; *Out* is
  silent between bursts. The sweep runs as in Continuous, so bursts step
  through the band like a stepped response measurement. A trigger during a
  burst restarts it after the fade-out.

*Hold* freezes `p` in every mode; synced, releasing it rejoins the grid.

### 4.4 Oscillator, phase and FM

The phase `φ ∈ [0, 1)` advances by `f_i / sr` with
`f_i = f · (1 + 2 · FM · x_FM)`, clamped to ±0.45 · sr: linear and
through-zero, with a constant index across the sweep. Frequency changes never
touch the phase, so wraps and retriggers don't click. With *Phase Reset* On,
a trigger sets `φ = 0`, the step smoothed by a polyBLEP.

**Retrace.** When a Continuous Up or Down sweep wraps, *Instant* jumps back.
*Glide* flies back over `min(5 % of L, 250 ms)` on an exponential curve (time
constant a fifth of that), audible like a bench sweeper's flyback; *Sweep*
follows it, *End* fires at its start, and markers stay silent during it.

### 4.5 Waveforms

With `k = 0.5 + 0.45 · Symmetry` (0.05 … 0.95):

- **Sine:** warped phase `ψ = φ < k ? 0.5 φ / k : 0.5 + 0.5 (φ − k) / (1 − k)`,
  `y = sin(2πψ)`. The kink at `φ = k` is corrected with a polyBLAMP.
- **Triangle:** rises from −1 to +1 over `[0, k)`, falls over `[k, 1)`;
  polyBLAMP at both corners. It starts at −1, so Burst fades it in.
- **Square:** +1 for `φ < k`, −1 after; polyBLEP at both edges.
- **Pulse:** a narrow pulse of duty `d = 0.01 + 0.12 · (Symmetry + 1)`
  (1 … 25 %), with its mean removed and peak at +1:
  `y = ((φ < d ? 1 : −1) − (2d − 1)) / (2 − 2d)`; polyBLEP at both edges.
- **Ramp Up / Down:** `y = ±(2 φ^c − 1)` with `c = 2^(−2 · Symmetry)`
  (convex to concave); polyBLEP at the reset.

Below audio rate *Out* doubles as a sweeping LFO (not DC-blocked).

### 4.6 Drift and warm-up

The frequency is multiplied by `2^(c / 1200)` with
`c = Drift · (25 · n(t) + w(t))` cents:

- `n(t)` is seeded smooth noise: cosine interpolation between values
  `2 · uniform01(Seed, j, 1) − 1` at knots `j` every 3 s, plus half as much
  at 0.7 s knots (stream 2). Time `t` is song time while playing (from ppq,
  so a seek lands on the same drift), else seconds since the module started.
- `w(t) = 40 · u · e^(−t_s / τ)` with `u = 2 · uniform01(Seed, 0, 3) − 1` and
  `τ` = *Warm-up* / 3, `t_s` counting from transport start (or module
  creation): it starts off-pitch and settles like a cold bench instrument.

### 4.7 Markers and triggers

A marker fires when `log2(f_sweep / m_i)` changes sign between samples, in
either direction (drift and FM excluded). *Marker Gate* then stays high for
*Marker Width*, retriggerable. *End* fires at `p = 1` and at the Up-Down
turning point; *Sync* fires on each phase wrap, forwards or backwards.

### 4.8 Determinism, transport and seeking

- Transport start resets `p` and `φ` to 0 (Triggered waits at *Start*) and
  restarts warm-up, so renders from the same position are identical.
- Synced position and drift follow song position: on a seek they jump to the
  new place while `φ` continues, so the tone never clicks.
- Transport stopped: synced lengths use the last tempo (120 bpm if none).

## 5. Module view

```
 ┌────────────────────────────────────────────────────────────┐
 │ 20k ┤                                    ╱ ·               │
 │  4k ┤ - - - - - - - - - - - - - - - - - ╱ - - - - - M3     │
 │  1k ┤ - - - - - - - - - - - - - ╱ - - - - - - - - - M2     │
 │ 250 ┤ - - - - - - - - ╱ - - - - - - - - - - - - - - M1     │
 │ 100 ┤ ─────────╱─────────── time ──────────────────▶       │
 │  1342 Hz    Log  Up  4.0 s          [∿][△][⊓][⟋][⟍][ı]     │
 │  Start  Stop  Time  Sym  M1  M2  M3  FM  Drift  Level      │
 └────────────────────────────────────────────────────────────┘
```

A canvas plots frequency (log axis, 10 Hz – 20 kHz, decade labels) against
time over one cycle: the sweep curve from the settings (straight in Log,
bowed in Lin, a tent in Up-Down, retrace faint), active markers as dashed
lines and the current position as a bright dot. A dial-style readout shows
the current frequency. Dragging the curve's ends sets *Start* and *Stop*;
dragging a marker line moves it. Waveform is a row of icon buttons.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

1. **polyBLEP / polyBLAMP helpers:** polyBLEP exists privately in
   `OscillatorDsp.h` and `Drums.h`; move it to a shared `dsp/Blep.h` and add
   polyBLAMP for the triangle and skewed-sine corners.
2. **Transport:** song position (ppq), tempo and play state per block, as
   used by Random and LFO; `dsp::syncBeats` in `Tempo.h` needs the longer
   values (16 bars = 64 beats) or a second table for this module's choices.
3. Uses `dsp::uniform01` (`Random.h`) for drift, `dsp::OnePole`
   (`Smoothing.h`) to smooth knob jumps over 5 ms, and **live values**
   (exists) to publish `s` and `f` each UI frame for the dot and readout.

## 8. Tests

- At `s = 0.5`: Log gives `√(Start · Stop)`, Lin `(Start + Stop) / 2`;
  *Freq* equals `log2(f / 261.626)` within 1 cent (Drift 0).
- Synced: `p = wrap01(ppq / syncBeats)` after a seek; *End* lands on bars.
- Phase continuity: no jump beyond the waveform's slope bound across a wrap,
  retrigger or seek (Phase Reset Off).
- Triggered: waits at *Start*, one sweep and one *End* per trigger, then
  holds at *Stop*. Gated advances only while high; Hold freezes `p`.
- Burst: exactly *Burst Count* *Sync* pulses per burst and silence between.
- Markers: a 100 Hz → 5 kHz Log sweep with markers at 250 Hz, 1 kHz and 4 kHz
  fires three pulses at the predicted times (±1 sample); none during retrace.
- Aliasing: a Square at 15 kHz has aliases at least 20 dB below a naive one.
- Drift: same Seed → identical renders; Drift 0 → exact frequency; the
  warm-up offset is down to 5 % (`e^−3`) after *Warm-up*.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A **Tracking** input whose level along the sweep is drawn as a response
  curve in the view; stepped sweeps with *Dwell*; lamp-style amplitude bounce.
