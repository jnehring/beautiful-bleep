# Wave Analyzer

Type id `wave-analyzer` · category *Audio* · colour proposal `#22d3ee`

## 1. Purpose

A very narrow, tunable band-pass that picks single partials out of any sound,
modelled on the heterodyne wave analyzers of the old measurement lab. Turn the
big dial and individual harmonics sing out one by one; let it sweep and it
draws a spectrum on its plotter while playing a melody of partials; let it
lock and it hunts for the strongest partial and follows it. The imperfections
are the point: the filter rings when it moves, the oscillator drifts, the lock
loop hunts and wobbles.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In | `audio` | The sound to analyse. |
| Pitch | `pitch` | Added to *Frequency* in octaves (1 V/oct). |
| Reset | `trigger` | Restarts a free sweep; in *Lock* mode starts a new hunt. |
| Hold | `gate` | While high, the tuned frequency is frozen (sweep paused, lock loop held). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Thru | `audio` | *In*, unchanged. |
| Band | `audio` | The isolated band around the tuned frequency, at its own pitch (4.2). |
| Shifted | `audio` | The same band moved to the *Listen* frequency (4.3). |
| Level | `control` (unipolar) | Band level on a dB scale with needle ballistics (4.4). |
| Track | `pitch` | The tuned (or locked) frequency: `log2(f / 261.626)`. |
| Peak | `trigger` | A pulse when *Level* rises through *Threshold* (4.4). |
| Locked | `gate` | High while the lock loop holds a partial (4.6). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Frequency | 20 Hz–20 kHz (exp.), or one decade (see *Range*) | 440 Hz | The tuning dial; sweep start in *Sweep*, hunt centre in *Lock*. |
| Span | 0–10 octaves | 4 oct | Sweep width above *Frequency*. |
| Sweep Time | 0.1–120 s (exp.) | 8 s | Length of one sweep when *Sync* is *Free*. |
| Capture | 0–24 semitones | 7 st | Lock window: ± around *Frequency*. |
| Drift | 0–100 % | 15 % | Wander of the local oscillator (4.7). |
| Listen | 50 Hz–4 kHz (exp.) | 800 Hz | Pitch of the *Shifted* output. |
| Threshold | 0–100 % | 60 % | *Peak* threshold on the *Level* scale. |
| Gain | −20…+40 dB | +12 dB | Gain on *Band* and *Shifted* (isolated partials are quiet). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Manual, Sweep, Lock | Manual |
| Bandwidth | 3 Hz, 10 Hz, 30 Hz, 100 Hz, 1/3 octave | 10 Hz |
| Range | Full, 20–200 Hz, 200 Hz–2 kHz, 2–20 kHz | Full |
| Sweep Dir | Up, Down, Up-Down | Up |
| Sync | Free, 1/32 … 8 bars (`dsp::syncNames`), 16, 32, 64 bars | Free |
| Floor | −24, −36, −48, −60, −72, −96 dB | −60 dB |
| Ballistics | Needle, Fast | Needle |
| Seed | 0–999 | 1 |

*Range* is the lab range switch: in a decade range the *Frequency* knob
covers only that decade, ten times finer; *Pitch* is added afterwards. (The
knob's normalised position is mapped by *Range*, `WaveAnalyzerDsp::dialHz`;
the plain knob text always shows the Full scale, so the view hides the small
knob and draws the big dial with the *Range* scale.)

## 4. Behaviour

### 4.1 Tuning

The tuned frequency is `f = clamp(F · 2^(pitch + drift), 10 Hz, 0.45 · fs)`,
where `F` is the dial (or the sweep or lock loop, 4.5 and 4.6). The
bandwidth `B` is the setting, or for 1/3 octave
`B = f · (2^(1/6) − 2^(−1/6)) ≈ 0.2316 · f`.

### 4.2 Complex demodulation

