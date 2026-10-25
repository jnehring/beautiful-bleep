---
title: Introducing Beautiful Bleep
date: 2026-10-20
description: An overview of Beautiful Bleep, a modular synthesizer for Ableton Live, your desktop and your browser: where it runs, how you build and play, and where to go next.
---

Beautiful Bleep is a digital modular synthesizer. Instead of one fixed instrument you get small sound building blocks (oscillators, filters, envelopes, effects) and connect them with virtual cables to build your own sounds. If you would rather not patch, you can play one of the ready-made instruments and effects and never touch a cable.

It is free, open source, and very new. This post is a tour of what is in it today, with links to everything you can try.

## One engine, three places

The same engine, the same modules and the same project files run in three places. A project you start in one place opens in the others, and the three can exchange audio, MIDI and tempo. [Ways to use Beautiful Bleep](/docs/musicians/start/ways-to-use/) explains how they fit together.

### In your browser

Bleep Play needs no install and no account. Open [the board](/board/), pick an instrument or start from an empty canvas, and you are making sound within seconds. When the board needs a module it has not seen yet, it fetches the module from the Bleep Library, checks it and runs it, so a visitor needs nothing installed.

That makes the browser the easiest way to try Beautiful Bleep and to share a project: send a link and the other person hears what you hear. It does not have every module yet, and the board page lists what is missing. If you are curious, [play now](/board/) or browse the [instruments](/instruments/) and [effects](/effects/) that open directly in it.

### In Ableton Live

The Bleep plugins are VST3 plugins for Ableton Live. Put **Bleep Instrument** on a MIDI track or **Bleep FX** on an audio track, pick a preset and play. All the modules of a set live on one canvas, the board, and small plugins called ports connect the board to your tracks.

This is where Beautiful Bleep is meant to feel like part of your music rather than a separate tool: a modular system that sits inside your project, saved with your set. The [install guide](/docs/musicians/start/getting-started/) walks through the steps, and [Your first sound](/docs/musicians/start/first-sound/) gets you to a note without any patching. You can get the plugins on the [download page](/download/).

### As a standalone app

The Bleep App is the board without a DAW. It is for playing, sound design and live use, and it can sit next to Live and trade MIDI, audio and tempo with the plugins. It also acts as the hub between the three places, so that a plugin in Live can send its audio through Bleep Play in your browser.

If you prefer to keep the DAW out of the way while you patch, or you want a fixed instrument on stage, this is the place. [The standalone app](/docs/musicians/use/standalone/) covers setup, and [Connecting plugin, app and Bleep Play](/docs/musicians/connect/connecting/) has the recipes and the latency numbers.

### Playing it with a MIDI controller

A MIDI keyboard or a box of knobs works in all three places. In the standalone app and in the browser you add a **MIDI Device** node, choose your controller, and cable its notes into a synth; its eight controller outputs turn your knobs into modulation. In the browser this needs Chrome or Edge, which ask once for permission to use your MIDI devices. In Live, the controller plays a Bleep plugin like any other instrument. [Play with a MIDI controller](/docs/musicians/connect/midi-controllers/) has the steps for each.

## More than patch cables

A modular synthesizer is wonderful to build and awkward to play. Beautiful Bleep adds three things on top of the cables to fix that.

### Custom UIs with panels

A patch with forty modules is hard to read and harder to play. Select some modules, press **⌘G**, and they become a *cell* that hides the wiring behind a few jacks. Cells can be saved as presets, so a patch you build once becomes a module you reuse everywhere.

Then give the cell a *panel*: a front panel with just the dials, faders, buttons, keyboard, XY pad and meters that matter. A panel has an Interface view for playing and a Wiring view for building, and a control can load another panel, which is how large instruments are split into tabs. Cells and panels are what turn a tangle of cables into something that plays like an instrument; see [Cells and panels](/docs/musicians/learn/cells-and-panels/), and [Voice Cells](/docs/musicians/use/voice-cells/) for polyphonic synths.

### Bleep Script

Bleep Script lets you write parts of a patch as code. A Code node on the board has an editor and a Compile button. Write a class with a `sample()` method and the node becomes a new module with its own jacks, dials and meters; write a patch script and it builds a whole cell of modules and cables for you, for example a hundred oscillators from a loop.

In Bleep Play, Bleep Script needs no installation: no toolchain, no setup. The compiler runs in your browser and compiles all the code right there, in about a second, so you can open the board, write a script and hear it.

Scripts can also route messages: handlers for notes and control edges run at their exact sample, so timing stays tight. Modules are written in AssemblyScript, a TypeScript-like language that compiles to WebAssembly,. Start with the [overview](/docs/developers/bleep-script/overview/) or the [quickstart](/docs/developers/bleep-script/quickstart/), and follow the [tutorials](/docs/developers/bleep-script/tutorials/overview/) from a sine oscillator up to a step sequencer.

### Bleep Assistant

The Bleep Assistant is a chat window in the board where an AI agent helps with your patch. It answers questions from the documentation, finds out why there is no sound, adds and wires modules, builds panels, programs sequencers and designs a sound from scratch ("build an acid synthesizer") step by step, using tools instead of just replying.

You stay in control. Every change is a visible changeset that the board applies as one undo step, you can approve it first, and the model never writes raw patch data: it calls typed operations that are checked against the module catalog before anything reaches the board. The assistant is measured with a benchmark. [How the assistant works](/docs/developers/bleep-assistant/overview/) describes the design, and the [benchmark](/docs/developers/bleep-assistant/benchmark/) page shows how it is tested.

## Modules and the Bleep Library

Beautiful Bleep ships with over a hundred modules in categories from oscillators, envelopes and filters to sequencers, drum machines, logic and metering. Each one has a manual, with demo patches and presets that show what it does, and the manuals are the same pages the board shows behind each module's **?** button.

Modules, plugins and presets live in the [Bleep Library](/library/), where anyone can browse and download without logging in. Modules are WebAssembly packages that run in a sandbox, so the library is also how third parties can add modules. Sharing a preset needs a free account. [How the library works](/docs/developers/modules/library/) explains packages and releases, and [Write a module](/docs/developers/modules/overview/) shows how to contribute one.

## Under the hood: Bleep Bus

The cables between the Bleep plugins run on Bleep Bus, an open, MIT-licensed protocol with a small C SDK. It sends per-sample control signals between audio plugins through named shared memory, which is what lets a modulation signal from one plugin reach another in your DAW.

It works between any plugins in any DAW and does not need Beautiful Bleep at all. The protocol has a public specification, a conformance suite to prove an implementation correct, and an RFC process for changes, so anyone can build on it. Try the [quickstart](/docs/developers/bleep-bus/quickstart/), read the [specification](/docs/developers/spec/v0.1/00-overview/) or look at the [overview](/docs/developers/bleep-bus/overview/).

## Where to go next

If you are a musician, [play in your browser](/board/), then follow [Your first sound](/docs/musicians/start/first-sound/) and [Your first patch](/docs/musicians/learn/first-patch/). The [musician documentation](/docs/musicians/overview/) covers the rest.

If you are a developer, start from the [developer overview](/docs/developers/overview/). The code is on [GitHub](https://github.com/jnehring/beautiful-bleep); this is a young project, so feedback is very welcome, through the [contact form](/contact/) or an issue on GitHub.
