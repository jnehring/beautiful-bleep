# Modal Voice

Type id `modal-voice` · category *Sources* · colour proposal `#14b8a6`

## 1. Purpose

A complete physical-modelling instrument in one module: an **exciter** (bow,
breath, mallet, or any audio) drives a **modal resonator** (string, bar, plate,
bell), and a small **space** places it in a room. A gate sustains bowed and
blown sounds for as long as it is held; a trigger strikes. It is built to sit
inside a Voice Cell: one module per voice, with an *Active* output that tells
the cell when the sound has died away. Where *Resonator* is an effect that
makes other sounds ring, Modal Voice is the instrument that plays itself.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct, 0.0 = C4. Moves the resonator; the exciters follow where they are pitch-related (4.2). |
| Gate | `gate` | While high, bow and blow play (with *Contour*'s swell and release). A rising edge also strikes when *Strike* is unpatched. |
| Strike | `trigger` | Fires the mallet (4.2). |
| Velocity | `control` (unipolar) | Scales all three exciters, sampled at gate start and strike. Unpatched: 1. |
| Ext In | `audio` | An external exciter, added to the exciter mix at *Ext Level*. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | Resonator plus space, stereo. |
| Exciter | `audio` | The exciter mix before the resonator (monitor it, or feed another Resonator). |
| Active | `gate` | High while the gate is high or the output is above −80 dB (including the space tail); patch it into *Voice Out › Active*. |

## 3. Controls

**Knobs** (modulatable floats)

| Group | Knob | Range | Default | What it does |
|---|---|---|---|---|
| Exciter | Bow | 0–100 % | 0 % | Bow level (bow speed). |
| | Bow Timbre | 0–100 % | 50 % | Bow pressure and roughness: smooth and airy → scratchy, gritty. |
| | Blow | 0–100 % | 0 % | Breath level. |
| | Blow Timbre | 0–100 % | 40 % | Breath colour: dark rush → bright hiss; above 60 % the flow starts to couple with the resonator (4.2). |
| | Strike | 0–100 % | 80 % | Mallet level. |
| | Strike Timbre | 0–100 % | 50 % | Soft felt → hard mallet → sharp tick → grainy scrape (4.2). |
| | Contour | 0–100 % | 30 % | Shape of the bow/blow envelope: slow swell and long release → fast attack with a short decay to a lower sustain. |
| | Ext Level | 0–100 % | 100 % | Level of *Ext In* (only with something patched). |
| Resonator | Coarse | −24…+24 semitones | 0 | Transposition. |
| | Fine | −100…+100 cents | 0 | Fine tuning. |
| | Geometry | 0–100 % | 25 % | Partial ratios: string → stiff string → bar → plate → bell. |
| | Brightness | 0–100 % | 55 % | Spectral tilt and how fast high partials decay. |
| | Damping | 0–100 % | 40 % | Decay of the fundamental: 0 % = 20 s, 50 % ≈ 1 s, 100 % ≈ 40 ms. |
| | Position | 0–100 % | 30 % | Where the exciter touches the body (and where it is heard). |
| Space | Size | 0–100 % | 40 % | Room size: small booth → hall. |
| | Space | 0–100 % | 20 % | Wet level of the room. 0 % switches the space off (no CPU). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Partials | 16, 32, 64 | 32 |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Signal flow

```
 Gate ─► envelope (Contour) ─┬─► Bow  (stick-slip, uses resonator feedback) ─┐
                             └─► Blow (filtered flow noise + jet)            ├─► Σ ─► modal resonator ─► space ─► Out L/R
 Strike ─► mallet pulse ─────────────────────────────────────────────────────┤        │
 Ext In ─► × Ext Level ──────────────────────────────────────────────────────┘        └─► velocity at the bow point (feedback, 1 sample)
```

All exciter levels are multiplied by *Velocity*. The module runs sample by
sample internally, so the bow and jet feedback are one sample long whatever
the engine's sub-block size.

### 4.2 Exciters

**Envelope (bow and blow).** A gate-driven envelope `e`: attack time
`A = 400 ms · (1 − Contour)³ + 2 ms` (linear rise to 1), release (T60, exponential)
`R = 1.5 s · (1 − Contour)² + 30 ms`; from 50 % *Contour* up, the attack
overshoots to 1 and decays (95 % in 200 ms) to a sustain of
`1 − (Contour − 0.5)`. A new gate while releasing starts from the current
value (no click).

**Bow.** The shared `dsp::Bow` (`common/dsp/Exciter.h`), a friction model:
bow velocity `v_b = 0.5 · e · Bow · Velocity · (1 + (0.02 + 0.08 · Bow Timbre) · n)`,
with `n` a 40 Hz low-passed noise (bow hair irregularity). The resonator's
velocity at the bow point `v_r` is the modal sum weighted by the position
factors, delayed one sample (`ModalBank::velocity()`). The relative velocity
`Δv = v_b − v_r` gives the force through the stick-slip curve
`F(Δv) = Δv · (|Δv| · s + 0.75)^(−4)`, clamped to ±1, where the slope
`s = 5 − 3 · Bow Timbre` is the inverse bow pressure: low timbre slips easily
(airy, flautando), high timbre grips (scratchy, rich). The library evaluates
the curve relative to the bow speed (`(v_b / 0.2) · F(0.2 · Δv / v_b)`), so
the regime depends on the timbre only and the level follows the bow speed,
and scales the force into the bank by `bowCoupling(admittance)` so the
one-sample loop never chatters. This makes the resonator self-oscillate at
its own frequency (a few cents flat at most, as bowed bodies are), and the
tone depends on *Position* and *Geometry*. Because only pitched modes of the
bank are driven, the bow works on bars and plates too (bowed metal).

**Blow.** The shared `dsp::Blow`. Flow noise: white noise through a ZDF
band-pass (`dsp::Svf`, Q 0.7) whose centre is `f0 · 2^(6 · Blow Timbre − 1)`
(it tracks pitch), times the flow `e · Blow · Velocity`. Above 60 % *Blow
Timbre* a jet term is added: `j = flow · tanh(30 · g · y(n − ¾ period))`,
where `y` is the resonator output (the jet's travel time is ¾ of a period)
and `g` rises from 0 at 60 % to 1 at 100 %. The jet feeds back like a
flute's air stream, so bright settings make the body sing on its own at a
level that follows the flow. The blow goes into the bank's resonant input.
The breath noise mostly passes the body only at its resonances, so 0.4 × the
blow signal also goes straight to the outputs: audible breath on top.

**Strike.** On each strike (Strike jack, or a gate rising edge if it is
unpatched) the mallet (`dsp::Mallet`) fires a force pulse of area
`Strike · Velocity` (scaled ×3 into the bank's struck input):

| Strike Timbre | Pulse |
|---|---|
| 0–40 % | raised-cosine half-period, 8 ms → 1 ms (soft felt → wooden) |
| 40–70 % | 1 ms → 0.1 ms, plus a single-sample click rising to 50 % of the level (hard mallet → tick) |
| 70–100 % | the tick plus a 5–40 ms burst of sparse seeded impulses (density and length rise): scraped, granular strikes |

The impulse positions of the burst come from `uniform01(Seed, strikeCount, k)`,
with the strike counter cleared on transport start, so renders repeat. A strike
on a ringing body adds to it; nothing is reset.

**Ext In** (after *Ext Level* and *Velocity*) goes into the struck input
energy-normalised like the Resonator's input (`resonator.md` 4.2): scaled by
`2 · √(2 (1 − |coef₁|))`, so noise in gives about the same level at any
*Damping*. With all other levels at 0 the module is a resonator with a room.

### 4.3 Resonator

The shared modal bank (`resonator.md` 4.2; *Geometry* plays the role of
*Structure*) with `Partials` modes, `f0 = C4 · 2^(Pitch + (Coarse + Fine/100)/12)`,
T60 of the fundamental `20 s · 0.002^Damping`. Position sets both the
excitation weights `|sin(π k p')|` and, for the outputs, two pickups: odd
partials are weighted toward *Out L*, even toward *Out R* (60/40), so the body
is slightly wide before the space; the fundamental goes 50/50 so low notes
stay centred. Partials above 0.45 × sample rate are skipped (no aliasing).
The body is scaled by 0.5 (a default strike then peaks around 0.5, a bow at
80 % plays around 0.25 RMS) and passes `softClip` at ±1 because a hard bow on
a long-decay body can build energy. The bank's coefficients are updated every
16 samples with a linear ramp.

### 4.4 Space

A compact stereo room per voice: a 4-line feedback delay network with a
Householder matrix, line lengths 13–41 ms scaled by *Size* (0.5×…2.5×),
a one-pole damping filter in each line (darker for bigger rooms), RT60 from
0.3 s to 4 s with *Size*, and two seeded slow modulators (0.1–0.3 Hz, ±0.3 ms)
on two lines against metallic ringing. An early-reflection tap pair feeds L/R
directly. *Space* is the wet level; the dry body stays at full level. Memory is
about 160 kB per voice (2.5 × 41 ms × 4 lines at 96 kHz). At *Space* 0 % the
network is bypassed (its output is exactly 0) and sleeps after its tail falls
below −90 dB. This is the shared `dsp::Room<4>` with its damping at 50 %.

For large Voice Cells, set *Space* to 0 % inside and put one board-level reverb
after the cell: that saves CPU and keeps one shared room.

### 4.5 Voice Cell use and Active

Typical patch inside a Voice Cell: *Voice In › Pitch* → Pitch, *Gate* → Gate,
*Trigger* → Strike, *Velocity* → Velocity, *Pressure* onto *Bow* or *Blow*
(aftertouch swells the bow); Out L/R → *Voice Out*, *Active* → *Voice Out ›
Active*. *Active* falls when the gate is low and the summed output (body and
space) has stayed below −80 dB for 50 ms; the module then sleeps until the next
gate, strike or *Ext In* signal (the body, the envelope and the room are
cleared, and nothing is computed).

### 4.6 CPU

At 32 partials with the space on, one Modal Voice costs about two
Oscillators-worth; 8 voices in a Voice Cell stay comfortable on a laptop. The
exciters that are at 0 % are not computed.

## 5. Module view

Three columns of knobs headed *Exciter*, *Resonator* and *Space*, and above
them:

- An **exciter scope**: the last 50 ms of the *Exciter* signal, so you see the
  mallet's pulse, the bow's stick-slip saw and the breath noise.
- A **partial display** shared with the Resonator (lines on a log frequency
  axis, height = amplitude, brightness = remaining energy) with a marker for
  *Position*.
- An *Active* LED.
- A *Play* button (a momentary module button): held, it is a gate, and its
  press strikes, for auditioning without cables.

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "modal-voice",
  "params": { "bow": 0.0, "strike": 0.8, "strikeTimbre": 0.5, "geometry": 0.25, "damping": 0.4, "space": 0.2, … } }
```

## 7. Engine requirements

1. The shared `ModalBank` and its ratio tables (see `resonator.md` section 7).
2. A small shared FDN room in `patch/common/dsp/Room.h`, reusable by a later
   board reverb module.
3. **Live values:** `active`; live arrays `exciter` (64 points over 50 ms, the
   signed peak of each slice) for the scope, and `modeHz`, `modeAmp`,
   `modeLevel` for the partials, as for the Resonator.
   The *Exciter* output is the monitor sum `0.2 · bow force + blow + mallet
   pulse × (0.5 ms · fs) + Ext In`, scaled so each part is visible at about
   its level.
4. Nothing else: Voice Cell activity already reads *Voice Out › Active*.

## 8. Tests

- Tuning: Strike at Geometry 0 rings at f0 within ±2 cents for C2, C4, C6.
- Bow: with Bow 80 %, Damping 50 %, the output reaches a steady periodic oscillation at f0 (±5 cents) within 300 ms, and stops after release.
- Blow below 60 % timbre never self-oscillates with the gate low; above 60 % it sustains a pitched tone while the gate is high.
- Strike: two strikes 100 ms apart add (energy rises), no reset discontinuity; Strike Timbre 70–100 % gives the same burst for the same Seed and strike count.
- Gate edge strikes only when *Strike* is unpatched (module logic; checked in the board, not in the DSP test).
- Velocity scales all exciters; unpatched = 1.
- Active: high while the gate is high; falls within 60 ms after the output goes below −80 dB; includes the space tail.
- Stability: maximum Bow, Blow and Strike (all timbres 100 %, strikes every 100 ms) with Damping 0 and Space 0 stays within ±1 and finite for 10 s at Geometry 0, 50 % and 100 %.
- Space 0 % output equals the dry body exactly (renders with different *Size* match sample for sample); with Space on they differ.
- Active sleeps the voice after it falls.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A second, coupled resonator (body + string) with a coupling knob.
- Exciter morph knob that crossfades bow → blow → strike on one control.
- Damper input: a gate that mutes the body quickly (palm mute) without stopping the exciter.
- Per-partial editing (draw the ratio table) saved as node data.
- Sample-based strikes from a small built-in set of recorded mallets.
