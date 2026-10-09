# Test Oscillator

Type id `test-oscillator` · category *Sources* · colour proposal `#f59e0b`

## 1. Purpose

A sine oscillator modelled on the lamp-stabilised bridge oscillators of the
old electronics lab: a big calibrated dial, a range switch, and a sound that
comes from a real self-oscillating loop rather than a phase accumulator. The
loop's imperfections are the point: the amplitude bounces when you turn the
dial, the pitch creeps up as it warms, it hums faintly, and below a loop gain
of 100 % it stops oscillating and becomes a ringing resonator that pings when
kicked, so the same module is a drone, a sweep source and a drum.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct, relative to the dial: 1.0 doubles the frequency. |
| FM | `audio` | Linear frequency modulation, depth set by *FM* (4.2). |
| Kick | `trigger` | Each pulse kicks the resonator (4.4): a ping when it isn't oscillating, a bounce when it is. |
| Audio In | `audio` | Added into the loop: excites, colours or locks the oscillator (4.4). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Sine | `audio` | The amplifier output of the loop (4.1). About ±0.5 when lamp-regulated, up to ±1 when clipping, times *Level*. |
| Square | `audio` | A comparator on the sine with finite edges (4.6), ±*Level*. |
| Sync | `trigger` | One pulse at each upward zero crossing of the sine. |
| Lamp | `control` (unipolar) | The lamp's heat: 0 cold, 0.5 at nominal amplitude, 1 at twice the nominal power (clamped there). A smoothed envelope of the bounces. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Frequency | 1.0–10.0 (log travel) | 4.4 | The dial: multiplied by the *Range* (4.2). |
| Fine | ±50 cents | 0 | Fine tuning. |
| FM | 0–100 % | 0 % | Linear FM depth. |
| Loop Gain | 0–300 % | 120 % | Below 100 % a resonator, 100–150 % lamp-regulated sine, above 150 % clipping (4.3). |
| Settle | 5 ms – 2 s (exp.) | 250 ms | The lamp's thermal time constant: how slowly the amplitude recovers (4.3). |
| Drift | 0–100 % | 40 % | Warm-up, wander and mains hum together (4.5). 0 % is an ideal instrument. |
| Kick | 0–100 % | 50 % | Strength of each Kick (4.4). |
| Level | 0–100 % | 100 % | Output level of Sine and Square. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Range | ×1 (2–20 Hz), ×10 (20–200 Hz), ×100 (200 Hz–2 kHz), ×1k (2–20 kHz) | ×100 |
| Warm-up | Off, On | On |
| Mains | Off, 50 Hz, 60 Hz | 50 Hz |
| Power-up | On load, On play | On play |
| Seed | 0–999 | 1 |

## 4. Behaviour

All loop processing runs at 4× oversampling (2× at 88.2/96 kHz, 1× at
176.4 kHz and above); `fs` below is the oversampled rate, `fb` the base rate.

### 4.1 The loop

A two-pole band-pass resonator (zero-delay-feedback state-variable filter,
cutoff `f`, fixed `Q0 = 5`, `k0 = 1/Q0`) and a saturating amplifier form a
closed loop. With `y` the normalised band-pass output (`k0 · bp`, peak gain 1
at `f`) and `G` the loop gain (4.3), each sample solves

`y = BP(amp(G · y) + e)`

The amplifier `amp` is linear up to ±0.6 and then bends into ±1 with a tanh
knee (the shape of `dsp::softClip`, knee 0.6). *Implementation note:* the
first design used `tanh` here. At the nominal amplitude `tanh` already
compresses by about 6 %, and that compression acts instantly: it took over
the regulation from the lamp, so the amplitude never bounced and the
lamp-regulated range only began at about 110 %. With a linear amplifier
around `A0` the lamp is the only regulator, as in the real instrument.

where `e` is the excitation (4.4, 4.5). The band-pass output is linear in its
input (`bp = α + β · in` for the current state), so the equation has one
solution (`k0 · β · G < 0.3` everywhere). Inside the amplifier's linear range
it is solved exactly (`y = k0 α' / (1 − k0 β G)`); past the knee with two
Newton steps from the previous `y`. There is no unit delay in the loop, so the small-signal
frequency is exactly `f`. **Sine** is the amplifier output `amp(G · y)`,
decimated, times *Level*.

For small signals it is a resonator with `Q_eff = Q0 / (1 − G)`: below
`G = 1` it rings and decays, above it grows at `exp(π · f · (G − 1) / Q0 · t)`
until something limits it.

### 4.2 Frequency

`f_dial = 2 Hz · 10^r · Frequency`, where `r` = 0, 1, 2, 3 for ×1 … ×1k, then

`f = max(1 Hz, f_dial · 2^(Pitch + Fine/1200 + drift/1200) · (1 + FM · fm))`

