# Live Params

## Introduction

Live Params lets the board modulate, switch and select parameters in Ableton Live: a Live device's knob, a send level, a switch,
a menu, or a parameter of any plugin in your set. One node has four rows and a **Channel** setting, and works with one
**Bleep Live Link** device (Max for Live, Suite) on the same channel, which has four rows too. In the device you map a row to a
parameter in Live; on the board the node shows what each row is mapped to.

For more than four parameters, add another node, set it to the next channel, and add another device on that channel. A board
supports eight channels, so 32 rows.

## How does it work?

**A row is a knob with a CV input.** Each row has a **Row** knob and a **CV** input jack on the node, and the board's usual rule
applies: *the knob plus the signals that feed it*. Cable an LFO, an envelope or any other source into **CV 1 to CV 4** (or drag a
cable straight onto the knob: it does the same), and set the cable's amount for the depth. The knob is the centre the modulation
moves around.

**Min and Max.** For a *continuous* parameter (a dial) the row's value is scaled into **Min** to **Max**: 0% to 100% is the whole
range of the Live parameter, and Min 30% / Max 70% keeps the modulation in the middle of it. Max below Min turns it round.
Both can be modulated too.

**Mapping.** In Live, put *Bleep Live Link* on any track, set its channel to the node's, press *Map* on a row and click the
parameter. The device tells the board what it found, and **the row's knob jumps to the parameter's position**, so nothing jumps
in Live. The device lets go of the parameter, and puts it back where it was, when you press × on its row or when you delete the
node or change its channel.

**What the node shows.** Open the node's view: for each row, its parameter's name, whether it is *continuous* or *discrete*,
and for a discrete parameter (a switch, a menu) every **choice** with the **value that picks it**.

| The mapped parameter is | The row's value does | The view shows |
|---|---|---|
| continuous (a dial) | moves the parameter through Min..Max of its range | the name, Min and Max, and where it is now |
| discrete (a switch, a menu) | picks a choice: 0 is the first, 1 the last; Min and Max do not apply | every choice, its number to send (0.00, 0.33, 0.67, 1.00 for four choices) and the same as a percentage for the knob |

A switch is a menu of two choices: below 0.5 is the first, 0.5 and above the second. A quantizer or a stepped source gives
exact picks; or set the knob to the percentage in the table.

**Speed.** Values are sent about 100 times a second, so this is for modulation, not audio rate. Nothing writes automation or
fills the undo history.

## Knobs

| Knob | Does |
|---|---|
| Channel | which Bleep Live Link device (1 to 8) this node talks to; in the view it is the menu in the top right corner |
| Row 1 … 4 | the row's value, 0 to 1, and a target for cables |
| Min 1 … 4 | where a continuous parameter's range starts (default 0%) |
| Max 1 … 4 | where it ends (default 100%) |

| CV 1 … 4 (inputs) | add to the row's knob; each takes any number of cables, each at its own amount |

## Without Max for Live

Live Intro and Standard have no Max for Live. Use *MIDI Out* instead: send CCs to a loopback port and MIDI-map the
parameter in Live. It is 7-bit and replaces automation on that parameter.
