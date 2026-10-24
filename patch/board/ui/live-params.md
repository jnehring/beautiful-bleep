# Live Params

## Introduction

Lets the board control **Ableton Live**: modulate a device's knob, set a switch, pick a choice in a menu, or move a parameter of any
plugin in your set. One node has four rows, and works with one **Bleep Live Link** device (a Max for Live device, Live Suite) on
the same channel. In the device you pick the parameter for each row; here you give it its value.

It works in the *Bleep Board* plugin in Live. In the standalone app and in the browser there is no Live to control.

## How does it work?

**Channel.** The node and the Bleep Live Link device share a **channel**, 1 to 8. Put the device on any track in Live, set its
channel to the node's, and press *Map* on one of its rows, then click a parameter in Live. For more than four parameters add another
node on the next channel, and another device.

**A row's value.** Each row is a knob that signals can feed: its value is the **Row** knob plus what you cable into its **CV**
input (the cable's amount sets the depth), and you can drag a cable straight onto the knob too. The knob is the centre the
modulation moves around. When you map a row, **its knob jumps to the parameter's position**, so nothing jumps in Live.

**Continuous parameters** (a filter cutoff, a volume): the value moves the parameter through the part of its range between **Min**
and **Max**, set with the two handles of the slider in the node's view. 0% to 100% is the whole range; 30% to 70% keeps the
modulation in the middle. Drag a handle past the other and the range turns round.

**Discrete parameters** (a switch, a menu): the value picks a choice: 0 is the first, 1 the last. The view lists every choice with
the value that picks it (four choices: 0.00, 0.33, 0.67, 1.00), and a click on a choice sets the row to it. A switch is a menu of
two choices: below 0.5 is the first, 0.5 and above the second. Min and Max do not apply.

**Letting go.** Press × on the row in the device, delete the node, or change its channel, and the device puts the parameter back
where it was when you mapped it. Nothing is written to Live's automation or undo history.

## How to use it?

- **Modulate a filter:** an LFO into **CV 1**, and in the device map row 1 to the filter's *Frequency*. Set the cable's amount for
  the depth, and the Row knob for the centre.
- **Keep a sweep small:** drag *Min* and *Max* together on the slider, for example to 30% and 50%.
- **Switch a device on and off rhythmically:** a gate or a clock into **CV 2**, with row 2 mapped to the device's on/off.
- **Walk through a menu:** a stepped source into **CV 3**, or click the choices in the view, with row 3 mapped to a filter type.

## Reference

### Settings

| Setting | Range | What it does |
|---|---|---|
| Channel | 1–8 | Which Bleep Live Link device this node talks to. In the view: the menu in the top right corner |
| Row 1–4 | 0–100% | The row's value, and a target for cables. In the view: the triangle on a continuous row's slider |
| Min 1–4 | 0–100% | Where a continuous parameter's range starts (default 0%). The left handle |
| Max 1–4 | 0–100% | Where it ends (default 100%). The right handle |

### Inputs

| Input | Signal | What it does |
|---|---|---|
| CV 1–4 | control | Adds to the row's value; takes any number of cables, each at its own amount |

### In the view

| Part | What it shows |
|---|---|
| The name and *continuous* or *discrete* | What the device has mapped the row to |
| The slider (continuous) | Min and Max handles, the row's value (triangle) and where the row is asking the parameter to be right now (line) |
| The choices (discrete) | Each choice with the value to send and the same as a percentage; the current one is lit |
| *not mapped* | The row has nothing mapped in the device on this channel |
