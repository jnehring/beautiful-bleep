# Route

## Introduction

The Route sends its *In* to one of up to eight outputs. It takes any signal:
audio, pitch, control, gate or trigger. Use it to send one melody to a chosen
quantizer or voice, one drum to a chosen effect, or one clock to a chosen
destination. A knob, a CV, a trigger or the song decides where the signal
goes, and every change fades, so audio doesn't click.

## How does it work?

**Choosing the output.** The *Outputs* setting (2 … 8) sets how many outputs
there are; the unused jacks are hidden, and cables from them are kept.

- **Select** divides its range into one slot per output. With 4 outputs,
  0 … 0.25 picks *Out 1*, 0.25 … 0.5 picks *Out 2*, and so on. Turn the knob,
  or patch a CV onto it: an LFO sweeps the signal through the outputs, a
  sequencer lane picks them, and a gate picks between two. A little
  hysteresis keeps a noisy CV from flickering at the borders.
- **Next** moves one output on each trigger, in *Order*: *Forward*, *Backward*,
  *Ping-Pong* or *Random* (never the same output twice, with *Seed* choosing
  the sequence). *Select* adds an offset, so a slow CV can sweep the outputs
  while triggers shift where the sweep starts.
- With *Next* unpatched and a **Rate** set, the Route follows the song, locked
  to the bars.
- **Slot Triggers** (off by default) gives the Route one trigger jack per
  output, *Trig 1 … Trig N*. A trigger on *Trig k* jumps straight to output *k*,
  and the next *Next* continues from there. Set it to the number of outputs
  you want to address.

**The other outputs.** With **Idle Outputs** *Zero* the outputs that aren't
selected are silent. With *Hold* they keep the last value they had, and fade
back into the live signal when their turn comes. Hold is right for pitches and
other control values; Zero for audio.

**Changing smoothly.** Each change fades over *Fade*. The short default (2 ms)
removes clicks from audio; 0 switches instantly, right for gates and stepped
values. A change in the middle of a fade continues from what's playing, so
fast switching never jumps. *Fade Curve* *Equal Power* keeps the loudness even
between two different destinations; *Linear* is right for modulation.

## How to use it?

- **Pick a voice:** a quantized melody into *In*, *Out 1–3* to three voices,
  a trigger into *Next* to hand the melody to the next voice.
- **Pick an effect:** a drum into *In*, *Out 1–4* to a dry path, a delay, a
  filter and a reverb; a slow LFO onto *Select*.
- **Roll a chord:** a pitch into *In*, *Idle Outputs* *Hold*, a clock into
  *Next*, *Out 1–4* to four oscillators: each oscillator keeps its note until
  its turn.
- **One trigger per destination:** *Slot Triggers* 3, drum lanes into
  *Trig 1–3*; each lane hit aims the signal at its output.
- **Both ways round:** pair a Route with a [Select](select.md) driven by the
  same clock to send one signal through one of several processors and pick up
  its result.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Route does. In the standalone app open **File → Presets…** (⌘P) and pick *Route* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Route: One Melody, Three Voices** | One wandering melody is quantized once and sent to three different voices in turn by the Route: a bright saw, a hollow pulse and a soft sine, each for one bar. Set Idle Outputs to Hold and a voice keeps its last note while it waits. |
| **Route: A Slow LFO Sends the Riff Around** | A slow triangle LFO on the Select knob moves one riff between four treatments: dry, a long echo, a low-pass filter and a big reverb. The 120 ms Fade blends from one to the next; at 0 it cuts, at 1 s it morphs. |
| **Route: Slot Triggers Aim the Hit** | Slot Triggers is set to 3: a trigger on Trig 1, 2 or 3 aims the Route at that output. One snare hit is sent to a dry output, a short room or a long hall depending on which Drum Grid lane fired just before it. |
| **Route: Hold Keeps Every Voice Singing** | Idle Outputs is Hold: a new note goes to the next of four drones every bar, and each drone keeps the pitch it last got until its turn comes again. The result is a four-note chord that rolls forward one note at a time. |
| **Route: Random Hits Around Four Voices** | One hi-hat pattern is dealt out at random to four differently tuned percussion filters, one step at a time, by a Route that follows the song at 1/8 (nothing is patched into Next). Change Seed for another order, or Order to Forward for a fixed rotation. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Select | 0 … 1 | 0 |
| Fade | 0 … 2 s | 2 ms |
| Outputs | 2 … 8 | 4 |
| Order | Forward, Backward, Ping-Pong, Random | Forward |
| Rate | Off, 1/32 … 8 bars | Off |
| Fade Curve | Equal Power, Linear | Equal Power |
| Idle Outputs | Zero, Hold | Zero |
| Reset Input | Off, On | Off |
| Slot Triggers | 0 … 8 | 0 |
| Changed Output | Off, On | Off |
| Seed | 0 … 999 | 1 |

- **Rate:** only used while *Next* is unpatched. One step per this length,
  locked to the song position.
- **Reset Input:** shows the *Reset* jack.
- **Slot Triggers:** shows *Trig 1 … Trig N* for the first N outputs.
- **Changed Output:** shows the *Changed* jack.
- **Seed:** chooses the sequence of *Order* *Random*.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In | audio | The source. Any signal type passes. |
| Next | trigger | Moves one output in *Order* |
| Reset | trigger | Back to the first output (the last, for *Backward*). Needs *Reset Input* On. |
| Trig 1–8 | trigger | Jump to that output. Needs *Slot Triggers*. |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1–8 | audio | *In* at the selected output; the others are silent or hold |
| Changed | trigger | A pulse at each change. Needs *Changed Output* On. |