clamped below `0.45 · fb`. The dial (Frequency, Fine) is smoothed by a
20 ms one-pole in octaves; Pitch and FM are not. Changing *Range* opens the
loop (`G = 0`) for 4 ms as the switch breaks contact: a click, a dip, a bounce.

### 4.3 Loop gain and the lamp

`G = LoopGain · agc · sweepLoss`.

- **Heat:** `h` is a one-pole low-pass of `2y²` with time constant *Settle*,
  so a steady sine of amplitude `A` heats it to `A²`. The nominal amplitude is
  `A0 = 0.5`.
- **Lamp:** `agc = max(1/1.5, 1 / (1 + 8 · max(0, h/A0² − 1)))`: above
  nominal heat the gain falls, never below 1/1.5 (the lamp runs out of range).
- **Sweep loss:** `sweepLoss = 1 − 0.015 · min(s, 20)`, where `s` is the rate
  of change of `log2 f` from the dial and Pitch (octaves per second, smoothed
  over 10 ms; FM excluded). Fast sweeps lose up to 30 % gain.

What follows from this:

- **100–150 %:** the oscillation settles where `G = 1`, at `A ≈ A0`
  (`h = A0² · (1 + (LoopGain − 1)/8)`, e.g. A = 0.507 at 120 %): a very clean
  sine (third harmonic about −58 dB at the default *Settle*, from the heat's
  ripple; it rises as *Settle* shortens). At exactly 100 % the loop is
  marginal (it neither grows nor decays), at exactly 150 % the lamp is at its
  limit (`G = 1` for any heat above it). The regulation is a lagged feedback
  loop, so any disturbance (a sweep, a range change, a kick) makes the
  amplitude **bounce**: overshoot, undershoot and settle. Linearised, the
  bounce rings at `ω ≈ √(16 · π f / Q0 / (LoopGain · Settle))` (about 20 Hz
  at 880 Hz and 500 ms, slower on low ranges and long *Settle*) and decays as
  `exp(−t / (2 · Settle))`, so it settles within 2 % in about 7 *Settle*
  times. The heat is a strong low-pass of the amplitude, so it moves only a
  few per cent during a bounce. Long *Settle*
  gives slow, deep swells; turning the dial fast starves the loop (sweep loss),
  the lamp cools, and when the dial stops the amplitude surges and rings.
- **Short Settle:** when *Settle* is shorter than about two periods, the heat
  follows the waveform itself: the gain wobbles at `2f`, the sine distorts,
  and at higher loop gains it squeals and flutters in bursts (squegging).
- **Above 150 %:** the lamp is at its limit and the amplifier's knee limits the amplitude
  instead: louder (up to ±1), harder and rich in odd harmonics; at 300 % close
  to a rounded square. The lamp still moves, so bounces remain.
- **Below 100 %:** no oscillation; any energy decays with
  `T60 ≈ 2.2 · Q0 / ((1 − LoopGain) · f)` seconds (e.g. 2.2 s at 100 Hz and
  95 %). Close to 100 % the loop whistles faintly on its own noise floor.
- **Startup:** the noise floor (4.5) grows into a tone at the rate in 4.1:
  about 0.3 s at 440 Hz and 110 %, many seconds on ×1.

### 4.4 Excitation

`e = 0.25 · AudioIn + kick + noise + hum`.

- **Kick:** each pulse adds a step to the band-pass state, scaled so that from
  rest the ping's first peak is `2 · Kick · A0` (so 50 % pings at nominal
  level), independent of frequency: `ic1 += 2 · Kick · A0 / k0 · √(1 + g²)`
  (the trapezoidal state rotates with norm `√(1 + g²)` times the band-pass
  amplitude). While oscillating, a kick knocks the
  amplitude off nominal and the lamp bounces it back.
- **Audio In:** below 100 % a tuned ringing filter that saturates when driven;
  above, the loop locks to partials near `f` and beats against others.

### 4.5 Drift

- **Noise floor:** seeded `dsp::WhiteNoise` (from *Seed* and voice index) at
  1e-4 (−80 dB), always on: it starts the oscillation. Inside a Voice Cell the
  value-noise streams below are offset by `100 · (voice + 1)`.
- **Warm-up** (when On): `−100 · Drift · exp(−t / 10 s)` cents, `t` seconds
  since power-up: the pitch rises by up to a semitone, mostly within 30 s.
- **Wander:** `15 · Drift · (0.7 · vn(0.11 · t, 11) + 0.3 · vn(0.6 · t, 12))`
  cents, where `vn(x, stream)` is value noise: `2 · uniform01(Seed, ⌊x⌋,
  stream) − 1` at integer knots, smoothstep-interpolated. Warm-up and wander
  are evaluated every 16 samples and ramped in between.