```
 In ─► DC block (5 Hz) ─► Hilbert ─► a = x + j·H(x)
 a · e^(−jφ) ─► 4-pole low-pass at B/2 (on I and Q) ─► Z = I + jQ
 Band = Re(Z · e^(+jφ))        Shifted = Re(Z · e^(+jψ))
```

- **Analytic input:** the Hilbert pair (shared with *Freq Shifter*) makes the
  input one-sided, so the mixer has no image at `2f` and low tunings stay
  clean. Below about 15 Hz the network leaks; the tuning floor is 10 Hz.
- **Local oscillator:** phase `φ` in cycles, a `double` advanced by `f / fs`
  and wrapped to [0, 1), so a 3 Hz band stays on a 15 kHz partial for hours.
  `e^(−jφ)` comes from `std::cos`/`std::sin` of the double phase.
- **Low-pass:** two cascaded zero-delay-feedback two-pole sections at
  Butterworth Q (0.5412 and 1.3066), cutoff `B/2`, on I and Q. The band is
  therefore `B` wide at −3 dB with 24 dB/octave skirts on each side of `f`.
- **Gain:** a sine of amplitude `A` at `f` gives `|Z| = A` (unity *Band*);
  *Band* and *Shifted* are then scaled by *Gain* and pass `dsp::softClip`.
- **Ringing:** the filter needs about `1/B` seconds to respond (330 ms at
  3 Hz); moving faster smears and rings, which is part of the sound.

### 4.3 Shifted

A second oscillator (beat-frequency oscillator, phase `ψ`, also `double`)
runs at *Listen*. `Re(Z · e^(jψ))` places the band at *Listen* instead of `f`:
every partial is heard at the same pitch. A partial `Δ` Hz off the tuned
frequency is heard at `Listen + Δ`, so vibrato and drift become small bends
around *Listen*; at wide bandwidths neighbouring partials beat and it whistles
and turns vocal.

### 4.4 Level and Peak

`dB = 20 · log10(max(|Z|, 1e−6))`; a full-scale sine reads 0 dB. The mapped
value `m = clamp((dB − Floor) / −Floor, 0, 1)` drives the needle:

- **Needle:** a two-pole mass-and-spring filter on `m`, natural frequency
  2.1 Hz and damping 0.8 (about 300 ms to settle, a 1.5 % overshoot), like a
  moving-coil meter. Computed per sample in zero-delay-feedback form.
- **Fast:** a one-pole with 5 ms time constant (`dsp::OnePole`).

*Level* is the needle position, stopped at the pins 0 and 1 (the needle
filter itself is not clamped). *Peak* fires when *Level* rises above
*Threshold* and re-arms below `Threshold − 0.03`. While sweeping, each
loud partial fires once: a rhythm read from the spectrum.

### 4.5 Sweep

A ramp `r` in [0, 1) moves the dial: `F = Frequency · 2^(Span · s)`, with
`s = r` (Up), `1 − r` (Down) or a triangle `1 − |2r − 1|` (Up-Down).

With *Sync* set and the transport playing, `r = wrap01(ppq / syncBeats)`
(seekable); otherwise `r` advances `1 / (Sweep Time · fs)` per sample, *Reset*
zeroes it and *Hold* pauses it.

A sweep faster than about `B² / 2` Hz/s reads partials low and draws them
late and wide, as on the bench; the view then lights *Too Fast*.

### 4.6 Lock

The lock loop has two states, *Hunt* and *Lock*. The window is
`W = [Frequency · 2^(−Capture/12), Frequency · 2^(+Capture/12)]`.

The loop works on the dial value `F` (so `f = F · 2^(pitch + drift)` as in
4.1, and `W` moves with *Pitch*); its frequency terms are divided by
`2^(pitch + drift)`.

