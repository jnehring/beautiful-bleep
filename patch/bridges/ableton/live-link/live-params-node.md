# Live Params

## Introduction

Live Params lets the board modulate, switch and select parameters in Ableton Live: a Live device's knob, a send level, a
switch, a menu, or a parameter of any plugin in your set. One node has four inputs and a **Channel** setting. It works
with one **Bleep Live Link** device (Max for Live, Suite) on the same channel, which has four rows. Cable a source into a
row, and the device acts on the Live parameter you picked for that row.

For more than four parameters, add another node, set it to the next channel, and add another device on that channel. A
board supports eight channels, so 32 rows.

## How does it work?

**On the board.** Set *Channel*, then patch sources into *Row 1* to *Row 4*. All four jacks take any signal: a control
signal, a gate or a trigger.

**In Live.** Put *Bleep Live Link* on any track and set its channel to the node's. For each row, press *Map*
and click the parameter in Live.

| The mapped parameter is | The board's value does | Notes |
|---|---|---|
| a dial (continuous) | moves it around its own position | the cable's amount sets the depth; the row's *amount* dial trims it |
| a switch or a menu (discrete) | picks an item: 0 is the first, 1 the last | a switch is a menu of two items: on at 0.5 or more; a quantizer or a stepped source gives exact picks |

The device works out which of the two it is; there is nothing to set.

**The knob stays where you set it.** A dial row adds the board's value to the parameter's own position, so it keeps the
position you gave it. Nothing writes automation or fills the undo history.

**Speed.** Values are sent about 100 times a second, so this is for modulation, not audio rate.

**Unpatching.** Remove a cable and a dial goes back to where its own knob is. A switch or menu goes to its first item (a
switch goes off), because the value is 0.

## Inputs

| Input | Signal | Does |
|---|---|---|
| Row 1 … 4 | control | The value for the Live parameter mapped to this row of the device on the same channel |

## Without Max for Live

Live Intro and Standard have no Max for Live. Use *MIDI Out* instead: send CCs to a loopback port and MIDI-map the
parameter in Live. It is 7-bit and replaces automation on that parameter.
