# Oscillator

![Oscillator in the module view](oscillator.png)

## Introduction

The Oscillator is the sound source of most patches. It makes a steady tone
whose pitch follows the *Pitch* input. Pick a **Waveform** (sine, triangle,
saw or square) and, if you like, a **Secondary** waveform: the **Morph** knob
crossfades from one to the other. A **sub oscillator** one or two octaves down
adds weight, **Drift** makes the pitch wander a little like an analog
oscillator. An FM section adds linear FM (through zero or not), exponential FM
or phase modulation, and hard sync for bell-like, metallic and tearing sounds.
The sound comes out of one output, *Out*; *Sync Out* gives a pulse at the start
of every cycle, and *Reset* restarts the cycle at *Phase*.

## How does it work?

At its core is a phase that runs from 0 to 1 once per cycle. All waveforms are
read from that same phase, so they are always in step. Saw and square are
band-limited (polyBLEP), so they don't alias in the high register.

**Waveform, Secondary and Morph.** *Out* plays the *Waveform* when *Morph* is
at 0 % (the default) and the *Secondary* waveform at 100 %. In between you hear
a crossfade of the two. Any pair works: sine to square, saw to triangle, or the
same waveform twice (then *Morph* does nothing).

**Pitch.** The **Free** switch picks the pitch mode. Off (the default) is
*Tuned*: the frequency is C4 (261.6 Hz) × 2^pitch, where pitch is the sum of
*Octave*, *Coarse* (semitones), *Fine* (cents) and the *Pitch* input
(1 V/oct: +1.0 is one octave up, 0.0 is C4). On is *Free*: *Coarse* and *Fine*
are set in Hz and there is no *Octave*; the frequency is (Coarse + Fine) ×
2^Pitch input, so the input still follows 1 V/oct. Free *Coarse* starts at
261.63 Hz (C4), so switching over at the defaults keeps the pitch.

**FM.** The *FM* input changes the frequency linearly:
frequency × (1 + 4 × FM Depth × FM). With deep modulation the frequency can go
negative. With **Through-Zero** on (the default) the phase then runs backwards
instead of stopping, so the tone stays in tune even under heavy FM. With
*Through-Zero* off the frequency stops at 0 Hz: classic linear FM, grittier and
drifting off pitch as the depth rises.

**Exponential FM.** With *FM Mode* on *Exponential* the *FM* input moves the
pitch in octaves instead: frequency × 2^(4 × FM Depth × FM), so ±4 octaves at
full depth. The frequency never reaches 0 Hz (*Through-Zero* does nothing
here), and the average pitch rises with the depth, as on analog synths: good
for vibrato, sirens and growling, inharmonic tones.

**Phase modulation.** With *FM Mode* on *Phase* the *FM* input does not
change the frequency at all: it moves the point of the cycle that is read,
by up to ±1 cycle (±360°) at full depth. This is how the DX synthesizers
"FM" really works: the pitch stays exactly in tune whatever the depth, even
with a slow or offset modulator, and bells and electric pianos come out
clean. *Through-Zero* does nothing here.

**Sub oscillator.** **Sub Level** mixes a second waveform one or two octaves
below (**Sub Octave**) into *Out*: a square (band-limited), a sine, or *Main*,
a copy of the main waveform (**Sub Wave**). *Main* follows *Waveform*,
*Secondary*, *Morph* and *Pulse Width*, so a saw gets a saw under it and a
morph sweep moves both. It counts the main oscillator's cycles, so it follows the pitch, FM
and sync exactly. At 100 % the sub is as loud as the main waveform and *Out*
reaches ±2; with phase modulation the sub keeps the steady carrier.

**Drift.** **Drift** detunes the oscillator by a slow random wander, up to
about ±12 cents at 100 %: a slow walk (every few seconds) plus a smaller,
quicker one. Each Oscillator, and each voice of a Voice Cell, wanders its own
way, so two of them drift apart and beat gently. At 0 % (the default) the
pitch is exact.

**Hard sync, Reset and Phase.** With **Hard Sync** on (the default), each rising edge at *Sync*
(the signal crossing 0.5 upwards) restarts the cycle.
Turn it off to ignore the *Sync* input without unplugging it. A rising edge at
**Reset** always restarts the cycle, whatever *Hard Sync* says. Both restart
at **Phase** (0° is the start of the cycle, 90° a quarter in), and the sub
starts over with them. Patch the note gate into *Reset* and every note begins
the same way: a punchy, repeatable attack for basses and kicks.

