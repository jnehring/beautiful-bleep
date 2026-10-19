# Speak

## Introduction

Speak is a small speech synthesiser in the old, characterful sense: a buzzing
voice or a hiss pushed through a few resonant filters that imitate a mouth.
You write what it says as a string of sounds, set how fast it goes, and it
mumbles, hums or chatters it, in pitch if you play it. It is made for
musical use: robotic choirs, vowel melodies, spoken rhythm, and odd
consonant percussion. The speech is deliberately rough; the output is the same
every time.

## How does it work?

**Text.** The text is a string of sound symbols, not spelling:

| Group | Symbols |
|---|---|
| vowels | `a` (father) `e` (bed) `i` (bit) `o` `u` (put) `ee` (feet) `oo` (boot) `ae` (cat) `uh` (cup) `er` |
| nasals and glides | `m n ng` · `l r w y` |
| hisses | `s sh f th h` and voiced `z zh v dh` |
| stops | `p t k` and voiced `b d g` · `ch j` |
| marks | `'` accent the next sound · `:` lengthen the last · space or `.` pause · `,` or `-` short pause · `_` separate letters |

Upper case works; anything else is skipped. `ae` is one vowel, `a_e` is two.
Up to 256 sounds are kept. The text is parsed when you edit it and is saved
with the node.

**The voice.** Voiced sounds (vowels, nasals, glides, the voiced hisses and
stops) start from a band-limited pulse train at the pitch, tilted so the
highs are softer, with a little noise (*Breath*) mixed in. It goes through
five resonators in a row: three that slide to each sound's own formant
frequencies, and two fixed ones for brightness. Hisses and the bursts of stops
are noise through one band that is moved to the right place for each sound
(an `s` high and narrow, `sh` lower, `f` and `th` wide and quiet); `h`
is noise through the mouth filters themselves. A stop is a closure (silent, or
a faint hum for `b d g`), a short burst and a puff of aspiration.

**Time.** Every sound has its own length in units; a unit lasts 1/*Speed*
seconds (so at 8 u/s a vowel is about 150 ms). *Glide* sets how fast the
formants slide from one sound to the next: low is clipped and consonantal,
high is a smooth, vowel-like blur. *Formant* shifts all formants up or down in
semitones: down for a giant, up for a child, with the pitch left alone.

**Pitch.** *Pitch* (and *Fine* and the Pitch jack, 1 V/oct) set the voice's
pitch. *Intonation* adds a gentle fall over the text and a lift on accented
sounds: at 0 it is a monotone, which is what you want for singing.

**Modes.** *Loop* speaks the text over and over. *Gate* speaks it once
each time *Go* rises and stops when it falls. *Step* speaks one sound at each
rising edge of *Go*; steady sounds (vowels, nasals, hisses) are held for as
long as the gate stays high, so a short gate gives a clipped sound and a long
gate sustains it: a sequencer plays the words one by one.

**Outputs.** *Sound* gives a trigger at the start of every sound (not for
pauses); *Voiced* is a gate that is high while the voice buzzes, *Position*
is how far through the text it is, 0 – 1.

## How to use it?

- **A robot singer:** *Mode* Loop, *Intonation* 0, a sequencer into *Pitch* and
  a slow *Speed*; text `'a ee oo o`.
- **Spoken rhythm:** short words of stops and hisses (`t k t ch . sh t k`),
  *Speed* 12 – 20, *Glide* low, as a hat or snare layer.
- **Words on a keyboard:** *Mode* Step, notes into *Pitch*, the keyboard's gate
  into *Go*: every key plays the next sound.
- **A choir:** two or three Speak modules on the same vowels at different
  *Pitch* and *Formant*, through a reverb.
- **Voiced clock:** *Sound* clocks a drum or an envelope.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Speak does. In the standalone app open **File → Presets…** (⌘P) and pick *Speak* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Speak: Robot Choir** | Sustained vowels on a slowly moving bass line, with no intonation, so the voice sings like a mechanical choir. Change the text to other vowels, raise Glide for smoother changes, or move Formant for a bigger or smaller singer. |
| **Speak: Spoken Beat** | Hisses and stops spoken fast over a drum loop, a percussive layer made only of consonants. Change the text for another rhythm or lower Speed to hear the individual sounds. |
| **Speak: Step Words** | Mode is Step: every note from the sequencer says the next sound of the text, on the note's pitch, so the tune spells out a phrase. Lengthen the gates to hold the vowels or change the text. |
| **Speak: Giant and Child** | Two voices say the same words at different speeds, one with its formants pulled down and one pushed up, so a giant and a child talk over each other. Change Formant on either voice. |
| **Speak: Vowel Sweep** | One long note while a slow LFO moves Formant up and down and the text walks through all the vowels: a singing, shifting drone. Move Glide for blur or Breath for a husky edge. |
<!-- /generated -->

<!-- generated:presets -->
## Presets

The preset bar of the Speak view has 13 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them.

| Preset | What it does |
|---|---|
| **Hello World** | A greeting, loosely. |
| **Robot Choir** | Sustained vowels on one note: a mechanical choir. |
| **Mumble** | A blurred, low conversation. |
| **Hat Talk** | Hisses and stops as percussion. |
| **Giant** | Formants down: a huge, slow voice. |
| **Child** | Formants and pitch up: a small voice. |
| **Whisper** | All breath and little voice. |
| **Vowel Walk** | Every vowel in turn: a sweeping formant tune. |
| **Nasal Hum** | Long nasals and open vowels. |
| **Stutter** | Plosive stutters into a rising vowel. |
| **Spoken Bass** | A low, pulsing talk: layer it with a bass. |
| **Yes No** | Two short words with a lift at the end. |
| **Step Words** | Step mode: send gates into Go to play one sound at a time. |
<!-- /generated -->

## Reference

### Inputs and outputs

| Jack | Signal | What it does |
|---|---|---|
| Pitch | pitch | 1 V/oct, 0 = C4, added to *Pitch* and *Fine* |
| Go | gate | starts (Gate), steps (Step) or is ignored (Loop) |
| Out | audio | the voice |
| Sound | trigger | a new sound started |
| Voiced | gate | the voice is buzzing |
| Position | control | 0 – 1 through the text |

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Speed | 1 – 40 u/s | 8 |
| Pitch | −36 … +24 st | −12 |
| Fine | ±100 ct | 0 |
| Formant | ±12 st | 0 |
| Breath | 0 – 100 % | 15 % |
| Intonation | 0 – 100 % | 50 % |
| Glide | 0 – 100 % | 50 % |
| Level | 0 – 100 % | 70 % |
| Mode | Loop, Gate, Step | Loop |
