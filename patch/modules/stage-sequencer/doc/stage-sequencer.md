# Stage Seq

![Stage Seq in the module view](stage-sequencer.png)

## Introduction

The Stage Seq plays **stages** instead of steps. Each of up to 16 stages has
a **pitch** and a **length in pulses** (1–8), and a **gate mode** that decides
what those pulses sound like: one long note, a note on every pulse, only the
first pulse, silence, or fast **ratchets**. **Slides** glide into a stage,
**accents** make it louder.

Because every stage has its own length, a few stages make long, uneven
phrases: the factory pattern is 8 stages and 12 pulses, so it shifts against
the bar every time round. It's a natural bass-line and lead sequencer.

Patch *Notes* into a Voice Cell and press play.

## How does it work?

**Pulses.** With nothing in *Clock*, pulses follow the transport at *Rate*;
with a trigger in *Clock*, each trigger is one pulse. A stage of 3 pulses
lasts three pulses, then the next stage starts.

**Order.** *Mode* chooses how the stages follow each other:

- **Forward** 1 … S, **Reverse** S … 1, **Pendulum** 1 … S … 2 (the end
  stages once per turn).
- **Random** jumps to a random stage, never the same one twice in a row.
- **Brownian** walks: one stage on (50 %), one back (25 %) or stays (25 %),
  wrapping around at the ends.

The fixed orders are worked out from the song position, so a loop jump lands
on the right stage and pulse. Random and Brownian start a new walk at every
**Phrase** (1–16 bars): the walk depends only on *Seed* and the phrase, so it
plays the same in every render, and after a jump the module replays the walk
from the phrase start and lands where it should. A stage that would cross the
end of a phrase is cut short there.

**Gate modes.**

| Mode | Gate | Notes |
|---|---|---|
| Rest | low | none; Pitch and Velocity hold |
| First | *Gate Length* of the first pulse | one |
| Every | *Gate Length* of each pulse | one per pulse |
| Hold | the whole stage | one long note |
| Ratchet | each pulse split into 2–4 fast gates | pulses × ratchets |

**Slide.** A stage with slide is entered **legato**: the previous note keeps
sounding into it (its gate is stretched to the stage boundary), the new
note-on comes before the old note-off, and *Pitch* glides there over *Slide
Time*. A Voice Cell in *Legato* mode glides with it. A slide into a Rest stage
does nothing.

**Accent.** An accented stage plays louder — by how much is set with the
*Accent* knob — and holds the *Accent* gate high while its notes sound.

**Hold.** While the *Hold* input is high, a stage that ends starts again. With
a clock, the order carries on where it stopped when Hold falls. With the
transport, the module rejoins the song position at the next pulse, so it's
never out of time.

**No hanging notes.** Stopping, Reset, changing *Stages*, *Mode* or *Phrase*,
and changing the sounding stage's gate mode or pulses all end the note.

## How to use it?

- **A bass line:** *Notes* into a Voice Cell with a low *Octave*. Use *Hold*
  stages for long notes and a slide or two for the squelch.
- **Editing:** the timeline shows each stage as wide as its pulses. Drag in
  the *Pitch* lane (it snaps to the scale; Shift for semitones; double-click
  resets). Drag sideways in *Pulses* to set the length, or scroll on the dots.
  Click *Gate* to cycle Rest → First → Every → Hold → Ratchet; scroll (or
  Shift-click) a Ratchet stage to set 2–4. Click *Slide* and *Accent* to
  toggle them; drag *Vel*.
- **Randomize** rewrites the lanes you tick in **▾** (pitch, pulses, gate,
  slide, accent, velocity), with the pitch range, the longest stage and the
  slide and accent chances. ◀ ▶ rotate the stages; **Clear** starts over.
- **Generative lines:** *Mode* = Brownian, *Phrase* = 4 bars. Change *Seed*
  until you like the walk; it stays the same every time you play.
- **Breaks:** patch a gate from another sequencer into *Hold* to stutter the
  current stage.
- **Chaining:** *Stage Start* fires on every stage, *End* when the cycle (or
  phrase) starts over.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Stage Seq does. In the standalone app open **File → Presets…** (⌘P) and pick *Stage Seq* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Stage Seq: Held Pulses** | Each stage holds its note for a different number of pulses, from one to six, so a slow pad-like line in Eb Lydian lingers on some notes and moves quickly past others. Change a stage's Pulses in the view to stretch or squeeze the phrase. |
