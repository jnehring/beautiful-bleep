# Rate Counter

## Introduction

Rate Counter measures how often something happens. Give it a tone and it tells you the frequency; give
it a clock, a drum pattern or your own taps and it tells you the tempo. The result comes out as signals:
the **rate** as a pitch, the **tempo** as a control signal, an **average** that ignores a shaky beat, and a
**Steady** gate that goes high when the rhythm is even.

## How does it work?

**Finding the beats.** Set *Input Is* to *Wave* for tones and any continuous signal: the counter learns the signal's
own range and counts every time it rises through its middle. Set it to *Pulse Train* for gates and triggers: it counts
every rising edge. Each edge is timed more finely than a sample, so a 4 kHz tone is measured to a fraction of a per cent.

**Intervals and the average.** The time between two edges is an interval. The counter keeps the last sixteen. **Rate** and **BPM** follow the
latest interval, a little smoothed. **Average BPM** is taken from the mean of the last *Average Of* intervals: with 8, one late hit
only moves it a little; with 2 it follows quickly. *Per Beat* says how many edges make one beat: 1 for a quarter-note clock, 4
for sixteenth notes, 24 for a MIDI-style clock.

**Steady.** The gate is high while the last four intervals are within *Steady Within* of each other. A drummer
that drifts or a modulated clock makes it flicker; a sequencer's clock keeps it high.

**Tap.** Press **Tap** in time with the music. The taps count like edges, so after a few of them *Average BPM* is the
tempo you tapped. **Clear** starts over. If nothing arrives for *Start Over After* seconds the
counter forgets the old rhythm, and the next edge starts a new count.

The BPM outputs are the tempo divided by 240, so 120 BPM is 0.5 and 240 BPM is 1. Rate is a pitch signal: it can drive an oscillator at the
frequency it measured, one octave per volt.

## How to use it?

- **Tempo follower:** a drum track's kick (as a trigger) into the counter, *Pulse Train*; **Average BPM** shows the tempo and **Steady** says when it holds.
- **A tuner for any tone:** *Wave*, **Rate** into a Quantizer or an oscillator's pitch.
- **Tap tempo:** press **Tap** with your music; read the Average BPM.
- **Gate by stability:** **Steady** into a VCA, or into a switch that only lets a sequence run once the clock is stable.
- **Echo of a source:** **Rate** into an oscillator two octaves lower (with a Math module for the offset) makes a sub that follows the tone.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Rate Counter does. In the standalone app open **File → Presets…** (⌘P) and pick *Rate Counter* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Rate Counter: Wave Tuner** | A slow drone changes pitch and the Rate Counter, in Wave mode, counts its cycles; its Rate output, a pitch signal, plays a sine a fifth and an octave above the drone. Change Input Is to Pulse Train to see it lose the wave, or lower Average Of. |
| **Rate Counter: Tempo Brightens the Lead** | The lead's own gate is a clock that the Rate Counter measures in Pulse Train mode, two edges to a beat; its Average BPM output, about 0.5 at 120 BPM, lifts the lead's filter cutoff. Change the song tempo and the brightness follows. |
| **Rate Counter: Sixteenths Per Beat 4** | A run of sixteenth notes is counted four edges to the beat, so the Rate Counter reads the true tempo, and its Average BPM bends the pitch of a low drone a little. Change Per Beat to 2 to see the reading double and the drone jump. |
| **Rate Counter: Steady Opens the Pad** | Four bars of even eighth notes are followed by four bars of uneven ones; the Steady gate of the Rate Counter is high only while the beat is even, and it swells a pad in and out. Make Steady Within wider and the pad stays open longer. |
| **Rate Counter: Edge Echo** | A sparse melody is read by the Rate Counter, and its Edge trigger, one pulse per counted note, plays a rim click and a high bell a moment after each note. The long gaps clear the count, so the count starts fresh with each phrase. Shorten Start Over After to clear it sooner. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Values | Default |
|---|---|---|
| Input Is | Wave, Pulse Train | Wave |
| Per Beat | 1, 2, 3, 4, 6, 8, 12, 16, 24 | 1 |
| Average Of | 2 – 16 | 4 |
| Steady Within | 0.5 – 25 % | 5 % |
| Start Over After | 1 – 20 s | 4 s |

Buttons: **Tap**, **Clear**.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In | audio | the wave or pulse train to count |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Rate | pitch | the latest rate, 1 V/oct, 0 = middle C |
| BPM | control | the latest tempo ÷ 240 |
| Average BPM | control | the tempo of the average interval ÷ 240 |
| Steady | gate | high while the last four intervals agree |
| Edge | trigger | a pulse on every edge found |
