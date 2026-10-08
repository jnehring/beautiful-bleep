# Verb

Type id `reverb` · category *Audio* · colour proposal `#f0abfc`

## 1. Purpose

A stereo reverb built to be **played**, not just set: every knob, including
*Size* and *Decay*, can be modulated at audio rate without zipper noise or
clicks. It goes from small rooms through halls to endless, slowly drifting
pads, and a *Freeze* gate holds whatever is in the tank for as long as you
like. Patch an envelope onto *Size* for swelling spaces, an LFO onto *Decay*
for breathing tails, or a sequencer onto *Freeze* for rhythmic holds.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is not patched. |
| In R | `audio` | Right input. |
| Freeze | `gate` | While high, the tank holds its contents: input to the tank is muted and the loop becomes lossless (see 4.4). |
| Clear | `trigger` | Empties the tank and the pre-delay with a 10 ms fade (see 4.6). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The dry/wet mix set by *Mix*. |
| Wet L, Wet R | `audio` | The reverb only (100 % wet, after *Tone* and *Width*), whatever *Mix* says. For parallel processing or feeding the tail into other modules. |
| Env | `control` (unipolar) | Envelope follower on the wet signal (5 ms attack, 200 ms release), so the tail can modulate other things. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Size | 0–100 % | 50 % | Scales every delay in the tank: 0 % is a small booth (≈ 3 m), 100 % a huge space (≈ 60 m). |
| Decay | 0.1 s – 60 s, then ∞ | 2.5 s | Mid-frequency T60 (time to fall by 60 dB). The top 4 % of the knob is *infinite*. |
| Pre-delay | 0–1000 ms | 20 ms | Gap between the dry sound and the reverb. In sync mode: the note value set by *Pre-delay Sync* (see 4.5). |
| Diffusion | 0–100 % | 70 % | Density of the early build-up: low values keep audible discrete echoes, high values give a smooth wash. |
| Damping | 0–100 % | 40 % | How much faster the highs decay than the mids (high-frequency T60 = Decay × (1 − 0.9 × Damping)). |
| Bass | 0.5× – 2× | 1× | Low-frequency T60 relative to *Decay* (below ≈ 250 Hz). |
| Mod Rate | 0.05–8 Hz | 0.6 Hz | Speed of the internal delay modulation that keeps the tail from ringing metallically. |
| Mod Depth | 0–100 % | 25 % | Amount of that modulation: 0 % is static (and can ring), 100 % is a seasick chorus. |
| Tone | −1 … +1 | 0 | Tilt EQ on the wet signal around 800 Hz, ±6 dB at the extremes: dark ↔ bright. |
| Width | 0–150 % | 100 % | Stereo width of the wet signal (mid/side): 0 % mono, 150 % wider than the tank. |
| Mix | 0–100 % | 35 % | Dry/wet, equal-power. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Pre-delay Sync | Free, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2 (each straight, dotted, triplet) | Free |
| Quality | Eco (8 lines), Fine (16 lines) | Fine |
| Clear on Play | off / on | off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Signal flow

```
 In L/R ─► Pre-delay ─► Input diffuser ─► FDN tank (8 or 16 lines) ─► Tone ─► Width ─► Wet L/R
   │         (stereo)    4 allpasses/ch     ▲ Damping/Bass filters │                      │
   │                                        └──── feedback matrix ◄┘                      │
   └──────────────────────────────── dry ─────────────────────────────── Mix ────────────► Out L/R
```

The tank is a **feedback delay network** (FDN): N delay lines whose outputs
are mixed by an orthogonal matrix and fed back into their inputs. We use a
Householder matrix (`A = I − 2/N · 1·1ᵀ`, N additions, no multiplies beyond
one scale) for Eco and a fast Hadamard transform for Fine. Both are lossless,
so all the decay comes from the per-line gains (4.3), which is what makes
infinite decay and freeze clean.

- **Delay lengths.** Base lengths are chosen mutually co-prime and spread
  log-uniformly between 11 ms and 97 ms (Fine) at Size 50 %. Size scales them
  by 2^(4 × (Size − 0.5)) ≈ ¼ … 4×, so the longest line is ≈ 390 ms at 100 %.
  Lines alternate between the left and right output taps; the input goes
  into all lines with alternating signs per channel, so a mono source gets a
  wide, decorrelated tail.
