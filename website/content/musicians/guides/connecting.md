---
title: Connecting plugin, app and web
description: Send audio, MIDI and tempo between Live, the Bleep App and Bleep Play, and what each connection costs in delay.
order: 6
---

# Connecting plugin, app and web

Bleep runs in three places: the [plugins](../ports.md) in Live, the
[app](../standalone.md) and a board in your browser. Each has its own board.
This page is about making them work together: a synth built in the browser and
played from Live, an effect in the browser on a Live track, a sequencer in the
browser that plays an instrument in Live, a patch in the app whose sound lands
on a Live track.

The idea is one setting, the **Board** menu on the plugins, plus one switch in
the app and one button in the browser.

![Live plugins connect to the app through shared memory; Bleep Play in the browser connects to the app over a WebSocket. The app is the hub in the middle.](/img/connecting-overview.svg)

The app sits in the middle. Live and the browser both talk to it, never to
each other directly. That is why the app has to be running for any of this.
Everything stays on your computer: the app listens on `127.0.0.1` only.

## What delay to expect

Audio cannot travel for free. Each hop adds a little time, and it is better to
know the numbers than to be surprised.

| Connection | Delay | Good for |
|---|---|---|
| Live ⇄ app | 2 audio buffers (about 5 ms at 256 samples) | Almost anything, including playing |
| Live → browser → Live | About 45 ms for the whole round trip with the page from the app (*Low latency*, 256-sample buffer, measured on a laptop with a Chrome-based browser); more with a bigger buffer or the *Safe* mode | Sound design, effects you hear, sequences |
| Browser page from the website | Safe mode: about 64 ms of buffering in each direction, on top | The same, with more headroom |

The browser's share is its jitter buffer (16 ms in *Low latency*, at least 1.5
audio buffers of the app or of Live) and the browser's own audio output. The
plugin that brings the sound back reports the total to Live.

Two things make the delay mostly invisible in a song:

- **Sources that follow the transport are lined up for you.** When Live's own
  MIDI plays a browser synth, or a browser sequencer plays a Live instrument,
  the plugin tells Live how late the sound will be, and Live's delay
  compensation moves everything else to match. On the timeline it is on the
  beat.
- **Sources that answer you live are not.** Playing the browser synth with a
  keyboard, or running a live input through a browser effect, you hear the full
  delay. For playing, run the instrument in the app or in a plugin instead, and
  use the browser for sequencing, effects and sound design.

## Turning it on

1. **In the app:** File → Settings → **Web**, then *Let Bleep Play pages connect to
   this app*. It is off until you do this. The port is `47100`; change it only
   if something else uses it.
2. **In a plugin:** open a port plugin's window (Bleep MIDI In, MIDI Out, Audio
   In or Audio Out) and choose its **Board**:

   | Board | The plugin talks to |
   |---|---|
   | **This set** | The board of this Live set, as always |
   | **Bleep App** | The board in the running app |
   | **Bleep Play** | Bleep Play that has joined (through the app) |

3. **In the browser:** open the board and press **⇄ Connect to app** (next to
   *Start audio*). The button is in the current web build only: a copy of the
   board built earlier does not have it. Rebuild with
   `scripts/build/build-web.sh --no-modules`.

For the lowest delay, **open the board from the app** instead of the website:
the Web section of the app's Settings shows the address
(`http://127.0.0.1:47100/`). The app serves the board page from the folder named
by the `BLEEP_WEB_ROOT` environment variable (the folder `build-web.sh` wrote,
`build/web/site`), for example
`BLEEP_WEB_ROOT=build/web/site "Bleep Patch.app/Contents/MacOS/Bleep Patch"`.
Without it the app shows only a placeholder page at that address. That page can use a faster path between the
browser and its audio engine, which is what *Low latency* means. The website's
page works too, in *Safe* mode, with more delay and a little more headroom.
Safari does not let a website talk to an app on your computer, so use the
app's page there.

The first time a page from anywhere else connects, the app asks whether to allow
it. Allow only pages you opened yourself. You can forget them again in
Settings → Web.

## Which plugins do I need?

Only four of the [port plugins](../ports.md) can talk to the app or Bleep Play:
**Bleep MIDI In**, **MIDI Out**, **Audio In** and **Audio Out**. They are the
ones with a **Board** menu. Pick the plugin for what should travel, then set
its Board to *Bleep App* (a patch in the app) or *Bleep Play* (the browser).