**Sync Out.** *Sync Out* is high for 1 ms at the start of every cycle (for half
a cycle above 500 Hz). Patch it into another Oscillator's *Sync* to make this
one the master, or use a slow Oscillator (*Free* at a few Hz) as a clock or a
trigger for envelopes.

## How to use it?

- **Basic voice:** Voice In *Pitch* → Oscillator *Pitch*; *Out* → VCA → Voice
  Out. Pick the tone with *Waveform* (the default is a saw).
- **Morphing timbre:** set *Waveform* and *Secondary* to two different waves
  and patch a slow LFO or an envelope onto *Morph*.
- **Transpose:** use *Octave* for whole octaves and *Coarse* for intervals,
  e.g. +7 for a fifth on a second oscillator.
- **Detune:** two oscillators with *Fine* at −7 and +7 cents give a wide,
  chorused sound.
- **Steady beating:** with *Free* on, a fixed offset in Hz beats at the same
  rate on every note: two oscillators with *Fine* at 0 and +1 Hz beat once a
  second, low or high.
- **Fixed frequencies:** *Free* with nothing at *Pitch* gives an exact
  frequency (a 50 Hz hum, a 1 kHz test tone), or a very slow oscillator down
  to 0.1 Hz.
- **Pulse-width modulation:** set *Waveform* to Square and patch a slow
  Function onto *Pulse Width*.
- **FM:** patch a second oscillator (on a sine) into *FM* and raise *FM Depth*.
  Integer ratios between the two (*Coarse* 0, +12, +19) give harmonic tones;
  other ratios give bells and metal.
- **Hard sync:** patch a second oscillator's *Out* (on a square) into *Sync*.
  Set this oscillator higher and sweep its pitch for the classic sync lead.
- **Pitch bend and vibrato:** patch a bend or LFO signal into *Pitch*. For
  ±2 semitones set the cable amount to 2/12 ≈ 17 %.
- **Weight:** raise *Sub Level* for a square an octave down under the main
  waveform; *Sub Octave* −2 and *Sub Wave* Sine for a deep, clean sub bass.
  For a detuned or filtered sub, use a second Oscillator one *Octave* lower
  instead.
- **Analog feel:** *Drift* at 20–40 % on two or three detuned Oscillators: they
  move against each other like a vintage polysynth.
- **Phase modulation:** *FM Mode* Phase, a sine carrier, and a second
  Oscillator on a sine at +12 or +19 *Coarse* into *FM*; an envelope on *FM
  Depth* makes the tone bright on the attack and mellow as it decays.
- **Same attack on every note:** patch the voice's gate into *Reset*; *Phase*
  at 90° on a sine starts at the peak for a click, at 0° from zero for a soft
  start.
- **Master and slave:** this Oscillator's *Sync Out* into a second one's *Sync*
  (with *Hard Sync* on), the second one set higher: no extra cable from the
  master's audio.

<!-- generated:presets -->
## Presets

The preset bar of the Oscillator view has 20 factory presets. Pick one to set the knobs, then change them to taste; your own presets sit next to them. In the board a click on a name below shows it in **Open Project**, where **Load into** sets the Oscillator; on the website it leads to the module's entry in the Bleep Library.

