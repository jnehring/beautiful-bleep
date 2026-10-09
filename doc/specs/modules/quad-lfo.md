# Quad LFO

Type id `quad-lfo` · category *Modulation* · colour proposal `#ea580c`

## 1. Purpose

Four LFOs in one module, with a global *Mode* that decides how they relate:
four independent rates, one rate in quadrature (0°, 90°, 180°, 270°), one rate
with an adjustable phase spread, or one rate divided into related
sub-rates. Each channel picks its own waveform. It is the quickest way to get
stereo circles, rotating pans, four-voice movement or interlocking
polyrhythms, and it locks to the song's bars with musical rates.

It shares the *LFO* module's waves and sync model, so a patch can move from one
to four LFOs without surprises. *Function* and *Tidal* can also make four
related outputs, but from one slope with one shape; Quad LFO has a waveform
per channel and independent rates.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Reset | `trigger` | Restarts all four channels at their phase offsets (4.4). |
| Clock | `trigger` | When patched, the master rate follows the clock: one cycle of channel 1 per *Clock Ratio* pulses (4.3). |
| Hold | `gate` | While high, all four outputs freeze (phases stop); they resume where they were. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out 4 | `control` (follows *Polarity*) | The four LFOs, each with its own wave and level. |
| Sum | `control` | `(Out 1 + Out 2 + Out 3 + Out 4) / 4`. |
| Cycle 1 … Cycle 4 | `trigger` | A pulse at each cycle start of that channel. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Rate 1 … 4 | 0.01–50 Hz (exponential, centre ≈ 0.7 Hz, as the LFO's Rate); a note value with *Sync* | 1 Hz, 1.5, 2, 3 Hz | Per-channel speed in *Free*. Rate 1 is the master rate in the other modes; Rate 2–4 are shown only in *Free*. |
| Spread | 0–360° | 90° | *Phase* mode (shown only there): offset between adjacent channels. |
| Level 1 … 4 | −100 … +100 % | 100 % | Per-channel depth; negative inverts. |
| Pulse Width | 5–95 % | 50 % | For channels set to *Square* (shared). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Free, Quadrature, Phase, Divide | Quadrature |
| Wave 1 … 4 | Sine, Triangle, Saw Up, Saw Down, Square, Random Step, Random Smooth | Sine |
| Divide 1 … 4 (shown in Divide mode) | ×4, ×3, ×2, ÷1 … ÷8, ÷12, ÷16 | ÷1, ÷2, ÷3, ÷4 |
| Sync | Off, On | Off |
| Clock Ratio | 1, 2, 3, 4, 6, 8, 12, 16, 24, 32 pulses per cycle | 4 |
| Polarity | Bipolar, Unipolar | Bipolar |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Modes

With `f_1` the master rate (Rate 1, the synced rate or the clock rate) and
`φ_k` channel k's phase in 0…1 (k = 1…4):

| Mode | Rates | Phases |
|---|---|---|
| **Free** | `f_k` = Rate k | independent accumulators, all start at 0 |
| **Quadrature** | all `f_1` | `φ_k = φ_1 + (k − 1) / 4` |
| **Phase** | all `f_1` | `φ_k = φ_1 + (k − 1) · Spread / 360°` |
| **Divide** | `f_k = f_1 × d_k` (`d_k` from *Divide k*) | each its own; all reset together (4.4) |

In Quadrature and Phase there is only one accumulator; the offsets are added
after it. Each channel's *Cycle* fires once per cycle of the phase it runs on
(channel 1's in the shared modes): armed when that phase wraps, it fires when
the phase reaches `1 − offset` (where the offset phase wraps). With a steady
Spread that is exactly the offset phase's wrap; a modulated Spread moves the
pulse but never adds one. Channels whose phase is 0 at the module's start
fire a pulse there (as the LFO's *Cycle*). At *Spread* 0° the four outputs are
identical apart from wave and level; at 180° channels 1 and 3, 2 and 4 match.

Switching *Mode* keeps channel 1's phase; the others jump to their new phase
over 5 ms (crossfade), so a mode switch never clicks.

### 4.2 Waves

The waves are the *LFO* module's (`lfo.md` 4.2): same formulas, same seeded
random. Random values are `uniform01(Seed, cycle number, stream = k)` (k = 1…4, the
cycle number of the offset phase), so
the four channels' random waves differ but are reproducible.

Output k = `wave_k(φ_k) × Level k`; *Unipolar* maps to `0.5 + 0.5 v` before
*Level*, so a negative level gives `1 − v` instead of going below 0
(clamped to 0…1).

### 4.3 Timing and sync

- **Sync Off:** Rates in Hz, modulated per sample.
- **Sync On:** each Rate knob picks from 16 bars (knob at 0) … 1/32T (knob at 1)
  in `dsp::noteValues()` (straight, dotted, triplet), one cycle per value;
  modulation steps through the list. The view shows the note value. With the
  transport playing, every phase is derived from the song:
  `φ_k = frac(ppq / beats_k) + offset_k` — Free uses each channel's own note
  value, the other modes channel 1's (Divide: `beats_1 / d_k`). All four are
  therefore phase-locked to bars, survive loop jumps and render identically.
  With the transport stopped they run free at the current tempo.
- **Clock patched:** `f_1 = 1 / (ClockRatio × T)` with T the pulse period
  (averaged over the last 4 pulses; a pulse after a pause longer than 2 T
  restarts the measurement). Channel 1's phase is set to 0 every *Clock
  Ratio* pulses, so it stays in step. In *Free* mode the clock only drives
  channel 1. Clock overrides Sync for channel 1 (and through it the others).

### 4.4 Reset and realignment

- **Reset** sets channel 1's phase to 0 (others to their offsets; in Free and
  Divide all to 0). With Sync on and the transport playing, Reset shifts the
  grid so that the next sample counts as phase 0 until the next transport
  start (as in the Step Sequencer's Transport mode).
- In **Divide**, the channels realign at the common multiple of their periods
  (e.g. ÷1 ÷2 ÷3 ÷4 → every 12 cycles of channel 1); the realignment comes
  from the song position when synced, so it lands on the same bar every time.
- **Transport start** resets all channels (synced or not).

### 4.5 Edge cases

- *Hold* freezes the free accumulators; in synced transport mode it freezes
  the outputs only, and on release the phase jumps to the song position
  (crossfaded over 5 ms).
- A Rate modulated below 0.01 Hz is clamped there; above 50 Hz is clamped.
- Inside a Voice Cell each voice runs its own four LFOs. Reset from
  *Voice In › Trigger* gives every note its own start; leave it unpatched and
  use Sync for LFOs that move together across voices.

## 5. Module view

- A **four-trace scope** of one cycle of channel 1 (two cycles in Divide),
  each trace in its own tint, with a dot at each live phase.
- An **XY view** toggle: Out 1 against Out 2 (a circle in Quadrature with
  sines), to see what a stereo pair will do, with a dot at the live outputs.
  The toggle is remembered per browser.
- Below: a row per channel (Wave, Rate, Level, Divide), then Mode, Spread,
  Sync, Polarity. Rows show only what the Mode uses (Rate 2–4 are hidden
  outside Free, Divide outside Divide mode, Spread outside Phase), but hidden
  knobs keep their cables and values. Knobs are grouped *Rates*, *Levels* and
  *Shape* (Spread, Pulse Width); the waves and divisions are settings below.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

- Dotted/triplet note values in the shared list (`dsp::noteValues()`, done).
- `liveValues`: `phase1` … `phase4` (with offsets) for the scope's dots, plus
  `clocked` and the measured `bpm`.
- The LFO module's wave functions in `patch/common/dsp/Waves.h` (done).

## 8. Tests

- Quadrature: at any sample, `φ_k − φ_1 = (k − 1) / 4` (mod 1); sine outputs 1 and 2 trace a unit circle.
- Phase: Spread 120° gives offsets 0, ⅓, ⅔, 0; sweeping Spread 0–360° at 3 Hz over a 1 Hz LFO still gives one Cycle pulse per cycle (±1).
- Divide ÷1 ÷2 ÷3 ÷4: Cycle counts over 12 s at 1 Hz are 12, 6, 4, 3; all realign at 12 s.
- Free: four rates give independent Cycle counts.
- Sync + transport: `φ_k = frac(ppq / beats_k) + offset_k`; a loop jump repeats values exactly.
- Clock: Clock Ratio 4 with a 0.25 s pulse period gives 1 Hz, reset on every 4th pulse.
- Random waves per channel differ; the same Seed repeats them.
- Mode switch: no output step larger than a 5 ms crossfade allows.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-channel *Phase* trim in Free mode.
- Shape morph between waves per channel (shared with the LFO's planned morph).
- A *Rotate* input that shifts which output carries which channel, stepping on each trigger.
- Audio-rate band-limited mode (a quadrature oscillator for frequency shifting).
