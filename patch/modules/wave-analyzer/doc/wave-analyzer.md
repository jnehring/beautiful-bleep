# Wave Analyzer

## Introduction

Wave Analyzer is a very narrow band-pass that you tune like an old lab
receiver. Turn the big dial and the single partials of a sound come out one
by one. Let it **sweep** and it draws the spectrum on its plotter while it
plays a melody of partials. Let it **lock** and it hunts for the strongest
partial in a window and follows it. The imperfections are part of the sound:
the filter rings when it moves, the oscillator drifts, and the lock loop
springs and wobbles before it settles.

## How does it work?

**Tuning.** The analyser listens at one frequency, the tuned frequency: the
*Frequency* dial (or the sweep, or the lock loop) with *Pitch* added in
octaves and a little *Drift*. *Bandwidth* sets how wide it listens: 3 Hz picks
out a single partial even high up, 100 Hz lets neighbours through, 1/3 octave
grows with the frequency like a graphic-EQ band. The skirts are steep
(24 dB per octave on each side).

**Band** is the isolated partial at its own pitch. **Shifted** is the same
partial moved to the *Listen* frequency: every partial you tune to is heard
at the same pitch, and a partial slightly off the dial is heard slightly off
*Listen*, so vibrato and drift become small bends. At wide bandwidths
neighbouring partials beat against each other, and it whistles and talks.
Isolated partials are quiet: *Gain* (+12 dB by default) lifts both outputs,
which are softly limited.

**Ringing.** A narrow band needs time: about 1 / bandwidth seconds (a third of
a second at 3 Hz). Move the dial faster and the band smears and rings.

**Level** is the loudness of the band on a dB scale, from *Floor* (0) to
0 dBFS (1), with the ballistics of a moving-coil meter: the needle swings
over in about 300 ms and overshoots a hair. *Ballistics: Fast* follows within
milliseconds. **Peak** fires when *Level* rises through *Threshold*; while
sweeping, each loud partial fires once, a rhythm read from the spectrum.

**Modes**

1. **Manual:** the band sits where the dial is.
2. **Sweep:** the band moves from *Frequency* up by *Span* octaves (or down,
   or up and down) in *Sweep Time*, or in a note length when *Sync* is set and
   the transport plays (then the sweep follows the song position). *Reset*
   restarts a free sweep, *Hold* pauses it. When the sweep is faster than the
   band can follow, *Too Fast* lights: partials then read low and draw late
   and wide, as on the bench.
3. **Lock:** the band scans the window *Frequency* ± *Capture* once, remembers
   the loudest place, jumps there and locks on with a phase-locked loop.
   *Locked* goes high and *Track* follows the partial: a crude pitch tracker.
   If the partial fades by more than 20 dB, or runs out of the window, it hunts
   again. *Reset* starts a new hunt, *Hold* freezes it.

**Range** is the lab range switch: in a decade range the dial covers only
20–200 Hz, 200 Hz–2 kHz or 2–20 kHz, ten times finer.

**Drift** lets the oscillator wander like a warm valve set, up to ±24 cents,
slowly. A partial slides out of a 3 Hz band and back; in *Lock* the loop
chases it. The drift follows *Seed* and the song position, so renders repeat.

## The view

- **Needle meter:** *Level* on a dB scale from *Floor* to 0 dB, *Threshold*
  as a red tick.
- **Frequency dial:** printed with the *Range* scale. Drag it (Shift for
  fine, double-click resets); the pointer shows where the band actually is,
  with *Pitch*, the sweep, the lock loop and drift.
- **Lights:** *Locked* (blinking while hunting) and *Too Fast*.
- **Plotter:** level against frequency from 20 Hz to 20 kHz. Each sweep draws
  in ink; the previous sweep stays faded, so a spectrum builds up sweep by
  sweep. In *Manual* and *Lock* the pen leaves a trace wherever the band goes.
  Click the strip to clear it.

## How to use it?

- **Harmonic melodies:** a rich oscillator into *In*, *Mode: Sweep*,
  *Frequency* at the oscillator's pitch, *Span* 4, *Bandwidth* 10 Hz: *Band*
  plays the harmonic series. *Peak* into a drum: the rhythm of the spectrum.
- **One pitch from everything:** *Shifted* with *Listen* at a note of your
  track: whatever you tune to sings at that pitch.
- **Pitch tracker:** a voice or a bass into *In*, *Mode: Lock*, *Capture*
  12 st around its range; *Track* into an oscillator's pitch, *Locked* into a VCA.
