# Drum + Mod

Type id `drum-modulator` · category *Sources* · colour proposal `#a5b4fc`

## 1. Purpose

A compact, two-channel utility for rhythm patches. Each channel is either a
**drum** (kick, snare, hat) or a **modulator** (envelope, tapped LFO, random
step) that reacts to the same triggers. Two knobs per channel change meaning
with the mode. One module gives a kick and its matching sidechain duck, a hat
and a random filter sweep that steps with it, or two modulators played by a
sequencer's gates. In modulator modes the channel also has a built-in VCA,
so it can duck or gate an audio signal without extra modules.

## 2. Jacks

Per channel (A and B):

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Trig A / Trig B | `trigger` | Strikes the drum or starts/advances the modulator. *Trig B* unpatched follows *Trig A* (normalled), so one trigger drives both channels. |
| Gate A / Gate B | `gate` | Envelope mode: holds the envelope at its peak while high. Other modes: high = accent (drums) or freeze (LFO, Random). |
| In A / In B | `audio` | Modulator modes only: the audio that the channel's VCA scales (4.4). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out A / Out B | `audio` | Drum modes: the drum. Modulator modes: *In* × the modulator (unipolar), or the modulator itself if *In* is unpatched. |
| CV A / CV B | `control` | Drum modes: the drum's amplitude envelope (0–1). Modulator modes: the modulator (range per mode, 4.3). |
| Inv A / Inv B | `control` (unipolar) | 1 − the unipolar CV: ready-made ducking signal. |

## 3. Controls

**Knobs** (modulatable floats), per channel:

| Knob | Range | Default | What it does |
|---|---|---|---|
| X | 0–100 % | 50 % | First mode knob (4.2, 4.3). |
| Y | 0–100 % | 50 % | Second mode knob. |
| Level | 0–100 % | 80 % | Drum level, or modulator depth (scales CV and the VCA amount). |

The view shows the current meaning and value of X and Y in their labels
(e.g. *Pitch 52 Hz*, *Decay 420 ms*).

**Settings**, per channel:

| Setting | Values | Default |
|---|---|---|
| Mode | Kick, Snare, Hat, Envelope, LFO, Random | A: Kick, B: Envelope |
| Sync (LFO, Random) | Taps, Transport 1/16 … 2 bars | Taps |
| Seed | 0–999 (shared by both channels) | 1 |

## 4. Behaviour

### 4.1 Mode map

| Mode | X | Y | Gate input |
|---|---|---|---|
| Kick | Pitch 30–120 Hz | Decay 50 ms – 2 s, sweep and click grow with it | accent |
| Snare | Tone (body ↔ noise balance, tuning 150–300 Hz) | Decay 50 ms – 800 ms | accent |
| Hat | Tone (dark ↔ bright, band-pass centre) | Decay 15 ms – 1.5 s (short = closed, long = open) | accent |
| Envelope | Attack 0.5 ms – 2 s | Release 5 ms – 8 s (shape gets snappier toward short) | hold |
| LFO | Rate multiplier ×¼ … ×4 of the tapped tempo (stepped: ¼, ⅓, ½, ⅔, 1, 3/2, 2, 3, 4) | Shape: sine → triangle → ramp down → square, morphed | freeze |
| Random | Slew 0 – 100 % of a step | Range / chance: 0–50 % widens the range around 0.5 from nothing to full; 50–100 % keeps the full range and lowers the chance that a step changes, from 100 % down to 10 % | freeze |

*Mode* is a setting: switching it fades the channel out over 5 ms and starts
the new mode silent (drums) or at its rest value (modulators).

### 4.2 Drum modes

The three drums are compact versions of the shared building blocks in
`patch/common/dsp/Drums.h`, with the knobs folded into two:

- **Kick:** a struck resonator at *X* with a pitch sweep and click whose
  depth rises with *Y*, so short decays are tight and long ones boom.
- **Snare:** two resonators (*X* sets tuning and their balance against the
  noise; low X is body-heavy, high X is wire-heavy) plus high-passed noise.
- **Hat:** the six-square metal source through a band-pass at 6–11 kHz
  (*X*). *Y* below 15 % is a closed hat; longer values are open. A new hit on
  the same channel chokes the previous one with a 3 ms fade.

