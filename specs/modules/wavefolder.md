# Folder

Type id `wavefolder` · category *Audio* · colour proposal `#10b981`

## 1. Purpose

A stereo, multi-stage wavefolder: six folding stages in a row turn a simple
waveform into a rich, bright, vocal tone, and the *Fold* knob sweeps through
the harmonics the way a filter sweeps through a spectrum, only upwards.
*Symmetry* adds even harmonics, *Tap* picks or blends how many stages you hear.
It is anti-aliased (oversampling plus antiderivative anti-aliasing), so deep
folds on high notes stay clean. With its *Pitch* jack it has its own sine/
triangle oscillator, which makes it a complete complex-oscillator voice on its
own. Utility's *Fold* mode is the cheap control-rate version; this is the one
for audio.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | The signal to fold. Also feeds the right channel when *In R* is unpatched. With *Source* on *Internal*, it becomes a linear FM input for the oscillator (4.5). |
| In R | `audio` | Right input. |
| Pitch | `pitch` | 1 V/oct, 0.0 = C4, for the internal oscillator. Patching it while *Source* is *Auto* switches the oscillator on (4.5). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The folded signal after *Tap*, *Mix* and DC blocking: within ±1, up to about ±2 with strong *Symmetry* (a lopsided fold minus its DC). |
| Osc | `audio` | The internal oscillator before folding (the "fundamental", for mixing back in or for FM elsewhere). Silent when the oscillator is off. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Fold | 0–100 % | 0 % | Drive into the stages: per-stage gain `g = 4^Fold` (1×…4×), so the total depth grows as gⁿ through the stages. At 0 % a signal within ±1 passes unfolded. |
| Symmetry | −100…+100 % | 0 % | DC bias added before the first stage (±1.0) and half of it before the second: asymmetric folds and even harmonics. |
| Tap | 1–6 | 6 | Which stage is heard; between whole numbers it crossfades the neighbouring stages (4.3). |
| Shape | 0–100 % | 50 % | Fold curve: 0 % soft (sine), 100 % hard (triangle reflection); in between a blend. |
| Spread | 0–100 % | 0 % | Stereo: offsets *Symmetry* by ±Spread × 0.5 and *Fold* by ±Spread × 10 % between L and R, so a mono source becomes wide. |
| Level | 0–100 % | 100 % | Input gain before folding (−∞…0 dB, cubic), for taming hot sources without changing *Fold*. |
| Mix | 0–100 % | 100 % | Dry/wet. The dry path is delayed by the oversampling latency so they mix in phase. |
| Wave | 0–100 % | 0 % | Internal oscillator: sine → triangle. |
| Coarse | −24…+24 semitones | 0 | Internal oscillator transposition. |
| Fine | −100…+100 cents | 0 | Internal oscillator fine tune. |
| FM Depth | 0–100 % | 0 % | Through-zero linear FM from *In L* when the oscillator runs (same scaling as the Oscillator: ±4× at 100 %). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Source | Auto, Input, Internal | Auto |
| Octave | −3…+3 | 0 |
| Quality | Eco (2×), Normal (4×) | Normal |

## 4. Behaviour

### 4.1 The fold function

With `x` the stage input, the hard fold reflects at ±1 again and again (a
triangle wave of period 4 evaluated at `x`):

    hard(x) = 1 − |((x + 1) mod 4) − 2|          (exact identity for |x| ≤ 1)
    soft(x) = sin(π/2 · x)
    F(x)    = (1 − Shape) · soft(x) + Shape · hard(x)

The soft curve already saturates gently below ±1, so at *Shape* 0 % the module
colours even at *Fold* 0 %; at 100 % it is perfectly clean until a signal
crosses ±1.

### 4.2 Stages

    y₀ = Level · input + Symmetry
    y₁ = F(g · y₀)
    y₂ = F(g · y₁ + Symmetry / 2)
    yₖ = F(g · yₖ₋₁)            for k = 3 … 6

