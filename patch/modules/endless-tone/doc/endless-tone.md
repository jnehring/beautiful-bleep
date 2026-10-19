# Endless Tone

## Introduction

Endless Tone is a sound that rises (or falls) for ever and never gets
higher. It is an auditory illusion built from a stack of tones one octave
apart: all of them glide upward together, but their loudness is controlled by
a fixed window, so the ones that leave the top fade out and new ones fade in
at the bottom. The ear follows the glide and never notices the hand-over. Use
it for tension risers that never arrive, falling drones, spinning pads and
as a stereo wash.

## How does it work?

**Partials.** *Count* (6 – 12) sine waves, each one octave above the last. *Pitch*
and the Pitch jack set the centre of the pattern (1 V/oct).

**The window.** Every partial's loudness comes from a window over the
log-frequency axis: a bell curve (a Gaussian) times a raised cosine that is
exactly zero at both ends. *Width* sets the bell: narrow shows a few clear
partials, wide spreads the energy into a dense cloud, a pad of octaves.

**The glide.** *Rate* (0 – 2 octaves per second) times *Direction* (−100 … +100 %)
moves the whole pattern in log-frequency. After one octave the pattern is
exactly where it started; at that moment each oscillator takes over the next
one's place (and its phase), so nothing clicks. Direction at 0 stops the glide,
a negative value falls, and *Direction* is modulatable, so you can reverse the
tone in mid-air.

**Timbre and space.** *Timbre* blends each partial from a sine to a sawtooth
(band-limited), which also gives the stack harmonics between the octaves.
*Spread* leans alternate partials to the left and right, so the glide also
travels across the stereo field. *Phase* offsets the pattern by up to one
octave, which with *Rate* at 0 is a hand-played glide.

**Loop output.** *Loop* is a ramp from 0 to 1 that completes once per octave of
travel (falling when the tone falls); *Wrap* is a trigger each time it
completes. They make a perfect clock for envelopes, filters and sequencers
that must stay in step with the glide: the tone and its modulation spin
together.

## How to use it?

- **A riser that never ends:** *Rate* 0.15, *Direction* up, *Width* 40 %,
  *Count* 10, into a low-pass that you open slowly.
- **A falling drone:** *Direction* down at 10 – 20 %, *Timbre* 60 %, a reverb.
- **Impossible staircase:** *Loop* into a quantiser into another oscillator.
- **Rhythm from the loop:** *Wrap* triggers a drum once per octave.
- **Swell and fall:** an LFO into *Direction* so the tone rises, hangs and falls.
- **Wide pad:** *Spread* 100 %, *Width* 100 %, *Count* 12.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Endless Tone does. In the standalone app open **File → Presets…** (⌘P) and pick *Endless Tone* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Endless Tone: Rising Pad** | A pad that rises for ever and never gets higher: octave-spaced partials slide up under a fixed window. Change Rate for a faster climb, Width for fewer or more clear partials, or flip Direction to fall. |
| **Endless Tone: Falling Drone** | A low, saw-edged tone that keeps sinking, with a slow LFO on Width so the cloud thickens and thins as it falls. Try a faster Rate for a descent that feels like an alarm. |
| **Endless Tone: Loop Clock** | Wrap gives a trigger every time the tone has climbed an octave: here it plays a kick, and the Loop ramp opens a filter on a saw so the whole patch spins with the tone. Change Rate to change the tempo of the spin. |
| **Endless Tone: Wide Swirl** | Twelve bright partials spread across the stereo field while a slow LFO swings Direction between rising and falling, so the swirl climbs, hangs and sinks. Narrow Width for a clearer, thinner voice. |
| **Endless Tone: Chord Riser** | Three tones a fifth and an octave apart rise together at slightly different rates, a chord that climbs without end and slowly rotates through its own beating. Change the Pitch of each tone for another chord. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Endless Tone view has 12 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Endless Riser** | A slow glide upward that never arrives. |
| **Falling Drone** | A warm tone that falls for ever. |
| **Slow Cloud** | A wide, dense wash of octaves, barely moving. |
| **Fast Spin** | A quick rising swirl. |
| **Saw Staircase** | Bright saw partials in a steady climb. |
| **Few Clear Partials** | Individual voices passing through the window. |
| **Frozen Chord** | No glide: a fixed stack of octaves; Phase moves it. |
| **Low Descent** | A deep, sinking tone. |
| **High Shimmer** | A glittering, wide rise high up. |
| **Gentle Mono** | Quiet and centred: a calm pad. |
| **Alarm Rise** | Tense, fast and bright. |
| **Reverse Slow** | A slow fall across many octaves. |
<!-- /generated -->

## Reference

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| Pitch | pitch | 1 V/oct centre of the pattern (0 = C4) |
| Reset | trigger | pattern back to its start |
| Out L, Out R | audio | the tone, with *Spread* panning |
| Loop | control | 0 – 1 ramp, one cycle per octave of glide |
| Wrap | trigger | at the end of each cycle |

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Pitch | −36 … +36 st | 0 |
| Fine | ±100 ct | 0 |
| Rate | 0 – 2 oct/s | 0.25 |
| Direction | −100 … +100 % | +100 % |
| Width | 0 – 100 % | 40 % |
| Count | 6 – 12 | 9 |
| Timbre | 0 – 100 % | 0 |
| Spread | 0 – 100 % | 30 % |
| Phase | 0 – 100 % | 0 |
| Level | 0 – 100 % | 60 % |

*Count* is a stepped knob and can be modulated.

## Origin

The illusion (a glide of octave-spaced partials under a fixed spectral
envelope) is textbook psychoacoustics; the module was written from that
description.
