---
title: Ableton Live goes modular
description: What Live can do with Beautiful Bleep that it could not do before, and what each connection costs in latency.
order: 5
---

# Ableton Live goes modular

Live is built around tracks: each track has its own chain, and tracks talk to each
other through sends, sidechains and "MIDI From". Beautiful Bleep adds something
Live does not have, a **patch bay for the whole set**. You put a few small
plugins on your tracks ([ports](../use/ports.md)) and every one of them shows up
on one shared canvas, the [board](../use/board.md). There you connect
them with cables, the way you would in a modular synthesizer.

This page lists what that gives you that Live cannot do by itself, then explains
what it costs in latency, especially when several plugins are connected to each other.

## What you can do now

- **Modulate anything from anything, across tracks.** Live has no modulation
  system. With the board, one source (an envelope, a random generator, a track's
  audio) can drive many parameters, and one parameter can take several
  sources. Source and target can sit on different tracks.
- **Modulate at audio rate.** Every signal except notes is calculated per
  sample, so a modulation cable can carry an audio-rate LFO, an oscillator or
  a whole audio signal. FM-style effects are a cable away.
- **Build feedback loops.** Filter into grit and back into the filter; a delay
  that feeds a synth. Live's routing refuses feedback. On the board, a cable that
  closes a loop is marked with a loop icon and delayed by a few samples
  (see [Feedback](#feedback-loops)).
- **Use modular building blocks.** Function generators, quantized random,
  chaos sources, comparators, clock dividers and keyframe morphing are modules, not
  separate devices. Because a comparator turns a signal into a trigger, a random
  source can fire envelopes or notes.
- **Patch audio, MIDI and modulation in one place.** Today Live keeps these in
  separate menus. On the board they are cable types, and the board only allows
  connections that make sense.
- **Design your own synths and effects inside Live.** Build an instrument or an
  effect out of modules, then load it as a normal plugin on a track
  (*Bleep Instrument* or *Bleep FX*) with its own front panel.
- **Modulate other plugins.** Plugins that use the Bleep Bus protocol appear on
  the board as nodes, so the board can modulate them too.
- **Take the board out of Live.** The [Bleep App](../use/standalone.md) runs the
  same board next to Live and stays in time through Ableton Link.

## How the board connects to Live

Everything you cable on the board happens inside one engine, and the
engine runs **sample-accurately**. Latency only appears where audio or notes
cross the border between Live and the board:

```
 Live track ──► Bleep Audio In ──┐                        ┌──► Bleep Audio Out ──► Live mixer
 Live track ──► Bleep MIDI In  ──┤   B O A R D (no delay  ├──► Bleep Instrument
 Live track ──► Bleep FX (send) ─┘   between modules)     └──► Bleep FX (return)
```

Entering the board takes one audio buffer, and leaving it takes another. So:

> **One trip through the board (into it and back out) costs two audio buffers.**

Cables between modules on the board cost nothing.

## How much is two buffers?

| Buffer size in Live | 44.1 kHz | 48 kHz |
|---|---|---|
| 64 samples | 128 samples, 2.9 ms | 128 samples, 2.7 ms |
| 128 samples | 256 samples, 5.8 ms | 256 samples, 5.3 ms |
| 256 samples | 512 samples, 11.6 ms | 512 samples, 10.7 ms |
| 512 samples | 1024 samples, 23.2 ms | 1024 samples, 21.3 ms |

Bleep Audio Out, Bleep Instrument and Bleep FX report this delay to Live, so
Live's delay compensation lines everything up. Your drums, your bass and
the board's audio stay in time with each other. What you pay is the
**total latency of the set**: Live delays the other tracks to match, which you
feel when you play or record on a monitored track.

Right after you load a set the plugins assume a larger buffer for a moment,
then settle to twice your real buffer after the first block has played. After
that the number only changes if you change the buffer size or sample rate.

## Several plugins connected to each other

This is the part that matters when you build bigger setups. The rule is simple:
**you pay once for every crossing between Live and the board, not for every
cable.**

| Setup | Added latency |
|---|---|
| One track, *Bleep Instrument* played from a keyboard | 2 buffers |
| Ten modules cabled together between *Audio In* and *Audio Out* | 2 buffers (the same as with one module) |
| Several *Bleep MIDI In* and *Audio In* ports feeding one *Audio Out*, all patched on the board | 2 buffers (inputs are processed together) |
| *Bleep FX* on track A, then *Bleep FX* on the same track after it | 4 buffers (two crossings, one after the other) |
| Track A: *Audio In*, board, *Audio Out* on track B. Then track B: *Audio In*, board, *Audio Out* on track C | 4 buffers at track C (two crossings) |
| Same as above, but you cable A straight to C on the board | 2 buffers |
| Three *Bleep FX* in a row, each on its own track or in one chain | 6 buffers |

**Tip: keep chains on the board.** If two Bleep effects follow each other, don't
put a Bleep FX after a Bleep FX. Put both effects in one board patch (or one
cell) and cable them there. Audio then goes into the board once and comes out once,
whatever happens in between.

**Live compensates, but only for what it can see.** Live adds the delays that
the output plugins report along the signal path, so the sum of crossings is
lined up with the rest of your set. Parallel tracks that do not use Bleep are
delayed to match. Some paths are not compensated:

- **Bleep MIDI Out sent to another track.** Live does not reliably compensate
  this routing. Notes arrive about two buffers late relative to the rest. Move
  the target track earlier in your timeline or nudge it with the track delay.
- **Tracks you monitor with Reduced Latency When Monitoring on.** Live skips
  delay compensation for them.
- **Modulation sent to other plugins through the Bleep Bus.** It arrives one
  buffer late, which you cannot hear for modulation.
- **Feedback cables.** A cable that closes a loop is delayed by one engine
  step (32 samples, 0.7 ms at 44.1 kHz).

### Feedback loops

A feedback cable adds 32 samples inside the board. It does not add to the two
buffers above. In a tight filter-grit loop that small delay slightly changes
the pitch of the ringing, which many people use on purpose. A *tight feedback*
option that reduces the delay to one sample is planned.

## Tips for low latency

- **Playing live:** set Live's buffer to 128 samples or lower for the tracks
  you play. *Bleep Instrument* on a 128 buffer adds under 6 ms at 44.1 kHz.
- **Mixing and producing:** buffer size does not matter for the sound, only
  for how fast the controls respond. Bigger buffers are fine.
- **Don't use the board for phase-tight parallel processing.** *Bleep FX*
  delays its own dry signal to match, so its Dry/Wet is safe. A dry/wet blend
  you build yourself from separate Audio In and Audio Out tracks depends on
  Live's compensation, and can comb-filter if that compensation is off.
- **Count crossings.** Before you add another Bleep FX in a row, ask whether the
  new effect can live on the board with the others.
- **Rendering:** latency does not matter for exports. The board follows Live's
  time stamps in real time and offline alike.

## Where to go next

- [Ports](../use/ports.md): every plugin you can add in Live
- [Your first patch](../learn/first-patch.md): build your first connection
- [Modulation](../learn/modulation.md): sources, cables and amounts
- [Connecting plugin, app and web](../connect/connecting.md): latency when
  the board lives in the Bleep App or in the browser
