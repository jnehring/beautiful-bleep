---
title: Concepts
description: Bus, endpoint, output and the other terms the API is built on.
order: 1
---

## Concepts

| Term | Meaning |
|---|---|
| Bus | One shared-memory segment per namespace (`default` unless set). Open one handle per plugin instance, or share one per process. |
| Endpoint | One registered plugin instance, with a stable 64-bit UID that you save in the plugin state. |
| Output | A named signal an endpoint publishes every block. |
| Input | A named destination. It sums all cables into it. |
| Cable | `(source UID, output name, amount)`, stored with the receiving input. |
| Block | One audio callback (≤ 4096 samples), framed by `bb_begin_block` / `bb_end_block`. |

### Signal conventions

| Type | Range | Notes |
|---|---|---|
| `BB_SIGNAL_CONTROL` | −1..+1 (bipolar) or 0..1 (unipolar) | declare polarity per output |
| `BB_SIGNAL_GATE` | high ≥ 0.5 | |
| `BB_SIGNAL_TRIGGER` | single sample of 1.0 | take the max when decimating |
| `BB_SIGNAL_PITCH` | 1.0 per octave, 0 = C4 (MIDI 60) | |

### Latency

A reader gets each source's block for the reader's *previous* block: exactly
one block late, whatever order the host runs the tracks in. That keeps renders
deterministic, including offline export. Don't use the bus for
phase-critical audio.

### Applying modulation

Apply an input as an offset in the parameter's normalised range, inside your
DSP. Never move the host parameter.

```c
float base = knob_normalised;                 /* what the user set */
uint32_t n_sources = bb_read_input(cutoff_in, mod, n);
for (uint32_t i = 0; i < n; ++i) {
    float v = base + mod[i];
    v = v < 0.f ? 0.f : v > 1.f ? 1.f : v;
    cutoff_hz[i] = 20.f * powf(1000.f, v);    /* exponential mapping = octaves */
}
```
