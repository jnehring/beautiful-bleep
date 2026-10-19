# Note Gate

## Introduction

Note Gate is a door for a `notes` stream. Every note-on has to get through a
row of checks, and the ones that pass can come out *changed*: moved to another
pitch class, given a different velocity. It combines a note filter, a note
remapper and a velocity shaper, with an input to open and close it and *rule
lanes* that decide by position in the bar, by count and by how busy the line
is.

## How does it work?

A note-on goes through these stages, in this order, and stops at the first
one that says no. A note-off always follows its note-on: a blocked note never
produces one, and a note that did pass is ended even if the gate closed in
the meantime.

1. **Gate.** With a cable in *Gate*, notes pass while it is high (*Gate Input*
   *Pass When High*) or while it is low (*Block When High*). Unpatched, the
   gate is open.
2. **Range.** *Low Note* and *High Note* make a window of MIDI notes, 60 being
   middle C. *Window* chooses whether notes inside pass or are blocked.
3. **Velocity limits.** *Floor*: softer notes are dropped (*Below Floor*
   *Drop*) or raised to it (*Lift*). *Ceiling*: harder notes are limited to
   it.
4. **Rule lanes** (the twist). Every lane that is switched on must agree:
   - *Step lane:* sixteen steps across the bar (*Beats Per Bar* long). A note
     passes only if the step nearest to its moment is lit in the lane. Click
     steps in the view. This lane needs a running transport; without a song
     position it does not decide.
   - *Every Nth:* of the notes that got this far, only every *N*th passes;
     *Nth Offset* chooses which of each *N*.
   - *Density Limit:* at most this many notes pass per *Density Window*
     (1 beat … 2 bars). 0 switches it off. The more you play, the more is
     held back.
5. **Remap.** With *Remap* on, each of the twelve pitch classes is sent to
   another pitch class (in the same octave) or blocked, as set in the view's
   table.
6. **Velocity curve.** The velocity is reshaped by *Bend* (soft notes louder
   when positive, quieter when negative) or, with *Curve* on *Drawn*, by the
   curve you draw in the view. A velocity never becomes 0, which would be a
   note-off.

The *Passed* and *Blocked* outputs give a short trigger for every note that
passed or was stopped.

## How to use it?

- **Split a keyboard:** two Note Gates on one MIDI port, one for *Low Note*
  0–59, one for 60–127, into different Voice Cells.
- **Keep it in key:** *Remap* with the sharps sent to the natural below
  (the preset *Naturals Only*) or to *blocked*.
- **Evening out touch:** *Bend* positive, or draw a curve that is flat at the
  top.
- **Rhythmic mute:** *Step lane* with the four beats lit lets only downbeat
  notes through; a Clock Divider into *Gate* does the same from outside.
- **Taming a busy line:** *Density Limit* 3 per beat on a fast arpeggio.
- **Probability by hand:** a Coin Toss into *Gate* decides note by note.
- **Chains:** put it before a Note Echo to echo only the strong notes, or
  after an Arpeggiator to thin it out.

<!-- generated:presets -->
## Presets

The preset bar of the Note Gate view has 17 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Low Register** | Only notes below middle C get through. |
| **Upper Register** | Only notes from middle C up. |
| **Notch Out The Middle** | A hole in the middle of the keyboard: lows and highs pass. |
| **Soft Notes Out** | Notes played softer than 30 % are dropped: ghost notes disappear. |
| **Lift The Floor** | Soft notes are raised to 45 % instead of dropped. |
| **Ceiling Squash** | Nothing plays harder than 60 %. |
| **Compress Curve** | Soft notes come out louder: an even, compressed touch. |
| **Expand Curve** | Soft notes get softer, hard notes stay: more dynamics. |
| **Hard Hits Only** | A drawn curve that mutes everything below the middle and jumps to full above it. |
| **Naturals Only** | Sharps and flats fall down to the natural below: a C-major-ish keyboard. |
| **Major To Minor** | E, A and B drop a semitone: the same tune in a minor mood. |
| **Mute Black Keys** | Every black key is blocked: only the white keys play. |
| **Fifths Swap** | Every note moves up a fifth within its octave. |
| **Downbeats Only** | Notes pass only on the four beats of the bar. |
| **Offbeat Eighths** | Notes pass only on the 'and' of each beat. |
| **Every Other Note** | Passes the 1st, 3rd, 5th note and so on: halves a busy line. |
| **Thin Out Busy Runs** | At most three notes per beat get through, however fast you play. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Low Note, High Note | 0 … 127 | 0, 127 |
| Window | Pass Inside, Block Inside | Pass Inside |
| Floor, Ceiling | 0 … 100 % | 0, 100 % |
| Below Floor | Drop, Lift | Drop |
| Curve | Knob, Drawn | Knob |
| Bend | −100 … +100 % | 0 |
| Remap | Off, On | Off |
| Gate Input | Pass When High, Block When High | Pass When High |
| Step Lane | Off, On | Off |
| Beats Per Bar | 1 … 8 | 4 |
| Every Nth, Nth Offset | 1 … 8, 0 … 7 | 1, 0 |
| Density Limit | 0 (off) … 16 | 0 |
| Density Window | 1 beat, 2 beats, 1 bar, 2 bars | 1 beat |

*Low Note*, *High Note*, *Floor*, *Ceiling* and *Bend* have modulation inputs.
The remap table, the drawn curve and the step lane are saved with the node.

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| Notes (in) | notes | The notes to filter; controller messages pass through |
| Gate | gate | Opens or closes the door |
| Notes (out) | notes | The notes that passed, remapped and reshaped |
| Passed | trigger | A pulse for every note that passed |
| Blocked | trigger | A pulse for every note that was stopped |
