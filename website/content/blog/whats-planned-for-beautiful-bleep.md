---
title: What is planned for Beautiful Bleep
date: 2026-10-21
description: A look ahead at Beautiful Bleep. Plugins for more DAWs, a closer bridge to Ableton Live, instruments and effects in the app and the browser, playing together across computers, and the rest of the list.
---

Beautiful Bleep is new, and most of what it will become is not built yet. [The introduction](/blog/introducing-beautiful-bleep/) described what you can use today. This post is the other half: what we plan to build, roughly in the order we think about it, and what is still open.

Nothing here is a promise or a date. These are plans, and they change when we learn what people need. If one of them matters to you, tell us through the [contact form](/contact/) or on [GitHub](https://github.com/jnehring/beautiful-bleep). That is the best way to move something up the list.

## Plugins for other DAWs

Today the Bleep plugins are VST3 plugins, and Ableton Live is the host we build and test against. The plan is to make Beautiful Bleep a good citizen in more DAWs:

- **More formats.** VST3 covers many hosts, but not all of them. Logic and GarageBand on the Mac need an Audio Unit, and some people would like CLAP. The plugins are built on JUCE, which makes the extra formats a packaging job rather than a rewrite.
- **Testing in more hosts.** A plugin that loads is not the same as a plugin that behaves. Hosts differ in how they save state, how they treat several instances of one plugin, and how they schedule audio. We want to test the Instrument, FX, Board and port plugins in the other major DAWs, and write down what works and what does not, the way the install guide does for Live.
- **Windows and Linux.** The apps and the Bleep Bus reference implementation already build for Windows, and the standalone app has audio capture for Windows and Linux. The plugins for those systems need more testing before we call them supported.

The part we are most curious about is [Bleep Bus](/docs/developers/bleep-bus/overview/), the protocol that lets one plugin send control signals to another. It does not depend on Ableton Live, so the cables between plugins should work in any DAW that can host two plugins at once. Whether a given host allows that is one of the things the testing will tell us.

## A closer bridge to Ableton Live

Right now Live and Beautiful Bleep meet at the plugin: Bleep Instrument on a MIDI track, Bleep FX on an audio track, and ports that carry signals between the board and your tracks. Tempo and transport follow Live.

We would like the two to know more about each other. The ideas on the table are:

- **Live's parameters on the board.** Automate a Bleep dial from a Live clip, or send a Bleep signal back as something Live can map to.
- **Sessions that stay in sync.** Open a Live set and have its Bleep board, presets and ports come back as you left them, without a manual step in the standalone app.
- **Less setup.** Today the app has to be running for some connections, and the cables between several plugins need the Bleep Board plugin in the set. A bridge should make the common case work with fewer steps.

How this is built is still open. It could be a Max for Live device, it could grow out of the existing plugins, or it could be a mix. We would rather hear how you use Live with Bleep before we choose, so this is the item where your feedback counts most.

## Instruments and effects in the app and the browser

In Live, you can pick an instrument or an effect preset and never see a cable. In the Bleep App and in Bleep Play you currently start from the full board. The [table of ways to play](/docs/musicians/start/ways-to-use/) lists the Instrument and Effect modes there as planned.

The goal is that you can open Bleep Play, pick *Slate Stabs* or *Dub Ping-Pong*, and play it with a panel in front of you, the same as in Live, and press **Open Board** when you want to look inside.

## Bleep Play catches up

The browser version runs the same projects as the plugins, but a few things are not ported yet: Voice Cells, the Harmony bus, Ableton Link, Macros, audio input, MIDI out to a host, and the media folder that sample-based modules use. Some of these need a browser feature that does not exist everywhere, and some are just work. Bringing them across is what lets you start a project in the browser and finish it in Live without losing anything.

Safari is on the list too. Bleep Play works best in Chrome and Edge today, and a browser that handles audio and MIDI differently needs its own testing.

## Playing together across computers

Everything is on one machine for now. The plugin, the app and Bleep Play can talk to each other, but only on the same computer. A shared session, such as a web board on your phone or a friend playing your synth, needs a server between the computers.

Sending notes over the internet is easy. Sending audio live is limited by the delay of the network, and no setting hides that. So the first version will focus on what works well at a distance: shared boards, shared presets, notes and control signals. Live audio between two rooms is a different problem, and we will be honest about its limits.

## Getting sound out as a file

Rendering a Bleep sound into an audio file is easy in a DAW, which can bounce or freeze a track. It is harder from the browser, where there is no DAW. We plan to add an export and freeze path so that something you make in Bleep Play can end up as a file, or as a clip in your project, without a recording workaround.

## Modules, the library and the assistant

A synthesizer is only as good as what you can patch with, so a large part of the plan is to grow the [Bleep Library](/library/):

- **More modules**, from us and from other developers, with a manual, demo patches and presets for each one.
- **Easier sharing.** Sandboxed modules already let third parties publish safely. We want to make it simpler to take a patch from your board, turn it into a module and share it, with a picture, a description and its source.
- **A better Bleep Assistant.** The assistant is measured with a benchmark, and the benchmark is how we decide what to improve: harder tasks, more kinds of sounds, and fewer wrong turns. Other models and ways to run it, including offline, are things we want to try.
- **More of Bleep Script.** More built-in helpers, more tutorials, and better error messages.

## Smaller rough edges

Some items are small, but they are the ones that make a tool pleasant to live with:

- Signed and notarized builds, so the system stops warning you about an unknown developer when you install.
- A more helpful first run, with clearer messages when a plugin cannot find the app or a module is missing.
- More documentation: more recipes for connecting the plugin, the app and the browser, and more walkthroughs for the modules.

## What is not on the list

We do not plan to turn Beautiful Bleep into a DAW. It is meant to sit inside the music software you already use, or next to it, and to be a modular instrument that you can play. Anything that makes it a better instrument is welcome. Anything that makes it a worse DAW is not.

## Help decide

This list is short on purpose, and the order is not fixed. If you want Bleep in a particular DAW, a particular kind of bridge to Live, or a module we do not have, [write to us](/contact/) or open an issue on [GitHub](https://github.com/jnehring/beautiful-bleep). If you would rather build it yourself, the code is open, the [developer documentation](/docs/developers/overview/) has the way in, and the [Bleep Bus quickstart](/docs/developers/bleep-bus/quickstart/) is a good place to start.
