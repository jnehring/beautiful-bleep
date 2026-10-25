# Shape Sequencer

![Shape Sequencer in the module view](shape-sequencer.png)

## Introduction

The Shape Sequencer **draws a control voltage in time with the music**. You
choose how long the loop is and how finely it is divided, then place shapes in
the slots: a rising saw, a falling saw, a plateau, a curve. Patch its output
onto a volume for a sidechain pump, a filter cutoff for a rhythmic sweep, or
a pan for a hopping stereo image.

It outputs CV only. What the shape moves is up to the module you patch it to.

## How does it work?

**Length and grid.** *Length* sets the loop (a quarter bar up to 8 bars).
*Grid* sets the size of one slot (1/1 up to 1/32). A loop of 1 bar on a 1/4
grid has 4 slots; 2 bars on 1/8 has 16. There are at most 32 slots; a
combination with more is cut to 32.

**Shapes.** Pick a shape in the palette and click slots to place it:

- **Saw up** and **Saw down** ramp between two levels.
- **Plateau** holds one level.
- **Curve** is an S-shaped glide between two levels.
- **Triangle** rises to a peak and falls back.
- **Pulse** holds one level for the first half of the slot and another for the second.
- **Erase** empties a slot (it plays 0).

Choose *Select* to stop placing and just pick slots.

**Editing a shape.** Click a slot to select it. Its handles appear: a yellow
square for each level (drag it up or down), and a white dot on the line that
bends the curve (drag it up or down). *Flip* swaps the start and end levels, so
a saw up becomes a saw down. *Reset shape* straightens the curve.

**Running it.** *Sync* decides what starts the loop:

- **Transport:** the loop follows the song position, so it is always on the
  grid, even after a loop jump. It rests while the song is stopped.
- **Trigger:** a pulse at *Trig / Gate* starts the loop from the beginning. A
  new pulse restarts it. *Playback* chooses *Loop* (keeps cycling) or *Once*
  (plays one pass and holds the last value).
- **Gate:** the loop runs while the gate is high and rests when it falls.

A pulse at *Reset* sends the loop back to the start.

**Output.** *Depth* scales the shape, *Offset* moves it up or down, *Polarity*
chooses 0 … 1 or −1 … +1, and *Slew* rounds off the corners. *Rate* plays the
loop at half or double speed (a quarter to four times). *Slot* sends a pulse at
the start of every slot, and *Cycle* a pulse at each start of the loop, to
trigger other modules in time with the shapes.

## How to use it?

- **Sidechain pump:** Saw up on each beat (1 bar, 1/4 grid, four Saw up slots)
  into a VCA's gain. Raise *Slew* a little for a softer pump.
- **Rhythmic filter:** 1 bar on a 1/8 grid with Saw down, Plateau and Pulse
  mixed, into a filter's cutoff.
- **One-shot swell:** *Sync* Trigger, *Playback* Once, 2 bars, a single Curve
  across a few slots; trigger it from a button.
- **Auto-pan:** *Polarity* Bipolar, Triangle slots into a pan.

## Settings and knobs

| Setting | Values | Default |
|---|---|---|
| Length | 1/4 bar, 1/2 bar, 1 bar, 2 bars, 4 bars, 8 bars | 1 bar |
| Grid | 1/1, 1/2, 1/4, 1/8, 1/16, 1/32 | 1/4 |
| Sync | Transport, Trigger, Gate | Transport |
| Playback | Loop, Once (Trigger sync only) | Loop |
| Polarity | Unipolar, Bipolar | Unipolar |

| Knob | Range | Default |
|---|---|---|
| Depth | 0 – 100 % | 100 % |
| Offset | −1 … +1 | 0 |
| Slew | 0 – 100 % | 0 |
| Rate | 1/4×, 1/2×, 1×, 2×, 4× | 1× |

Every knob is a modulation destination.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Trig / Gate | gate | Starts the loop (Trigger) or runs it while high (Gate) |
| Reset | trigger | Back to the start of the loop |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | control | The drawn shape, after Depth, Offset and Slew |
| Slot | trigger | A pulse at the start of each slot |
| Cycle | trigger | A pulse at each start of the loop |

<!-- generated:demos -->
## Demo patches

Five whole patches show what Shape Sequencer does. In the standalone app open **File → Presets…** (⌘P) and pick *Shape Sequencer* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Shape Sequencer: Sidechain Pump** | Four saw-up shapes, one per beat, are the gain of a held pad: each beat the sound ducks and swells back, like a sidechained compressor you can draw. Select a slot and drag its bend dot to change how quickly the pad recovers, or its start square to change how deep the duck goes. |
| **Shape Sequencer: Filter Steps** | A bar cut into eight slots mixes saws, plateaus, a pulse and a triangle, and moves a filter over an arpeggio so every eighth note opens differently. Switch the Grid to 1/16 for sixteen smaller slots, or drag the yellow squares to change how high each slot lifts the cutoff. |
| **Shape Sequencer: Auto-Pan** | Set to Bipolar, two bars of triangles and plateaus swing a bell-like melody left and right: the shape's centre is the middle of the stereo field. Change the Length to 4 bars for a slower drift, or raise Slew to round the corners. |
| **Shape Sequencer: One-Shot Swell** | A note every four bars triggers a four-bar shape, played once: a slow curve up, a peak and a long fall, which opens a filter and lifts a drone's volume together. Try Playback on Loop to hear it repeat on its own, or change Length to shorten the swell. |
| **Shape Sequencer: Slots as Triggers** | The Slot output pulses at the start of every slot and Cycle once per loop, so the grid itself plays drums: Slot is the kick, Cycle the snare, while the shape swells the hats. Change Grid to 1/8 to double the kick pattern. |
<!-- /generated -->
