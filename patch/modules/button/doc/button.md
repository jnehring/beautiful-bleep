# Button

![Button in the module view](button.png)

## Introduction

The Button is a **pad to press** while the patch plays. Click it, tap it or
press Space: it opens a gate, fires triggers, or switches something on and
off. Use it to start an envelope by hand, reset a sequencer, fire a drum or
mute a part.

## How does it work?

In **Momentary** mode, *Gate* is high for as long as you hold the pad. In
**Toggle** mode, each press switches *Gate* on or off, and it stays there.

Whatever the mode:

- *Trigger* fires a short pulse each time you press,
- *Release* fires one each time you let go,
- *Toggle* switches on or off with every press.

Once you've clicked the pad, **Space** and **Enter** press it too.

The toggle's state is saved with the set, so a part you switched off stays
off when you open it again.

## How to use it?

- **Play an envelope by hand:** *Gate* into an ADSR's **Gate**, the ADSR into
  a VCA.
- **Restart the music:** *Trigger* into a Step Sequencer's or an LFO's
  **Reset**.
- **Fire a drum:** *Trigger* into a drum's **Trig**.
- **Mute a part:** Toggle mode, *Gate* onto a VCA's **Gain** (or into a
  Switch to choose between two sources).

<!-- generated:demos -->
## Demo patches

Five whole patches show what Button does. In the standalone app open **File → Presets…** (⌘P) and pick *Button* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Button: Hold To Brighten** | A dark, muffled saw riff plays on its own; hold the Button and its Gate output opens an envelope that sweeps the filter wide open, then lets it fall back when you let go. Try the Toggle mode to latch the bright sound. |
| **Button: Toggle Bell Layer** | A warm pad-like line carries the patch; click the Button in Toggle mode and a second, bell-like line fades in on top and stays until you click again. Switch Mode to Momentary to bring the bells in only while you hold it. |
| **Button: Clap On Press** | A bass line and a half-time beat play by themselves; every press of the Button sends a Trigger to a clap, so you add hand claps by tapping it in time. The Trigger fires on the press, not on the release, and its Gate output would stay high while you hold. |
| **Button: Cymbal On Release** | Press and hold the Button, then let go: its Release output fires a long crash cymbal at the moment you lift your finger, like a drum-fill finish. Use the Trigger output on the same Button to hit the cymbal on the way down instead. |
| **Button: Freeze Hold** | In Toggle mode the Button's Toggle output latches the reverb's Freeze input: click it while a note is ringing and the tail is held as an endless chord under the following notes. Click again to let the room empty. |
<!-- /generated -->

## Reference

### Settings

| Setting | Values | Default |
|---|---|---|
| Mode | Momentary, Toggle | Momentary |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Gate | gate | high while held (Momentary) or while toggled on (Toggle) |
| Trigger | trigger | a pulse on every press |
| Release | trigger | a pulse on every release |
| Toggle | gate | switches on or off with every press |
