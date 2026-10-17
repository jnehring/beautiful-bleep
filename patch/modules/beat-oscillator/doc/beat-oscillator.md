# Beat Oscillator

## Introduction

Beat Oscillator is a heterodyne tone source, the way old laboratory signal
generators worked. Two high carriers, **A** and **B**, run close together
and are mixed, and what you hear is their difference. Turn *Beat* a little
around zero and the tone sweeps from several kilohertz down to a slow pulse,
then stops.

The charm is in how imperfect it is. *Pull* couples the carriers so they try
to lock. Inside the lock range the beat disappears; just outside it the tone
stumbles along in uneven blips. *Drift* lets both carriers wander, and close
to zero beat even a tiny wander is a big change. *Warm-up* starts the
carriers flat, so the tone glides into tune like a cold valve instrument.

## How does it work?

**Two carriers.** A runs at *Carrier*. B runs at *Carrier* plus *Beat* plus
*Fine*. *Pitch* (1 V/oct) transposes both, so the beat tone moves with them.
The *Detune* input adds hertz to B (*Detune Range* per 1.0) without being
scaled by Pitch, like a hand moved near a tuning capacitor. *FM* modulates
B's frequency directly and can push it through zero: 1.0 is 1 kHz of
deviation.

**Beat.** The knob is cubic, so the middle is very fine: on *Range* ±2 kHz,
10 % is 2 Hz and 50 % is 250 Hz. *Range* sets the full swing (±20 Hz,
±200 Hz or ±2 kHz). *Fine* adds ±2 Hz for finding zero beat. The view shows
the actual beat in hertz.

**Mixer and detector.** The carriers are multiplied, and a steep low-pass
(the *detector*) keeps only the difference. *Mixer* picks the circuit:

- **Ideal:** a clean multiplier. The beat is a pure sine.
- **Diode:** a half-wave square-law mixer. The beat is brighter and slightly
  buzzy, with its own harmonics.
- **Overdriven:** both carriers clipped almost to squares first. The beat
  sounds like a triangle, with a little carrier leaking through.

At 0 %, *Detector* passes beats up to about 2 kHz and nothing else. Open it
and the sum of the carriers comes through as a whistle. You only hear it when
the carriers are low: turn *Carrier* below about 11 kHz with the detector open.

**Pull.** The carriers are coupled, so each one drags the other. The lock
range grows with *Pull* (25 % → 3 Hz, 50 % → 25 Hz, 100 % → 200 Hz).

- **Inside the lock range** both carriers run at one frequency and the beat
  stops. *Lock* goes high.
- **Just outside it** the beat is much slower than the detuning (the
  square-root law: 30 Hz detuning with a 25 Hz lock range beats at 16.6 Hz).
  The phase difference crawls, then whips round once, so Out plays one-cycle
  blips between near-silences. Let *Drift* or a slow *Detune* move the pair
  across the edge and the blips lurch, bunch up and stop.
- **Far outside** it is a plain beat again.

**Coupling.** *AC* removes DC from Out (below 5 Hz). Slow beats become
swells, and a locked pair is silent. *DC* keeps slow beats as a usable
modulation signal, and a locked pair holds a steady level.

**Drift and warm-up.** With *Drift* up, each carrier wanders on its own
smooth random curve, by up to ±25 cents at 100 %. At 10 kHz that is about
±145 Hz, enough to throw a 2 Hz beat all over the place, while a 2 kHz beat
barely notices. While the transport plays, the wander follows the song
position (a slow turn every 8 beats, small wobbles every beat). With
*Warm-up* on, both carriers start up to 40 cents flat, by different amounts,
and settle over the warm-up time. Warm-up starts when the transport starts.
While stopped it starts when the board loads, or when you press **Cold**.

**Beat and Lock outputs.** *Beat* measures the beat frequency by counting
how often the phase difference slips a full turn, and puts it out as
1 V/oct (0 V = 261.6 Hz, i.e. C4). When the pair locks it falls smoothly to
its floor of 0.1 Hz (−11.35 V). *Lock* is high while the carriers are locked.

**Repeatable.** The drift curves come from *Seed*. A transport start resets
the phases, the filters and the warm-up, so a render from the same start
is always the same. Inside a Voice Cell each voice drifts on its own.

## The view

Two dials show the actual frequencies of A and B, after drift, warm-up and
pulling. Between them is the beat B − A in hertz (signed, in millihertz
below 1 Hz) and the *Lock* lamp. The lamp is lit while locked. Outside lock
it flashes once per slip, so a slow beat shows as a blinking lamp. Below
them, the circle shows the phase difference ψ as a dot with a fading tail.
Locked, the dot stands still. Near the edge it creeps, then flicks round.
Far out it spins and blurs into a ring.

## How to use it?

- **Theremin sweep:** *Range* ±2 kHz, sweep *Beat* slowly from 0 % to 60 %
  with a slow LFO or by hand.
- **Lurching pulse:** *Pull* 50 %, *Range* ±200 Hz, *Beat* just past the lock
  edge (B − A around 27 Hz), *Drift* 30 %. Out into a VCA or filter.
- **Lock as a gate:** the same patch with *Lock* into an envelope. Drift
  pulls the pair in and out of lock at irregular times.
- **Tape-warmup intro:** *Warm-up* 30 s, *Beat* around 100 Hz: the tone
  slides into tune when the transport starts.
