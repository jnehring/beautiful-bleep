# Note Looper

## Introduction

Note Looper records the **notes** you play, not the sound, and loops them for
one to sixteen bars. Because it keeps notes, you can change a loop after the
fact: quantize it, thin it with probability, play it at half or double speed,
overdub more notes and take the last layer away again. The loop is shown as a
small piano roll and is saved with the board. The notes out play a Voice Cell
like any other note source.

## How does it work?

**The loop** is *Bars* × *Beats Per Bar* quarter notes long. The playhead is
locked to the song position while the transport plays, so the loop always
stays on the beat, also after a jump; with the transport stopped it runs
freely at the tempo. *Speed* **Half** or **Double** makes the head cross the
loop at half or twice the rate. Notes are stored with their position in the
loop and their length, so the loop plays the same at any tempo.

**Mode:**

- **Play:** the loop plays; what you play is heard but not recorded.
- **Record:** the old loop is thrown away and what you play is recorded.
- **Overdub:** what you play is added to the loop. Each time you enter Record
  or Overdub from Play it begins a new *layer*; **Undo** removes the newest
  layer.

A cable into **Rec** is a punch-in: high means Overdub, low means Play, and
the *Mode* setting is ignored while it is patched. **Clear** empties the loop.

A note you hold longer than the loop is cut to the loop's length. A note that
crosses the loop's end sounds on at the start. Shortening *Bars* hides the
notes beyond the end without deleting them; lengthening it brings them back.

**Quantize** moves note starts towards a grid (1/4 … 1/16T) by *Strength*:
100 % puts them on the grid, 50 % halfway. It acts on playback, not on what is
stored, so you can turn it off again. **Probability** is decided for each note
on each pass (seeded by *Seed*, so a render repeats): at 60 % about six in ten
notes play and the loop never sounds quite the same twice.

*Thru* passes what you play to the output, or mutes it until the loop comes
round (what you play is still recorded).

## How to use it?

- **Loop a figure:** *Mode* Record, play two bars, switch *Mode* to Play.
- **Build up layers:** *Overdub*, play a bass line, then a melody. Undo the
  melody if it was not right.
- **Tidy a loose take:** *Quantize* 1/16 at 100 %, or 50 % to keep some feel.
- **Make it breathe:** *Probability* 60–80 % for ghost notes, or a Coin Toss
  into the *Probability* knob.
- **Feed the loop elsewhere:** *Notes* → Note Echo or Melody Mirror, so the
  loop is echoed, reversed or answered.
- **Perform with a pedal:** a button into *Rec* for punch-in overdubbing.
- **Sync outside modules:** *Pass* triggers at every loop start, *Phase* is a
  ramp over the loop, *Recording* is high while it records.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Note Looper does. In the standalone app open **File → Presets…** (⌘P) and pick *Note Looper* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Note Looper: Recorded Groove** | A two-bar bass line, recorded earlier, loops over a beat. Set Mode to Overdub and play along to add notes on top, press Undo to take the last layer off again, or Clear to start over. |
| **Note Looper: Ghost Notes** | A one-bar sixteenth-note figure is played with 55 % Probability, so every pass keeps a different set of its notes. Change Seed for another sequence of passes, or raise Probability to 100 % for the full figure. |
| **Note Looper: Half Speed Drift** | A two-bar tune loops at half speed, so it takes four bars to come round and every note is twice as long. Set Speed to Double or Normal to hear the same notes at other speeds. |
| **Note Looper: Tidied Take** | A loosely played one-bar riff, quantized to sixteenths by a Strength that a slow LFO sweeps from none to full: you hear the take tighten and loosen again. Turn Strength up for a fixed amount, or try Quantize 1/8T. |
| **Note Looper: Loop Into Echo** | A sparse two-bar loop feeds a Note Echo that climbs the scale and fans into chord tones, so a handful of recorded notes becomes a shimmering figure. Mute the Echo's Original or change its Rate to reshape it. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Note Looper view has 15 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Two Bar Loop** | A two-bar loop in play: set Mode to Record and play it in. |
| **One Bar Pulse** | A one-bar loop for short, repeating figures. |
| **Four Bar Phrase** | Four bars: room for a melody that goes somewhere. |
| **Eight Bar Story** | Eight bars for a whole verse of notes. |
| **Overdub Layers** | Records on top of what is already looping; Undo takes the last layer off. |
| **Fresh Take** | Throws the old loop away and records a new one. |
| **Half Speed Drift** | The loop plays at half speed: the same notes, twice as long. |
| **Double Speed Flurry** | The loop at double speed. |
| **Tight Sixteenths** | Notes snap fully to the sixteenth grid. |
| **Loose Eighths** | Notes move halfway to the eighth grid: tidied, but still human. |
| **Triplet Snap** | Everything snaps to triplets. |
| **Ghost Notes** | Each pass plays about 60 % of the notes, differently every time. |
| **Sparse Memory** | A handful of notes per pass: the loop hints at the tune. |
| **Silent Thru** | What you play is recorded but not heard until the loop comes round. |
| **Waltz Loop** | Bars of three beats. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Mode | Play, Record, Overdub | Play |
| Bars | 1 … 16 | 2 |
| Beats Per Bar | 1 … 8 | 4 |
| Speed | Half, Normal, Double | Normal |
| Probability | 0 … 100 % | 100 % |
| Quantize | Off, 1/4, 1/8, 1/16, 1/32, 1/8T, 1/16T | Off |
| Strength | 0 … 100 % | 100 % |
| Thru | Pass, Mute | Pass |
| Seed | 0 … 999 | 1 |

*Bars*, *Probability* and *Strength* have modulation inputs. Buttons:
**Clear**, **Undo**. At most 256 notes fit in a loop.

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| Notes (in) | notes | The notes to record |
| Rec | gate | High: Overdub, low: Play (while patched) |
| Notes (out) | notes | What you play (Thru) and the loop |
| Pass | trigger | A pulse at the start of every pass |
| Recording | gate | High while Record or Overdub is active |
| Phase | control | 0 … 1 across the loop |
