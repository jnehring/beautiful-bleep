# Test Oscillator

## Introduction

Test Oscillator is modelled on the lamp-stabilised sine generators of the
old electronics lab: a big calibrated dial, a range switch, and a sine that
comes from a real self-oscillating loop instead of a counter. The loop's
imperfections are the point. The amplitude **bounces** when you turn the
dial or switch the range, the pitch creeps up as it warms, it hums faintly,
and below a *Loop Gain* of 100 % it stops oscillating and becomes a ringing
resonator that pings when kicked. One module is a drone, a sweep source and
a drum.

## How does it work?

**The loop.** A band-pass filter tuned by the dial feeds an amplifier, and
the amplifier feeds the filter. When the amplifier's gain (*Loop Gain*) is
above 100 %, any tiny noise grows into a sine at exactly the dial's
frequency. Something has to stop it growing:

**The lamp.** A small lamp in the loop warms up with the signal and turns the
gain down when the sine gets louder than its nominal level (±0.5). It takes
time to warm and cool (*Settle*), so the regulation lags behind: every
disturbance makes the amplitude overshoot, undershoot and settle again over
a few *Settle* times. That is the bounce. The *Lamp* output carries the
lamp's heat: 0 cold, 0.5 at the nominal level, 1 at twice the power.

**Loop Gain** decides the character:

- **Below 100 %:** no oscillation. The loop is a resonator that rings and
  decays: a *Kick* pings it, *Audio In* drives it like a tuned filter that
  saturates when pushed. The closer to 100 %, the longer the ring (at 95 %
  and 100 Hz it takes about 2.2 s to die away).
- **100 – 150 %:** a clean, lamp-regulated sine of about ±0.5. Higher values
  start faster and bounce harder.
- **Above 150 %:** the lamp runs out of range and the amplifier clips: louder
  (up to ±1), harder, rich in odd harmonics; at 300 % close to a rounded
  square. The lamp still moves, so the bounces remain.

**Settle** is the lamp's speed. Long values give slow, deep swells after a
disturbance. Very short values let the lamp follow the waveform itself: the
sine distorts, and at high loop gains it squeals and flutters in bursts.

**Turning the dial** costs the loop some gain while it moves (up to 30 % on
fast sweeps; jumps on *Pitch* count too). The lamp cools, and when the dial
stops the amplitude surges and rings. **Changing the Range** breaks the loop
for 4 ms, like the contacts of a real switch: a click, a dip, a surge.

**Drift** adds the instrument's age: after power-up the pitch starts up to a
semitone flat and warms up over about 30 s (*Warm-up*), it wanders by a few
cents, and the mains hum (*Mains*) leaks in faintly. Tuned near 50/60 Hz (or
150/180 Hz) the oscillator gets pulled and locks to the hum. At 0 % the
instrument is ideal.

**Square** is a comparator on the sine with finite edges, and stays at 50 %
duty through the bounces. **Sync** fires once per period at the sine's
upward zero crossing. Both go quiet when the loop is silent.

**Power-up.** With *Power-up* on *On play* the oscillator switches on when the
transport starts: silent, cold and flat, then it starts up from its noise
floor and warms up, the same way on every playback, so renders repeat
exactly. *On load* switches it on when the board loads (or *Seed* changes)
and lets it run free.

## How to use it?

- **A drone with life:** *Loop Gain* 120 %, *Settle* 1 s, *Drift* 60 %. Turn
  the dial slowly and let it swell.
- **A sweep source:** modulate *Frequency* or *Pitch* with a slow LFO; the
  amplitude dips on the fast parts and surges back.
- **A tuned drum:** *Loop Gain* 90–98 %, a clock into *Kick*, *Range* ×10. The
  *Kick* knob sets how hard it pings; inside a Voice Cell, *Voice In ›
  Trigger* into *Kick* and *Voice In › Pitch* into *Pitch* give a tuned
  percussion voice.
- **A resonant filter:** *Loop Gain* 80–95 %, a drum loop or noise into
  *Audio In*; tune the dial to taste.
- **Wobbly tremolo:** *Settle* 5–20 ms, *Loop Gain* 200 %: the lamp chases the
  waveform and the tone squeals and stutters.
- **An envelope of the bounces:** *Lamp* into a filter's cutoff.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Frequency | 1.0 – 10.0 (log) | 4.4 |
| Fine | ±50 cents | 0 |
| FM | 0 – 100 % | 0 % |
| Loop Gain | 0 – 300 % | 120 % |
| Settle | 5 ms – 2 s | 250 ms |
| Drift | 0 – 100 % | 40 % |
| Kick | 0 – 100 % | 50 % |
| Level | 0 – 100 % | 100 % |
| Range | ×1, ×10, ×100, ×1k | ×100 |
| Warm-up | Off, On | On |
| Mains | Off, 50 Hz, 60 Hz | 50 Hz |
| Power-up | On load, On play | On play |
| Seed | 0 – 999 | 1 |

- **Frequency:** the dial; the frequency is 2 Hz × *Range* × *Frequency*
  (4.4 on ×100 is 880 Hz).
- **Fine:** fine tuning.
- **FM:** depth of linear frequency modulation from the *FM* input.
- **Loop Gain:** resonator below 100 %, regulated sine up to 150 %, clipping above.
- **Settle:** how slowly the lamp reacts; the speed of the bounces.
- **Drift:** warm-up, wander and mains hum together.
- **Kick:** how hard each *Kick* pulse hits (50 % pings at the nominal level).
- **Level:** the size of Sine and Square.
- **Range:** ×1 2–20 Hz, ×10 20–200 Hz, ×100 200 Hz–2 kHz, ×1k 2–20 kHz.
- **Warm-up:** the pitch starts flat after power-up and rises.
- **Mains:** the hum's frequency.
- **Power-up:** when the oscillator switches on.
- **Seed:** picks the noise and the wander.

All knobs are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Pitch | pitch | 1 V/oct relative to the dial |
| FM | audio | linear frequency modulation, depth set by *FM* |
| Kick | trigger | each pulse kicks the resonator: a ping, or a bounce while oscillating |
| Audio In | audio | added into the loop: excites, colours or locks it |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Sine | audio | the loop's sine, about ±0.5 when regulated, up to ±1 when clipping |
| Square | audio | a band-limited square at the same frequency, 50 % duty |
| Sync | trigger | one pulse per period, at the upward zero crossing |
| Lamp | control | the lamp's heat, 0 … 1 (0.5 at the nominal level) |
