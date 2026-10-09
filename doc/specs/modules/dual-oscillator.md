# Dual Osc

Type id `dual-osc` · category *Sources* · colour proposal `#2dd4bf`

## 1. Purpose

Two analog-style oscillator cores, *A* and *B*, wired together for the
sounds that need two oscillators talking to each other: B frequency-modulates
A (linear through-zero or exponential), A hard-syncs to B, and the pair runs
into a wavefolder that turns soft waves into bright, moving spectra. Every
stage has its own output, so the module is a complete complex-oscillator
voice and also two ordinary oscillators when you only need those.

The single Oscillator stays the simple, cheap source. The Dual Osc is for
cross-modulation without patching (and without the one-sub-block delay a
feedback cable would add, `specs.md` section 7.5).

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct for both cores (0.0 = C4). |
| Pitch B | `pitch` | Added to B only. With *B Track* off, B follows only this input. |
| FM | `audio` | External FM into A, added to B's modulation before *FM Depth*. |
| Sync | `trigger` | An external rising edge resets **both** cores (a hard restart for the pair, e.g. one per note). |
| Fold CV | `audio` | Added to *Fold* at audio rate (amount 100 % = full knob range). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| A | `audio` | Core A with its modulation and sync, waveform per *Shape A*. |
| B | `audio` | Core B, waveform per *Shape B*. |
| Mix | `audio` | `(1 − Balance)·A + Balance·B`, before the folder. |
| Out L, Out R | `audio` | The folded mix. With *Width* 0 % both carry the same signal (4.5). |
| Ring | `audio` | `A × B` (sine cores), a clean ring modulation. |
| Sub | `audio` | Square one octave below A: flips on each forward wrap of A and on each sync reset with *Sync* ≥ 75 % (band-limited at the exact flip time). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Octave A, Octave B | −4…+4 (stepped) | 0, −1 | Whole octaves per core. |
| Tune A, Tune B | −12…+12 st | 0 | Semitones per core. |
| Fine A, Fine B | −100…+100 ct | 0 | Cents per core. |
| Shape A, Shape B | 0–100 % | 67 %, 0 % | Waveform morph sine → triangle → saw → pulse (as the Oscillator's *Shape*). |
| Width A | 5–95 % | 50 % | Pulse width of A's pulse end. |
| FM Depth | 0–100 % | 0 % | How strongly B (and the *FM* input) modulates A. |
| Sync | 0–100 % | 0 % | Blend from free (0 %) through soft sync to hard sync (100 %) of A to B (4.3). |
| Balance | 0–100 % | 50 % | A ↔ B in the mix fed to the folder. |
| Fold | 0–100 % | 0 % | Folder drive: gain 1…12 before folding. 0 % passes the mix unchanged. |
| Symmetry | −1…+1 | 0 | DC bias before the folder: adds even harmonics, moves the folds. |
| Drift | 0–100 % | 10 % | Seeded slow pitch wander of each core, up to ±8 cents at 100 %. |
| Width | 0–100 % | 0 % | Stereo spread of *Out L/R* (4.5). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| FM Mode | Linear (through-zero), Exponential | Linear |
| B Track | On, Off | On |
| B Range | Audio, Low (B ÷ 100: 0.03–200 Hz for vibrato-like modulation) | Audio |
| Quality | Normal (2×), High (4×) | Normal |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Cores

Each core is a phase accumulator in double precision with the four waveforms
of the Oscillator (sine, triangle, saw, pulse), morphed by *Shape*:
crossfades between neighbours, as in `OscillatorDsp.h`.

- `fB = 261.63 Hz × 2^(OctB + TuneB/12 + FineB/1200 + PitchB + [B Track] · Pitch + driftB)`, ÷ 100 in *Low* range.
- `fA0 = 261.63 Hz × 2^(OctA + TuneA/12 + FineA/1200 + Pitch + driftA)`.
- Saw and pulse use polyBLEP; the triangle uses polyBLAMP at its corners, so
  hard-synced triangles stay clean.
- *Drift* is a 0.2 Hz smoothed random walk per core (`dsp::OscDrift`, seeded
  by `Seed` and the core), so renders repeat. The engine gives modules no
  voice index yet, so voices of a Voice Cell drift identically (section 7.3).
- The cores are `dsp::SyncOsc` (`OscCore.h`); *Pitch*, *FM* and *Fold CV* are
  interpolated linearly across the oversampled sub-samples.

### 4.2 B → A frequency modulation

The modulator `m = sineB + FM input` (B's **sine** regardless of *Shape B*,
so the FM spectrum is predictable; *Shape B* still shapes the *B* output).

- **Linear:** `fA = fA0 × (1 + 4 × FMDepth × m)`. Negative frequencies run A's
  phase backwards (through-zero), so FM at integer ratios stays in tune at any
  depth. The pitch you hear is `fA0` whatever the depth.
- **Exponential:** `fA = fA0 × 2^(4 × FMDepth × m)` (±4 octaves at 100 %).
  Pitch drifts upward with depth, as on analog exponential FM: the classic
  growl and siren sounds.

FM Depth is smoothed over 5 ms; the modulator itself is not smoothed.

### 4.3 Sync

On each B phase wrap (B completing a cycle) at sub-sample position `t`
(`SyncOsc` semantics):

- **0–50 %, reversing soft sync:** if A is in the last `Sync` of its cycle,
  its direction reverses instead of resetting (no jump in value, only in
  slope), giving gentler, vocal timbres.
- **50–100 %, hard part** `h = 2·Sync − 1`: A's phase is pulled toward 0
  (`phase ← phase·(1 − h)`) and runs forward again, except inside a reversal
  window that shrinks from half the cycle (50 %) to nothing (100 %). 100 % is
  an exact reset.
- The reset happens at the exact fractional position `t`; the discontinuity
  in each waveform is corrected with a polyBLEP (saw, pulse, sub) or
  polyBLAMP (triangle) scaled by the jump size.

The external *Sync* input resets both phases (amount 100 %), applied one
oversampled sample after the edge's sample.

### 4.4 Folder

`x = Mix × (1 + 11 × Fold) + FoldCV` into `dsp::Folder` (`Folder.h`) with
gain 1, bias *Symmetry* (and half of it before stage 2), up to 4 stages:

- Stage 1 morphs from a hard fold (reflection at ±1: the identity within ±1)
  at *Fold* 0 to a soft fold `sin(π/2 · x)` at *Fold* ≥ 25 %, so *Fold* 0
  passes the mix unchanged.
- Stages 2–4 (a 50/50 blend of soft and triangle fold) come in one after the
  other: tap = `1 + 3 × Fold`, fractional taps crossfade neighbours.

Every stage uses first-order antiderivative anti-aliasing (ADAA, half an
oversampled sample of delay) and the whole cross-mod section (both cores,
FM, sync, folder) runs at the *Quality* oversampling factor (`Oversampler.h`
half-band FIR decimators). *A*, *B*, *Mix*, *Ring* and *Sub* are taken from
the same oversampled stream after decimation, so all outputs stay
phase-aligned. A 5 Hz DC blocker follows the folder (Symmetry adds DC). The
band-limited folds overshoot a little: *Out* stays within about ±1.25.

### 4.5 Stereo

With *Width* > 0, *Out L* and *Out R* fold two slightly different mixes:
L uses `Balance − Width/4`, R `Balance + Width/4`, and R's symmetry is
`Symmetry × (1 − 2 × Width)` (mirrored at 100 %, so 0 % stays identical).
When *Width* turns up from 0, R's folder, decimator and DC blocker start
from L's state, so there is no click. The result is a wide image that collapses cleanly to
mono (the sum keeps the fundamental in phase).

### 4.6 Edge cases and transport

- Unpatched *Pitch*: both cores sit at their knob pitches (A on C4).
- `fA` and `fB` are clamped to ±0.45 × the oversampled rate.
- *Sync* 0 % costs nothing extra; FM Depth 0 % skips the modulator read.
- The transport is ignored (free-running oscillators), except that *Drift*
  is reseeded at transport start for repeatable renders.

### 4.7 CPU

Measured at 48 kHz (one core, Apple silicon) with only *Out L* patched:
1.4 % at the defaults, 2.6 % (Normal) and 4.5 % (High) with FM, sync and
folding active; with all seven outputs patched 5.3 % / 12.4 %. Most of it is
the decimators (`Oversampler.h` computes every tap, including the half-band
zeros and the discarded phase); a polyphase decimator there would roughly
halve these figures. Unpatched outputs aren't decimated.

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │  A  Oct ◯ Tune ◯ Fine ◯ Shape ◯ Width ◯        ┌── scope ──┐ │
 │  B  Oct ◯ Tune ◯ Fine ◯ Shape ◯  [B Track] [Audio▾]│ A B Out │ │
 │  FM Depth ◯ [Lin▾]   Sync ◯          Drift ◯    └──────────┘ │
 │  Balance ◯   Fold ◯   Symmetry ◯   Width ◯       fold curve ⌇ │
 └───────────────────────────────────────────────────────────────┘
```

- **Scope:** A, B and Out over two cycles of B (triggered on B's wrap), so
  sync and FM are visible.
- **Fold curve:** the transfer function at the current Fold and Symmetry,
  with a dot tracing the input level.
- Knob groups *Osc A*, *Osc B*, *Cross* and *Folder*, so the pair reads like
  two oscillators; the scope (live arrays `scopeA/B/Out`, 128 points) and the
  fold curve (computed in the view, dot from the live value `foldIn`) sit
  below them. Width 560 px (`ui/dual-osc.js`).

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "dual-osc",
  "params": { "octaveA": 0.5, "octaveB": 0.375, "shapeA": 0.67, "fmDepth": 0.0,
              "fmMode": 0.0, "sync": 0.0, "fold": 0.0, "bTrack": 1.0, … } }
```

## 7. Engine requirements

1. **Shared DSP** in `patch/common/dsp/`: `OscCore.h` (`SyncOsc`: phase,
   polyBLEP/BLAMP at every discontinuity including sync; `OscCore::morph`;
   `OscDrift`), `Oversampler.h` and `Folder.h` (ADAA fold, wavefolder.md).
   The Dual Osc's folder is a fixed 4-stage use of the Folder module's code.
2. **Sub-sample trigger offsets** for the external *Sync* input (already part
   of the `trigger` type, `specs.md` section 7.1).
3. **Inside Voice Cells:** runs per voice. *Drift* should differ per voice
   through a voice index, which `ProcessContext` doesn't provide yet; until
   then all voices drift alike.

## 8. Tests

- Tuning: A at 0 V plays 261.63 Hz ±0.1 cent; B at *Octave B* −1 plays 130.81 Hz; *B Track* off ignores *Pitch* for B.
- Linear FM: with B at A's frequency and FM Depth 50 %, the spectrum's fundamental stays at fA0 (through-zero holds the pitch); exponential FM raises the mean pitch.
- Hard sync: A's period equals B's period at *Sync* 100 % for any A pitch; aliasing of a synced saw (A at C5, C6.4, C7; B at C3) stays below −55 dB (Normal) / −75 dB (High) under 20 kHz (most of it sits above 15 kHz).
- Folder: *Fold* 0 % and *Symmetry* 0 make *Out* equal the DC-blocked *Mix* within 0.015 (the ADAA's half oversampled sample); output stays within ±1.3; DC after the blocker < 1e-3.
- Stereo: *Width* 0 % gives L = R exactly; L + R at 100 % keeps the fundamental within 3 dB of mono.
- Outputs are phase-aligned (the transparency test above); the external *Sync* input lines two differently started renders up exactly.
- Same Seed → identical renders including Drift; another Seed differs.
- Saved params round-trip; demo types file includes the module.

## 9. Later

- A → B FM as well (bidirectional, with an implicit one-sample delay inside the module).
- A third core as a dedicated modulator, with its own envelope input for FM index.
- Shape outputs per core (separate sine/triangle/saw/pulse jacks).
- Per-core *Pitch* quantizing to a scale (shared `Scales.h`).
