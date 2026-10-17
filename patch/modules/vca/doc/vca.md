# VCA

![VCA in the module view](vca.png)

## Introduction

A VCA (voltage-controlled amplifier) sets the volume of a signal. On its own
it's a stereo volume knob. Patch an envelope or an LFO onto its **Gain** and the
volume follows that signal. This is how a note gets its loudness shape, and how
tremolo and ducking work.

## How does it work?

Both channels are multiplied by the same gain:

    Out = In × gain

*Gain* is a 0 – 400 % knob. With the **Linear** response, gain is the knob
value. With **Exponential**, it is the value cubed up to 100 %: 50 % on the knob is
about −18 dB, and the bottom of the range fades smoothly toward silence. This
sounds more natural for fades and envelopes. Above 100 % the curve continues
linearly, up to 4× (+12 dB).

Gain starts at **0 %** (closed). Modulation adds to the knob, so an envelope
patched at 100 % amount sweeps the whole knob range, from silence up to 400 %,
so use an amount of 25 % to open the VCA exactly to unity.

Gain above 100 % lifts a quiet signal; mind the level after it.

If only *In L* is patched, it feeds both channels. A mono oscillator then comes
out on both sides.

## How to use it?

- **Note volume:** Oscillator *Out* → VCA *In L*; ADSR *Env* → VCA **Gain**
  knob. VCA *Out L/R* goes to Voice Out or an output port.
- **Tremolo:** turn Gain up to about 50 % and patch a Function (cycling) onto
  Gain with a small amount.
- **Ducking:** set Gain to 100 % and patch an envelope onto Gain with a
  *negative* amount of about −25 % (a full envelope sweeps the whole 400 %): each trigger dips the volume.
- **Plain volume or mute:** use the knob without any cable.
- To shape a control signal instead of audio, use **Utility**. The VCA is
  built for audio.

<!-- generated:demos -->
## Demo patches

Five whole patches show what VCA does. In the standalone app open **File → Presets…** (⌘P) and pick *VCA* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **VCA: Exponential Pluck** | A saw note shaped by a short envelope into the VCA's Gain, with Response on Exponential so the decay sounds natural and plucked. Switch Response to Linear to hear a stiffer, more abrupt tail, or change the envelope's Decay. |
| **VCA: Tremolo Chords** | A held chord goes through a VCA whose Gain rests at a middle value while a triangle LFO swings it up and down, a classic tremolo. Raise the LFO Rate for a flutter, change its amount for a deeper chop, or move the VCA's Gain to rebalance. |
| **VCA: Linear Swell** | A very slow attack on the envelope lets a rich pad fade in and out through a VCA with Response set to Linear, so the volume rises evenly instead of rushing in at the end. Compare it with Exponential, or lengthen Attack and Release. |
| **VCA: Kick Ducking** | Every kick fires an envelope that pushes the pad VCA's Gain down by a negative amount, so the chords dip on the beat and swell back between hits. Change the envelope Release for a longer pump, or raise the VCA's Gain for an even bigger pad. |
| **VCA: Rhythm Gate** | A sustained saw chord is chopped into a rhythm by a drum-grid track that fires a tight envelope into the VCA's Gain, the stuttering gate used in trance and electro. Edit the pattern, or lengthen the envelope Release to soften the chops. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Gain | 0 – 400 % | 0 % |
| Response | Linear, Exponential | Exponential |

- **Gain:** the amplification, from silence (0 %) through unity (100 %) up to
  4× (400 %, +12 dB). Patch envelopes and LFOs here; the ring around the knob shows
  the gain really used.
- **Response:** how the gain value maps to volume.
  - *Linear:* volume = gain. Good for amplitude modulation at audio rate and for
    signals that should stay proportional.
  - *Exponential:* volume = gain³ up to 100 % (about −60 dB to 0 dB), then linear. Fades and envelopes
    sound even, the way our ears expect.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In L | audio | left input; also feeds the right channel when *In R* is not patched |
| In R | audio | right input |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out L | audio | left input × gain |
| Out R | audio | right input × gain |
