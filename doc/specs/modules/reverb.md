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
| Pre-delay | 0–1000 ms | 20 ms | Gap between the dry sound and the reverb. Hidden in sync mode, where *Pre-delay Sync* sets it (see 4.5). |
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
| Pre-delay Sync | Free, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2 (each triplet, straight, dotted) | Free |
| Quality | Eco (8 lines), Fine (16 lines) | Fine |
| Clear on Play | off / on | off |
| Seed | 0–999 | 1 |
| Freeze (latch) | off / on | off |
| Type | Hall, Spring | Hall |

*Decay* is an exponential seconds knob (0.1 s at 0 %, 60 s at 92 %); above
92 % it is the infinite region (4.3), so the knob's own read-out shows
seconds up to ≈ 104 s at the top and the view shows *Infinite*.

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
- **Reads** are fractional through first-order allpass interpolation
  (`dsp::AllpassTap`), which is exactly flat in magnitude, so freeze and
  infinite decay keep their highs while the modulation runs (cubic reads lose
  treble on every pass). The pre-delay is read with cubic Hermite
  interpolation. Every line's length can change every sample (4.2).

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
- **∞ (infinite)**: between 92 % and 96 % T60 ramps from 60 s towards
  lossless (`60 s / (1 − t)`), and above 96 % the module runs the tank with
  T60 = 10⁹ s: per-pass gains differ from 1 by about 10⁻¹⁰ and the shelves
  are flat, so sweeping into infinity is continuous. The input stays open,
  so new sound keeps piling up; the tank's soft limiter (tanh at −1 dBFS in
  the loop) bounds it. The limiter is engaged only above 92 % **and** while
  the tank is hot (wet peak above −6 dBFS, released below −9 dBFS, 0.5 s
  peak hold), because its gentle compression drains a moderate tail by
  several dB a minute; the tank's own `infinite` mode keeps it on at all
  levels, so the module doesn't use that mode.

### 4.4 Freeze

*Freeze* high (the gate, ORed with the latching *Freeze* setting): within
20 ms the tank input fades to zero and the loop becomes lossless (gains
exactly 1, flat shelves), and the modulation
keeps running so the held sound slowly shimmers instead of ringing static.
*Size* and *Mod Depth* still act on the frozen sound (moving its pitch and
movement); *Decay*, *Damping* and *Bass* are ignored until release. *Freeze*
low: input fades back in and the gains glide back to the knob values over
50 ms. The dry path is untouched, so you can play over a frozen pad.

### 4.5 Pre-delay and the transport

With *Pre-delay Sync* on a note value, the pre-delay equals that note at the
current tempo (4/4), clamped to 1000 ms, and the *Pre-delay* knob is not
used (hidden). Tempo changes glide the delay (4.2). The pre-delay is the only tempo-aware part; the tank is not
quantized.

### 4.6 Tails, Clear and determinism

- **Transport stop** never cuts the tail: the module keeps running while the
  engine runs (`specs.md` section 5.3), and the tail rings out normally.
- **Clear** fades the wet path out over 10 ms, zeroes all lines, filters and
  the pre-delay, and fades back in. The dry path is untouched. *Quality* and
  *Seed* changes go through the same fade (the change happens at silence).
- **Clear on Play**: when on, starting the transport (the engine's
  `transportStarted`) clears everything at once (no fade: a fade would carry
  the old tail into the render). With it on, two offline renders of the
  same section are bit-identical. With it off (default), leftover tail
  from before the render is part of the output, as in a hardware reverb.
- **Modulation phases** of the internal LFOs (one per line, rates spread
  ±23 % around *Mod Rate*, start phases from *Seed*) restart from the seed on
  `transportStarted`, so the modulation itself is repeatable.
- **Denormals** are flushed (FTZ/DAZ on the engine thread), so a long,
  quiet tail costs no more CPU than a loud one.

### 4.7 CPU and memory

- Fine: 16 lines, 8 diffuser allpasses, 16 interpolated reads, 32 shelf
  filters per sample. The module harness measures ≈ 2.5–3 % of one core
  (48 kHz-equivalent, every knob modulated); nearly all of it is the shared
  tank (`Fdn.h`). The module reads its slow knobs every 8 samples. Eco is
  about half.
- Memory: lines sized for the maximum (390 ms × 16, rounded up to powers of
  two) plus 1 s stereo pre-delay: ≈ 2.5 MB at 48 kHz, ≈ 10 MB at 192 kHz.
  The spec flags the module `memoryHeavy`. Allocated in `prepare()`
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
- **Freeze** button: latching toggle (it sets the *Freeze (latch)* setting),
  ORed with the *Freeze* gate. Lit while frozen from either source (live
  value `frozen`).