| **Stage Seq: Gate Modes** | Eight stages that each use a different gate mode: a single First hit, notes that repeat on Every pulse, a long Hold, a Ratchet burst and a Rest, so one riff shows all the ways a stage can fire. Click a stage's gate mode in the view to change it. |
| **Stage Seq: Slide Bass** | Stages marked Slide glide into the next pitch over the Slide Time, and the accented stages fire an extra gate that snaps the filter open, giving a squelchy bass over a four-on-the-floor beat. Raise Slide Time for slower glides or Accent for a harder bite. |
| **Stage Seq: Pendulum Bells** | Twelve stages are played in Pendulum mode: forward to the last stage and back again, with the Phrase length marking the repeat. Switch Mode to Forward, Reverse, Random or Brownian to hear the same stages in other orders. |
| **Stage Seq: Brownian Walk** | In Brownian mode the playhead takes a random step to a neighbouring stage each time, so a Dorian melody wanders without jumping, and the Stage Start output ticks a hat on every new stage. Change Seed to take another walk, or Stages to widen the range. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Stage Seq view has 14 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Eight Stages** | Eight stages played forward: the neutral setup. |
| **Sixteen Stages** | All sixteen stages for a long phrase. |
| **Short Four** | A four-stage loop: tight and repetitive. |
| **Reverse** | Stages play backward. |
| **Slow Pendulum** | Swings forward and back through the stages. |
| **Random Stages** | Stages in random order. |
| **Brownian Wander** | Each step moves one stage up or down: a drifting melody. |
| **Slidey Lead** | Long slide times make marked stages glide. |
| **Snappy Slide** | Very short slides: a quick portamento snap. |
| **Hard Accents** | Accented stages hit at full strength. |
| **Soft Accents** | Accents barely stand out: an even, gentle line. |
| **Swung Stages** | A shuffle across the stages. |
| **Triplet Phrase** | Triplets over a two-bar phrase. |
| **Long Phrase Bass** | A long eight-bar phrase an octave pair down. |
<!-- /generated -->

## Reference

### Knobs

| Knob | Range | Default |
|---|---|---|
| Gate Length | 1 – 100 % of a pulse | 50 % |
| Slide Time | 1 ms – 2 s | 80 ms |
| Accent | 0 – 100 % | 50 % |
| Swing | 50 – 75 % | 50 % |

- **Gate Length:** the gate of *First*, *Every* and *Ratchet* notes (for
  ratchets, of each fast gate).
- **Slide Time:** how long *Pitch* takes to reach a slide stage (99 %).
- **Accent:** how much accented stages are boosted, from not at all to full
  velocity.
- **Swing:** delays every second pulse.

Every knob is a modulation destination.

### Settings

| Setting | Values | Default |
|---|---|---|
| Stages | 1 – 16 | 8 |
| Rate | 1/1 … 1/32, dotted (.) and triplet (T) | 1/16 |
| Mode | Forward, Reverse, Pendulum, Random, Brownian | Forward |
| Phrase | 1, 2, 4, 8, 16 bars (Random and Brownian) | 4 bars |
| Root | C … B | C |
| Scale | the Step Sequencer's scales | Major |
| Octave | −3 … +3 | 0 |
| Seed | 0 – 999 | 1 |
| Sync To | Auto, Clock, Transport | Auto |

- **Sync To:** what steps the module. *Auto*: the clock pulses while *Clock* is patched, otherwise the transport. *Clock*: only the pulses step it. *Transport*: the song position steps it, and a patched *Clock* is ignored.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Clock | trigger | each pulse is one pulse of the current stage; unpatched, the transport drives the pulses |
| Reset | trigger | the next pulse is stage 1, pulse 1 |
| Hold | gate | while high, the current stage repeats |
| Transpose | pitch | added before quantizing (1 V/oct) |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Notes | notes | the stages' notes; slides as legato |
| Pitch | pitch | the stage's quantized pitch, gliding into slide stages; holds on Rest |
| Gate | gate | the gates of the gate modes |
| Velocity | control, 0 – 1 | the stage's velocity, accent included |
| Accent | gate | high while an accented stage's notes sound |
| Trigger | trigger | a pulse at each note start, ratchets included |
| Stage | control, 0 – 1 | the playing stage: first 0, last 1 |
| Stage Start | trigger | a pulse at every stage start |
| End | trigger | a pulse when the cycle (or a phrase) starts over |
