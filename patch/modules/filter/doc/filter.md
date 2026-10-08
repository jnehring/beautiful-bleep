# Multi Filter

## Introduction

The Multi Filter shapes the tone of a sound by removing or emphasising
frequencies. It's stereo and has a low-pass, band-pass, high-pass and notch
response that you can morph between continuously. It comes with drive,
key tracking and two filter algorithms with different characters. An envelope
output tells the rest of the patch how loud the filtered signal is.

## How does it work?

The core is a **state-variable filter**, which produces all four responses at
once. The *Mode* knob crossfades between them:

    LP (0 %) → BP (33 %) → HP (67 %) → Notch (100 %)

- **Cutoff** sets where the filter acts. The knob is exponential: 20 Hz at the
  bottom, 20 kHz at the top, about ten octaves in total. Modulation therefore
  works in octaves: a cable at 10 % moves the cutoff by about one octave,
  whatever the cutoff is.
- **Resonance** boosts the frequencies around the cutoff (Q from 0.5 to 25).
- **Drive** saturates the input before the filter (a soft tanh curve) for
  warmth and grit.
- **Key Track** moves the cutoff with the *Pitch* input, so high notes are as
  bright as low ones.
- **Mix** blends the dry input with the filtered signal.

Two algorithms, chosen with **Type**:

- **Clean:** a zero-delay-feedback state-variable filter. It stays stable and
  click-free under fast modulation, even at audio rate.
- **Rough:** a gritty 12 dB filter. Its stages saturate, so it growls when
  driven and stays bounded when pushed into self-oscillation. It drives harder
  than Clean at the same *Drive* setting.

The **Env** output follows the level of the filtered signal (fast 5 ms
attack, 120 ms release).

The view shows the filter's response curve. It is drawn from the modulated
values, so you can see it move.

## How to use it?

- **Subtractive synth:** Oscillator *Out* → Filter *In L* → VCA. Start with
  *Mode* at LP, *Cutoff* around 1 kHz and some *Resonance*.
- **Filter envelope:** patch an ADSR's *Env* onto **Cutoff**. The cable amount
  sets how many octaves the envelope opens: 30 % ≈ 3 octaves.
- **Key tracking:** patch Voice In *Pitch* into *Pitch* and set *Key Track*
  to 100 %. The cutoff then follows the keyboard one octave per octave.
- **Filter sweeps:** patch a slow Function or Random onto *Cutoff*, or onto
  *Mode* for a sweep from low-pass to high-pass.
- **Process a track:** route a track's audio onto the board with an input
  port, through the filter, and back out with an output port.
- **Sidechain-style movement:** patch *Env* onto another module, e.g. a pad's
  cutoff or a VCA's gain with a negative amount, so it reacts to this signal.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Cutoff | 20 Hz – 20 kHz | 2 kHz |
| Resonance | 0 – 100 % | 20 % |
| Drive | 0 – 100 % | 0 % |
| Mode | LP → BP → HP → Notch | LP |
| Mix | 0 – 100 % | 100 % |
| Key Track | 0 – 100 % | 0 % |
| Type | Clean, Rough | Clean |

- **Cutoff:** the corner (LP, HP) or centre (BP, notch) frequency. Exponential
  over ten octaves; 10 % of modulation ≈ one octave.
- **Resonance:** emphasis at the cutoff. Low values are smooth; high values
  ring and whistle. *Rough* gets close to self-oscillation at the top.
- **Drive:** how hard the input is saturated before filtering. At 0 % the
  signal is untouched. Turn down the source level if you want drive without
  much extra loudness.
- **Mode:** the response, morphed continuously:
  0 % low-pass (removes highs), 33 % band-pass (keeps a band around the
  cutoff), 67 % high-pass (removes lows), 100 % notch (removes a band).
- **Mix:** dry/wet. 100 % is only the filter; lower values mix the
  unfiltered input back in. The response curve shows the result.
- **Key Track:** how far the cutoff follows the *Pitch* input. At 100 % the
  cutoff moves one octave per octave of pitch; at 50 %, half an octave. No
  effect when *Pitch* is unpatched.
- **Type:** the filter algorithm (see above). Not modulatable.

All knobs are modulation destinations.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In L | audio | left input; also feeds the right channel when *In R* is not patched |
| In R | audio | right input |
| Pitch | pitch, 1 V/oct | moves the cutoff, scaled by *Key Track* |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out L | audio | filtered left channel |
| Out R | audio | filtered right channel |
| Env | control, 0 – 1 | envelope follower on the filtered output |
