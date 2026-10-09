# Sweep Generator

## Introduction

Sweep Generator is a function generator with a built-in frequency sweep, like
the bench instruments that measure a circuit across the audio band. It glides
from *Start* to *Stop* over a set time or a number of bars, and puts out
everything other modules need to follow it: the sweep ramp, the frequency as
pitch (so a filter can track it), and triggers at markers, at the end of each
sweep and on every cycle of the waveform.

Musically it is a riser, a siren, a tone-burst source and a tracking test
signal for feedback patches. The old benches' character is kept on purpose: a
slow *Drift*, a warm-up that settles after the transport starts, and an
audible *Retrace* as the sweep flies back.

## How does it work?

**The sweep.** One sweep runs from *Start* to *Stop* in *Sweep Time*, or in
the note value set by *Sweep Sync*. *Stop* may be below *Start* for a falling
sweep. *Direction* runs it Up, Down, or Up-Down (up and back within the same
length). The **Law** decides the speed: *Log* spends the same time on every
octave (it sounds even), *Lin* the same time on every hertz: it rushes through
the bass and lingers in the treble.

**Modes.**

1. **Continuous:** the sweep repeats. Synced to a note value while the
   transport plays, its position follows the song position, so it stays on the
   bars after a loop or a jump. *Trigger* restarts it.
2. **Triggered:** waits at the beginning until a trigger, runs one sweep, fires
   *End* and holds the last frequency. A new trigger starts again from the
   beginning.
3. **Gated:** the sweep moves only while *Gate* is high and pauses while it is
   low. *Trigger* restarts it.
4. **Burst:** the sweep runs as in Continuous, but *Out* is silent until a
   trigger. Each trigger plays *Burst Count* whole cycles of the waveform at the
   frequency the sweep has reached, with short fades. Bursts step through the
   band like a stepped response measurement.

While *Hold* is high, the sweep position freezes in every mode; the tone keeps
playing. When synced, releasing *Hold* jumps back onto the grid.

**The waveform** is phase continuous: when the frequency jumps (a new sweep, a
trigger, a jump in the song), the wave carries on without a click. Edges and
corners are band-limited, so even high sweeps stay clean. *Symmetry* skews the
sine and the triangle, sets the duty of the square and the pulse, and bends the
ramps. With *Phase Reset* on, a trigger also restarts the cycle. *FM* adds
linear (through-zero) frequency modulation from the *FM* input, with the same
depth all along the sweep; *AM* scales the level. Very low sweeps make *Out* a
sweeping LFO.

**Retrace.** When an Up or Down sweep starts over, *Instant* jumps back.
*Glide* flies back over 5 % of the sweep (at most a quarter of a second), the
way a bench sweeper's flyback can be heard. *Sweep* follows it, *End* fires
as it starts and the markers stay quiet during it.

**Markers.** Up to three marker frequencies (set by *Markers*). *Marker* fires
whenever the sweep crosses one, in either direction, and *Marker Gate* stays
high for *Marker Width*. Use them to trigger events at points in the band.

**Drift and warm-up.** *Drift* adds a slow, seeded wander of up to about
±37 cents, plus a warm-up offset of up to ±40 cents that settles over
*Warm-up* after the transport starts (or the module is created), like a cold
instrument. With *Drift* at 0 the frequency is exact.

**Repeatable.** The drift comes from *Seed* and the song position, and
starting the transport restarts the sweep, the waveform and the warm-up, so a
render from the same position is always identical.

## How to use it?

- **Riser:** *Start* 100 Hz, *Stop* 8 kHz, *Sweep Sync* 8 bars, Mode
  Continuous, into a filter or straight into the mix. Patch *End* to a crash.
- **Filter that follows:** *Freq* into a filter's cutoff pitch input: the filter
  tracks the tone exactly. Or *Sweep* into any knob as a ramp.
- **Siren:** Direction Up-Down, *Sweep Time* 1.5 s, Waveform Triangle, Law Lin.
- **Tone bursts:** Mode Burst, *Burst Count* 8, a clock into *Trigger*:
  short blips that climb through the band.
- **Events along the sweep:** *Markers* 3, *Marker* into drum triggers or an
  envelope: hits at 250 Hz, 1 kHz and 4 kHz.
- **One sweep per note:** Mode Triggered, a note's trigger into *Trigger*,
  *Pitch* from the keyboard: each note sweeps from its own key.

## Demo patches

