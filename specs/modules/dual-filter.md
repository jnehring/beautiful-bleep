# Dual Filter

Type id `dual-filter` · category *Audio* · colour proposal `#f9a8d4`

## 1. Purpose

Two multimode state-variable filters under one *Cutoff*, with a **Spread**
knob that pulls their cutoffs apart symmetrically. Serial, parallel or
stereo routing turns the pair into a wide band-pass with independent
slopes, a two-peak formant filter, a band-reject, or a stereo filter whose
left and right channels sit at different frequencies. One cable on *Cutoff*
moves both; one on *Spread* opens and closes the gap.

### What it adds over the Filter module

The Multi Filter (`filter`, `patch/modules/filter/doc/filter.md`) is one
algorithm applied identically to both channels. The Dual Filter is narrower
in algorithms (only the clean and the saturating SVF) but wider in structure:

| | Filter | Dual Filter |
|---|---|---|
| Filters per channel | 1 | 2, with their own mode and resonance |
| Cutoffs | one | centre + Spread (two, linked) |
| Routing | — | serial, parallel, stereo |
| Two resonant peaks (vowels, formants) | no | yes |
| Different cutoffs left/right | no | yes (Stereo routing) |
| Separate outputs per filter | no | yes |
| Algorithms | 25 | 2 (SVF clean, SVF saturating) |

Use the Filter for a specific character (ladders, shelves, phasers); use the
Dual Filter for shapes that need two filters working together.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is unpatched. |
| In R | `audio` | Right input. |
| Pitch | `pitch` | Moves both cutoffs, scaled by *Key Track*. |