- **Clear** button: same as the trigger.
- **Wet meter:** the *Env* output (live value `env`). The pre-delay gap uses
  the live value `preDelayMs` (it follows the tempo when synced).

## 6. Saved state

Only knob and setting values. The latching Freeze button is a setting
(`freeze`), so a board reopens frozen-ready (the tank content itself is not
saved: it opens empty). No node data.

```json
{
  "type": "reverb",
  "params": { "size": 0.5, "decay": 0.463, "mix": 0.35, …, "freeze": 0.0 }
}
```

## 7. Engine requirements

1. **Shared tank** `patch/common/dsp/Fdn.h` (exists) on the delay toolkit
   `Delay.h` (`RingDelay`, `AllpassTap`, `TapeTime`).
2. **Allocation in `prepare()`** for buffers sized by sample rate (no
   allocation in `process`). If `prepare()` is called again with a new rate,
   buffers are reallocated and cleared.
3. **`transportStarted`** is already in `ProcessContext`; *Clear on Play* and
   the LFO reseed use it.
4. **State across recompiles:** like every module, reused by node id, so
   patching elsewhere on the board doesn't cut the tail.
5. No node data: the latched Freeze is a plain setting.

## 8. Tests

- **Impulse response:** an impulse at Decay 2 s (Damping 0, Bass 1×) falls by
  60 dB in 2 s ± 10 %, measured on the RMS envelope; with Damping 100 % the
  > 5 kHz band decays at least 5× faster.
- **Lossless loop:** Decay ∞ and Freeze each keep an injected burst's energy
  (noise low-passed at 6 kHz) within ±0.5 dB over 56 s (measured −0.2 dB);
  the limiter bounds the wet output below ±2 (measured peak ≈ 1.45, so not
  below 0 dBFS: up to 16 limited lines add up) when full-scale noise is fed
  continuously at ∞.
- **Click-free Size:** sweep Size 0 → 100 % in 10 ms and modulate it with a
  1 kHz sine at full depth; the output's sample-to-sample difference never
  exceeds that of the unmodulated tail by more than a fixed factor, and no
  sample exceeds ±2.
- **Click-free Decay / Pre-delay:** same check for audio-rate modulation of
  Decay and Pre-delay.
- **Freeze:** toggling the gate every 0.5 s gives no sample step larger than
  1.5× the unmodulated tail's; the frozen tail holds (above); dry path
  unchanged (Mix 0 gives the input exactly).
- **Clear on Play:** two renders of the same transport section after
  different prior input are bit-identical with it on.
- **Seed:** same seed, same output; different seeds, different modulation.
- **Mono input** with *In R* unpatched gives decorrelated L/R (correlation
  < 0.5) at Width 100 %, and identical L/R at Width 0 %.
- **Pre-delay sync:** at 120 BPM, 1/8 gives 250 ms ± 1 sample.
- **Spring:** T60 follows *Decay*; *Damping* darkens; the lows arrive after the highs with *Diffusion* up; bounded at infinite decay and full modulation; Hall → Spring switches are click-free; *Clear on Play* repeats.
- The demo types file includes the module (`patch.ui-types`).

### 4.8 Type: Hall and Spring

*Type* chooses the tank; the rest of the chain (pre-delay, Tone, Width, Mix,
the fades, outputs) is shared. *Hall* is the FDN above and the default, so
saved boards are unchanged. *Spring* (`dsp/SpringTank.h`) is, per channel, a
loop of: a delay line (the coil; round trip 22 – 122 ms from *Size*, the right
channel 13 % longer), 36 first-order allpasses with coefficient −(0.1 + 0.8 ×
*Diffusion*) (dispersion: the group delay is large at low and small at high
frequencies, so each pass turns an impulse into a falling chirp), a damping
low-pass (14 kHz · 0.05^*Damping*: 14 kHz down to 700 Hz), a 220 Hz
split that scales the low band by the *Bass* ratio, the per-round-trip gain
10^(−3 · loop / T60), and a tanh at the write point. *Mod Depth* shortens the
line by up to 12 % with the level of the input (a fast attack, ≈ 80 ms
release, the "boing") plus a ±3 % wobble at *Mod Rate*. *Freeze* closes the
input and sets the loop gain to 1 without damping. *Quality* and *Seed* only
act on the hall and are hidden. Switching *Type* uses the *Quality* fade
(10 ms out, empty tank, 10 ms in).

## 9. Later

- *Shimmer:* a pitch shifter (+12 / +7 semitones) inside the loop.
- *Early reflections* as a separate, shape-selectable stage (room, plate,
  hall) with its own level.
- A *Ducking* knob (wet ducks under the dry signal's envelope).
- A *Gate* mode for gated-reverb drums (tail cut after a hold time).
- 32-line *Ultra* quality for very long, dense tails.