Five whole patches show what Sweep Generator does. In the standalone app open **File → Presets…** (⌘P) and pick *Sweep Generator* under *Demos by module*; loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Sweep Generator: Four-Bar Riser** | A *Ramp Up* sweep from *Start* 100 Hz to *Stop* 8 kHz over four bars (*Sweep Sync*) opens a filter, and *End* fires a crash. |
| **Sweep Generator: Lab Sirens** | Two *Up-Down* sweeps of different *Sweep Time* wail left and right; *Law* Lin against Log changes the feel. |
| **Sweep Generator: Climbing Bursts** | *Burst* mode plays *Burst Count* cycles at the frequency the slow sweep has reached for each sequencer step. |
| **Sweep Generator: Marker Drums** | Three sweeps each fire *Marker* when they cross a set frequency and play a kick, a snare and a hat: a drifting polyrhythm. |
| **Sweep Generator: Laser Plucks** | *Triggered* mode with a falling sweep makes a zap per note, and *Pitch* from the sequencer moves the sweep. |

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Start | 0.01 Hz – 20 kHz | 100 Hz |
| Stop | 0.01 Hz – 20 kHz | 5 kHz |
| Sweep Time | 10 ms – 100 s | 4 s |
| Symmetry | −100 … +100 % | 0 % |
| Marker 1–3 | 0.01 Hz – 20 kHz | 250 Hz, 1 kHz, 4 kHz |
| FM | 0 – 100 % | 0 % |
| Drift | 0 – 100 % | 15 % |
| Level | 0 – 100 % | 80 % |
| Waveform | Sine, Triangle, Square, Ramp Up, Ramp Down, Pulse | Sine |
| Mode | Continuous, Triggered, Gated, Burst | Continuous |
| Sweep Sync | Free, 1/4, 1/2, 1 bar, 2, 4, 8, 16 bars | Free |
| Law | Log, Lin | Log |
| Direction | Up, Down, Up-Down | Up |
| Retrace | Instant, Glide | Instant |
| Burst Count | 1 – 64 | 4 |
| Markers | 0 – 3 | 0 |
| Marker Width | 1, 5, 10, 25, 50, 100 ms | 10 ms |
| Phase Reset | Off, On | Off |
| Warm-up | Off, 10 s, 30 s, 2 min | 30 s |
| Seed | 0 – 999 | 1 |

- **Start / Stop:** the frequencies at the beginning and the end of the sweep.
  Drag the curve's ends in the view to set them.
- **Sweep Time:** the length of one sweep when *Sweep Sync* is *Free*.
- **Symmetry:** skew of sine and triangle, duty of square (5 … 95 %) and pulse
  (1 … 25 %), curve of the ramps.
- **Marker 1–3:** the marker frequencies; drag a marker line in the view to
  move it.
- **FM:** the depth of the *FM* input (at 100 %, an input of ±1 swings the
  frequency by ±200 %, through zero).
- **Drift:** the slow wander and the warm-up offset.
- **Level:** the size of *Out*.
- **Sweep Sync:** a note value for one sweep (4/4); the length follows the tempo.
- **Law:** Log (equal time per octave) or Lin (equal time per hertz).
- **Retrace:** how an Up or Down sweep returns to its beginning.
- **Burst Count:** the cycles in each burst (Mode Burst).
- **Markers:** how many markers are active.
- **Marker Width:** how long *Marker Gate* stays high.
- **Phase Reset:** a trigger also restarts the waveform's cycle.
- **Warm-up:** how long the warm-up offset takes to settle (to 5 %).
- **Seed:** picks the drift.

*Start*, *Stop*, *Sweep Time*, *Symmetry*, the markers, *FM*, *Drift* and
*Level* are modulation destinations. Waveform is the row of icons in the view.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trigger | trigger | starts a sweep (Triggered), a burst (Burst), or restarts the sweep (Continuous, Gated) |
| Gate | gate | in Gated mode, the sweep runs only while high |
| Hold | gate | while high, the sweep position freezes |
| Pitch | pitch | shifts *Start*, *Stop* and the markers together (1.0 = one octave) |
| FM | audio | linear frequency modulation, depth set by *FM* |
| AM | audio | amplitude modulation: the level × (1 + AM), never below 0 |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the waveform, times *Level* |
| Sweep | control | the sweep position: 0 at *Start*, 1 at *Stop* |
| Freq | pitch | the current frequency as pitch (0 = C4), drift included |
| Marker | trigger | a pulse when the sweep crosses an active marker |
| Marker Gate | gate | high for *Marker Width* after each marker |
| End | trigger | a pulse at the end of each sweep (each half in Up-Down) |
| Sync | trigger | a pulse at the start of every cycle of the waveform |