- **Mains hum:** `hum = sin(2π fm t) + 0.4 · sin(6π fm t)` at 50 or 60 Hz,
  added to `e` at `0.002 · Drift` and to Sine at `0.001 · Drift` (−60 dB at
  100 %). Tuned near the mains frequency (or 150/180 Hz) the oscillator gets
  pulled and locks to it.

### 4.6 Square and Sync

**Square:** `q = clamp(30 · y / max(√h, 1e-4), −1, 1)` (duty stays 50 %
through bounces), slew-limited to 20 µs edges at the oversampled rate and
decimated (band-limited); it fades out as `√h` falls from −60 to −72 dB.
**Sync** fires on upward zero crossings of `y` with hysteresis (re-armed
below `−0.1 · √h`), only while `√h` is above −60 dB, at the base-rate sample
offset of the crossing, delayed by the decimator's latency (35 samples at 4×)
so it lands on Sine's crossing.

### 4.7 Power-up, transport and determinism

- **On play:** on transport start the module powers up: resonator and heat
  cleared, noise reseeded, `t = 0`. Renders from the same start are identical,
  warm-up and startup included. Jumps while playing don't reset (an
  oscillator has no position); stopping leaves it running.
- **On load:** powers up on load or *Seed* change, then runs free.
- `t` counts samples since power-up, independent of tempo.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────┐
 │        ╭───── 3 ── 4 ── 5 ─── 6 ───╮        ( ◉ ) lamp     │
 │      2 ╱          ▲              ╲ 7                       │
 │     1.5          dial              8     ┌──────────────┐ │
 │      1 ╲________________________╱ 9  10  │ ∿∿∿∿  scope  │ │
 │                                          └──────────────┘ │
 │   RANGE  [×1] [×10] [×100] [×1k]      440.0 Hz  +3 ct     │
 │   Fine  FM  Loop Gain  Settle  Drift  Kick  Level          │
 └──────────────────────────────────────────────────────────┘
```

A large log-printed dial (drag vertically, Shift for fine) and a four-button
range switch. The lamp glows with *Lamp* (dark at 0, orange at 0.5, white-hot
at 1), so bounces are visible. The scope shows two periods triggered on Sync
and freezes when the loop is silent; the readout includes drift.

## 6. Saved state

Only knob and setting values; a loaded board warms up again.

## 7. Engine requirements

1. **Resonator access:** the implicit loop solve needs the instantaneous
   band-pass response (`bp = α + β · in`), double-precision state and no 5 Hz
   clamp (2 Hz at 192 kHz oversampled gives `g ≈ 3e-5`). *Implemented in
   `TestOscillatorDsp.h`*: the few lines of the TPT SVF are written out there
   in double (shared files were not changed); `dsp::Svf` could later expose
   `α`/`β` instead.
2. **Oversampling:** `dsp::Upsampler` / `dsp::Downsampler` (`Oversampler.h`)
   for the loop and Square.
3. **Value noise:** `TestOscillatorDsp::valueNoise(key, x, stream)` (local,
   on `dsp::uniform01`); could move to `Random.h`.
4. **Scope:** `liveArrays` carries `scope` (128 points: two periods of Sine
   from a Sync pulse, at most 30 captures a second); `liveValues` carries
   `lamp`, `freq` (Hz with Pitch and drift, without FM) and `drift` (cents).
5. **Voice Cells:** one loop per voice, streams `+ voice index`; *Voice In ›
   Trigger* into *Kick* below 100 % gives a tuned percussion voice.

## 8. Tests

- Small-signal frequency: at 105 % and long Settle, the settled frequency is
  within 1 cent of `f_dial` on every range (Drift 0, Mains Off).
- Regulation: settled `y` and Sine peaks within 5 % of `A0` for Loop Gain
  105–145 %; third harmonic below −30 dB; Lamp ≈ 0.5. Short Settle distorts.
- Bounce: after a range change ×10 → ×100 (Settle 500 ms) the amplitude dips,
  surges above +10 %, then settles within 2 % in under 10 Settle times; the
  heat overshoots too.
- Resonator: at 95 %, 100 Hz, a kick peaks at `2 · Kick · A0` (±5 %), decays
  60 dB in 2.2 s (±10 %).
- On play: two renders from the same start are bit-identical.
- Warm-up: at Drift 100 % the warm-up term starts at −100 cents and is within
  5 cents at 30 s (wander, ±15 cents, comes on top); Drift 0 → no warm-up,
  wander or hum.
- Square stays 50 % duty (±1 %) during a bounce; Sync fires once per period.
- The demo types file includes the module (not yet: `demo-types.json` is a
  shared file; regenerate it with `bleep_dump_types --write` when merging).

## 9. Later

- A ×10k range (20–200 kHz) feeding an internal mixer down to audio, for
  heterodyne whistles.
- A Quadrature output (the resonator's low-pass, 90° behind the sine).