Each stage multiplies the number of folds; the first two stages handle
asymmetry, the later ones density. Because `F` maps into [−1, 1], every stage
output is bounded and stages don't need gain compensation.

### 4.3 Tap

*Tap* `t` in 1…6: the output is `(1 − φ) · y⌊t⌋ + φ · y⌈t⌉` with
`φ = t − ⌊t⌋`, an equal-gain crossfade. Stages above ⌈t⌉ are not computed, so
lower taps cost less. Modulating *Tap* with an envelope gives a "harmonic
envelope" that opens from a gentle fold to a dense one without changing the
input level. Crossfading between stages whose outputs are in opposite phase can
thin the sound briefly at half-way positions; the view's tap display shows
this.

### 4.4 Anti-aliasing

Folding creates very high harmonics; without care, a C6 folded deeply is mostly
alias. Two measures, combined:

1. **Oversampling.** The input is upsampled by 2× or 4× (*Quality*) with
   cascaded linear-phase half-band FIRs (the 95-tap filter of
   `dsp/Oversampler.h`, run in polyphase form: 48 multiply-adds per 2× step),
   folded, and decimated with the same filters. Latency: 47 (2×) or 70.5 (4×)
   base samples, compensated in the dry path. (An 8× setting is not offered:
   4× with ADAA already meets the targets below, and 8× would double the
   cost again.)
2. **First-order antiderivative anti-aliasing (ADAA)** in every stage. With
   `G` the antiderivative of `F`,

       hardG(x): piecewise quadratic, periodic in 4 with the linear trend removed
       softG(x) = −(2/π) · cos(π/2 · x)
       yₖ[n] = (G(u[n]) − G(u[n−1])) / (u[n] − u[n−1])

   falling back to `F((u[n] + u[n−1]) / 2)` when `|u[n] − u[n−1]| < 1e-5`
   (ill-conditioning). ADAA adds half a sample of delay per stage at the
   oversampled rate; the dry path adds it too (`stages / 2 / factor`, read
   from the delay line with 4-point Lagrange interpolation).

Measured with a C5 sine (strongest alias relative to the fundamental): *Fold*
100 % at *Tap* 1: −115 dB (Normal) / −77 dB (Eco); *Fold* 100 % at *Tap* 2
(16× total drive): −84 / −38 dB; *Fold* 50 % at *Tap* 6 (64×): −74 / −42 dB.
Deeper settings (high *Fold* at *Tap* 3–6, total drive in the hundreds or
thousands) fold into dense noise by design. *Eco* is meant for many voices
and moderate folds.

**DC.** *Symmetry* creates DC; a 5 Hz one-pole high-pass on each output
(after *Mix*, so dry and wet stay in phase) removes it. Changes of *Symmetry* and *Level* are smoothed over 2 ms (they
would otherwise click at the hard corners); *Fold* and *Tap* are taken per
sample at the oversampled rate (linear interpolation of the sub-block values),
so audio-rate modulation works.

### 4.5 Internal oscillator

- **Source *Auto*** (default): the oscillator runs when *Pitch* is patched and
  *In L* is not. *Input*: always fold the inputs. *Internal*: always run the
  oscillator; a patched *In L* then becomes its FM input. Switching between
  input and oscillator crossfades over 5 ms.
- The oscillator is the shared core (`chord-oscillator.md` section 7) limited
  to sine and triangle, morphed by *Wave*, at
  `C4 · 2^(Octave + Pitch + (Coarse + Fine/100)/12)`, mono into both channels
  (then *Spread* widens it). Its amplitude is ±1, so *Fold* acts as the timbre
  control right away.
- A classic complex voice: *Wave* 0 % (sine), *Fold* swept by an envelope,
  *Symmetry* by a slow LFO, a second Oscillator into *In L* for FM.

### 4.6 CPU

