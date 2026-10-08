# LFO

Type id `lfo` · category *Modulation* · colour proposal `#7dd3fc`

## 1. Purpose

A classic low-frequency oscillator: the fastest way to make something move.
One knob for the speed, a waveform dropdown, free-running or locked to the
song's bars. It complements *Function* (a slope generator that can also act as
an LFO): the LFO has fixed waveforms, phase-locked tempo sync, seeded random
waves and a fade-in, and needs no patching to start moving.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Reset | `trigger` | Restarts the cycle at *Phase* (free-running) and restarts the fade-in. In a Voice Cell, patch *Voice In › Trigger* here so each note starts its LFO fresh. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `control` | The wave chosen in *Wave*, with *Polarity* and the fade-in. |
| Sine, Triangle, Saw, Square | `control` | Each wave at the same rate and phase, so one LFO gives several related shapes. *Saw* rises; *Square* follows *Pulse Width*. |
| Random | `control` | A new random value at each cycle start, held (stepped). |
| Cycle | `trigger` | A pulse at each cycle start. |

All outputs follow *Polarity* and the fade-in.

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Rate | 0.01–50 Hz (exponential) | 1 Hz | Speed when *Sync* is *Free*. |
| Phase | 0–360° | 0° | Shifts the wave within its cycle. Two LFOs with different phases make circles, stereo movement, etc. |
| Pulse Width | 5–95 % | 50 % | Share of the cycle the square spends high. |
| Fade | 0–10 s | 0 s | After Reset (or when the transport starts), the output rises from 0 to full over this time. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Wave | Sine, Triangle, Saw Up, Saw Down, Square, Random Step, Random Smooth | Sine |
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars (one cycle per value) | Free |
| Polarity | Bipolar (−1…+1), Unipolar (0…1) | Bipolar |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Phase and timing

- **Free:** a phase accumulator advances by *Rate* / sample rate; *Rate*
  modulation is applied per sample, so FM from another LFO is smooth.
- **Synced, transport playing:** the phase is derived from the song position,
  `phase = frac(ppq / cycleBeats)`, and the cycle number is
  `floor(ppq / cycleBeats)`. The LFO is always in the same place at the same bar,
  survives loop jumps, and renders identically every time.
- **Synced, transport stopped:** runs free at the synced length and the current
  tempo, so it keeps moving while you patch.
- **Reset** sets the free-running phase to 0 (the wave then starts at *Phase*).
  In synced mode with the transport playing, Reset only restarts the fade-in;
  the phase stays locked to the song.
- *Phase* is added after the accumulator, so modulating it never makes the
  *Cycle* output fire extra triggers.

### 4.2 Waves

With `p` the phase in 0…1 (after *Phase*), bipolar values:

| Wave | Value |
|---|---|
| Sine | `sin(2π p)` |
| Triangle | starts at 0 rising, like the sine: `4p` below 0.25, `2 − 4p` below 0.75, else `4p − 4` |
| Saw Up | `2p − 1` |
| Saw Down | `1 − 2p` |
| Square | `+1` while `p < Pulse Width`, else `−1` |
| Random Step | a seeded value per cycle in −1…+1, held for the cycle |
| Random Smooth | cosine interpolation from this cycle's random value to the next one's |

Random values are a pure function of (*Seed*, cycle number), so synced random
LFOs repeat exactly on every render and after a loop jump.

**Polarity** *Unipolar* maps −1…+1 to 0…1 (`0.5 + 0.5 v`); the Random output
does the same.

### 4.3 Fade

Each Reset (and each transport start) sets the fade gain to 0; it rises
linearly to 1 over *Fade*. In bipolar mode the output fades towards 0; in
unipolar mode towards 0 as well (no offset jump). With *Fade* at 0 the gain is
always 1.

## 5. Module view

The usual knobs and settings, plus a **wave preview** above them: one cycle of
the current wave (with Pulse Width and Phase applied), and a dot that follows
the live phase.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

None beyond what exists: transport position (`ppqAt`), `transportStarted`,
and `Module::liveValues` for the preview's phase dot.

## 8. Tests

- Free rate: 2 Hz gives exactly 2 *Cycle* triggers per second, at the right samples.
- Sync: with the transport playing, phase equals `frac(ppq / cycleBeats)` for every Sync value; a loop jump lands on the same value as the first pass.
- Waves: values at phases 0, 0.25, 0.5, 0.75 match the table; Square follows Pulse Width; Saw Down is Saw Up inverted.
- Unipolar outputs stay in 0…1, bipolar in −1…+1.
- Random: same Seed → same sequence; different Seed → different; Random Smooth is continuous (no step larger than the slope allows).
- Reset restarts the phase; Fade ramps from 0 to full over its time.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Shape morph (continuous blend between the waves) and a *Skew* control.
- Dotted and triplet sync values.
- Per-voice phase spread inside Voice Cells (from *Voice #*).
- Audio-rate band-limited waves.
