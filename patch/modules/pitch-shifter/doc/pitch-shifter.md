# Pitch Shifter

## Introduction

The Pitch Shifter moves a sound up or down by a musical interval and keeps its rhythm: a vocal an octave up, a pad a fifth down, a guitar doubled at +12 and −12. Unlike the [Freq Shifter](freq-shifter.md), which adds a fixed number of hertz and breaks harmony, the Pitch Shifter multiplies every frequency by the same ratio, so chords stay chords.

Put it in front of a [Verb](reverb.md) and feed the reverb back into it, and every echo climbs another octave: a **shimmer**. The factory cell *Shimmer Verb* is built that way.

## How does it work?

The signal is written into a short delay line. Two read heads sweep through it. A head that moves *against* the writing point reads faster than real time, so it plays higher; one that moves with it reads slower, so lower. A head can only sweep so far, so each one fades out as it nears the end of the *window* and jumps back, while the other, half a window behind, fades in. The two fades are sine-shaped, so one head is always loud.

This is the simple, cheap way to shift pitch. It has a character: the jump of the heads leaves a faint **flutter** at the sweep rate (a few Hz to tens of Hz at big intervals), and the sound is a little "grainy", most on sustained tones. Inside a reverb, that is not heard; on a dry vocal it is a voice. A phase-vocoder shifter is cleaner, but it adds a lot of delay and CPU.

- **Pitch** is the interval in semitones, −24 to +24. Modulating it with an envelope or LFO gives dive bombs and vibrato. **Fine** adds ±100 cents for detuned doubling (+7 and −7 cents on two shifters in parallel is a classic widener).
- **Window** is the length of the delay the heads sweep through, 20 to 340 ms. Short windows follow fast notes and give a tight, buzzy character; long windows are smoother and stretch into an echo. Around 60–100 ms suits most material; 150 ms or more for pads. The shifter's latency is about half a window.
- **Drift** makes the heads wander randomly, slowly: tape-like flutter and a wide, chorused sound. It also works at 0 semitones.
- **Feedback** sends the shifted sound back into the input, softly limited. With +12 semitones every repeat is an octave higher than the one before (a rising spiral), with −12 they fall.
- **Mix** blends the dry input with the shifted sound. At 100 % you hear only the shifted signal.

The left and right sides are separate shifters (with different drift), so the stereo image stays. With only *In L* patched, the signal feeds both sides.

## How to use it?

- **Shimmer:** Pitch +12, Window 100 ms, Mix 100 %, into a Verb, and the Verb's output back to the shifter's input through a Utility at 30–40 %. Or use the *Shimmer Verb* preset.
- **Octave down:** Pitch −12, Mix 50 %, for a sub-octave under a bass or a lead.
- **Harmoniser:** two Pitch Shifters in parallel, +4 and +7 semitones, Mix 40 %, for a major triad on a single note.
- **Wide doubling:** Pitch 0, Fine +12 cents, Drift 30 %, Mix 50 %.
- **Dive bomb:** an envelope onto Pitch, down 24 semitones, Mix 100 %.
- **Spiral:** Pitch +7, Feedback 60 %, Mix 50 %, into a delay: each repeat is a fifth higher.

## Origin

The pitch-shifting algorithm (two crossfading delay-line heads, and the Fun parameter, here called Drift) is from **PitchShifter (DaisySP)** by Electrosmith, [github.com/electro-smith/DaisySP](https://github.com/electro-smith/DaisySP), MIT licence. Bleep's version is rewritten for stereo and our delay line, with a smoothed window size, fine tuning, feedback with a soft clip and a seeded random generator, so offline renders repeat. The original licence text is in this module's `LICENSE` file.