- **Input diffuser.** Four allpasses in series per channel (lengths 1.2–8 ms ×
  Size factor, coefficient 0.35 + 0.4 × Diffusion). At low *Diffusion* the
  diffuser coefficient is low and the first reflections stay audible as
  echoes.
- **Reads** are fractional with cubic Hermite interpolation. Every line's
  length can change every sample (4.2).

### 4.2 Modulating Size without clicks

The difficult knob in most reverbs is *Size*: jumping delay lengths click,
and recomputing them per block zips. Here every line's read position moves
continuously:

- The target length of each line is computed **per sample** from the
  effective Size value (the engine delivers per-sample parameter values).
- The actual read length follows the target through a slew limiter of at
  most ±0.5 samples per sample (pitch shift bounded to ± one octave down /
  half again up) followed by a 2 ms one-pole. Within that limit the read head
  simply moves: the tail bends in pitch like a tape being sped up or slowed,
  which is the musical sound of a moving space, and never a step.
- Slow or moderate modulation (anything an LFO or envelope does below ≈ 20 Hz
  at full depth) stays inside the limit and tracks exactly. Faster or deeper
  audio-rate modulation is smoothed by the limiter, so it turns into a
  frequency-modulated shimmer instead of noise or clicks.
- The diffuser allpasses use the same smoothed scale factor.

*Pre-delay* uses the same mechanism on its own line (slew ±1 sample per
sample), so sweeping it gives a doppler swoop on the onset of the tail.

### 4.3 Decay, Damping, Bass