| Preset | What it does |
|---|---|
| **[Bright Saw](/library/detail/?kind=module&slug=oscillator#preset-1)** | The classic sawtooth: a rich, bright starting point for any filter. |
| **[Pure Sine](/library/detail/?kind=module&slug=oscillator#preset-2)** | A clean sine for sub bass, tones and as an FM carrier. |
| **[Soft Triangle](/library/detail/?kind=module&slug=oscillator#preset-3)** | Mellow triangle with only odd, quiet harmonics. |
| **[Hollow Square](/library/detail/?kind=module&slug=oscillator#preset-4)** | A 50 % square: woody, clarinet-like and hollow. |
| **[Reedy Pulse](/library/detail/?kind=module&slug=oscillator#preset-5)** | A narrower pulse with a nasal, reed-like colour. |
| **[Thin Pulse](/library/detail/?kind=module&slug=oscillator#preset-6)** | Very narrow pulse: thin and buzzy, great for chiptune leads. |
| **[Sub Sine](/library/detail/?kind=module&slug=oscillator#preset-7)** | Two octaves down sine for deep, clean sub bass. |
| **[Fat Bass Saw](/library/detail/?kind=module&slug=oscillator#preset-8)** | A saw an octave down, slightly flat: pair it with a second oscillator. |
| **[Triangle To Saw](/library/detail/?kind=module&slug=oscillator#preset-9)** | Half-way between triangle and saw: a soft, round buzz; sweep Morph with an LFO. |
| **[Sine To Square](/library/detail/?kind=module&slug=oscillator#preset-10)** | A sine with some square mixed in: round with a hollow edge; sweep Morph for a filter-like opening. |
| **[Octave Lead](/library/detail/?kind=module&slug=oscillator#preset-11)** | A bright saw-to-square blend one octave up for cutting leads. |
| **[Detuned Fifth](/library/detail/?kind=module&slug=oscillator#preset-12)** | Saw set a fifth up and slightly sharp: layer it with a root oscillator. |
| **[Gentle FM](/library/detail/?kind=module&slug=oscillator#preset-13)** | A sine with the FM input open: patch a modulator in for bell tones. |
| **[Strong FM](/library/detail/?kind=module&slug=oscillator#preset-14)** | Deep through-zero FM for metallic, clangorous timbres. |
| **[Clamped FM](/library/detail/?kind=module&slug=oscillator#preset-15)** | Linear FM that stops at 0 Hz instead of running backwards: grittier, slightly out of tune under deep modulation. |
| **[Exponential FM](/library/detail/?kind=module&slug=oscillator#preset-16)** | FM in octaves: the pitch swings up and down with the modulator, from vibrato to a snarling, inharmonic growl as the depth rises. |
| **[Phase Mod Bell](/library/detail/?kind=module&slug=oscillator#preset-17)** | Phase modulation: patch a sine a few octaves up into FM for DX-style bells and electric pianos that stay in tune at any depth. |
| **[Analog Saw Bass](/library/detail/?kind=module&slug=oscillator#preset-18)** | A saw an octave down with a square sub under it and a little drift: a full, slightly unstable analog bass. |
| **[Sync Sweep Base](/library/detail/?kind=module&slug=oscillator#preset-19)** | Saw for hard sync: patch a gate or a faster oscillator into Sync and sweep Coarse. |
| **[Low Rumble](/library/detail/?kind=module&slug=oscillator#preset-20)** | Very low pulse: use as a drone, or slow rhythmic modulation. |
<!-- /generated -->

<!-- generated:demos -->
## Demo patches

Five whole patches show what Oscillator does. In the standalone app open **File → Presets…** (⌘P) and pick *Oscillator* under *Demos by module*; on the website they are in the [Oscillator entry of the Bleep Library](/library/detail/?kind=module&slug=oscillator#examples), where **Load in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **[Oscillator: Morph Sweep](/library/detail/?kind=module&slug=oscillator#demo-1)** | A bass line on one Oscillator while a slow LFO moves Morph from the triangle (Waveform) to the square (Secondary), so the same note keeps changing colour. Set Morph by hand to freeze the blend, pick other waveforms, or move Pulse Width for a thinner square. |
| **[Oscillator: Hard Sync Sweep](/library/detail/?kind=module&slug=oscillator#demo-2)** | A lead oscillator is reset by the sequencer's gate on every note, while a slow LFO pushes its Coarse tuning upward: the classic tearing sync sweep. Turn Morph toward the square for a hollower bite, or lower the LFO amount for a calmer tone. |
| **[Oscillator: Through-Zero Bells](/library/detail/?kind=module&slug=oscillator#demo-3)** | A second Oscillator frequency-modulates the first through its FM input, and a decaying envelope on FM Depth makes each bell strike bright and then mellow. Change the modulator's Coarse for different bell families, or raise FM Depth for glassier tones. |
| **[Oscillator: Sub Octave Weight](/library/detail/?kind=module&slug=oscillator#demo-4)** | A pulse bass and a second Oscillator on a square one octave down are mixed under a drum loop, with Pulse Width moving slowly for a hollow, breathing bass. Mute the Sub channel on the mixer to hear how much weight it adds. |
| **[Oscillator: Three-Voice Pad](/library/detail/?kind=module&slug=oscillator#demo-5)** | Three Oscillators a few cents apart play slow chord roots, one pushed a fifth up, and a reverb spreads them wide. Change Fine on any oscillator for faster beating, or Morph for a brighter or softer pad. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Free | on / off | off (Tuned) |
| Octave (Tuned) | −3 … +3 | 0 |
| Coarse (Tuned) | −12 … +12 st | 0 st |
| Fine (Tuned) | −100 … +100 ct | 0 ct |
| Coarse (Free) | 0.1 Hz … 20 kHz | 261.63 Hz |
| Fine (Free) | −10 … +10 Hz | 0 Hz |
| Waveform | Sine, Triangle, Saw, Square | Saw |
| Secondary | Sine, Triangle, Saw, Square | Square |
| Morph | 0 – 100 % | 0 % |
| Pulse Width | 5 – 95 % | 50 % |
| FM Depth | 0 – 100 % | 0 % |
| FM Mode | Linear, Phase, Exponential | Linear |
| Through-Zero | on / off | on |
| Hard Sync | on / off | on |
| Phase | 0 … 360° | 0° |
| Sub Level | 0 – 100 % | 0 % |
| Sub Octave | −1, −2 | −1 |
| Sub Wave | Square, Sine, Main | Square |
| Drift | 0 – 100 % | 0 % |

- **Free:** the pitch mode. Off, *Tuned*: *Octave*, *Coarse* in semitones and
  *Fine* in cents, from C4. On, *Free*: *Coarse* and *Fine* in Hz, no *Octave*.
  The view shows the knobs of the mode it is in.
- **Octave:** (Tuned) shifts the pitch by whole octaves. At 0 and with nothing at
  *Pitch*, the oscillator plays C4.
- **Coarse:** (Tuned) shifts the pitch in semitones. As a modulation destination it
  covers 24 semitones over the knob's full travel.
- **Fine:** (Tuned) shifts the pitch in cents (1/100 semitone), for detuning and tuning
  against other instruments.
- **Coarse (Free):** the frequency in Hz, on an exponential knob from 0.1 Hz
  to 20 kHz.
- **Fine (Free):** added to *Coarse* in Hz, ±10 Hz, for beating at a fixed
  rate. The sum never goes below 0 Hz.
- **Waveform:** the waveform at *Out* while *Morph* is at 0 %.
- **Secondary:** the waveform at *Out* when *Morph* is at 100 %.
- **Morph:** crossfades from *Waveform* (0 %) to *Secondary* (100 %).
  Modulating it gives an evolving timbre.
- **Pulse Width:** the duty cycle of the square, wherever the square is heard.
  50 % is a hollow square; narrow pulses sound thin and nasal. It doesn't
  affect the other waveforms.
- **FM Depth:** how strongly the *FM* input moves the frequency. At 100 % an
  FM signal of ±1 swings the frequency by ±4 times its base value (linear) or
  by ±4 octaves (exponential). With nothing at *FM* the knob does nothing.
- **FM Mode:** *Linear* (frequency × (1 + 4 × depth × FM), tuned FM tones),
  *Phase* (phase modulation: the read position moves by ±depth × FM cycles,
  the pitch never moves) or *Exponential* (pitch in octaves, as on analog
  synths).
- **Through-Zero:** linear FM only: on, negative frequencies run the phase backwards (stays in
  tune); off, the frequency stops at 0 Hz.
- **Hard Sync:** whether rising edges at *Sync* restart the cycle.
- **Phase:** where *Reset* and *Sync* restart the cycle, 0° to 360°.
- **Sub Level:** how much of the sub oscillator is added to *Out*. At 0 %
  there is none.
- **Sub Octave:** the sub one or two octaves below the main pitch.
- **Sub Wave:** a square (hollow and full), a sine (clean and deep) or *Main*
  (the main waveform, Morph and Pulse Width included, an octave or two down).
- **Drift:** the slow random pitch wander, up to about ±12 cents at 100 %.

Knobs (*Coarse*, *Fine* in both modes, *Morph*, *Pulse Width*, *FM Depth*,
*Phase*, *Sub Level*, *Drift*) are modulation destinations; *Octave*, the
waveforms, *FM Mode*, *Sub Octave*, *Sub Wave* and the three switches can be set by a
cable from a Dial or a toggle.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Pitch | pitch, 1 V/oct | Tuned: added to Octave, Coarse and Fine (0.0 = C4); Free: multiplies Coarse + Fine by 2^Pitch |
| FM | audio | linear or exponential frequency modulation or phase modulation (*FM Mode*), scaled by *FM Depth* |
| Sync | gate | with *Hard Sync* on, each rising edge restarts the cycle at *Phase* |
| Reset | trigger | each rising edge restarts the cycle at *Phase*, also with *Hard Sync* off |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out | audio | *Waveform* crossfaded toward *Secondary* by *Morph*, plus the sub at *Sub Level*: −1 … +1, up to ±2 with the sub |
| Sync Out | gate | high for 1 ms (at most half a cycle) at the start of every cycle |

Boards saved before the Oscillator had *Waveform*, *Secondary* and *Morph*
load with the same sound: the old *Shape* position becomes the matching pair
of waveforms and *Morph*. A cable from one of the old waveform outputs (*Sine*,
*Triangle*, *Saw*, *Square*) moves to *Out* with that waveform selected; a
cable from the old *Sub* output is removed (turn up *Sub Level* instead).
Boards saved when *FM Mode* had only Linear and Exponential keep their mode.
