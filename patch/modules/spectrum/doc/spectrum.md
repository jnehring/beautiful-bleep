# Spectrum

## Introduction

Spectrum shows which frequencies are in a sound, low on the left and high on the right, with the
frequency axis spaced the way you hear it. It also listens for you: the **strongest partial**, the
**centroid** (how bright the sound is) and a **flux** trigger (a new sound has arrived) come out as
signals. The audio passes through unchanged.

## How does it work?

**The picture.** The sound is cut into short windows and analysed several times per window length;
each analysis updates the curve. *Resolution* chooses the window: a long one separates close partials
and low notes but reacts slowly, a short one is quick but blurry. *Average* smooths the curve over
time so it stops flickering. The *Peak Line* keeps the highest levels: *Falling* lets them sink
slowly, *Hold* keeps them until you press **Reset Peaks**. *Tilt* leans the curve by a number of
decibels per octave, which only changes how it looks: +4.5 dB per octave makes a pink noise look flat.
*Floor* is the bottom of the picture.

**Strongest.** The loudest partial between 20 Hz and the top of the axis, found precisely between the bins. It
comes out of **Dominant** as a pitch signal (1 V/oct, 0 is middle C) and is shown in Hz and as a note name. When the
input falls below −60 dBFS, Dominant holds its last value.

**Centroid.** The centre of gravity of the spectrum, from the same average. A sine has its centroid at its
pitch; adding harmonics pulls it up. Patch it into a filter cutoff to make a brightness follower.

**Flux.** Each analysis is compared with the one before. When much more energy than usual has arrived
(a new note, a drum hit) **Flux** sends a short pulse and **Flux Amount** shows how much changed. *Flux Sensitivity*
sets how little is enough; a steady tone triggers nothing.

## How to use it?

- **Look at a patch:** put a Spectrum anywhere in an audio path; at Average 0.15 s it follows the sound smoothly.
- **A tuner:** an instrument into In L, **Dominant** into a Quantizer: it snaps to the note the instrument plays.
- **Brightness follower:** **Centroid** into a Math module (to scale it) and on to a filter or a reverb mix.
- **Onset trigger:** **Flux** as a clock for a sequencer or an envelope: it follows what is played, even when the notes are soft.
- **Find a resonance:** switch *Peak Line* to Hold, sweep a filter's cutoff and read where the curve rose.

<!-- generated:demos -->
## Demo patches

Five whole patches show what Spectrum does. In the standalone app open **File → Presets…** (⌘P) and pick *Spectrum* under *Demos by module*; on the website, **Run in Play** opens one in your browser. Loading one replaces the project and starts the transport.

| Patch | What it shows |
|---|---|
| **Spectrum: The Band at a Glance** | A small band plays through the Spectrum: the kick and bass fill the left, the lead and hats the right, and the dashed line follows the strongest partial. Change Tilt to +4.5 dB/oct to flatten the slope, or Peak Line to Hold to keep the highest marks. |
| **Spectrum: Siren to Bells** | A quiet siren glides up and down; the Spectrum's Dominant output hears its strongest partial and a Quantizer turns that into bell notes of a minor scale, struck whenever the note changes. Change the Quantizer's Scale, or slow the siren down. |
| **Spectrum: Brightness Drives the Pad** | A drum loop is analysed and its Centroid, the spectrum's centre of gravity, sets the filter cutoff of a saw pad: when hats and snares crowd in the pad opens, when only the kick is left it dulls. Turn the pad filter's Key Track down to lessen the effect. |
| **Spectrum: Flux Plays the Hats** | Plucked notes go through the Spectrum, whose Flux trigger fires whenever new energy appears: it plays a closed hat and a rim click on every note, so the percussion follows the melody. Raise Flux Sensitivity to catch the quiet notes too. |
| **Spectrum: Sweeping Pad, Tilted** | A saw pad with a slowly sweeping filter, seen on a long 8192 point average with the Tilt at +4.5 dB/oct so the slope looks level and the peak line stays up in Hold. Press Reset Peaks to clear the line, or lower Average for a jumpier picture. |
<!-- /generated -->

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Resolution | 1024, 2048, 4096, 8192 | 4096 |
| Average | 0 – 3 s | 0.15 s |
| Tilt | −6 … +9 dB/oct | 0 |
| Peak Line | Off, Falling, Hold | Falling |
| Flux Sensitivity | 0 – 100 % | 50 % |
| Floor | −120 … −30 dB | −90 dB |

Button: **Reset Peaks**.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| In L, In R | audio | analysed as their average; R unpatched: L alone |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| Out L, Out R | audio | the inputs, unchanged |
| Dominant | pitch | the strongest partial |
| Centroid | pitch | the spectrum's centre of gravity |
| Flux | trigger | new energy arrived |
| Flux Amount | control | how much is new, 0 – 1 |