Each line has a gain `g_i = 10^(−3 · L_i / (T60 · fs))` and a two-band shelf
(1-pole low shelf at 250 Hz for *Bass*, 1-pole high shelf at 3 kHz for
*Damping*) whose gains are derived from the T60 per band in the same way
(Jot's method), so all lines decay at the same rate per band whatever their
length.

- Gains are recomputed every 8 samples from the current *Decay*, *Damping*,
  *Bass* and line lengths, and linearly interpolated in between, so audio-rate
  modulation of *Decay* is smooth (it's amplitude modulation of the tail, with
  an effective control rate of fs/8 ≈ 6 kHz).
- Shelf coefficients are TPT one-poles (`specs.md` Multi Filter, zero-delay
  feedback), so changing them per sample is stable.
- **∞ (infinite)**: above 96 % on the knob, gains are exactly 1 and the shelves
  are flat. The region between 92 % and 96 % ramps T60 from 60 s towards the
  lossless state, so sweeping into infinity is continuous. The input stays
  open, so new sound keeps piling up; a soft limiter (tanh at −1 dBFS on the
  line sum, only engaged in the loop above 92 %) keeps the energy bounded.

### 4.4 Freeze

*Freeze* high: within 20 ms the tank input fades to zero and the loop
becomes lossless (as ∞ above, including flat shelves), and the modulation
keeps running so the held sound slowly shimmers instead of ringing static.
*Size* and *Mod Depth* still act on the frozen sound (moving its pitch and
movement); *Decay*, *Damping* and *Bass* are ignored until release. *Freeze*
low: input fades back in and the gains glide back to the knob values over
50 ms. The dry path is untouched, so you can play over a frozen pad.

### 4.5 Pre-delay and the transport

With *Pre-delay Sync* on a note value, the pre-delay equals that note at the
current tempo (4/4), clamped to 1000 ms; *Pre-delay* then scales it 0–100 %
(default 100 % of the note when synced). Tempo changes glide the delay
(4.2). The pre-delay is the only tempo-aware part; the tank is not
quantized.

### 4.6 Tails, Clear and determinism

- **Transport stop** never cuts the tail: the module keeps running while the
  engine runs (`specs.md` section 5.3), and the tail rings out normally.
- **Clear** fades the wet path out over 10 ms, zeroes all lines, filters and
  the pre-delay, and fades back in. The dry path is untouched.
- **Clear on Play**: when on, starting the transport (the engine's
  `transportStarted`) acts like *Clear*. With it on, two offline renders of
  the same section are bit-identical. With it off (default), leftover tail
  from before the render is part of the output, as in a hardware reverb.
- **Modulation phases** of the internal LFOs (one per line, rates spread
  ±23 % around *Mod Rate*, start phases from *Seed*) restart from the seed on
  `transportStarted`, so the modulation itself is repeatable.
- **Denormals** are flushed (FTZ/DAZ on the engine thread), so a long,
  quiet tail costs no more CPU than a loud one.

### 4.7 CPU and memory

- Fine: 16 lines, 8 diffuser allpasses, 16 interpolated reads, 32 shelf
  filters per sample. Expect ≈ 1.5 % of one core at 48 kHz on an M1; Eco about
  half.
- Memory: lines sized for the maximum (390 ms × 16) plus 1 s stereo
  pre-delay: ≈ 1.6 MB at 48 kHz, ≈ 6.4 MB at 192 kHz. Allocated in `prepare()`
  on the message thread, never on the audio thread.
- **Inside a Voice Cell** it works per voice (each voice its own tank), which
  multiplies CPU and memory by the number of voices. Usually place it after
  the cell.

## 5. Module view

The usual knobs and settings (`specs.md` section 9.4), plus a display above
them:

```
 ┌───────────────────────────────────────────────────────────────┐
 │  ▁▂▅█▇▆▅▄▃▃▂▂▁▁▁▁▁▁▁▁▁        decay curve, 3 bands (lo/mid/hi)│
 │  |pre|                         T60 2.5 s · hi 1.6 s · lo 2.5 s │
 │  ◉ FREEZE   [Clear]                       wet level ▮▮▮▮▯▯    │
 └───────────────────────────────────────────────────────────────┘
```

- **Decay curves:** three lines (low, mid, high) from the *effective*
  (modulated) values, on a log time axis; the pre-delay is drawn as a gap.
  ∞ shows a flat line and the label *Infinite*.
- **Freeze** button: latching toggle, ORed with the *Freeze* gate. Lit while
  frozen from either source.
- **Clear** button: same as the trigger.
- **Wet meter:** the *Env* output.

## 6. Saved state

Only knob and setting values; the latching Freeze button is saved so a board
reopens frozen-ready (the tank content itself is not saved: it opens empty).

```json
{
  "type": "reverb",
  "params": { "size": 0.5, "decay": 0.41, "mix": 0.35, … },
  "data": { "freezeLatched": false }
}
```

## 7. Engine requirements

1. **Shared delay toolkit** in `patch/common/dsp/Delay.h`: a fractional
   delay line (cubic Hermite), the slew-limited length follower of 4.2, and
   denormal-safe one-pole shelves. Zone Delay, Delay Net and Bender use the
   same file.
2. **Allocation in `prepare()`** for buffers sized by sample rate (no
   allocation in `process`). If `prepare()` is called again with a new rate,
   buffers are reallocated and cleared.
3. **`transportStarted`** is already in `ProcessContext`; *Clear on Play* and
   the LFO reseed use it.
4. **State across recompiles:** like every module, reused by node id, so
   patching elsewhere on the board doesn't cut the tail.
5. Small node data for the latched Freeze (`ModuleSpec::sanitiseData`).

## 8. Tests

- **Impulse response:** an impulse at Decay 2 s (Damping 0, Bass 1×) falls by
  60 dB in 2 s ± 10 %, measured on the RMS envelope; with Damping 100 % the
  > 5 kHz band decays at least 5× faster.
- **Lossless loop:** Decay ∞ and Freeze each keep an injected burst's energy
  within ±0.5 dB over 60 s; the limiter bounds the output below 0 dBFS when
  noise is fed continuously at ∞.
- **Click-free Size:** sweep Size 0 → 100 % in 10 ms and modulate it with a
  1 kHz sine at full depth; the output's sample-to-sample difference never
  exceeds that of the unmodulated tail by more than a fixed factor, and no
  sample exceeds ±2.
- **Click-free Decay / Pre-delay:** same check for audio-rate modulation of
  Decay and Pre-delay.
- **Freeze:** gate on/off gives no discontinuity (max step < −40 dBFS) and the
  frozen tail holds; dry path unchanged.
- **Clear on Play:** two renders of the same transport section after
  different prior input are bit-identical with it on.
- **Seed:** same seed, same output; different seeds, different modulation.
- **Mono input** with *In R* unpatched gives decorrelated L/R (correlation
  < 0.5) at Width 100 %, and identical L/R at Width 0 %.
- **Pre-delay sync:** at 120 BPM, 1/8 gives 250 ms ± 1 sample.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- *Shimmer:* a pitch shifter (+12 / +7 semitones) inside the loop.
- *Early reflections* as a separate, shape-selectable stage (room, plate,
  hall) with its own level.
- A *Ducking* knob (wet ducks under the dry signal's envelope).
- A *Gate* mode for gated-reverb drums (tail cut after a hold time).
- 32-line *Ultra* quality for very long, dense tails.
