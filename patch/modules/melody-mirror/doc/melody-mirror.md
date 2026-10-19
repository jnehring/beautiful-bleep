# Melody Mirror

## Introduction

Melody Mirror listens to the last few notes of a `notes` stream, with their
timing, and plays them back **turned around**: backwards, upside down, with
the pitches shifted along the rhythm, or both turns at once. In *Answer* mode
it behaves like a second player: it waits for you to pause, replies with your
phrase turned around, and listens again. The notes out play a Voice Cell like
any other note source.

## How does it work?

**The phrase.** The module remembers the last *Length* notes (2–16) with when
each began and how long it was held. That is the phrase.

**The turns** (*Mode*, a knob you can modulate):

- **Reverse:** the phrase played backwards in time. The last note comes first
  and the rhythm runs backwards too.
- **Invert:** every pitch mirrored around an axis, the rhythm unchanged. The
  *Axis* is the phrase's first note, its average pitch (*Mean*), or a *Fixed*
  note you choose. Pitches that would leave the keyboard are folded back by
  octaves.
- **Rotate:** the pitches move *Rotate* places along the phrase while the
  rhythm stays where it is: the same tune, shifted against its rhythm.
- **Mirror:** Reverse and Invert together.
- **Answer:** the twist. While you play it only listens. When you have been
  quiet for the *Gap* it plays the phrase turned by *Reply* (Reverse, Invert,
  Rotate or Mirror) and then listens again. While it answers, new notes are
  heard through *Thru* but not remembered, so it never answers itself.

**Starting.** *Start* **After Gap** plays the turned phrase whenever you stop
for *Gap* (1/2 beat … 2 bars at the transport's tempo) after new notes; it
does not repeat until you play something new. *Start* **Trigger** plays only
when a trigger arrives at *Trig* or you press **Replay**, as often as you
like. Starting while a phrase plays begins it again.

**Playback shaping.** *Speed* (0.25× … 4×) changes the tempo of the replay,
*Transpose* moves it by semitones, *Velocity* scales how hard it plays and
*Gate Length* how long each note holds. *Snap To Scale* pulls the replayed
notes to the *Root* and *Scale* (or the key of a Harmony Master bus), so an
inversion cannot leave the key.

*Thru* passes what you play to the output as well, or mutes it so you hear
only the turned version. A note that you hold while the module plays the same
pitch never gets cut by the other: they share the note.

## How to use it?

- **Call and response:** *Mode* Answer, *Gap* 1 beat, MIDI keyboard in. Play
  four notes, stop, and hear the mirror image come back.
- **Counter-melody:** *Mode* Invert with *Snap To Scale* on and a slower
  *Speed*; mix with the original through *Thru*.
- **Hands-free variation:** a Step Sequencer feeding it, *Mode* Reverse; patch
  an LFO into *Mode* to change the turn from phrase to phrase.
- **Perform it:** *Start* Trigger and a button on *Trig*, so the turned
  phrase comes in when you want it.
- **Sync with others:** the *Playing* gate and *Phrase* trigger tell other
  modules when the reply is sounding or has just started.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Mode | Reverse, Invert, Rotate, Mirror, Answer | Reverse |
| Reply | Reverse, Invert, Rotate, Mirror (Answer) | Mirror |
| Length | 2 … 16 notes | 6 |
| Axis | First Note, Mean, Fixed | First Note |
| Axis Note | 0 … 127 (Fixed) | 60 |
| Rotate | −8 … +8 | 1 |
| Start | Trigger, After Gap | After Gap |
| Gap | 1/2 beat, 1 beat, 2 beats, 1 bar, 2 bars | 1 beat |
| Speed | 0.25× … 4× | 1× |
| Transpose | −24 … +24 | 0 |
| Velocity | 0 … 100 % | 100 % |
| Gate Length | 25 … 200 % | 100 % |
| Thru | Pass, Mute | Pass |
| Snap To Scale | Off, On | Off |
| Root, Scale, Harmony | as in the Chord Quantizer | C, Major, Off |

*Mode*, *Length*, *Axis Note*, *Rotate*, *Speed*, *Transpose*, *Velocity* and
*Gate Length* have modulation inputs. Buttons: **Replay** plays the phrase now,
**Clear** forgets it.

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| Notes (in) | notes | The notes to listen to |
| Trig | trigger | Plays the phrase now |
| Notes (out) | notes | What you play (Thru) and the turned phrase |
| Playing | gate | High while a turned phrase sounds |
| Phrase | trigger | A pulse when a turned phrase starts |
