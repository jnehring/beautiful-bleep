# Attenuverter

![Attenuverter in the module view](attenuverter.png)

## Introduction

Four rows that make a signal smaller, bigger, upside down or shifted. In the
module view each row is a column of two knobs: *Scale* on top, *Offset* below.
With nothing patched, a row is a knob you set by hand, so the Attenuverter is
also four macro controls: one row can feed many destinations with the same
value.

## How does it work?

Each row computes

    Out = In × Scale + Offset

*Scale* runs from −2 to +2: +1 passes the signal unchanged, 0 mutes it, −1
turns it upside down, and values beyond ±1 boost a weak signal. *Offset*
shifts the result up or down.

An unpatched *In* counts as a constant **+1**, so an empty row outputs
*Scale* + *Offset*. *Sum* adds the four rows.

Every cable already has its own amount at the destination. The Attenuverter
is for scaling once, at the source: one knob changes the depth for every
destination, and that knob can itself be modulated.

## How to use it?

- **One depth for many destinations:** LFO → *In 1*, *Out 1* to several
  knobs at full amount. *Scale 1* now sets all depths at once.
- **Macro knobs:** leave a row unpatched, set *Scale* to 0 and use *Offset*
  as a manual control. Patch *Out* to several knobs and move them together.
- **Unipolar from bipolar:** an LFO (−1 … +1) with *Scale* 0.5 and *Offset*
  0.5 runs from 0 to 1.
- **Invert:** *Scale* −1 makes an envelope fall instead of rise.
- **Mix four rows:** use *Sum* as a small four-input mixer.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Attenuverter does. In the standalone app open **File → Presets…** (⌘P) and pick *Attenuverter* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Attenuverter: Opposite Sweeps** | One slow LFO enters two rows of the Attenuverter, one scaled +1 and one -1, and they open the left filter while closing the right one, so the arpeggio seems to travel across the stereo field. Change the scale of either row to unbalance the sweep. |
| **Attenuverter: Manual Offsets** | With nothing patched in, each Attenuverter row is a constant set by its Offset: row 1 transposes the sequencer up a fourth and row 2 holds the filter at a fixed opening. Turn Offset 1 to change key while the music plays. |
| **Attenuverter: Wandering Sum** | Three unrelated modulators, a slow sine, a triangle and a smooth random line, go into three rows and meet at the Sum output, which sweeps the filter along a path that rarely repeats. Change a row's scale to give one modulator more say. |
| **Attenuverter: Hard-Clipped Sweep** | A triangle LFO is doubled by the row's Scale and hard-clipped, so the filter spends most of the time fully open or fully closed and only moves quickly in between. Set Clip to Off or Soft to round the sweep, or lower Scale to reduce the effect. |
| **Attenuverter: Kick Ducking** | A kick's envelope goes through a row set to scale -1 with offset +1, turning a short burst into a short dip, and that dip pumps the volume of a chord pad on every beat. Lower the negative Scale for a gentler duck. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Scale 1–4 | −2 … +2 | +1 |
| Offset 1–4 | −1 … +1 | 0 |
| Clip | Off, Soft, Hard | Off |

- **Scale:** the gain of the row. Negative values invert.
- **Offset:** added after scaling.
- **Clip:** limits every output, including *Sum*, to ±1. *Soft* leaves
  values up to ±0.8 untouched and bends smoothly into ±1; *Hard* cuts off at
  ±1.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In 1–4 | control | The signal of each row. Unpatched: a constant +1. |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out 1–4 | control | In × Scale + Offset, per row |
| Sum | control | Out 1 + Out 2 + Out 3 + Out 4 |
