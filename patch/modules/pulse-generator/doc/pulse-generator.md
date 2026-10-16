# Pulse Generator

## Introduction

Pulse Generator is a laboratory pulse generator on your board: one precisely
timed rectangular pulse per period, with a **delay**, a **width**, slewed
**edges**, **bursts** and **double pulses**. As a clock it is exact and can
lock to the song position. As a sound source its edges excite a **ringing**
resonance, like a badly terminated cable, so the pulses turn into clicks,
pings and small drum tones.

Its unit is time: set it with the knobs or drag the timing diagram.

## How does it work?

**The pulse.** Each period starts with a *Sync* pulse. *Delay* later the
pulse begins: it rises over *Rise*, stays up, and after *Width* falls over
*Fall* (both a share of the width; at 0 % the edge is a clean step). The
*Gate* output is the plain logic version: high from the start of the pulse
to the start of its fall. *Amplitude* and *Offset* set the level of *Out*.
*Polarity Complement* turns the pulse upside down (Gate too).

With *Time Units* on *% of Period*, Width and Delay are shares of the
period, so they follow it. In *Time*, a width that would reach the next
period is shortened and the **Duty** lamp lights.

**Modes.**

1. **Free Run:** a period every *Period*. With *Sync* on a note value and the
   transport playing, periods lock to the song position (stopped, they run at
   that note length and the current tempo). *Reset* restarts the period now.
2. **Triggered:** each *Trigger* (or the **Single** button) starts a burst of
   *Burst* pulses, one *Period* apart. A trigger during a burst restarts it;
   *Reset* stops it.
3. **Gated:** while *Gate* is high, periods run, the first one at the rising
   edge. After the falling edge no new pulse starts, but the last one plays
   to its full width.
4. **External Width:** a gate delay line. *Gate*'s edges come out *Delay*
   later, the pulse as long as the gate was high (*Rise* and *Fall* are still
   shares of the *Width* knob). Up to 256 edges can wait; more are dropped and
   Duty lights. With Gate unpatched, each *Trigger* becomes a pulse of
   *Width*. Sync fires at the input's rising edges.

**Double** gives two pulses per period, at the period start and *Delay*
later. The shortest period is 4 samples (83 µs at 48 kHz).

**Jitter** moves each pulse by a seeded random amount, up to ±25 % of the
period (more often small than large). It never moves the period grid, so a
synced clock stays on the beat, and Sync is never jittered. The same *Seed*
gives the same jitter every time.

**Warm-up** (Free Run, Sync Free) makes the period settle like a cold
instrument: 5 % long at the start (of the transport, or when the module is
added), then drifting in. The **Warming** lamp stays lit until it is within
0.1 %, after about 47 seconds.

**Ringing.** Every edge excites a resonance at *Ring Freq* (plus *Pitch*, in
octaves). *Damping* sets how many cycles it lasts: from 200 down to half a
cycle. Rising and falling edges ring with opposite sign, so a short pulse
gives a two-edge ping whose colour follows the width (half a ring cycle
reinforces it, a whole cycle cancels it). Slow edges ring less. *Ring* mixes
it into Out; the *Ring* output carries it alone, at full strength. A very
resonant ring that a pulse train keeps feeding is softly limited.

**Clean edges.** Edges are placed between samples and band-limited, so fast
pulse trains don't alias and the ring is clean. All outputs are one sample
late for it.

## How to use it?

- **An exact clock:** Sync 1/16, Width 10 %, *Gate* into a sequencer's clock.
- **Clicks and pings:** Period 250 ms, Width 0.2 ms, Ring 100 %, Ring Freq
  3 kHz, Damping 60 %. Turn Width to hear the colour change.
- **A small drum:** Triggered, *Ring* output, Ring Freq 180 Hz, Damping 30 %,
  Width 3 ms: a pitched thump per trigger.
- **One ping per note:** in a Voice Cell, *Voice In › Trigger* into *Trigger*
  and pitch into *Pitch*, Triggered mode. Each voice has its own jitter.
- **Rolls and flams:** Triggered, Burst 4, Period 30 ms; or Double with a
  short Delay for flams.
- **A humanised clock:** Sync 1/8, Jitter 15 %.
- **Delay a gate:** External Width, Delay 125 ms: the gate comes out late and
  as long as it went in.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Pulse Generator does. In the standalone app open **File → Presets…** (⌘P) and pick *Pulse Generator* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Pulse Generator: Humanised Clock** | A Pulse Generator synced to 1/16 is the clock for a melody, while a second one rings a short pulse into hi-hat ticks. Jitter on the first one loosens the groove; try it at 0 for a rigid machine and at 40 % for a drunk one. |
