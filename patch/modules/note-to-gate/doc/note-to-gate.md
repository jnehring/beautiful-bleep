# Note to Gate

## Introduction

Note to Gate turns a stream of MIDI notes into gates: one gate per note you
choose, as many gates as you need (1 to 16). Each gate has its own note setting
and is high while that note is held. Use it to open envelopes from a pad
controller's keys, to switch parts of a patch with single keys, or to split a
drum track into separate gates.

## How does it work?

**One note per gate.** Set *Gates* to the number you need, then give each gate
its *Note* (0 … 127, any MIDI channel). A note-on raises that gate; the note-off
lowers it. If two gates listen to the same note, both follow it.

**Notes heard.** The top of the view lists the latest notes that came in, newest
first, with their note name, number and velocity. Play the key you want, read the
number off the list, and set it on a gate. A note a gate already listens to is
tinted. **Freeze** stops the list so you can read it while notes keep arriving;
click it again to catch up. Under the list, a lamp per gate lights while the gate is high.

**All notes off.** The MIDI messages *All Sound Off* (120) and *All Notes Off*
(123) lower every gate.

## How to use it?

- **Find the note of a pad:** patch a Notes source into *Notes*, hit the pad and
  read its number in *Notes heard*.
- **Gates from keys:** set *Gates* to 3, notes 36, 38 and 42, and patch each gate
  into an envelope.

## Reference

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Notes | notes | the MIDI notes to listen to, all channels |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Gate 1 … Gate 16 | gate | high while the gate's note is held; only the first *Gates* are shown |

### Settings

| Setting | Range | What it does |
|---|---|---|
| Gates | 1 … 16 | how many gate outputs there are |
| Note 1 … Note 16 | 0 … 127 | the MIDI note gate *n* listens to (default 36, 37, 38 …) |
