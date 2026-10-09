# Quantizer

![Quantizer in the module view](quantizer.png)

## Introduction

The Quantizer snaps a pitch to the nearest note of a scale. Feed it an LFO,
a random voltage or an envelope, and an oscillator plays a melody that always
fits the key. A trigger on every note change lets the melody play envelopes
too.

## How does it work?

The signal goes through these steps:

1. **Range:** *In* is scaled, so a full-scale LFO (−1 … +1) spans ±*Range*
   octaves.
2. **Transpose** is added. Because this happens before quantizing, the result
   stays in the scale.
3. **Clock** (optional): when patched, the value is only taken on each clock
   pulse and held until the next.
4. **Quantize** to the scale chosen by *Root* and *Scale*. *Rounding* picks the
   nearest note, the one below, or the one above.
5. **Shift** is added after quantizing: a chromatic transposition that may
   leave the scale.
6. **Glide** smooths the jumps between notes.

*Hysteresis* stops flicker: the input has to move a bit past the halfway
point between two notes before the output changes.

*Trigger* fires and *Gate* drops for one millisecond each time the note
changes, so an envelope or *CV to Notes* can start a new note.

To build your own scale, click keys on the keyboard. Clicking a key while
another scale is selected copies that scale and switches *Scale* to
**Custom**, so any scale is a starting point.

## How to use it?

- **Melodies from an LFO:** a slow LFO into *In*, *Out* into an oscillator's
  *Pitch*. Try *Minor Pentatonic*: no wrong notes.
- **Random melodies:** Random into *In*, a clock into *Clock*, *Trigger* into an
  ADSR's gate.
- **Key changes:** a sequencer or another quantizer into *Root In* sets the
  key; everything stays in the new scale.
- **Arpeggios:** a sawtooth LFO into *In* plays the scale upwards.
- **Portamento:** raise *Glide* for slides between notes.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Range | 0 … 4 octaves | 1 octave |
| Hysteresis | 0 … 50 % of a semitone | 10 % |
| Glide | 0 … 2 s | 0 s |
| Root | C … B | C |
| Scale | the Step Sequencer's 17 scales, plus Custom | Major |
| Rounding | Nearest, Down, Up | Nearest |

- **Range:** how many octaves a full-scale input covers in each direction.
  It applies to *In* only.
- **Hysteresis:** how far past the midpoint between two notes the input must
  move before the note changes. 0 is plain quantizing.
- **Glide:** a smoothing time on *Out*. *Trigger* still fires at the change.
- **Root**, **Scale:** the key. *Custom* uses the keys set in the keyboard.
- **Rounding:** *Nearest* rounds to the closest scale note (an exact tie goes
  down), *Down* to the one at or below, *Up* to the one at or above.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In | pitch | The signal to quantize, 1 V/oct (0 = C4) |
| Clock | trigger | Optional: the output changes only on a clock |
| Transpose | pitch | Added before quantizing (stays in the scale) |
| Shift | pitch | Added after quantizing (chromatic) |
| Root In | pitch | Optional: overrides *Root* with this note's pitch class |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | pitch | The quantized pitch, plus *Shift*, after *Glide* |
| Trigger | trigger | A pulse at each note change |
| Gate | gate | Low for 1 ms at each note change, high otherwise |
