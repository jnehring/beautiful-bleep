---
title: Ways to use Bleep
description: Bleep plugin, Bleep App or Bleep Play: the three places to use Beautiful Bleep and how much effort each level takes.
order: -1
---

# Ways to use Bleep

Beautiful Bleep is one sound engine you can reach in three places, and in each
place you can use it at three levels of effort.

## Three places

| | What it is | Best for |
|---|---|---|
| **Bleep plugin** | VST3 plugins for your DAW (Ableton Live today). See [ports](ports.md) | Making music inside a DAW project |
| **Bleep App** | The [standalone app](standalone.md): the board without a DAW | Playing, sound design, live use next to a DAW |
| **Bleep Play** | [Bleep Play](/board/) in your browser, no install | Trying things out, sharing a project |

All three run the same board, the same modules and the same project files, so a
project made in one place opens in the others. (Bleep Play does not have
every module yet; the board page lists what is missing.)

### Connecting them

The places work together: MIDI, audio and tempo can travel between them, and
you choose where in the place you are. The plugins have a **Board** menu
(*This set*, *Bleep App* or *Bleep Play*), the Bleep App has a *Web* switch in
Settings, and Bleep Play has a **Connect to app** button. The Bleep App sits in the
middle, on your computer. **What works:**

| | Plugin ⇄ App | App ⇄ Play | Plugin ⇄ Play (through the app) |
|---|---|---|---|
| **MIDI** | Board menu on MIDI In/Out, or the app's MIDI ports | Remote MIDI nodes | Board menu: *Bleep Play* |
| **Audio** | Board menu on Audio In/Out, or *Bleep Audio Bridge* | Remote Audio nodes | Board menu: *Bleep Play* |
| **Tempo and transport** | Live leads; Ableton Link | Bleep Play follows the app | Bleep Play follows Live |

Audio between the plugin and the app is two buffers late; through Bleep Play
it is a little more. [Connecting plugin, app and Bleep Play](guides/connecting.md)
has the numbers, the setup and some recipes. Another computer, or Bleep Play
without the app, is planned, not built.

## Three ways to play

Whichever place you are in, you choose how to start:

- **Instrument.** Pick a preset such as *Warm Saws*, play it with MIDI. For
  when you want a sound, not a board. In Live this is **Bleep Instrument**.
- **Audio effect.** Pick a preset such as *Dub Ping-Pong*, send audio
  through it. In Live this is **Bleep FX**.
- **Full board.** Every module, every cable, your own
  project. In Live this is the **Bleep Board** plugin, with ports that connect the board to
  your tracks.

These are not three different systems. An instrument or an effect preset is a
small *cell* on the same board as everything else. The simple modes
are a shortcut: you can try presets without ever touching a cable, and when you
want more, open the board, edit the preset's cell, cable it to other parts,
and save it as your own.

| | Instrument | Audio effect | Full board |
|---|---|---|---|
| **Bleep plugin** | Bleep Instrument | Bleep FX | Bleep Board and the [ports](ports.md) |
| **Bleep App** | Planned | Planned | Yes |
| **Bleep Play** | Planned | Planned | Yes |

In the plugins, Instrument and FX open on the preset's panel (knobs and
sliders) rather than on the board. **Open Board** shows the preset as a cell
on the board. Cables between several plugins need the Bleep Board plugin in the set,
because the board is saved there.

Next: [Getting started in Live](getting-started.md), the
[Bleep App](standalone.md), or [Bleep Play](/board/) in your
browser.
