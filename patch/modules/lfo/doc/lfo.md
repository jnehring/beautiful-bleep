# LFO

![LFO in the module view](lfo.png)

## Introduction

The LFO is a **low-frequency oscillator**: it moves up and down by itself,
slower than you can hear, and makes whatever it's patched into move with it.
Patch it onto a filter's cutoff for a sweep, onto an oscillator's pitch for
vibrato, or onto a VCA's gain for tremolo.

Pick a wave, set the speed, done. It can run freely or lock to the song's bars.

## How does it work?

**Speed.** With *Sync* on *Free*, *Rate* sets the speed in Hz (cycles per
second). Pick a note value in *Sync* (1/16 … 8 bars) and one cycle takes exactly
that long. While the transport plays, a synced LFO follows the song position:
it's always at the same point of its wave at the same bar, even after a loop
jump, and renders the same every time. When the transport is stopped it keeps
running at the synced speed.

**Waves.** *Wave* chooses what *Out* plays:

- **Sine** and **Triangle**: smooth up and down. Both start at the middle,
  rising.
- **Saw Up** / **Saw Down**: a ramp that jumps back at the end of each cycle.
- **Square**: high, then low. *Pulse Width* sets how much of the cycle is high.
- **Random Step**: a new random value each cycle, held until the next.
- **Random Smooth**: glides from one random value to the next.

The *Sine*, *Triangle*, *Saw*, *Square* and *Random* outputs give you each wave
at once, all at the same speed and phase. *Cycle* fires a trigger at the start
of every cycle.

**Phase** shifts the wave within its cycle. **Polarity** chooses between
*Bipolar* (−1 … +1, moves both ways around the knob) and *Unipolar* (0 … 1, only
upwards). Random values come from *Seed*, so they repeat on every render.

**Reset and Fade.** A trigger at *Reset* restarts the cycle (on a free-running
LFO) and the fade-in. With *Fade* above 0, the output starts at 0 and grows to
full over that time after each Reset and each time the transport starts.

## How to use it?

- **Filter sweep:** *Out* onto a Multi Filter's **Cutoff**; set the cable's
  amount for the depth.
- **Vibrato in a Voice Cell:** put the LFO inside the cell, *Out* onto the
  oscillator's **Pitch** knob with a small amount, *Voice In › Trigger* into
  *Reset*, and set *Fade* to half a second: each note starts straight and
  then begins to wobble.
- **Rhythmic movement:** set *Sync* to 1/8 and *Wave* to *Square* onto a VCA's
  gain for a tempo-locked chop.
- **Two related movements:** use *Sine* on one destination and *Square* on
  another, or two LFOs with *Phase* 0° and 90° for circular stereo movement.
- **Wobbling the wobble:** patch another LFO onto **Rate**.
- **Clocking other modules:** *Cycle* triggers a sequencer's *Clock* or an
  envelope.

<!-- generated:presets -->
## Presets

The preset bar of the LFO view has 15 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Gentle Sine** | Slow sine for subtle filter or pitch drift. |
| **Vibrato** | Classic vibrato speed that fades in after the note starts. |
| **Tremolo** | Unipolar triangle for amplitude tremolo. |
| **Beat Pump** | Falling ramp locked to the beat: sidechain-like ducking. |
| **Eighth Chop** | Square gate on every eighth for rhythmic chopping. |
| **Slow Sweep** | A 20-second triangle for long filter sweeps. |
| **Rising Saw** | Ramp that climbs over two bars and snaps back. |
| **Sample and Hold** | Random stepped values, a classic sample-and-hold. |
| **Smooth Random** | Wandering smooth random for organic movement. |
| **Narrow Pulse** | Thin pulse for staccato jumps. |
| **Wide Slow Tide** | A four-bar sine swell locked to the song. |
| **Triplet Feel Wobble** | Fast synced triangle for shimmering wobble. |
| **Offset Sine** | Sine starting at its peak: pair with another LFO for quadrature. |
| **Fast Flutter** | Tape-like flutter, best used very lightly. |
| **Wild Random** | Fast random jitter for glitchy modulation. |
<!-- /generated -->

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Rate | 0.01 – 50 Hz | 1 Hz |
| Phase | 0 – 360° | 0° |
| Pulse Width | 5 – 95 % | 50 % |
| Fade | 0 – 10 s | 0 s |

Every knob is a modulation destination.

### Settings

| Setting | Values | Default |
|---|---|---|
| Wave | Sine, Triangle, Saw Up, Saw Down, Square, Random Step, Random Smooth | Sine |
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars | Free |
| Polarity | Bipolar, Unipolar | Bipolar |
| Seed | 0 – 999 | 1 |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Reset | trigger | restarts the cycle (free-running) and the fade-in |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | control | the wave chosen in *Wave* |
| Sine, Triangle, Saw, Square | control | each wave, same speed and phase |
| Random | control | a new random value each cycle, held |
| Cycle | trigger | a pulse at the start of each cycle |