| You want | Put this on a track | Board |
|---|---|---|
| **MIDI from Live to the board** (Live's notes play a synth in the app or browser) | **Bleep MIDI In** on a MIDI track | *Bleep App* or *Bleep Play* |
| **MIDI from the board to Live** (a board sequencer plays an instrument in Live) | **Bleep MIDI Out** on a MIDI track, routed to your instrument ([how](midi-out-routing.md)) | *Bleep App* or *Bleep Play* |
| **Audio from a Live track to the board** (an effect, a sampler or analysis) | **Bleep Audio In** on that track | *Bleep App* or *Bleep Play* |
| **Audio from the board back into Live** (the sound of a synth or an effect) | **Bleep Audio Out** on its own MIDI track | *Bleep App* or *Bleep Play* |
| **Sync** (tempo, beat, play and stop) | Nothing extra: any one of the four plugins above carries it | |

A few things follow from that:

- **Audio and MIDI are separate.** A browser synth played from Live needs two
  plugins: MIDI In for the notes and Audio Out for the sound. A browser effect
  needs Audio In and Audio Out.
- **Sync has no plugin of its own.** As soon as one plugin with a Board other
  than *This set* is connected, Live leads the tempo and transport, and the app
  and Bleep Play follow it (see [Tempo and transport](#tempo-and-transport)).
- **The other port plugins stay in Live.** *Bleep Board*, *Bleep Instrument* and
  *Bleep FX* have no Board menu: they always use the board of this set. Put
  *Bleep Board* once per set if you want macros as usual.

The [recipes](#recipes) below walk through the common combinations.

## What you see

**On the app's board**, a plugin with *Board = Bleep App* appears as the
same node it would be in Live (a *MIDI In*, an *Audio Out* …), named after its
track. When you set it back, or delete the plugin, the node turns grey and its
cables stay.

**On the browser's board**, a plugin with *Board = Bleep Play* appears as a node
named *Live: track name*, in the same colour as the app's remote nodes.
Pressing *Connect* again after a break reconnects them. Nodes you add yourself
from the **Add** menu, *Remote Audio* and *Remote MIDI*, appear on the app's
board as *Web: name* nodes.

A plugin with a Board other than *This set* has no node on Live's own board:
Bleep App there shows it as a grey ghost until you switch it back.

## Recipes

### Play a browser synth from Live

1. In Live, make a MIDI track with **Bleep MIDI In**, *Board = Bleep Play*. Play
   or draw notes on it.
2. Make another MIDI track with **Bleep Audio Out**, *Board = Bleep Play*. This
   is where the sound comes back.
3. In Bleep Play, connect to the app. *Live: your MIDI track* and *Live:
   your audio track* appear. Cable the MIDI node's *Notes* into an oscillator
   or a synth cell, and the synth's output into the audio node's *L* and *R*.

Audio Out reports the way there and back to Live, so a clip's notes sound on
their beat. If you play the MIDI track live with a keyboard, expect the delay
from the table above.

### Put a browser effect on a Live track

Put **Bleep Audio In** (*Board = Bleep Play*) on the track to send its audio to
the browser, and **Bleep Audio Out** (*Board = Bleep Play*) on its own track to
get the result back. Mute the original track if you want only the effect.
Audio travels there and back, so the delay is twice that of the table. Live
lines it up with the rest of your set when the clips play.

### Play an instrument in Live from a browser sequencer

Put **Bleep MIDI Out** (*Board = Bleep Play*) on a MIDI track in Live and route
that track's output to the track with your instrument (see [MIDI Out
routing](midi-out-routing.md)). In Bleep Play a node *Live: track name*
appears with a *Notes* input: cable your sequencer's notes into it.

The sequencer follows Live's tempo and position, and sends notes a short time
ahead, each with the beat it belongs to. The plugin plays every note at its
place in the right buffer, so it is on the beat, not just *about* on the beat.
When you change the tempo or jump the playhead, the sequencer drops what it had
queued and starts again from the new place, so nothing plays in the wrong spot.

To use the browser's MIDI in the app instead, add a *Remote MIDI* node from the
**Add** menu: in the app it appears as a *Web: Remote MIDI* node you can patch
like any other MIDI source.

### A patch in the app, as a sound source in Live

In Live, put **Bleep Audio Out** with *Board = Bleep App* on a track: the
app's board now plays on that track, with its own mixer channel. The app
follows Live's tempo and position while it is connected. The delay is two
buffers, and Live compensates it.

Do the same with **Bleep MIDI In** (*Board = Bleep App*) to play the
app's patch from a Live MIDI track. MIDI and audio then travel in the same way,
so they stay together.

While Live is connected to the app, **the app's own audio interface stays
silent**: Live's audio buffers drive the app, and its sound goes back through
Live. Disconnect the plugins, or close the set, to use the app on its own.

## Tempo and transport

One of them leads at a time:

1. **Live**, as long as one of its plugins talks to the app or Bleep Play.
2. **Ableton Link** in the app, if it is on.
3. The app's own clock.

Bleep Play follows whoever leads: tempo, beat and play/stop. It can ask
for a new tempo or for play, and only the leader decides. If Live leads, a
request from the browser changes nothing.

## Export and freeze

A browser works on the clock of its own sound card and cannot go faster than
real time. When Live **exports**, **freezes** or **flattens** a track faster
than real time, a Bleep plugin with *Board = Bleep App* waits for the app
and everything is in the file. With *Board = Bleep Play* the browser's share is
silent. To get it into a file: **record the web part to an audio track in real
time** (a track with Audio In/Out is enough), then export.

## When it does not work

The plugin window says what it sees:

| It says | What to do |
|---|---|
| *The Bleep App is not running* | Start the app. Until then the plugin passes its track through untouched |
| *The app is connected to another host* | Only one Live at a time can drive the app |
| *The app has no free bridge slot* | 32 plugins at most can talk to the app. Remove some |
| *The app is another version* | Update the plugins and the app, then restart Live |
| *Late blocks* counting up | The computer is busy or the buffer is small. Raise Live's buffer size |

In the browser, the *Connect* button says why it could not connect (the app is
not running, the Web setting is off, the browser blocks the connection, you
declined the question). In the app, **Settings → Web** shows who is connected
and how many channels each has, and counts MIDI that arrived late or after a
tempo change.

## What is not there yet

- **Another computer.** Everything is on one machine. A shared session (a web
  board on your phone, a friend playing your synth) needs a server between the
  computers and is planned. Playing notes across the internet is easy; sending
  audio live is limited by the network's delay, which no setting hides.
- **A browser sound in a file, automatically.** See *Export and freeze*.
- **The page from the website in Safari.** Use the page from the app.
- **Live without the app.** The app has to be running. A plugin that can take
  its place is a possibility later.

The formats and numbers behind all this are in the design notes for
developers, `doc/specs/bridges.md` in the source.