- **Slow modulation:** *Coupling* DC, *Range* ±20 Hz, *Beat* near zero: Out is
  a drifting sub-hertz wave for filters or panning.
- **Whistle:** *Carrier* 3 kHz, *Detector* 100 %: the sum tone joins the beat.
- **Melodic beat:** a sequencer into *Pitch* transposes the beat tone by octaves,
  and *Beat* (the output) gives back its pitch for a second oscillator.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Beat Oscillator does. In the standalone app open **File → Presets…** (⌘P) and pick *Beat Oscillator* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Beat Oscillator: Heterodyne Drone** | Two high carriers beat against each other and a slow LFO sweeps Beat, so a pure tone glides down into a throbbing pulse and back. Turn Drift up for a wandering, unstable tone or move Beat by hand for a held pitch. |
| **Beat Oscillator: Played Melody** | The sequencer's pitch is fed to the Pitch input so the heterodyne tone plays a tune, with a gentle envelope for each note. Change Carrier to shift the character, or raise Fine to detune the whole line. |
| **Beat Oscillator: Pull and Stutter** | A slow LFO raises Pull so the two carriers try to lock: the tone stutters, drops into pulses and jumps into pitch as they catch each other. Move Pull and Detector by hand to hear the stutter appear and disappear. |
| **Beat Oscillator: Slow Pulse Bass** | A low heterodyne bass under a drum loop: each sequencer note retunes the pair through Pitch and an envelope shapes it, with the Diode mixer adding grit. Try the Range setting at ±20 Hz or ±2 kHz and move Beat to change how deep it sits. |
| **Beat Oscillator: Overdriven Mixer** | The Mixer setting on Overdriven adds harmonics and sidebands to the beat tone, and Drift keeps it alive and slightly unstable. Compare Ideal, Diode and Overdriven to hear the same beat with three characters. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Beat Oscillator view has 14 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Lab Tone** | Classic heterodyne sine around 260 Hz, slightly alive. |
| **Pure Low** | A steady, drift-free low sine tone, good for sub and tests. |
| **Bright Whistle** | High beat tone around 1.2 kHz, thin and whistly. |
| **Diode Buzz** | Brighter, buzzy beat from a diode mixer: a reedy lead. |
| **Overdriven Triangle** | Squared-off carriers give a triangle-like beat with a little leak. |
| **Slow Tremolo** | Beat of a few hertz: the tone swells and fades like a tremolo. |
| **Slow Pulse** | Sub-audio beat of about one hertz; use as a smooth LFO. |
| **Wandering Zero** | Near zero beat with strong drift: the pitch lurches unpredictably. |
| **Locking Stutter** | Coupled carriers try to lock: uneven blips between near-silences. |
| **Hard Lock** | Strong coupling: the beat vanishes and returns as drift moves across the lock edge. |
| **Open Detector** | Opening the detector lets the sum tone whistle through above the beat. |
| **Cold Valve** | Starts flat and glides into tune like a cold instrument. |
| **Hand Capacity** | Wide Detune range: patch a slow control to it for theremin-like hand moves. |
| **FM Siren** | Mid-high buzzing beat to patch an LFO into FM for sirens. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Carrier | 500 Hz – 18 kHz | 10 kHz |
| Beat | −100 … +100 % (cubic: ± *Range*) | +51 % (+261.6 Hz on ±2 kHz) |
| Fine | −2 … +2 Hz | 0 Hz |
| Pull | 0 – 100 % | 0 % |
| Detector | 0 – 100 % | 0 % |
| Drift | 0 – 100 % | 15 % |
| Detune Range | 0 – 200 Hz | 20 Hz |
| Range | ±20 Hz, ±200 Hz, ±2 kHz | ±2 kHz |
| Mixer | Ideal, Diode, Overdriven | Ideal |
| Coupling | AC, DC | AC |
| Warm-up | Off, 10 s, 30 s, 2 min | Off |
| Seed | 0 – 999 | 1 |

- **Carrier:** the frequency of A.
- **Beat:** B's offset from A: *Range* × x³.
- **Fine:** added to the offset, for dialling zero beat.
- **Pull:** coupling between the carriers; lock range 200 Hz × Pull³.
- **Detector:** the mixer's low-pass, 2.5 kHz at 0 % up to 60 kHz at 100 %.
- **Drift:** how far the carriers wander, up to ±25 cents.
- **Detune Range:** hertz added to B per 1.0 at the *Detune* input.
- **Range:** the full swing of *Beat*.
- **Mixer:** the mixing circuit (see above).
- **Coupling:** AC removes DC from Out; DC keeps it.
- **Warm-up:** how long the carriers take to come up to pitch.
- **Seed:** picks the drift curves.

All knobs are modulation destinations. The **Cold** button restarts the
warm-up while the transport is stopped.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Pitch | pitch | 1 V/oct on both carriers (transposes the beat tone) |
| Detune | control | adds *Detune* × *Detune Range* Hz to B |
| FM | audio | linear, through-zero FM of B: 1.0 = 1 kHz |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the difference tone |
| A, B | audio | the raw carriers, after pulling and drift |
| Beat | pitch | the measured beat frequency as 1 V/oct (0 V = 261.6 Hz) |
| Lock | gate | high while the carriers are locked |