Every knob is also an input (`specs.md` section 7.3). As on the Filter,
*Cutoff* and *Spread* modulation works in octaves.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The routed result (4.2), after *Balance* and *Mix*. |
| F1 Out | `audio` | Filter 1 alone, mono (in Stereo routing: the left channel's filter). |
| F2 Out | `audio` | Filter 2 alone, mono (in Serial: after filter 1; in Stereo: the right channel's filter). |
| Env | `control` (unipolar) | Envelope follower on *Out* (5 ms / 120 ms, as the Filter's *Env*). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Cutoff | 20 Hz – 20 kHz (exponential) | 1 kHz | The centre between the two cutoffs. |
| Spread | −5…+5 octaves | +1 octave | Distance between the cutoffs. Positive: filter 2 above filter 1; negative: below. |
| Res 1 | 0–100 % | 20 % | Resonance of filter 1 (Q 0.5–25, the Filter's mapping `Q = 0.5 · 50^res`). |
| Res 2 | 0–100 % | 20 % | Resonance of filter 2. |
| Mode 1 | LP → BP → HP → Notch | LP | Response of filter 1, morphed continuously (`dsp::morphSvf`). |
| Mode 2 | LP → BP → HP → Notch | LP | Response of filter 2; with *Link* on, an offset from Mode 1 (4.3). |
| Balance | −100…+100 % | 0 % | Level of filter 1 vs filter 2 in Parallel and Stereo; in Serial, the share of filter 1's output that bypasses filter 2. |
| Drive | 0–100 % | 0 % | tanh input drive, as on the Filter. |
| Key Track | 0–100 % | 0 % | How far *Pitch* moves both cutoffs. |
| Mix | 0–100 % | 100 % | Dry ↔ filtered. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Routing | Serial, Parallel, Parallel (F2 inverted), Stereo | Serial |
| Link | Off, Same, Mirror | Off |
| Character | Clean, Saturating | Clean |

## 4. Behaviour

### 4.1 Cutoffs

With `c` the *Cutoff* in octaves above 20 Hz (after modulation and key
tracking) and `s` the *Spread* in octaves:

```
 f1 = 20 Hz · 2^(c − s/2)
 f2 = 20 Hz · 2^(c + s/2)
```

Both are clamped to 5 Hz … 0.49 · fs (as `dsp::Svf::set` does). At Spread 0
the two filters sit on the same frequency; in Serial with both at LP this is
a 24 dB/oct low-pass with two coinciding resonance peaks. Coefficients are
computed per sample when *Cutoff*, *Spread* or *Pitch* are modulated (a `tan`
per filter per sample) and once per sub-block otherwise.

### 4.2 Routing

```
 Serial          in ─► F1 ─┬─► F2 ─► (1−b)·      ─┐
                           └───────► b·          ─┴─► out
 Parallel        in ─┬─► F1 ─► (1−b) ─┐
                     └─► F2 ─► (1+b) ─┴─► ½ sum ─► out
 Parallel (inv.) as Parallel, F2 subtracted
 Stereo          in L ─► F1 ─► out L    in R ─► F2 ─► out R
```

`b` is *Balance*: in Serial, `b = max(Balance, 0)` (negative values have no
extra effect there); in Parallel the levels are `1 − Balance` and
`1 + Balance`, each clamped to 0…2 and halved.

- **Serial** gives steep slopes and band-passes with independent sides:
  *Mode 1* HP and *Mode 2* LP with Spread +2 oct is a band-pass two octaves
  wide whose edges each have their own resonance.
- **Parallel** gives two peaks: both on BP, Spread +1.5 oct, high
  resonance — a vowel-like formant pair; moving *Spread* changes the vowel.
- **Parallel (F2 inverted)**: LP − LP is a band-pass between the cutoffs;
  BP − BP gives a notch with steep sides.
- **Stereo:** each channel has only one filter; Spread places the left and
  right cutoffs apart (a mono source gets stereo width), and *Balance* is a
  left/right level.

Serial and Parallel are processed per channel (two filters per channel, four
in all); Stereo uses two in all.

### 4.3 Link

- **Off:** *Mode 1* and *Mode 2* are independent.
- **Same:** filter 2's mode = Mode 1 + Mode 2 − LP (Mode 2 is an offset;
  at its default, LP, both filters have the same response). One cable on
  *Mode 1* morphs both.
- **Mirror:** filter 2's mode = (1 − Mode 1) + (Mode 2 − LP), clamped to
  0…1: when filter 1 goes LP → notch, filter 2 goes notch → LP. Sweeping
  *Mode 1* in Serial then moves from "two low-passes" through "band-pass"
  to "two notches" with one knob.

### 4.4 Character

- **Clean** — `dsp::Svf`. Resonance peaks at Q 25 and doesn't self-oscillate.
- **Saturating** — `dsp::RoughSvf`, the same filter as the Filter's
  *SVF Saturating (Rough)*: growls when driven, bounded. In Serial the
  saturation of filter 1 shapes what filter 2 sees, so high *Res 1* and
  *Drive* behave like an overdriven two-stage filter.

### 4.5 Gain staging

Two resonant peaks in series can add up to +56 dB at the same frequency. In
*Clean* Serial, the input of filter 2 is scaled by `1 / max(1, Q1 / 4)` when
the cutoffs are within a semitone of each other, rising back to 1 over the
next octave of spread, so turning up both resonances at Spread 0 is loud but
not explosive. The output then passes `x / (1 + |x| / 8)` as a final safety
limit (inaudible below ±2).

### 4.6 Edge cases and CPU

- **Routing change:** the filters keep their state, and the output
  crossfades from the old routing to the new over 10 ms.
- **Character change** resets the filter states (as the Filter's *Type*).
- **Unpatched F1/F2 outputs** cost nothing extra; the filters run anyway for
  *Out*.
- **CPU:** at most four SVFs and one follower per sample — about twice the
  Filter module's *SVF Multimode*.

## 5. Module view

The usual knobs and settings, and a response display above them:

```
 ┌───────────────────────────────────────────────────────────────┐
 │ dB                         ┌─ combined (bright)              │
 │   ╲    F1 (thin)   ╱╲      │                                  │
 │ ───╲──────────────╱──╲─────┘                                  │
 │     ╲____________╱    ╲___  F2 (thin)                         │
 │      ▲ f1        ▲ c   ▲ f2                       20 Hz…20 kHz│
 └───────────────────────────────────────────────────────────────┘
```

- Thin curves for each filter, a bright curve for the combined response of the
  current routing (for Stereo: left and right in two colours).
- Three markers: f1, the centre, f2. Dragging the centre marker sets *Cutoff*;
  dragging f1 or f2 sets *Spread* symmetrically (Alt: moves only that
  cutoff by changing *Cutoff* and *Spread* together). Vertical drag on a
  marker sets that filter's resonance. Each drag is one undo step.
- Drawn from the modulated values, like the Filter's curve; for *Saturating*
  the quiet-signal response.

## 6. Saved state

Only knob and setting values; no node data.

```json
{
  "type": "dual-filter",
  "params": { "cutoff": 0.5674, "spread": 0.6, "res1": 0.2, "res2": 0.2,
              "mode1": 0.0, "mode2": 0.0, "balance": 0.5, "drive": 0.0,
              "keyTrack": 0.0, "mix": 1.0, "routing": 0.0, "link": 0.0,
              "character": 0.0 }
}
```

## 7. Engine requirements

None beyond what exists: `dsp::Svf`, `dsp::RoughSvf` and `dsp::morphSvf` in
`patch/common/dsp/Svf.h`, the resonance mapping of the Filter (move
`Q = 0.5 · 50^res` into a shared helper in `Svf.h` so both modules use the
same curve), `dsp::EnvelopeFollower`, and the Filter's response-curve
drawing code (`patch/modules/filter/ui`), generalised to plot several curves.

## 8. Tests

- Spread: f1 and f2 are `Cutoff (Hz) · 2^(∓s/2)` for several values, including
  clamping at both ends.
- Serial, both LP, Spread 0, Res 0: −24 dB/oct slope well above the cutoff
  (within 1 dB of the analytic response at 4× and 8× the cutoff).
- Serial HP → LP with Spread +2 oct: −3 dB points within 5 % of f1 and f2 at
  low resonance.
- Parallel (F2 inverted), both LP: response at the geometric mean of f1 and f2
  is the maximum; DC and 20 kHz are below −30 dB.
- Stereo with a mono input: left output equals filter 1 at f1, right equals
  filter 2 at f2.
- Link Same and Mirror produce the documented filter-2 modes for Mode 1 at
  0, 1/3, 2/3, 1.
- Gain staging: Clean Serial, both Res 100 %, Spread 0, full-scale noise:
  output stays below ±8.
- Routing change produces no sample step larger than 0.05 on a sine.
- Audio-rate *Spread* modulation stays stable (no NaN, bounded) at Res 100 %.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Any of the Filter's 25 algorithms per slot (a Type per filter).
- An *Offset* knob that moves only filter 2, for asymmetric spreads under one
  cable.
- A vowel table (a/e/i/o/u) for the Parallel BP pair, morphable by one knob.
- Cross-modulation: filter 1's output as audio-rate FM of filter 2's cutoff.
