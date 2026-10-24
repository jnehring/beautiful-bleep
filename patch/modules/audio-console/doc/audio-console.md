# Audio Console

## Introduction

A mixing console for the board. It brings up to 32 sources (oscillators, drums, Voice Cells, the output of whole
cells) into one stereo pair, and every channel has what you expect on a console: a high-pass and a low-pass filter,
a three-band EQ, up to four aux sends, a pan, a fader with a meter, and solo, mute and record arm. Aux buses come
back through returns, the master has its own filters, EQ and a limiter, and every channel can leave on its own
through a direct output.

The console also **records**: every armed channel, aux bus and the master is written to a file of its own, so you
can record a whole session as separate stems. For a small mixer with four channels, the [Audio Mixer](audio-mixer.md)
is lighter.

## How does it work?

The number of channels, aux buses and direct outputs are settings (**Channels**, **Aux Buses**, **Direct Outs**).
The strips, jacks and knobs above the number are hidden; a cable patched to a hidden jack stays where it is.

Each channel's signal goes through, in this order:

1. **Mono or stereo.** A mono channel reads *In L*; a stereo channel reads *In L* and *In R*, and its pan becomes a
   balance.
2. **High-pass** (20 Hz to 1 kHz, off at 20 Hz) and **low-pass** (1 kHz to 20 kHz, off at 20 kHz), 12 dB per octave.
3. **EQ:** a low shelf at 100 Hz, a mid bell at 1 kHz and a high shelf at 8 kHz, each −15 to +15 dB. A band at 0 dB is
   skipped.
4. **Level** (−60 dB, silence, to +6 dB; 0 dB sits at about 80 % of the travel), **Mute** and **Pan**.
5. **Solo:** when any channel is soloed, only soloed channels reach the main output. The sends and the direct
   outputs are not affected, so a reverb keeps its tail while you solo.

**Sends.** Each channel has a *Send* knob for each aux bus (−60 dB, silence, to 0 dB). *Send Point* decides where
the send is taken, for each bus: after the fader (post-fader, the default: the send follows the fader) or before it
(pre-fader: the send ignores the fader and the solo and only follows the mute). The sum of every channel's send comes
out of *Send 1…4 L/R*. Patch it into an effect, and the effect's output into *Return 1…4 L/R*. A return has a fader,
a balance and a mute and joins the main output. The cable that brings a return back is a feedback cable, so the
return arrives about 0.7 ms late: inaudible for a reverb or a delay, wrong for parallel compression.

**Master.** The main bus (the channels and the returns) goes through the master's high-pass, low-pass and EQ, its
balance, fader and mute, and then the **limiter**, a lookahead peak limiter at −0.3 dBFS that keeps the sum from
clipping. **Mono Main** sums the whole console to mono.

**Direct outputs.** *Direct Outs* gives the first *n* channels an output pair of their own, taken after the fader
or, with *Direct Point* on *Pre-fader*, after the filters and EQ but before the fader and mute.

**Other outputs.** *Level* follows the loudness of the main output (for ducking). *Recording* is high while a take is
written.

## The view

A row of channel strips, then the aux strips, then the master. A channel strip has, from the top: its **name**
(click it to rename; the name is also the name of the recorded file), **Mono / Stereo**, the filters, the EQ, the
sends, the pan, the fader with its meter (a peak meter with a hold line and a clip light; click the light to reset
it) and the **S M R** buttons: solo, mute and record arm. Double-click a knob or a fader to reset it.

Below the strips is the **Record** panel: the **Record** button, **Arm all** and **Unarm all**, the time left, the
**Setup** (channels, aux buses, direct outs, send points, mono main, limiter), the **Record settings** and the
**View** toggles. The View toggles hide the EQ, the filters, the sends or the S / M / R buttons to make the strips more
compact. A hidden section keeps working; only the view changes, and the choice is saved with the board.

## Recording

See [Recording](/docs/musicians/use/recording/) for the steps. In short:

- Arm channels, aux buses (they record their send bus) and the master, then press **Record**.
- Each armed track is its own file in the Recordings folder (`~/Music/Beautiful Bleep/Recordings` on a Mac; change it in
  Settings → Recordings), in a
  folder named after the time you started.
- **Start and Stop:** *Manual* is one take from Record to Stop, however often the transport starts and stops;
  *Follow Transport* makes one take for every play-to-stop.
- **Channel Tap:** *Input* records the channel as it arrives (the dry stem), *Post-fader* records it after the
  filters, EQ, fader and mute.
- **Format:** WAV at 16-bit, 24-bit or 32-bit float, or MP3 at 192 or 320 kbps (about a tenth of the space; in the app and the
  plugins, when they were built with the encoder).
- The panel shows how long you can still record. If the disk cannot keep up, the take ends and the panel says why.

The tracks armed when you press Record are the tracks of that recording; arming during a recording changes the next one.
In the browser (Bleep Play) the recording is kept in memory: after Stop it is listed in the Record panel, with **Download .zip**
(a WAV file for every track of every take) and **Discard**. The time left is what is left of a fixed memory budget.

## How to use it?

- **A drum kit on separate channels:** each drum into its own channel, *Out L/R* to an audio output port. Arm them all
  and record a take of the whole kit as stems.
- **A shared reverb:** turn up each channel's *Send 1*, patch *Send 1 L/R* into a reverb and the reverb's output into
  *Return 1 L/R*. Raise the return fader to taste.
- **Stems with processing in Live:** use *Direct Outs* with *Direct Point* on *Pre-fader* and send every channel to its own
  port.
- **Ducking:** patch the *Level* output with a negative amount onto another VCA's gain.