Per channel and stage, one fold with ADAA at the oversampled rate; a mono
source (*In R* unpatched, *Spread* 0) is computed once and copied (when
*Spread* or *In R* turns stereo on, the right channel continues from the left
one's state, without a click). Stages above the tap are skipped.

Measured (one core, 48 kHz, Tap 6): Normal mono 3.4–4.1 % (Shape 0–50 %),
2.1 % (Shape 100 %); stereo about twice that; Eco about half. That is well
above the original target of 1.5 Oscillators: the cost is in
`dsp::Folder` (about 37 ns per stage and sample: a double-precision cosine
for the soft curve's antiderivative and a division), 24 stage evaluations per
channel and sample at 4×. A float fold with a polynomial cosine in
`Folder.h` would roughly halve the module.

## 5. Module view

The usual knobs and settings, plus two small displays:

- **Transfer curve:** the input-to-output curve of the chain up to the current
  *Tap* (x from −2 to +2 after *Level*), with the live input range marked as a
  shaded band, so you see how many folds the signal actually crosses.
- **Scope:** one period (internal oscillator) or the last 20 ms (input) of the
  output, overlaid on the dry signal in a dimmer colour.

A row of six dots shows the *Tap* position between the stages.

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "wavefolder",
  "params": { "fold": 0.0, "symmetry": 0.5, "tap": 1.0, "shape": 0.5, "source": 0.0, "quality": 1.0, … } }
```

## 7. Engine requirements

1. **Oversampling helper** `patch/common/dsp/Oversampler.h` (half-band FIR,
   2×/4×, per channel), also usable by Multi Filter drive and Low Pass Gate.
   Its `HalfbandFir` runs all 95 taps on every (zero-stuffed) sample and reads
   its ring one sample late (48 instead of 47 samples of delay per stage); the
   module uses the same taps in polyphase form (`HalfbandPoly` in
   `WavefolderDsp.h`), which Oversampler.h could adopt. The fold function and its ADAA (4.1, 4.4) go into
   `patch/common/dsp/Folder.h`; both files are also proposed by
   `dual-oscillator.md` and `macro-oscillator.md`, so whichever module is built
   first creates them and the others reuse them (Folder needs the per-stage
   taps on top).
2. **Latency reporting** per node, if the engine doesn't compensate parallel
   paths yet: for now the module compensates its own dry path only; the
   documentation says that parallel patching around it is off by about 1.5 ms
   (70.5 samples at Normal, 47 at Eco).
3. The shared oscillator core (`chord-oscillator.md` section 7).

## 8. Tests

- Fold 0 %, Shape 100 %, Symmetry 0: a sine at ±0.9 passes with < −90 dB THD (identity).
- The ADAA output matches the naive fold of a slow signal within 1e-4 (no bias); the ill-conditioned fallback is exercised with DC input (shared `common/dsp/tests/test_folder.cpp`).
- Aliasing with a C5 sine (a sine, so everything non-harmonic is alias): Fold 100 % at Tap 2 below −80 dB at Normal; Fold 50 % at Tap 6 below −70 dB; Fold 100 % at Tap 1 below −110 dB; Normal always better than Eco.
- Bounds: outputs finite and within ±2.2 for random inputs up to ±20, knob extremes and audio-rate Fold/Tap modulation.
- Tap: integer taps equal the stage outputs (shared test); Tap 1 is cheaper than Tap 6 (timing check).
- Symmetry 0 yields no even harmonics (< −90 dB) for a symmetric input; the output has no DC after 1 s.
- Source Auto switches with the patch state; Internal + In L gives FM; the *Osc* output equals the internal oscillator.
- Mix 50 % with Fold 0 % and Shape 100 % equals Mix 0 % (dry/wet in phase, within 1 %: six ADAA stages average neighbouring samples); Mix 0 % is the input delayed by the stated latency.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Per-stage gains drawn in the view (a "fold profile") saved as node data.
- A low-pass gate-style *Timbre* input that couples Fold to an internal envelope.
- Second internal oscillator as a modulator (complete two-oscillator complex voice).
- Feedback from a later stage to the input, for chaotic folding.
