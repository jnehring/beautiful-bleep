# Note Echo

## Introduction

Note Echo sits in a `notes` cable and gives every note an **echo of notes**:
repeats that come later, softer, and not always on the same pitch. Where an
audio delay copies sound, this copies *notes*, so each repeat can be moved
along the board's scale, fanned into a chord, left out at random, or pulled
towards (or pushed away from) the beat grid. The notes out play a Voice Cell
like any other note source.

## How does it work?

When a note starts, Note Echo plans the whole train of repeats at once. The
plan uses the knobs as they are at that moment, so turning a knob changes the
next note, never one that is already echoing.

- **Time.** *Repeats* (1–16) come one *Rate* apart: a note value from 1/1 to
  1/32T at the transport's tempo, or *Free*, where *Time* sets the gap in
  seconds. *Length* is how much of the gap each repeat sounds.
- **Decay.** Each repeat is quieter than the one before by the *Decay* share.
  Repeats that would be inaudible are not played.
- **Scale Steps.** Every repeat moves further along the scale: repeat *k* is
  *k* × *Scale Steps* scale notes above (or below) the played note. The scale
  is the *Root* and *Scale* setting, or the key of a Harmony Master when
  *Harmony* names a bus. In a chromatic scale a step is a semitone. A note
  that is not in the scale is first moved to the nearest scale note.
- **Drop** is the chance, per repeat, that it is left out. It is seeded with
  *Seed* and the note's count, so a render repeats exactly.
- **Spread** (the twist). At 0 the repeats keep to the stepped pitch. Raising
  it adds chord tones, built by stacking thirds in the scale: 25 % adds the
  third, 50 % the fifth, 75 % the seventh, 100 % the ninth. *Fan* decides the
  order the repeats walk through them: *Up*, *Down*, *Up-Down* or *Random*.
  The played note counts as the root, so a three-tone fan on C plays C, E, G,
  C, E … around it.
- **Gravity** (the twist). Positive values pull each repeat towards the nearest
  line of the *Grid* (1/4 … 1/32), at 100 % exactly onto it; negative values
  push it towards the point halfway between two lines. Triplet repeats pulled
  onto a sixteenth grid skip; straight repeats pushed off it lag behind the
  beat. Gravity needs a running transport (without a song position the time
  stays as it is).
- **Original** passes the played note too, or mutes it so only the echoes are
  heard.

Notes of the same number never cut each other off: when a repeat meets a
sounding note of the same pitch, that note ends and the repeat starts again,
and the note-off of the original never ends a repeat.

## How to use it?

- **Tail on a keyboard:** MIDI port → Note Echo → Voice Cell. Try *Rate* 1/8.,
  *Repeats* 5, *Decay* 35 %.
- **Climbing figures:** *Scale Steps* 1 with a short *Length* makes every
  note start a little scale run.
- **Arpeggio from one key:** *Spread* 50 %, *Fan* Up, *Rate* 1/16 and
  *Original* Pass.
- **Sparse and human:** *Drop* 30–50 % gives echoes that differ for each
  note.
- **Groove:** *Rate* 1/8T with *Gravity* 100 % and *Grid* 1/16, or *Gravity*
  −100 % for behind-the-beat repeats. Modulate *Gravity* from an LFO.
- **Rhythmic trigger:** the *Tap* output fires for every repeat that starts;
  use it to trigger drums or envelopes in time with the echoes.
- **Follow the song:** put *Harmony* on a bus and the repeats walk through
  whatever key the Harmony Master plays.

<!-- generated:presets -->
## Presets

The preset bar of the Note Echo view has 16 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Dotted Eighth Tail** | Five fading repeats a dotted eighth apart: the classic rhythmic tail. |
| **Slapback** | One quiet, short repeat right behind the note. |
| **Rising Staircase** | Each repeat is one scale step higher: the note climbs the board's scale. |
| **Falling Cascade** | Each repeat one scale step lower: a tumbling run down the scale. |
| **Triad Fan Up** | Repeats take the chord tones above the note in turn: an arpeggio from one key. |
| **Triad Fan Down** | The same chord tones, falling. |
| **Seventh Ping-Pong** | Four chord tones bounce up and down in triplets. |
| **Random Sparkle** | Fast random chord tones with gaps: glitter around every note. |
| **Sparse Ghosts** | Half the repeats go missing, differently for every note. |
| **Pulled Tight** | Triplet spacing, dragged onto the sixteenth grid: a skipping, almost straight feel. |
| **Off The Grid** | Repeats pushed halfway between the grid lines: behind-the-beat echoes. |
| **Loose Pull** | Gravity at half: repeats drift towards the grid without landing on it. |
| **Free Wash** | Repeats in seconds, not beats, long and overlapping: a wash behind the playing. |
| **Echo Only** | The played note is muted: you hear only its climbing repeats. |
| **Pentatonic Rain** | Climbing repeats in A minor pentatonic: nothing sounds wrong. |
| **Fourths Climb** | Three scale steps per repeat: open, fourth-like leaps. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Repeats | 1 … 16 | 4 |
| Rate | Free, 1/1 … 1/32T | 1/8 |
| Time | 10 ms … 2 s (Rate Free) | 250 ms |
| Decay | 0 … 90 % | 30 % |
| Scale Steps | −7 … +7 | 0 |
| Drop | 0 … 100 % | 0 |
| Length | 5 … 98 % | 50 % |
| Spread | 0 … 100 % | 0 |
| Fan | Up, Down, Up-Down, Random | Up |
| Gravity | −100 … +100 % | 0 |
| Grid | 1/4, 1/8, 1/16, 1/32 | 1/16 |
| Original | Pass, Mute | Pass |
| Seed | 0 … 999 | 1 |
| Root, Scale | any root and scale | C, Major |
| Harmony | Off, Bus A … D | Off |

*Repeats*, *Decay*, *Scale Steps*, *Drop*, *Length*, *Spread*, *Gravity* and
*Time* are knobs with a modulation input.

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| Notes (in) | notes | The notes to echo; controller messages pass through |
| Notes (out) | notes | The original (unless muted) and its repeats |
| Tap | trigger | A pulse for every repeat that starts |