- **Hunt:** the dial scans `W` once upwards at
  `max(B² / 2 Hz/s, width(W) / 8 s)` (evaluated at the current `F`, so a
  1/3-octave band scans faster higher up). It remembers the frequency `f*`
  where `|Z|` was largest. At the end it jumps to `f*` and enters *Lock* if
  that peak read above *Floor* + 6 dB, otherwise it scans again. Because the
  band reads a moving dial late by its group delay (`0.832 / B` s for the
  4-pole Butterworth), `f*` is first moved back by `rate · 0.832 / B`. A hunt
  lasts at least `1/B` seconds (it matters only for *Capture* 0).
- **Lock:** a second-order phase-locked loop with frequency-locked-loop aid.
  The phase error is `e = atan2(Q, I)` (radians), the turn of `Z` per sample
  `τ = arg(Z[n] · conj(Z[n−1]))`; the integrator advances by
  `(Ki · e · dt + Kf · τ) / 2π` and `f = integrator + Kp · e / 2π`, with
  `ωn = 2π · B/16`, damping 1, `Kp = 2 · ωn`, `Ki = ωn²`, `Kf = ωn`. The
  integrator starts at `f*`; it and `f` are clamped to `W`. Locked, `τ` is 0
  and only the PLL acts; pulling in, the FLL term drags the loop onto the
  partial without slipping cycles. It still springs: it overshoots and rings
  for a few cycles as it pulls in (settled within about 0.8 s at 10 Hz).
  (Designed first with `ωn = 2π · B/8`, damping 0.707 and no FLL term: with
  the low-pass lag at the loop's crossover that left about 5° of phase
  margin. It rang for seconds and, started a few hertz off, slipped cycles
  forever while reporting *Locked*.)
