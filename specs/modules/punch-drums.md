# Punch Drums

Node types `punch-kick`, `punch-snare`, `punch-clap`, `punch-tom`,
`punch-rim`, `punch-hats`, `punch-cymbal` · category *Drums* · colour
`#f43f5e`

## 1. Purpose

A drum kit, one node per instrument, built from the techniques of the drum
machines of the mid eighties: sine oscillators that restart on every hit and
sweep down fast, with a noise click (kick, snare body, toms), filtered noise,
and bright metal with an optional early-sampler crunch for hats and cymbals.
Tight, hard and forward. Its sibling, `ring-drums.md`, is the deep, round kit.

## 2. Jacks

The same as the Ring drums (`ring-drums.md` section 2): *Trig* (Punch Hats:
*Closed*, *Open*), *Velocity*, *Out*.

## 3. Controls

Every node ends with **Level** (0–100 %, default 80 %).

| Node | Knobs (default) | Settings |
|---|---|---|
| Punch Kick | Tune 30–120 Hz (50), Decay 50 ms–2.5 s (600 ms), Sweep (50 %), Attack (50 %), Drive (30 %) | — |
| Punch Snare | Tune 120–400 Hz (200), Tone (50 %), Snappy (60 %), Decay 50 ms–1 s (300 ms) | — |
| Punch Clap | Tone 0.5–4 kHz (1.5 k), Decay 50 ms–1.5 s (350 ms), Spread 3–30 ms (8 ms) | Bursts 1–6 (4) |
| Punch Tom | Tune 50–500 Hz (110), Decay 50 ms–2 s (450 ms), Bend (50 %), Noise (20 %) | — |
| Punch Rim | Tune ±12 st (0), Decay ×0.25–×4 (×1) | — |
| Punch Hats | Tune ±12 st, Closed Decay 10–300 ms (50 ms), Open Decay 50 ms–3 s (400 ms), Tone (50 %), Crunch (40 %) | — |
| Punch Cymbal | Tune ±12 st, Decay 0.3–8 s (2 s), Tone (50 %), Crunch (30 %) | Voice: Crash, Ride |

## 4. Behaviour

Building blocks as in `ring-drums.md` section 4, plus:

- *SweepOsc:* a sine whose phase restarts at 0 on every hit.
- *Crusher:* sample-and-hold at 44.1 kHz × (1 − 0.6·Crunch) and quantising to
  2^(15 − 9·Crunch) steps (16 bits down to 7). Applied before the envelope,
  like a sample played through a VCA.

**Voices** (`patch/modules/punch-drums/dsp/PunchDrumsDsp.h`):

- *Kick:* sine at Tune·(1 + Sweep·(5·f + 0.6·s)), f a 30 ms and s a 250 ms
  decay; amplitude T60 *Decay*; click = 12 ms decay of a thump plus noise
  low-passed at 7 kHz, level *Attack*; soft clip by *Drive*.
- *Snare:* sines at Tune and 1.62·Tune, both bent +40 % with a 40 ms decay,
  T60 160 / 100 ms, softly saturated; noise low-passed at 3–16 kHz (*Tone*)
  and high-passed at 500 Hz, level *Snappy*, T60 *Decay*.
- *Clap:* the shared clap with a wider band-pass (Q 0.9), a 700 Hz high-pass
  and a louder tail.
- *Tom:* sine at Tune·(1 + Bend·(f + 0.3·s)), f 50 ms, s *Decay*; noise
  low-passed at 4 kHz with an 80 ms decay, level *Noise*.
- *Rim:* resonators at 500, 1720 and 3260 Hz (30 / 22 / 15 ms ×Decay) and a
  3 ms noise click, high-passed at 420 Hz and saturated.
- *Hats:* metal (317, 421, 556, 691, 793, 1033 Hz) 65 % + white noise 35 % →
  high-pass 6–10.4 kHz (*Tone*) → crusher → envelope. Closed chokes open.
- *Cymbal, Crash:* metal (263, 400, 421, 474, 587, 845 Hz) and noise 50/50,
  high-passed at 4–9.2 kHz (*Tone*), envelope T60 *Decay* plus an extra 80 ms
  burst at the start. *Ride:* metal (336, 492, 607, 758, 917, 1213 Hz) 60 % +
  noise 40 % high-passed, plus the metal band-passed at 2.6 kHz (Q 3) as a
  bell, T60 1.5·Decay. Both through the crusher.

Velocity and retriggering as in the Ring drums: the swept voices (kick,
snare, tom) restart their oscillators and envelopes, cutting the previous
hit; saturation is velocity-neutral.

## 5. Module view

The generic view. No custom view.

## 6. Saved state

Knob values only.

## 7. Engine requirements

None (`DrumModule.h`, shared with the Ring drums).

## 8. Tests

As in `ring-drums.md` section 8, for every Punch voice (crash and ride
separately). Also: Punch Kick without sweep rings at *Tune*; with full sweep
its first 20 ms are well above *Tune* and it settles on *Tune*; Punch Tom's
ring time follows *Decay*.

## 9. Later

- A sample-based variant of hats and cymbals, once the board can load audio
  files.
- Choke groups across nodes; 1 V/oct *Pitch* input on the tuned voices.
