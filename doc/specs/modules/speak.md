# Speak

Type id `speak` · category *Sources/Voices* · colour `#fb923c`

## 1. Purpose

A small cascade-formant speech synthesiser sequenced from a phoneme string.
Musical character first, intelligibility second, fully deterministic.

## 2. Jacks

Inputs: Pitch (pitch), Go (gate). Outputs: Out (audio), Sound (trigger),
Voiced (gate), Position (control 0–1).

## 3. Controls

Speed (1–40 units/s, exponential), Pitch (st), Fine (ct), Formant (st),
Breath, Intonation, Glide, Level are modulatable; Mode (Loop, Gate, Step) is a setting.

## 4. Behaviour

4.1 Text → segments (`speak::parse`, message thread): longest-match symbols
from a 36-entry table (10 vowels, 3 nasals, 4 glides, 4+4 fricatives, `h`,
3+3 stops, `ch`, `j`); `'` accents the next sound (×1.3 voice, +3 st
before Intonation, ×1.2 length), `:` lengthens the previous ×1.8, space/`.`
is a pause of 1 unit, `,`/`-` of 0.5, `_` separates. At most 256 segments.

4.2 Voice (audio thread). Source: PolyBLEP saw through a one-pole tilt, plus
`Breath × 0.35 × noise`, times a smoothed voicing amplitude. Cascade of five
two-pole resonators (formants F1–F3 glide at 4 – 49 ms depending on Glide,
F4, F5 fixed at 3.6 and 4.7 kHz × the formant shift). Noise: seeded
`WhiteNoise` (fixed seed on reset), differentiated, through one resonator
at the sound's band (or, for `h`, into the cascade).

4.3 Timing. Segment length = table duration × length multiplier / Speed. Stops
have closure (55 % of the segment, 35 % for affricates), burst (10 %) and
aspiration. Edges fade over a few milliseconds through the amplitude smoothers.

4.4 Modes: Loop restarts at the end; Gate starts at a rising edge of Go, plays
once, stops when the gate falls; Step advances one segment per rising edge
and holds steady sounds while the gate is high after 60 % of the segment.

4.5 Pitch contour: declination of −2 st across the text and +3 st on accents,
scaled by 2 × Intonation and smoothed.

## 5. Module view

A text box for the phoneme string, a progress bar through the sounds and a
symbol key.

## 6. Saved state

Node data `{"text": "<up to 400 characters>"}`.

## 7. Engine requirements

None.

## 8. Tests

`tests/test_speak.cpp`: parser (digraphs, accents, lengthening, pauses,
separator, junk, limit); repeatability; formant energy of `a` against `ee`
and the effect of Formant; silence in a plosive closure and a high noisy `s`;
Gate and Step modes; bounds over all sounds, speeds and pitches.

## 9. Later

Spelling-to-sound rules, stress marks per word, a second voice for duets.
