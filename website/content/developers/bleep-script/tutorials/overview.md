---
title: Tutorials
description: Worked examples for Bleep Script: a step sequencer, drive with anti-aliasing, smoothing, sample and hold, every kind of input, and the usual DSP building blocks.
order: -10
---

# Tutorials

Each tutorial builds a complete module that you can paste into a Code node and compile. They go from a bigger project to small techniques; if you are new to this, start with the sine oscillator; read [Rates and timing](../rates.md) first, since every one of them depends on it.

| Tutorial | You build | You learn |
|---|---|---|
| [A simple sine oscillator](sine-oscillator.md) | A sine from a phase accumulator, with a pitch input, tuning and a lookup-table version | Phase, `f64`, volts per octave, block rate against sample rate |
| [An advanced oscillator](advanced-oscillator.md) | Four waveforms with PolyBLEP, pulse width, FM and hard sync | Anti-aliasing a jump, per-sample FM, edge-triggered sync |
| [An 8-step, 4-lane step sequencer](step-sequencer.md) | Four gate lanes that follow the tempo or a clock input | `@transport`, edge handlers, counted outputs, a layout |
| [Preventing pops and clicks](smoothing.md) | A gain, a mute and a low-pass that never click | Smoothing, block rate against sample rate |
| [Drive with anti-aliasing](drive.md) | A soft clipper that aliases much less | Aliasing, ADAA, oversampling |
| [Sample and hold](sample-and-hold.md) | A sample and hold, with the generated UI and with a self-made UI | Triggers, a layout, a custom canvas UI |
| [Processing different inputs](inputs.md) | An envelope follower, a transposer, a gate envelope and a note converter | Audio, pitch, gate, trigger and notes inputs |
| [A synth voice](synth-voice.md) | A supersaw voice with a ladder filter, an ADSR, notes and a chorus | The `bleep/osc`, `filters`, `env` and `fx` libraries, block-rate modulation |
| [The DSP toolbox](dsp-toolbox.md) | An oscillator, noise, a delay, a pan, a clock divider and a tempo LFO | The usual building blocks |

Every code block marked as a module compiles as shown. The documentation tests compile them and, for the larger ones, run them: the step sequencer's timing, the drive's aliasing, and the others' behaviour are checked, so what you read is what the module does.