- **Spectrum on the bench:** *Sync* 4 bars, *Bandwidth* 30 Hz, *Span* 10,
  *Frequency* 20 Hz: one full spectrum every four bars on the plotter.
- **Frozen partial:** *Hold* from a gate: the band stays put while you play.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Wave Analyzer does. In the standalone app open **File → Presets…** (⌘P) and pick *Wave Analyzer* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Wave Analyzer: Partial Picker** | A low saw drone has many partials; the analyzer is a very narrow band-pass that an LFO moves slowly over them, so you hear single sine-like overtones appear and fade, over the dry drone. Change Bandwidth for a wider or glassier peak, or move Frequency by hand. |
| **Wave Analyzer: Spectrum Sweep** | Mode is Sweep: the narrow band glides from low to high and back across a bed of noise and drums, drawing out a rising and falling whistle. Change Sweep Dir, Span or Sweep Time, or widen Bandwidth for a softer tone. |
| **Wave Analyzer: Pitch Shadow** | In Lock mode the analyzer finds the strongest partial of a melody and its Track output drives a pure sine that shadows every note an octave up. Change Listen to move the range it hears, or Threshold to make it more or less eager to lock. |
| **Wave Analyzer: Kick Pump** | The analyzer is tuned to the kick's low note and its Level output follows how strong that partial is; the level swells a chord pad in time with the beat. Move Frequency to follow a different drum, or Gain to make the pad react more. |
| **Wave Analyzer: Shifted Harmony** | A wide band-pass picks the fundamental of a plucked line and the Shifted output moves it up by the Capture amount, a seventh semitones for a fifth, so a thin sine harmony chases each note. Change Capture for other intervals, or Bandwidth to let more of the original through. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Frequency | 20 Hz – 20 kHz (or one decade, see *Range*) | 440 Hz |
| Span | 0 – 10 octaves | 4 oct |
| Sweep Time | 0.1 – 120 s | 8 s |
| Capture | 0 – 24 semitones | 7 st |
| Drift | 0 – 100 % | 15 % |
| Listen | 50 Hz – 4 kHz | 800 Hz |
| Threshold | 0 – 100 % | 60 % |
| Gain | −20 … +40 dB | +12 dB |
| Mode | Manual, Sweep, Lock | Manual |
| Bandwidth | 3 Hz, 10 Hz, 30 Hz, 100 Hz, 1/3 octave | 10 Hz |
| Range | Full, 20–200 Hz, 200 Hz–2 kHz, 2–20 kHz | Full |
| Sweep Dir | Up, Down, Up-Down | Up |
| Sync | Free, 1/32 … 8 bars, 16, 32, 64 bars | Free |
| Floor | −24, −36, −48, −60, −72, −96 dB | −60 dB |
| Ballistics | Needle, Fast | Needle |
| Seed | 0 – 999 | 1 |

- **Frequency:** the tuning dial; the sweep's start in *Sweep*, the window's
  centre in *Lock*. The small knob text shows the Full scale; the big dial
  shows the *Range* scale.
- **Span, Sweep Time, Sweep Dir, Sync:** the sweep (shown in *Sweep*).
- **Capture:** the lock window, ± semitones around *Frequency* (shown in *Lock*).
- **Drift:** how far the oscillator wanders.
- **Listen:** the pitch of *Shifted*.
- **Threshold:** where *Peak* fires on the *Level* scale.
- **Gain:** on *Band* and *Shifted*.
- **Floor:** the bottom of the *Level* scale.
- **Ballistics:** *Needle* swings like a meter, *Fast* follows at once.
- **Seed:** picks the drift.

*Frequency*, *Span*, *Sweep Time*, *Capture*, *Drift*, *Listen*, *Threshold*
and *Gain* are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In | audio | the sound to analyse |
| Pitch | pitch | added to the tuned frequency in octaves (1 V/oct) |
| Reset | trigger | restarts a free sweep; in *Lock* starts a new hunt |
| Hold | gate | while high, the tuned frequency is frozen |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Thru | audio | *In*, unchanged |
| Band | audio | the isolated band at its own pitch |
| Shifted | audio | the band moved to *Listen* |
| Level | control | the band's level, 0 at *Floor* … 1 at 0 dBFS, with needle ballistics |
| Track | pitch | the tuned frequency (0 = C4) |
| Peak | trigger | a pulse when *Level* rises through *Threshold* |
| Locked | gate | high while the lock loop holds a partial |