**Accent** (gate high at the trigger) adds +4 dB and a brighter attack. The
*CV* output carries the amplitude envelope, so a kick channel can duck a pad
by itself (*Inv* onto a VCA's gain).

### 4.3 Modulator modes

- **Envelope** — an attack/release envelope (attack linear, release
  exponential, like the ADSR's stages) started by *Trig* from the current
  level (no clicks on retrigger). While *Gate* is high, it holds at the
  peak. *CV* is 0–1.
- **LFO (tapped)** — the period comes from the triggers: the time between
  the last two *Trig* pulses (tap tempo), × the *X* ratio. Each trigger
  re-phases the LFO to the start of its cycle (soft re-phase: the phase
  slides there within 5 ms instead of jumping, so the output never steps).
  A pulse after more than 4 s restarts the measurement; before two pulses
  have arrived the period is 500 ms. With *Sync* on a note value it follows
  the transport like the LFO module (phase from the song position), and
  triggers only re-phase. *CV* is −1…+1.
- **Random (step)** — each trigger draws a new value from
  `hash(Seed, channel, step counter)` (step counter from the song position
  when synced, otherwise a counter reset on `transportStarted`), with the
  range or probability of *Y*, glided by *X*. *CV* is 0–1. Seeded, so renders
  repeat.

*Level* scales the modulator before it reaches *CV* and the VCA.

### 4.4 The VCA in modulator modes

`Out = In × (1 − Level + Level × m)` where *m* is the unipolar modulator
(LFO and Random mapped to 0–1). So at Level 0 the audio passes unchanged,
at 100 % it's fully shaped. Gain changes are per-sample; *In* connections
ramp like any audio input (`specs.md` section 7.7). With *In* unpatched,
*Out* carries the bipolar modulator at audio level so it can be heard, used
as an audio-rate modulator or sent into another VCA.

### 4.5 Typical patches

- **Kick + duck:** A = Kick, B = Envelope (normalled to Trig A) with a short
  attack and a 300 ms release. Patch *Inv B* onto a VCA's gain after a pad:
  the pad ducks under every kick. (Ducking through B's own VCA needs the
  *Invert* option in 9.)
- **Hat + wobble:** A = Hat on 1/16 triggers, B = LFO tapped from the same
  triggers, ×¼, onto a filter's cutoff: a sweep that always fits the groove,
  whatever the tempo.
- **Two modulators:** A = Envelope from a sequencer's *Gate*, B = Random from
  its *Trigger*: an envelope and a stepped value per note.

### 4.6 Transport, tails, CPU

Drum hits and envelopes run out after the transport stops; LFO and Random in
Taps mode keep running at their last tempo, in Transport mode they hold until
the transport restarts. The module costs ≈ 0.05 % (modulators) to 0.15 %
(hat) of one core per channel at 48 kHz. Works per voice inside Voice Cells.

## 5. Module view

```
 ┌──────────────────────────────────────────────────┐
 │  A  [Kick ▾]              B  [Envelope ▾]        │
 │  ( Pitch )  ( Decay )     ( Attack ) ( Release ) │
 │   52 Hz      420 ms        2 ms       300 ms     │
 │  ▕██▆▄▂▁▁▁▁ scope         ▕█▇▅▃▂▁▁ scope         │
 │  (Level)  [▶]             (Level)  [▶]           │
 └──────────────────────────────────────────────────┘
```

- Two columns. The mode dropdown sits at the top; the X/Y labels and units
  change with the mode.
- A small scope per channel shows *CV* (the envelope or modulator), so the
  modulators are visible without patching a scope.
- *▶* fires the channel's trigger (audition, and tap tempo for LFO mode:
  click it in time).

## 6. Saved state

Knob and setting values only. X and Y are stored normalised (0–1) and keep
their position when the mode changes, so switching back restores the sound.

## 7. Engine requirements

1. **Mode-dependent knob labels and units:** a way for the spec to describe
   knobs whose display name and value formatting depend on a setting
   (`ParamSpec::display(modeIndex)` table), used by the view and the
   modulation picker.
2. **Normalled inputs:** *Trig B* follows *Trig A* when unpatched. A general
   `JackSpec::normalledTo` field lets the engine pass the other jack's buffer
   instead of zeros.
3. Shared drum blocks in `dsp/Drums.h`; audition events (Perc Voice, section 7).

## 8. Tests

- Each drum mode at defaults: non-silent, finite, below −80 dB after its
  decay; CV matches the envelope.
- Envelope: attack and release times ± 5 %; Gate holds the peak; retrigger
  from the current level without a step.
- LFO: two triggers 500 ms apart give a 2 Hz LFO at ×1, 0.5 Hz at ×¼; a
  re-phase never produces a step larger than the 5 ms slide allows.
- Random: same Seed → same sequence; Y above 50 % changes values only with
  the set probability (statistical check over 10 000 steps).
- VCA: Level 0 passes *In* bit-exact; Level 100 % with m = 0 is silent.
- Normalling: with Trig B unpatched, both channels fire from Trig A;
  patching Trig B breaks the normal.
- Mode switch fades over 5 ms (no click).
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- An *Invert* toggle per channel for the VCA (duck instead of gate).
- More modes: clap, tom, Euclidean trigger divider, slew/follower.
- Link mode: channel B's modulator shaped by channel A's drum envelope.
