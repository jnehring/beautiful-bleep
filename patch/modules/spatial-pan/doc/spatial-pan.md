# Spatial Pan

## Introduction

Spatial Pan places a sound in a space around your head, for headphones.
Instead of just moving it left and right it uses the cues the ear really uses:
sound reaches the near ear earlier and louder, the head shadows the far ear's
highs, the shape of the outer ear changes with height, the back is duller than
the front, distance makes sounds quieter, softer and more reverberant, and a
source that moves toward or away from you bends in pitch. All the cues are
synthesised from simple formulas, so there is no data to install.

## How does it work?

**Azimuth, distance, elevation.** *Azimuth* is the angle around you: 0° is in
front, +90° at your right ear, ±180° behind. *Distance* runs from 0.25 m (right at
the ear) to 25 m. *Elevation* is −90° (below) to +90° (above). Everything is
smoothed so moving them (or modulating them) is clean. *Orbit* spins the
azimuth continuously at up to 2 turns per second in either direction.

**Time difference.** The sound reaches the far ear later by (a/c)(θ + sin θ),
with *Head* radius a (7 – 11 cm), the speed of sound c and the angle θ from the
midline: up to 0.65 ms. Delays are read with cubic interpolation.

**Level difference and head shadow.** Each ear has a first-order filter whose
gain depends on the angle between the source and that ear: the near ear gets a
slight lift of the highs, the far ear a growing roll-off, up to −15 dB at 6 kHz
for a source at the side.

**Height and rear.** A notch in the highs moves from about 5 kHz (below) to
10 kHz (above) and deepens away from the horizontal plane. The back is a
low-pass that closes from 16 kHz to about 5 kHz.

**Distance.** The level falls with 1/(1 + 1.5·(d − 0.25 m)); *Air* removes
highs with distance. The propagation delay d/c is applied in proportion to
*Doppler*: when the distance changes, the delay changes, and the pitch bends
as it would in air (a source receding at 34 m/s is 10 % flat). At 0 % there is no
delay, so a moving distance changes only level and brightness.

**Room.** Six early reflections from the same source, panned around its
direction, arrive between 6 and 32 ms (spaced by *Size*), quieter with distance,
low-passed. *Room* sets their level.

**Side.** A control output with the source's left/right position, −1 … +1.

## How to use it?

- **Headphone mixes:** one Spatial Pan per instrument at different azimuths
  and distances; keep the *Level* knobs matched.
- **A source in orbit:** *Orbit* 0.2 turns/s, *Distance* 40 %, *Doppler* low.
- **A fly-by:** an envelope or LFO into *Distance* with *Doppler* up.
- **Movement from a sequencer:** noise or random CV into *Azimuth*.
- **Stereo input:** with both inputs patched they are mixed to one source.
- **Speakers:** the cues are made for headphones; on speakers keep *Head* small
  and *Room* up for a softer effect.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Spatial Pan does. In the standalone app open **File → Presets…** (⌘P) and pick *Spatial Pan* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Spatial Pan: Orbiting Lead** | A plucked melody circles the listener once every five seconds. Wear headphones: the time and level differences, the duller back and the early reflections make the circle. Change Orbit for a faster or reversed spin or Distance to pull it in. |
| **Spatial Pan: Drifting Kit** | A drum loop swings from side to side over four bars with a little room around it. Reduce the Room knob for a drier, closer kit or make Distance bigger for a kit heard from the back of the hall. |
| **Spatial Pan: Fly-By** | A bright riff passes by: it comes from the far left, sweeps close to the middle and leaves to the far right, and its pitch bends the way a passing source does. Lower Doppler to hear the path without the pitch bend. |
| **Spatial Pan: Overhead Rain** | Bell-like plucks high in the scale move up and down in elevation and wander in azimuth under two slow random LFOs, so notes seem to fall around and above the head. Reduce Elevation depth for a flatter field. |
| **Spatial Pan: Two Places** | The drums sit behind and to the right, the melody in front and to the left, each with its own distance and room. Move Azimuth on either to rearrange the stage. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Spatial Pan view has 13 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Front Centre** | Straight ahead, a little room. |
| **Hard Left** | At the left ear. |
| **Hard Right** | At the right ear. |
| **Behind** | Behind you: duller, with the highs rolled off. |
| **Above** | Overhead: the pinna notch moves up. |
| **Below Left** | Low and to the left. |
| **Slow Orbit** | A source circling the head every seven seconds. |
| **Fast Orbit** | A quick spin, close in. |
| **Distant** | Far away: quiet, soft and reverberant. |
| **Close Whisper** | At the ear, almost dry. |
| **Big Room** | A large space of long reflections. |
| **Dry Booth** | No reflections: pure head cues. |
| **Giant Head** | A large head: longer time differences. |
<!-- /generated -->

## Reference

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| In L, In R | audio | the source; two inputs are summed to mono |
| Out L, Out R | audio | the binaural pair |
| Side | control | the source's lateral position, −1 … +1 |

### Knobs

| Control | Range | Default |
|---|---|---|
| Azimuth | −180 … +180 ° | 0 |
| Distance | 0.25 m … 25 m (0 – 100 %) | 35 % |
| Elevation | −90 … +90 ° | 0 |
| Orbit | −2 … +2 turns/s | 0 |
| Doppler | 0 – 100 % | 100 % |
| Room | 0 – 100 % | 30 % |
| Size | 0 – 100 % | 50 % |
| Air | 0 – 100 % | 50 % |
| Head | 7 – 11 cm | 8.75 |
| Level | 0 – 100 % (50 % = unity gain) | 50 % |

## Origin

The time-difference and head-shadow formulas are standard published
spherical-head models (path-length formula and a first-order pole/zero
shadow); the module was written from those descriptions and uses no
measured response data.
