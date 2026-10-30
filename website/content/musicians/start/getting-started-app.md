---
title: Get started with the Bleep App
description: The board without a DAW: download the app, install the modules, choose your audio interface, make a sound and save a project.
order: 3
---

# Get started with the Bleep App

The Bleep App is the board on its own, with your audio interface, your MIDI
keyboard and every module. It is one of
[three places to use Bleep](ways-to-use.md), and it is also where you install
the plugins for Live.

## Install

1. [Download](/download/) the app for macOS, Windows or Linux. It is free and
   needs no login.
2. Open it. The app is not signed with a paid certificate, so macOS and
   Windows warn you the first time. A few clicks get you past it:
   [Installing unsigned builds](unsigned-builds.md).
3. Open **File → Open Library…**. On the **Modules** tab, click **Install the
   default modules**. Until they are installed, boards show placeholders.

## Choose your audio

Open **File → Settings → Audio** and pick your audio interface (or the
built-in output). A new board starts with *In 1/2* and *Out 1/2* of that
device. More inputs and outputs, the MIDI ports and the Link node are under
**Add → Port**. All the settings are in [Settings](../use/settings.md).

## Make a sound

1. Press **Tab**, type *keyboard* and press Enter: a **Keyboard** module. Or
   add **MIDI Device** and choose your MIDI keyboard in its view.
2. Add a Voice Cell from **Add → Cell**, for example *Slate Stabs*.
3. Drag a cable from the keyboard's *Notes* to the cell's notes input, and
   from the cell's *Out L/R* to *Out 1/2*.
4. Play: click the Keyboard module and use your computer keys, or play your
   MIDI keyboard.

Now open the cell, turn its knobs, add a filter or drag an LFO onto a knob.
[Your first patch](../learn/first-patch.md) is a five-minute tour of the board
(steps 1 and 2 there are for Live; from step 3 on it is the same here).

## Save

**File → Save** saves the project as a `.bleepboard` file, **File → Open
Project File…** opens one. The same file opens in Live and in Bleep Play.

## Next to Live

The app runs alongside Ableton Live:

- **MIDI:** the app's own ports *Bleep App 1* and *2* show up in Live.
- **Audio:** put **Bleep Audio Bridge** on a track and its audio comes into the
  board and goes back.
- **Tempo:** turn on **Transport → Ableton Link** in both.

The details are in [The Bleep App](../use/standalone.md) and
[Connecting](../connect/connecting.md).

## The plugins for Live

The app installs them: quit Live, open **File → Open Library… → Plugins** and
click **Install or update the default plugins**. Then continue with
[Get started in Live](getting-started.md).
