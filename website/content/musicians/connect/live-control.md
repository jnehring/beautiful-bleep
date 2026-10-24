---
title: Control Live from the board
description: Move a knob of any Live device, switch a device on and off or pick a choice in a menu from the board, with the Live Params node and the Bleep Live Link device.
order: 3
---

# Control Live from the board

Cables on the board can do more than move other modules. With the **Live Params** node and the **Bleep Live Link** device, a signal on the
board can move a knob of any device in Live, or of any plugin in your set. It can switch a device on and off, and it can pick a choice in a
menu, such as a filter type. An LFO can sweep a Live filter, a clock can pulse a device on and off, and a stepped source can walk through
the filter types, all from the board.

You need Live **Suite** (the device is a Max for Live device), the **Bleep Board** plugin on a track, and the **Bleep Live Link** device on
a track. Without Max for Live, there is [a simpler way for continuous parameters](loopback-cc.md).

## Try it in five steps

1. Put **Bleep Board** on a track (once per set), and open the board.
2. Put the **Bleep Live Link** device on any track. Leave its **Channel** at 1.
3. On the board, choose **Add → Module → Ports → Live Params**. Leave its channel at 1.
4. In the device, click **Map** on *row 1*, then click a knob in Live, for example the *Frequency* of an Auto Filter. The button turns
   yellow, shows the knob's name and locks.
5. On the board, cable an LFO into **CV 1** of the Live Params node. The knob in Live moves.

Open the node's view (double-click the node) to see what it is doing. *Row 1* now shows the name of the knob and the word *continuous*.

## The two halves

The two halves share a **channel**, from 1 to 8:

- The **Live Params** node lives on the board. It has **four rows**. Each row has a value that you set with the board's usual tools:
  a knob and a **CV** input, with cables at their own amounts.
- The **Bleep Live Link** device lives in Live. It also has four rows, each with a **Map** button. A row of the device is mapped to a
  parameter in Live, and the matching row of the node gives it its value.

For more than four parameters, add another node on the next channel and another device on that channel. A set can use up to eight
channels, so 32 parameters.

## A row's value

A row's value is its **Row knob plus what you patch into its CV input**. The knob sets the centre; the cable's amount sets how far the
modulation goes. You can also drag a cable straight onto the knob.

When you map a row, **the node's knob jumps to the parameter's position**, so nothing jumps in Live. From then on the node is in
charge.

## Continuous parameters: a slider with two handles

Most knobs in Live are *continuous*. For these the node's view shows a slider with **two handles**:

- The **circle** is *Min*, the **square** is *Max*. The row moves the parameter through the part of its range between them. 0% to 100%
  is the whole range; 30% to 70% keeps the sweep in the middle.
- The **triangle** is the row's value (the knob). Drag it to move the centre.
- The **thin line** is where the row is asking the parameter to be right now, with the CV input and the cables included.
- **Double-click** a handle to reset it. Drag a handle past the other and the range turns round: a rising LFO then makes the
  parameter fall.

*Row 80%* in the read-out means the row's value is 80% of the way from Min to Max. *Now* is the position in the parameter's whole range.

## Discrete parameters: switches and menus

Some controls in Live have a fixed set of choices: a device's on/off, a filter type, a sync mode. The node knows when a row is mapped to
one of these, and its view lists every **choice with the number that picks it**:

| # | Choice | Send | Knob |
|---|---|---|---|
| 0 | Lowpass | 0.00 | 0% |
| 1 | Highpass | 0.33 | 33% |
| 2 | Bandpass | 0.67 | 67% |
| 3 | Notch | 1.00 | 100% |

- **Click a choice** to set the row to it.
- **Send** is the value that picks it. With *N* choices, choice *i* is picked by *i ÷ (N − 1)*, and a value in between picks the nearest one.
  Patch a stepped source, a quantizer or a sequencer into the row's CV input and it walks through the choices.
- A **switch** is a menu with two choices (*Off*, *On*): below one half is the first, one half and above the second. A gate or a clock into
  the CV input switches it on and off.
- Min and Max do not apply to a discrete row.

## Letting go

While a row drives a knob, you can't move that knob with the mouse in Live. To get it back:

- press **×** on the row in the device, or
- delete the Live Params node, or change its channel.

The parameter goes back to **where it was when you mapped it**. Nothing is written to Live's automation, and nothing lands in Live's undo
history. The device saves its mappings with your set, and the node is part of the board, so both come back when you open the set.

## What you can control

| Works | Doesn't |
|---|---|
| Continuous knobs of Live's own devices | The song's *Tempo*, and *Solo*: we could not control them |
| Switches and menus of Live's own devices | Anything Live greys out |
| Mixer knobs: volume, pan, sends | |
| Parameters of VST3 plugins, once you have added them to the plugin's list of parameters in Live (the *Configure* button) | |

Values go out about a hundred times a second: smooth for modulation, but not sample-accurate and not delay-compensated. See [Ableton Live
goes modular](../start/ableton-live-goes-modular.md) for what that means next to audio latency.

## Ideas

- **A filter that breathes:** an LFO into *CV 1*, row 1 mapped to an Auto Filter's frequency, Min 20%, Max 60%.
- **A device that pulses:** a clock divider into *CV 2*, row 2 mapped to a device's on/off.
- **A filter type that changes by itself:** a stepped random source into *CV 3*, row 3 mapped to the filter type of the same filter.
- **One knob for several things:** cable the same source into several rows, each with its own Min and Max.

## When something doesn't work

| What you see | What to check |
|---|---|
| Nothing moves | The device and the node must be on the **same channel**. Is the node's channel the one in the device's *Channel* menu? Is the device's row mapped (the button shows a name)? |
| The node says *not mapped* but the knob moves | The board hasn't heard the device yet. The device repeats its report every two seconds, so wait a moment. If it stays, another program may be using the network port 9880 that Bleep uses to hear the device. |
| The knob jumps between two values | Two sources are writing to the same row: a second node on the same channel, or two devices on one channel. Give each node and device its own channel. |
| The menu picks the wrong choice | Look at the table in the node's view and send the number it shows for that choice, or click the choice. |
| The Map button says *not mappable* | Live doesn't let a device map that control (for example *Solo*). Click something else. |
| The Map button says *no answer* | Live didn't answer when the device asked about the parameter. Press ×, and map it again. |

## Where to go next

- [Ableton Live goes modular](../start/ableton-live-goes-modular.md): everything the board adds to Live, and what it costs in latency
- [Ports](../use/ports.md): the plugins you add in Live
- [Modulation](../learn/modulation.md): sources, cables and amounts
- [Modulating any Live parameter without Max for Live](loopback-cc.md): the MIDI loopback way
