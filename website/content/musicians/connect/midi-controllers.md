---
title: Play with a MIDI controller
description: Connect a MIDI keyboard or pad controller to the Bleep App, to Bleep Play in your browser, or to Live, and map its knobs.
order: 6
---

# Play with a MIDI controller

A MIDI keyboard, a pad controller or a box of knobs can play Bleep in all three places. How you connect it depends on where you play.

| You play in | The controller is read by | You add |
|---|---|---|
| **The Bleep App** | the app itself | a **MIDI Device** node (or **MIDI In**) |
| **Bleep Play** (browser) | your browser | a **MIDI Device** node, or nothing at all |
| **Live** | Live | the **Bleep Instrument** plugin on a MIDI track |

Connect the controller to your computer with USB before you start Bleep or open the page. Most controllers need no driver.

## In the Bleep App

### The quick way: MIDI Device

1. Plug in the controller and start the app.
2. Choose **Add → Module → Sources → MIDI Device**.
3. Click the node and choose your controller from the list.
4. Cable the node's **Notes** output into a [Voice Cell](../use/voice-cells.md), for example *Slate Stabs*, and the cell's *Out L/R* into *Out 1/2*.

Play a key and you hear it. The node remembers the controller in the project, so it is there again the next time you open it. You do not have to switch anything on in Settings.

### The other way: MIDI In

If you would rather switch controllers on once for every project:

1. Open **Settings → MIDI** and switch on your controller under **Inputs**.
2. Choose **Add → Port** and add the *MIDI In* node of that controller.

A controller that is switched off in Settings is ignored by *MIDI In*. A *MIDI Device* node works either way.

## In Bleep Play (the browser)

1. Open [the board](/board/) in **Chrome or Edge**. Safari has no Web MIDI.
2. Press **▶ Start audio**. The browser asks whether the page may use your MIDI devices. Allow it.
3. Play. With no MIDI Device node on the board, every connected controller plays the board's MIDI In.

To choose one controller, add a **MIDI Device** node as in the app and pick it in the node. A *MIDI Device* node wins over the switches in **Settings → MIDI**, which only apply to boards without one.

If you pressed *Don't allow* by mistake, change the page's MIDI permission in the browser's site settings (the lock icon next to the address), then reload.

The browser passes on notes, controller (CC) knobs and pitch bend. Channel pressure and program changes are not passed on yet.

### Playing the app from the browser

The other direction works too: add a *Remote MIDI* node from the **Add** menu once the board is linked to the app, and the browser's controller plays the app's patch. See [Connecting plugin, app and web](connecting.md).

## In Live

Live reads the controller. Put **Bleep Instrument** on a MIDI track, arm the track and play. To play a board that runs in the app or in Bleep Play, set the plugin's *Board*; [Connecting](connecting.md) shows how.

## Use the knobs

Every MIDI source node has eight controller outputs, **CC 1–8**, plus **Pitch**, **Gate**, **Velocity**, **Trigger**, **Pressure**, **Bend** and **Mod Wheel**.

1. Turn a knob on your controller and see which controller number it sends: cable *Notes* into a **Monitor**, which lists every note, controller number and program change.
2. Set one of the **CC 1–8 #** fields of the node to that number.
3. Cable the matching *CC* output to what it should move, for example a filter's cutoff.

The defaults are 2, 4, 7, 10, 11, 71, 74 and 64. Many controllers send 1 (mod wheel), 7 (volume) and 74 (brightness) out of the box. *Channel* limits a node to one MIDI channel, or *All*.

## When nothing plays

- **The controller is not in the list.** Plug it in before you start the app or open the page, or reload.
- **The node shows the controller but there is no sound.** Check that *Notes* goes into a Voice Cell (or *Pitch* into an oscillator and *Gate* into an envelope), and that the cell's output goes to *Out 1/2*.
- **Only the wrong channel plays.** Set the node's *Channel* to *All*.
- **The browser does not offer MIDI.** Use Chrome or Edge, and check that you allowed MIDI access.

## More about the nodes

Each node has a manual behind its **?** button: *MIDI Device* and *MIDI In* list every setting and output. Settings are explained in [Settings](../use/settings.md#midi).
