# Index

## Introduction

The Index turns a signal into a **whole-number step**: 0, 1, 2 … up to
*Steps* − 1. Its main job is to drive things that are not knobs: a dropdown
(an oscillator's *Octave*, a filter's *Type*, a chorus *Mode*), a toggle, or a
parameter in Ableton Live through a *Live Params* node. A cable on such a
setting sets its value, and the Index sends exactly the position it reads.

## How does it work?

**Out** carries the step as `step / (Steps − 1)`: 0 for the first choice, 1 for
the last. Patch it to a dropdown and it picks that choice. **Set *Steps* to the
number of choices of the target** (2 for a toggle); the Index cannot see the
target, and a wrong number lands on a neighbour. **Index** carries the plain
whole number, for the Math module or a display. **Changed** (optional) pulses
when the step changes.

*Mode* decides where the step comes from:

- **CV** splits the input *In* into *Steps* equal bands. An LFO, a sequencer
  lane or a knob picks the step; a little hysteresis stops a noisy CV from
  flickering at a border. *Input Range* says whether the input runs 0…1 or
  −1…+1.
- **Count** moves on triggers: *Up*, *Down* and *Reset*, in *Order* (*Forward*,
  *Backward*, *Ping-Pong*, *Random* with a *Seed*). *Wrap* wraps at the ends or
  stops. With *Up* unpatched and a *Rate* set, the step follows the song.
- **Gates** has *Gate Inputs* jacks: the highest gate that is high picks its
  step (Gate 1 is step 0). With none high, *Default Step* applies.
- **Binary** adds the gates up: Gate 1 is 1, Gate 2 is 2, Gate 3 is 4. Three
  gates reach eight steps; one gate is an on/off switch.

*Offset* adds `floor(Offset × Steps)` to the step in every mode, wrapping.

## How to use it?

- **Toggle on a square wave:** a square LFO into *In*, *Steps* 2, *Out* onto a
  toggle or two-choice dropdown.
- **Walk a dropdown:** *Mode* Count with a clock into *Up*, or with a *Rate*
  set to follow the song.
- **Pick with hits:** drum lanes into the *Gate* jacks in *Gates* mode.
- **Drive Ableton:** *Out* into a *Live Params* row mapped to a menu or switch
  in Live; *Steps* is the number of items.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Index does. In the standalone app open **File → Presets…** (⌘P) and pick *Index* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Index: Octave Walk** | With nothing patched into Up, the Index follows the song: every half bar it moves one step in Ping-Pong order over 7 steps, and the step goes to the Oscillator's Octave dropdown, so the melody climbs and falls through seven octaves. Change Order or Rate. |
| **Index: Chorus or Flanger** | A square LFO is one bar low, one bar high. The Index with 2 steps turns that into 0 or 1, and 0 or 1 picks the Chorus or the Flanger mode. Two steps make any gate or square wave an on/off switch for a toggle. |
| **Index: Sweeping the Filter Types** | A very slow triangle LFO crosses the 32 bands of the Index, and the step goes to the Filter's Type dropdown, so every few seconds the same riff goes through another kind of filter. Set Steps to the number of choices of whatever you drive. |
| **Index: Three Switches, Seven Waves** | Three square LFOs at one, two and four bars act as three switches. The Index in Binary mode adds them up (1, 2, 4), and the sum picks the wave of a vibrato LFO that wobbles the filter. A counter in four lines of patch. |
| **Index: Hits Pick the Octave** | The kick, snare and hat of the drum grid are three gates into the Index in Gates mode: a kick drops the next notes three octaves, a snare two, a hat one, and with none high the Default Step 3 is the octave you wrote. Try another Default Step. |
<!-- /generated -->