- **Losing lock:** after 4/B seconds with `|Z|` more than 20 dB below the
  value at lock-in (the hunt's peak), or with `f` pinned to an edge of `W`
  (only when `W` has a width), it hunts again.
  *Reset* forces a new hunt; *Hold* freezes `f` and the integrator.
  *Locked* is high in *Lock*; *Track* then works as a crude pitch tracker.

### 4.7 Drift

The local oscillator wanders like a warm valve set:
`drift = Drift · 0.02 · d(t)` octaves (up to ±24 cents), where `d(t)` is a
cubic (Hermite) interpolation of seeded values `2 · uniform01(Seed, k, 1) − 1`
at knots `k` spaced 6 s apart (`dsp::smoothNoise`, a Catmull-Rom curve),
`t` being song time while playing (seekable; the transport's sample position
divided by the sample rate) and a free-running counter otherwise. It is
recomputed every 16 samples. A partial slides out of a 3 Hz band and
back; in *Lock* the loop chases it.

### 4.8 Transport and edge cases

- On transport start: `φ` and `ψ` reset to 0, the Hilbert pair, DC block,
  filters and needle clear, a free sweep restarts, the lock loop starts a
  hunt. A render from the same position is identical.
- *Hold* freezes the whole tuned frequency `f` (dial, sweep, lock loop,
  *Pitch* and drift); on release it jumps to the current value and the band
  rings.
- *Gain* is smoothed (20 ms); *Shifted*'s oscillator is skipped when nothing
  reads it.
- *Bandwidth* changes recompute coefficients only (and only when `B` moves
  by more than 0.1 %, so a 1/3-octave sweep does not recompute every
  sample); the I/Q states are cleared when they and their input fall below
  1e−20.
- In a Voice Cell each voice has its own analyser; drift uses stream `1 + voice`.

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │   ╭──── dB ────╮      ╭───────────────╮    Mode   [Sweep ▾]   │
 │   │  ╲  ·  ·   │      │    ·  440 ·   │    BW     [10 Hz ▾]   │
 │   │    ╲       │      │  ·    ╲    ·  │    Range  [Full  ▾]   │
 │   ╰─────●──────╯      ╰───────●───────╯    ● Locked ● Too Fast│
 │   plotter  −0 ┤      ▌                                        │
 │            ─30┤  ▌   █▌   ▌    ▌                              │
 │            ─60┼──█───██───█─▁──█──▁───▁───── ▲ (pen)          │
 │                20   100      1k       10k    Hz               │
 └───────────────────────────────────────────────────────────────┘
```

- **Needle meter:** an arc from *Floor* to 0 dB; *Threshold* as a red tick.
- **Frequency dial:** a large calibrated dial printed with the *Range* scale;
  dragging it sets *Frequency*, its pointer shows the actual `f`.
- **Plotter strip:** level against log frequency, 20 Hz–20 kHz, 384 columns.
  Each column keeps the highest needle value seen while `f` was in it during
  the current pass, drawn as ink; the previous pass stays as faded ink, so a
  spectrum builds up slowly, sweep by sweep. In *Manual* and *Lock* the pen
  leaves a trace wherever the dial goes. Clicking the strip clears it.
  Implementation: the node publishes the per-column needle maxima since the
  last read as the live array `ink` (read and reset), plus live values `f`,
  `level`, `locked`, `hunting`, `tooFast` and `pass`; `pass` counts sweep
  passes (a wrap of `r`, *Reset*, a transport start, entering or leaving
  *Sweep*), and the view moves the current ink to the faded layer when it
  changes.

## 6. Saved state

Only knob and setting values. The plotter ink is not saved.

## 7. Engine requirements

All met with existing code:

1. **Hilbert pair:** `dsp::HilbertTransformer` (`patch/common/dsp/Hilbert.h`),
   band edge 15 Hz.
2. **Low-cutoff filter:** the double-precision `dsp::SvfLow` (`Svf.h`) for
   I, Q and the needle.
3. **Array live values:** 384 atomic per-column maxima, read and reset by
   `liveArrays` (key `ink`).
4. Sync lengths of 16, 32 and 64 bars: `WaveAnalyzerDsp::syncNames()` /
   `syncBeats()` extend `dsp::syncNames()` locally.

## 8. Tests

- A 1 kHz sine at amplitude 0.5, tuned to 1 kHz: *Band* settles to the same
  sine within 0.1 dB; tuned 3·B away: attenuated by more than 40 dB.
- Bandwidth: −3 dB points at `f ± B/2` within 5 % for each setting.
- No image: tuned to 30 Hz at B = 100 Hz, a 30 Hz input leaves its `2f`
  (60 Hz) term in `|Z|` below −30 dB (a real mixer would pass it: it lies
  inside the 50 Hz low-pass). (Written first as "a 60 Hz input reads below
  −30 dB", but 60 Hz is inside a 100 Hz band around 30 Hz.)
- Phase accuracy: the double phase accumulator after one hour at 15 kHz
  (44.1 kHz, where the increment is not exact) is within 1e−6 cycles of the
  exact phase; a 3 Hz band started with that phase on the partial an hour in
  reads within 0.5 dB.
- *Shifted*: a 2 kHz sine tuned at 2 kHz, *Listen* 800 Hz → 800 Hz sine.
- Level mapping: 0 dBFS → 1, *Floor* → 0; Needle overshoot under 2 %.
- Peak: one trigger per crossing, no chatter. Synced sweep: `f` = fn(ppq).
- Lock: input 523 Hz, *Frequency* 440 Hz, *Capture* 7 st → *Locked* within
  (scan time + 1 s), *Track* within 2 cents of `log2(523 / 261.626)`.
  Two sines (−6 dB and 0 dB) in the window: it locks to the louder one.
- Drift 0 → `f` exact; Drift > 0 → identical over two renders, |drift| ≤ 24 ct.
- The demo types file includes the module (`patch.ui-types`): needs
  `bleep_dump_types --write patch/board/ui/demo-types.json` (a shared file,
  regenerated when the module is merged).

## 9. Later

- Warm-up: the oscillator settles from a seeded offset over a minute.
- A second band (two dials, stereo out); *Lock* to a played pitch's harmonic.
