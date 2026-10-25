# Select

## Introduction

The Select picks one of up to eight inputs and passes it to *Out*. It takes any
signal: audio, pitch, control, gate or trigger. Use it to choose between
three quantizers, cycle through melodies, or switch between sound sources. A
knob, a CV, a trigger or the song decides which input is heard, and every
change fades, so audio doesn't click.

## How does it work?

**Choosing the input.** The *Inputs* setting (2 … 8) sets how many inputs there
are; the unused jacks are hidden, and cables to them are kept.

- **Select** divides its range into one slot per input. With 4 inputs,
  0 … 0.25 picks *In 1*, 0.25 … 0.5 picks *In 2*, and so on. Turn the knob,
  or patch a CV onto it: an LFO sweeps through the inputs, a sequencer lane
  picks them, and a gate picks between two. A little hysteresis keeps a noisy
  CV from flickering at the borders.
- **Next** moves one input on each trigger, in *Order*: *Forward*, *Backward*,
  *Ping-Pong* or *Random* (never the same input twice, with *Seed* choosing the
  sequence). *Select* adds an offset, so a slow CV can sweep the inputs while
  triggers shift where the sweep starts.
- With *Next* unpatched and a **Rate** set, the Select follows the song, locked
  to the bars.
- **Slot Triggers** (off by default) gives the Select one trigger jack per
  input, *Trig 1 … Trig N*. A trigger on *Trig k* jumps straight to input *k*,
  and the next *Next* continues from there. Set it to the number of inputs
  you want to address.

**Changing smoothly.** Each change fades over *Fade*. The short default (2 ms)
removes clicks from audio; 0 switches instantly, right for gates and stepped
values. A change in the middle of a fade continues from what's playing, so
fast switching never jumps. *Fade Curve* *Equal Power* keeps the loudness even
between two different sounds; *Linear* is right for modulation and for two
versions of the same sound.

An unpatched input counts as silence (0).

## How to use it?

- **Pick a quantizer:** the same random or sequence into three Quantizers set
  to different scales, their outputs into *In 1–3*, *Out* to the oscillator.
  Turn *Select*, or patch a trigger into *Next*.
- **A/B switch:** *Inputs* 2 and a gate (a square LFO, a button) onto
  *Select*: low is *In 1*, high is *In 2*.
- **Sweep sources:** four oscillators into *In 1–4* and a slow triangle LFO
  onto *Select*.
- **One trigger per source:** *Slot Triggers* 3, drum lanes into
  *Trig 1–3*; each lane hit jumps to its input.
- **Carry a gate along with a pitch:** use two Selects driven by the same
  CV, one for the pitch and one for the gate, with *Fade* 0.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Select does. In the standalone app open **File → Presets…** (⌘P) and pick *Select* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Select: Three Scales in Turn** | One wandering random value goes into three Quantizers set to different scales; the Select hands the melody to the next scale every bar with a short crossfade. Set Order to Random, or turn the Select knob by hand. |
| **Select: A Slow LFO Sweeps the Sources** | Four oscillators play the same riff and a slow triangle LFO on the Select knob sweeps through them, so the sound changes shape by itself. The Fade of 80 ms blends neighbours; set it to 0 for hard cuts or 600 ms for a smooth morph. |
| **Select: A/B Melodies on a Gate** | Two different sequences feed a two-input Select, and a square LFO used as a gate on the Select knob flips between them every two bars: low plays the first melody, high the second. With only two inputs, any gate is an A/B switch. |
| **Select: Slot Triggers Pick the Drum** | Slot Triggers is set to 3: a trigger on Trig 1, 2 or 3 jumps straight to that input. Two lanes of the Drum Grid pick between kick, snare and clap, so the one voice the Select lets through changes with the groove. Remove a cable to hear just one drum. |
| **Select: Rotating with the Song** | With nothing patched into Next, the Select follows the song at its Rate: one new drone every two bars, in Ping-Pong order, with a one-second crossfade. Lengthen Fade for a slow morph, or choose Random and another Seed. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Select | 0 … 1 | 0 |
| Fade | 0 … 2 s | 2 ms |
| Inputs | 2 … 8 | 4 |
| Order | Forward, Backward, Ping-Pong, Random | Forward |
| Rate | Off, 1/32 … 8 bars | Off |
| Fade Curve | Equal Power, Linear | Equal Power |
| Reset Input | Off, On | Off |
| Slot Triggers | 0 … 8 | 0 |
| Changed Output | Off, On | Off |
| Seed | 0 … 999 | 1 |

- **Rate:** only used while *Next* is unpatched. One step per this length,
  locked to the song position.
- **Reset Input:** shows the *Reset* jack.
- **Slot Triggers:** shows *Trig 1 … Trig N* for the first N inputs.
- **Changed Output:** shows the *Changed* jack.
- **Seed:** chooses the sequence of *Order* *Random*.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In 1–8 | audio | The sources for *Out*. Any signal type passes. Unpatched: silence. |
| Next | trigger | Moves one input in *Order* |
| Reset | trigger | Back to the first input (the last, for *Backward*). Needs *Reset Input* On. |
| Trig 1–8 | trigger | Jump to that input. Needs *Slot Triggers*. |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | The selected input |
| Changed | trigger | A pulse at each change. Needs *Changed Output* On. |
