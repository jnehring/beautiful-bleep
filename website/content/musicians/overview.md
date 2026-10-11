---
title: Ways to use Bleep
description: Plugin, app or browser: the three places to use Bleep and how much effort each level takes.
order: -1
---

# Ways to use Bleep

Bleep is one sound engine you can reach in three places, and in each place you
can use it at three levels of effort.

## Three places

| | What it is | Best for |
|---|---|---|
| **Plugin** | VST3 plugins for your DAW (Ableton Live today). See [ports](ports.md) | Making music inside a DAW project |
| **App** | The [standalone app](standalone.md): the board without a DAW | Playing, sound design, live use next to a DAW |
| **Web** | [Play](/board/) in your browser, no install | Trying things out, sharing a patch |

All three run the same board, the same modules and the same patch files, so a
patch made in one place opens in the others. (The web version does not have
every module yet; the board page lists what is missing.)

### Connecting them

The places are meant to work together: MIDI, audio and tempo can travel
between them. **What works today:**

| | Plugin ⇄ App | Web |
|---|---|---|
| **MIDI** | The app's own MIDI ports, *Bleep Patch 1/2* | Computer keyboard and Web MIDI devices |
| **Audio** | *Bleep Audio Bridge* on a Live track | Not connected to the other two yet |
| **Tempo and transport** | Ableton Link | Not connected yet |

Connecting the web board to the app and to Live (an effect built in the
browser, played in Live through a plugin) is planned, not built.

## Three ways to play

Whichever place you are in, you choose how to start:

- **Instrument.** Pick a preset such as *Warm Saws*, play it with MIDI. For
  when you want a sound, not a patch. In Live this is **Bleep Instrument**.
- **Audio effect.** Pick a preset such as *Dub Ping-Pong*, send audio
  through it. In Live this is **Bleep FX**.
- **Bleep patch.** The whole board: every module, every cable, your own
  patch. In Live this is **Bleep Patch**, with ports that connect the board to
  your tracks.

These are not three different systems. An instrument or an effect preset is a
small patch (a *cell*) on the same board as everything else. The simple modes
are a shortcut: you can try presets without ever touching a cable, and when you
want more, open the board, edit the preset's patch, cable it to other parts,
and save it as your own.

| | Instrument | Audio effect | Bleep patch |
|---|---|---|---|
| **Plugin** | Bleep Instrument | Bleep FX | Bleep Patch and the [ports](ports.md) |
| **App** | Planned | Planned | Yes |
| **Web** | Planned | Planned | Yes |

In the plugins, Instrument and FX open on the preset's panel (knobs and
sliders) rather than on the board. **Open Board** shows the preset as a cell
on the board. Cables between several plugins need Bleep Patch in the set,
because the board is saved there.

Next: [Getting started in Live](getting-started.md), the
[standalone app](standalone.md), or [Play](/board/) in your
browser.
