---
title: Get started with Bleep Play
description: Bleep in your browser, no install: start audio, play the keyboard synth, patch a cable and save your project.
order: 2
---

# Get started with Bleep Play

Bleep Play is the board in your browser. Nothing to install, no account
needed, and nothing you play leaves your computer. It is one of
[three places to use Bleep](ways-to-use.md); a project made here opens in the
Bleep App and in Live too.

## Open it

1. Go to [Play](/board/) and press **Launch**. Bleep opens in its own window.
2. Click **▶ Start audio**. Browsers only allow sound after a click.
3. The browser asks for the microphone, the audio outputs and MIDI. Allow
   what you want to use. If you said no by mistake, allow it in the site
   settings (the icon left of the address) and click **↻ Ask again**, or
   click **Continue without**.

Use a current Chrome, Edge, Firefox or Safari. A MIDI keyboard needs Chrome or
Edge.

## Play

A new board is a small synth that is ready to play: Keyboard → Oscillator →
Filter → Amp → **Audio Out**. Play it with your computer keys:

| Keys | Notes |
|---|---|
| `A S D F G H J K L` | the white keys, from C |
| `W E T Y U O P` | the black keys |
| `Z` / `X` | one octave down / up (`Y` / `X` on a German keyboard) |

A MIDI keyboard plays it too. **View → Screen Keyboard** shows a piano you
can play with the mouse or a finger.

The **Audio Out** node is *This computer*. Click it to choose the output
device; the same choice is in **File → Settings → Audio**.

## Patch

- **Turn a knob.** Click the Filter to open its view and turn **Cutoff**.
- **Add a module.** Press **Tab** (or double-click empty space), type a name
  and press Enter. A module downloads the first time you use it.
- **Make a cable.** Drag from a jack to another jack. Drag a cable onto a
  knob to modulate it: try an **LFO** on the Filter's Cutoff.

[Your first patch](../learn/first-patch.md) has a five-minute tour of the
board. Steps 1 and 2 there are for Live; from step 3 on it is the same here.

## Save

- **File → Download Project** saves a `.bleepboard` file; **File → Open
  Project from File…** opens one again. The file also opens in the Bleep App
  and in Live.
- **File → Save to Library** keeps the project in your account on the
  website (log in first). **Share → Share Project…** then gives you a link
  others can open in Bleep Play.

## Good to know

- An **Audio In** node carries your microphone.
- Not in the browser yet: Voice Cells and Ableton Link.
- **Connect to app** links Bleep Play to the Bleep App and through it to Live,
  for MIDI, audio and tempo. See [Connecting](../connect/connecting.md).
- Want lower latency, your audio interface and every module? Get the
  [Bleep App](getting-started-app.md).
