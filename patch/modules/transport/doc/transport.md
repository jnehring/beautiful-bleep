# Transport

![Transport in the module view](transport.png)

## Introduction

Transport is the control panel for the song's clock. Set the tempo, switch
**Ableton Link** on or off, send **MIDI clock** to a drum machine, follow the
MIDI clock of another device, and start and stop the song from the module's
buttons, from cables or from incoming MIDI. Everything on the board that keeps
time (sequencers, delays, LFOs) follows what Transport sets.

Transport changes the clock in the **standalone app**. In Live the host's own
transport leads, and in the browser there is none: there it still sends MIDI
clock and shows the tempo, but cannot change it.

## How does it work?

**Tempo.** Move *Tempo* to set it. With *Tap*, tap a few times in the beat you
want. The tempo stays what you set; loading a board does not change it, so a
project keeps its own tempo. With Link on, the tempo is shared with the other
Link apps and devices, and they can change it too.

**Link.** *Link* turns Ableton Link on or off. With *Link Start/Stop* on,
playing and stopping is shared as well. Link needs an app built with it; without,
the switch has no effect and the app runs on its own clock.

**MIDI clock out.** With *MIDI Clock Out* on, Transport sends 24 pulses per beat
while the song plays, plus Start when it begins at the beginning, Continue when
it resumes anywhere else, and Stop. Patch *MIDI Out* into a MIDI Out module.

**MIDI clock in.** With *MIDI Clock In* on, patch a MIDI In or MIDI Device
module's *Notes* into *MIDI In*. Transport measures the incoming clock and sets
the tempo from it; it settles after about a beat and follows changes within a
bar. Start, Continue and Stop from the device start and stop your song. This
sets the tempo, but does not line up the beats exactly: for that, use Link.

**Play and Stop.** The *Play / Stop* button toggles. A trigger in *Play* starts a
stopped song from the beginning, a trigger in *Stop* stops it. Patch a Button
or a pad to either.

## How to use it?

- **Tempo on a knob:** put a Dial on the *Tempo* knob's input (or play with the
  knob itself).
- **Drum machine follows you:** *MIDI Clock Out* on, *MIDI Out* → MIDI Out
  (the drum machine's port). Start your song and the machine starts with it.
- **You follow the drum machine:** *MIDI Clock In* on, its MIDI Device's
  *Notes* → *MIDI In*. Press play on the machine.
- **Tap tempo:** press *Tap* to the beat, four times or more.
- **Footswitch:** a MIDI Device's gate or a Button into *Play* and *Stop*.
- **A lamp that shows the song runs:** *Playing* into a Level Meter or a light.
- **Tempo-linked effects:** *Tempo* into a control input (BPM / 100: 120 BPM is 1.2).

Do not connect the module's *MIDI Out* back into its own *MIDI In* with both
clock settings on: that makes a loop.

## Reference

### Knobs, settings and buttons

| Control | Range | Default |
|---|---|---|
| Tempo | 20 … 400 BPM | 120 |
| Link | Off, On | On |
| Link Start/Stop | Off, On | On |
| MIDI Clock In | Off, On | Off |
| MIDI Clock Out | Off, On | Off |
| Play / Stop | button | |
| Tap | button | |

If the board also has a *Link* node, its *Start/Stop Sync* setting decides.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Play | trigger | Starts the song from the beginning |
| Stop | trigger | Stops the song |
| MIDI In | notes | The MIDI clock to follow (MIDI Clock In) |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| MIDI Out | notes | MIDI clock, Start, Continue and Stop (MIDI Clock Out) |
| Playing | gate | High while the song runs |
| Tempo | control | The tempo in BPM divided by 100 (120 BPM is 1.2) |