| **Pulse Generator: Ringing Pings** | A very short pulse struck once per note makes the Ring resonance ping, and the sequencer's pitch moves Ring Freq, so each note is a glassy, metallic chime. Turn Damping to change how long they ring, or Width to change their colour. |
| **Pulse Generator: Pulse Drums** | Four Pulse Generators in Triggered mode, each struck by a Drum Grid track: Ring Freq and Damping turn the same circuit into a deep thump, a tom, a rim click and a hat. Change their Ring Freq and Damping for a whole new kit. |
| **Pulse Generator: Rolls and Flams** | Burst fires four to eight pulses 30 ms apart for a drum roll, and Double adds a second pulse for a flam. A sparse beat triggers them, so the kit rolls in at the ends of phrases. Try Burst 16 or a longer Period. |
| **Pulse Generator: Gate Echo** | In External Width mode the Pulse Generator is a gate delay: each gate of a slow melody comes out 330 ms later, as long as it went in, and opens a second voice an octave up. Change Delay to move the echo, and Width to see the gate length. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Pulse Generator view has 15 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Clock 1/16** | Exact 1/16 clock pulse locked to the song position. |
| **Slow Gate** | Gentle one-second gate with softened edges: a rhythmic envelope source. |
| **Square Wave** | A 200 Hz square tone. |
| **Narrow Pulse** | Thin 200 Hz pulse: nasal and bright. |
| **Click Train** | A train of 25 Hz clicks: granular and tick-like. |
| **Cable Ping** | Short pulses ringing like a mistuned cable. |
| **Small Drum** | Low ringing resonance: a tiny tuned drum on every beat. |
| **Metal Tick** | High, tight ring for hat-like ticks. |
| **Burst Triggered** | Each trigger fires eight fast pulses: a flam or roll. |
| **Double Pulse** | Two pulses per period for flams and double clocks. |
| **Jittery Clock** | Human-ish wobble on each pulse while the grid stays put. |
| **Gated Pulses** | Pulses run while the gate is high: a buzzy gated tone. |
| **Complement Gate** | Inverted pulse: high most of the time, dips on the beat. |
| **Percent Width** | Width follows the period, so the timbre stays put as you sweep pitch. |
| **Soft Edges** | Slewed edges round a pulse into a soft, nearly triangle tone. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Period | 20 µs – 10 s | 100 ms |
| Width | 1 µs – 5 s, or 0 – 100 % | 10 ms (10 %) |
| Delay | 0 – 10 s, or 0 – 100 % | 0 |
| Rise | 0 – 100 % of Width | 0 % |
| Fall | 0 – 100 % of Width | 0 % |
| Amplitude | 0 – 100 % | 100 % |
| Offset | −1 … +1 | 0 |
| Jitter | 0 – 100 % | 0 % |
| Ring | 0 – 100 % | 0 % |
| Ring Freq | 20 Hz – 20 kHz | 2 kHz |
| Damping | 0 – 100 % | 50 % |
| Mode | Free Run, Triggered, Gated, External Width | Free Run |
| Sync | Free, 1/32, 1/16, 1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars, 8 bars | Free |
| Time Units | Time, % of Period | Time |
| Double | Off, On | Off |
| Burst | 1 – 64 | 1 |
| Polarity | Normal, Complement | Normal |
| Warm-up | Off, On | Off |
| Seed | 0 – 999 | 1 |

- **Period:** time from one period start to the next (Free Run with Sync Free,
  Triggered, Gated). The view's ÷10 / ×10 buttons step it by decades; the
  knob is the vernier.
- **Width:** the pulse length. *Time Units* picks which of the two Width knobs
  is shown.
- **Delay:** period start to pulse start; with *Double*, the pair spacing.
- **Rise / Fall:** the edge times, as a share of the width.
- **Amplitude / Offset:** the pulse height and the baseline of Out.
- **Jitter:** random timing, up to ±25 % of the period.
- **Ring / Ring Freq / Damping:** how much ringing is mixed into Out, its
  frequency, and how fast it dies.
- **Burst:** pulses per trigger (Triggered).
- **Seed:** picks the jitter.

Period, Width, Delay, Rise, Fall, Amplitude, Offset, Jitter, Ring, Ring Freq
and Damping are modulation destinations.

### The view

The timing diagram shows one period: Sync ticks, the pulse with its ringing,
and Period, Delay and Width as dimension lines. Drag an arrow's end to change
that value, or drag a slope's dot to change Rise or Fall. When Width or Delay
is under 2 % of the period the time axis is compressed, so they stay visible.
The **Duty** lamp lights when a width was shortened or pulses or edges were
dropped (at most 32 pulses can wait for their Delay at once); **Warming**
during warm-up. **Single** starts a burst in Triggered mode (and a pulse in
External Width with Gate unpatched).

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trigger | trigger | starts a burst (Triggered), or a pulse (External Width, Gate unpatched) |
| Gate | gate | runs the generator while high (Gated); the signal delayed (External Width) |
| Reset | trigger | restarts the period (Free Run unsynced, Gated); stops a burst (Triggered) |
| Pitch | pitch | added to Ring Freq in octaves |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | the pulse plus ringing, band-limited |
| Gate | gate | a clean logic copy of the pulse |
| Sync | trigger | one pulse at each period start, before Delay |
| Ring | audio | only the ringing, at full strength |
