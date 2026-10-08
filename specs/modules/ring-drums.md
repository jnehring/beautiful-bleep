# Ring Drums

Node types `ring-kick`, `ring-snare`, `ring-clap`, `ring-tom`, `ring-rim`,
`ring-cowbell`, `ring-hats`, `ring-cymbal` · category *Drums* · colour
`#f59e0b`

## 1. Purpose

A drum kit, one node per instrument, built from the techniques of the classic
analog drum machines of the early eighties: struck resonators (kick, toms,
snare heads, rim, clave), band-passed noise (snare, clap) and six detuned
square waves for the metal (cowbell, hats, cymbal). Deep, round and a little
soft. Its sibling, `punch-drums.md`, is the tight, hard kit.

## 2. Jacks

Every drum node has the same outside (`patch/engine/DrumModule.h`):

| Jack | Type | What it does |
|---|---|---|
| Trig (in) | `trigger` | A rising edge (≥ 0.5) plays the voice. Ring Hats has *Closed* and *Open* instead. |
| Velocity (in) | `control` | Read at the trigger, clamped 0…1; unpatched = 1. |
| Out (out) | `audio` | The drum, mono. |

## 3. Controls

Every node ends with **Level** (0–100 %, default 80 %), multiplied into *Out*.

| Node | Knobs (default) | Settings |
|---|---|---|
| Ring Kick | Tune 30–120 Hz (50), Decay 50 ms–3 s (0.8 s), Sweep (30 %), Tone (30 %), Drive (0 %) | — |
| Ring Snare | Tune 100–400 Hz (180), Tone (50 %), Snappy (60 %), Decay 50 ms–1 s (250 ms) | — |
| Ring Clap | Tone 0.5–4 kHz (1.1 k), Decay 50 ms–1.5 s (300 ms), Spread 3–30 ms (11 ms) | Bursts 1–6 (4) |
| Ring Tom | Tune 50–600 Hz (140), Decay 50 ms–2 s (400 ms), Bend (30 %), Noise (30 %) | — |
| Ring Rim | Tune ±12 st (0), Decay ×0.25–×4 (×1) | Voice: Rim, Clave |
| Ring Cowbell | Tune ±12 st (0), Decay 50 ms–2 s (400 ms), Tone (50 %) | — |
| Ring Hats | Tune ±12 st, Closed Decay 10–300 ms (60 ms), Open Decay 50 ms–3 s (500 ms), Tone (50 %) | — |
| Ring Cymbal | Tune ±12 st, Decay 0.3–8 s (2 s), Tone (50 %) | — |

Decays are T60 (time to fall by 60 dB).

## 4. Behaviour

**Building blocks** (`patch/common/dsp/Drums.h`, shared with the Punch drums):

- *Resonator:* a complex one-pole (a rotating, decaying phasor). A strike adds
  to its state; the output starts as a sine at zero phase. Its amplitude is
  independent of frequency, so the pitch can sweep while it rings, and a
  second strike adds to the ringing as in a real resonant circuit.
- *Decay:* exponential envelope, T60 in seconds.
- *Square:* polyBLEP square; *Metal:* six free-running squares at 205.3,
  304.4, 369.6, 522.7, 540 and 800 Hz (scaled by *Tune*).
- *Clap:* white noise through a band-pass, opened by *Bursts* bursts *Spread*
  apart (each decays within its slot), the last one also starting a tail of
  T60 *Decay*.

**Voices** (`patch/modules/ring-drums/dsp/RingDrumsDsp.h`):

- *Kick:* resonator at Tune·(1 + 1.5·Sweep·e), e a 90 ms decay; plus a click
  (4 ms decay, low-passed at 0.4–4.4 kHz by *Tone*); soft clip by *Drive*.
- *Snare:* resonators at Tune and 1.84·Tune, blended by *Tone*, T60
  ≈ Decay/2 (50–400 ms); white noise high-passed at 1.8 kHz, low-passed at
  9 kHz, level *Snappy*, T60 *Decay*.
- *Tom:* resonator at Tune·(1 + 0.5·Bend·e), e falling over *Decay*; noise
  low-passed at 10·Tune, T60 0.4·Decay, level *Noise*.
- *Rim:* resonators at 455 and 1667 Hz (35 / 25 ms ×Decay), high-passed and
  saturated. *Clave:* one resonator at 2450 Hz (90 ms ×Decay).
- *Cowbell:* squares at 540 and 800 Hz, band-pass 0.7–2.8 kHz by *Tone*;
  envelope 70 % with 35 ms decay + 30 % with *Decay*.
- *Hats:* metal → band-pass 8 kHz → envelope → high-pass 5–10 kHz by *Tone*.
  Closed and Open share one envelope, so a closed hit chokes an open one.
- *Cymbal:* metal → band-pass 3.4 kHz (T60 0.4·Decay) and high-pass 8 kHz (T60
  Decay), balanced by *Tone*.

**Velocity** scales the strike. Where a voice saturates (kick, rim) the signal
is divided by the hit's velocity before the saturation and multiplied after,
so velocity changes loudness, not timbre.

**Levels:** at velocity 1 and default knobs every voice peaks between about
0.5 and 1.0 before *Level*.

**Retriggering:** resonators add to their ringing; envelopes restart.

Triggers are read per sample, so hits are sample-accurate.

## 5. Module view

The generic view. No custom view.

## 6. Saved state

Knob values only.

## 7. Engine requirements

None. `DrumModule<Voice, Triggers>` adapts a voice to `Module` (trigger edges,
velocity, *Level*).

## 8. Tests

- `test_dsp` *drums*: each voice is silent before the trigger, peaks between
  0.3 and 1.5, has fallen by 60 dB by the end of the run, and at velocity 0.25
  plays between 5 % and 60 % as loud. Ring Kick and Ring Tom ring at *Tune*
  without sweep/bend; Ring Kick's ring time follows *Decay*; a closed hat
  chokes an open one; the clap plays four separate bursts; `reset()`
  silences a voice.
- `engine_test` *drumNodes*: every *Drums* node through its real jacks:
  silent until triggered, each trigger input plays, it dies away, Velocity
  0.25 is 10–40 % as loud, Level 0 is silent.

## 9. Later

- Choke groups across nodes (e.g. a separate open hat node).
- A *Pitch* input with 1 V/oct tracking on the tuned voices.
- Maracas and a dedicated hand-drum (conga) voice.
- A drum-kit preset cell with sequencers.
