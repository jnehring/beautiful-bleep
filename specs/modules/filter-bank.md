# Filter Bank

Type id `filter-bank` · category *Audio* · colour proposal `#eab308`

## 1. Purpose

Splits a sound into ten bands with fixed band-pass filters, each with its own
level, its own audio output and its own envelope output. Shape the spectrum
by hand or with modulation (a *Tilt* knob, an odd/even balance, a scanning
window that sweeps across the bands), send single bands to different
effects, or use the envelope outputs to make other sounds follow this one's
spectrum: patched into a second bank's levels, that is a vocoder. A built-in
*Vocode* knob does exactly that with a sidechain, without the cables.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is unpatched. |
| In R | `audio` | Right input. |
| Sidechain | `audio` | Analysis input for the envelopes when *Env From* is *Sidechain* (the modulator in a vocoder). |
| Pitch | `pitch` | Transposes the band frequencies in *Harmonic* and *Scale* tuning (4.1). |

Every knob is also an input (`specs.md` section 7.3), including the ten band
levels.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Sum L, Sum R | `audio` | All bands after level, tilt, scan and *Vocode*, plus the dry signal per *Mix*. |
| Odd | `audio` | Bands 1, 3, 5, 7, 9 summed, mono ((L + R)/2). |
| Even | `audio` | Bands 2, 4, 6, 8, 10 summed, mono. |
| Band 1 … Band 10 | `audio` | Each band alone, mono, after its gain (4.3). |
| Env 1 … Env 10 | `control` (unipolar) | Each band's envelope, 0–1 (4.4). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Level 1 … 10 | −∞…+12 dB (0–100 %, 75 % = 0 dB) | 0 dB | Gain of each band. |
| Q | 0.5–30 (exponential) | 2.2 | Sharpness of all bands. The default gives a sum within ±1 dB of flat. |
| Tilt | −6…+6 dB/oct | 0 | Spectral slope around 1 kHz, applied as band gains. |
| Odd/Even | −100…+100 % | 0 % | −100 %: only odd bands; +100 %: only even bands. |
| Scan | 0–100 % | 50 % | Centre of a window over the bands (0 % = band 1, 100 % = band 10). |
| Width | 1–10 bands | 10 | Width of the scan window. 10 = all bands pass (the window is off). |
| Shift | −2…+2 octaves | 0 | Moves all band frequencies together. |
| Spacing | 50–200 % | 100 % | Stretches or squeezes the bands around the middle (between bands 5 and 6). |
| Attack | 0.5–100 ms (exponential) | 3 ms | Envelope followers' attack. |
| Release | 5–2000 ms (exponential) | 80 ms | Envelope followers' release. |
| Vocode | 0–100 % | 0 % | How much the band envelopes multiply the band gains (4.5). |
| Mix | 0–100 % | 100 % | Dry ↔ bank, for *Sum*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Tuning | Spectral, Harmonic, Scale | Spectral |
| Root | C … B (Scale tuning) | C |
| Scale | the Step Sequencer's scales (`Scales.h`) | Minor Pentatonic |
| Slope | 12 dB/oct, 24 dB/oct | 12 dB/oct |
| Edge Bands | Band-pass, Low-pass/High-pass | Low-pass/High-pass |
| Env From | Input, Sidechain | Input |
| Stereo | Normal, Odd/Even split | Normal |

## 4. Behaviour

### 4.1 Band frequencies

Ten centre frequencies `f_k`, k = 1…10, before *Shift* and *Spacing*:

| Tuning | f_k |
|---|---|
| Spectral | log-spaced from 55 Hz to 14 kHz: `55 · 254.5^((k−1)/9)` (about 0.89 octaves apart): 55, 102, 189, 349, 646, 1196, 2213, 4097, 7583, 14000 Hz |
| Harmonic | `f0 · k`, with `f0 = 65.41 Hz (C2) · 2^Pitch`: the first ten partials of a note — a resonant bank that plays in tune |
| Scale | ten consecutive notes of *Scale* from *Root* in octave 2, transposed by *Pitch* (quantized to the scale): a pitched, chord-like resonator |

Then, in octaves relative to the geometric middle `m = sqrt(f_5 · f_6)`:
`f'_k = m · 2^(Shift) · (f_k / m)^(Spacing)`. All frequencies are clamped to
20 Hz … 0.45 · fs; bands that hit the top clamp are muted rather than
stacked. *Shift* and *Spacing* modulation is applied in octaves, so an LFO on
*Shift* sweeps the whole bank like a phaser.

### 4.2 Filters

Each band is a ZDF state-variable band-pass (`dsp::Svf`), unit gain at the
centre (`bp · 2R`, as the Filter's *SVF Bandpass (unit gain)*). At *24 dB/oct*
each band is two cascaded SVFs at `Q · 0.64` (so the bandwidth stays similar).
With *Edge Bands* = Low-pass/High-pass, band 1 is a 2-pole low-pass and band
10 a 2-pole high-pass, so the sum covers the whole spectrum (roughly flat at the
default Q, with the usual band-pass sum ripple of about ±1 dB). Alternate bands
are not polarity-flipped: the overlap regions sum in phase at the default Q.

Coefficients (one `tan` per band) are recomputed every 8 samples while
*Shift*, *Spacing*, *Q* or *Pitch* move, and linearly interpolated in between;
the ZDF topology keeps this click-free.

### 4.3 Band gains

The gain of band `k` is the product of:

1. **Level** k.
2. **Tilt:** `10^(Tilt · log2(f'_k / 1 kHz) / 20)` (dB/oct around 1 kHz).
3. **Odd/Even:** odd bands × `min(1, 1 − OE)`, even bands × `min(1, 1 + OE)`
   (OE = Odd/Even in −1…+1).
4. **Scan window:** a raised-cosine window over the band index, centre
   `1 + 9 · Scan`, half-width `Width / 2` bands; bands outside get 0. At
   *Width* 10 the window is 1 everywhere.
5. **Vocode** (4.5).

Gains are smoothed over 5 ms, except when a cable modulates them at audio
rate (then per sample, unsmoothed, like any knob input).

### 4.4 Envelope followers

One peak follower per band (`dsp::EnvelopeFollower`, *Attack* and
*Release*), fed by the band's filter output **before** its gain, so the
envelopes describe the source and don't change when you turn levels. Source:
the input ((L + R)/2) or, with *Env From* = Sidechain, the *Sidechain* signal
through its own bank of ten filters (same frequencies). The outputs are
scaled by 2 and clamped to 0…1, so a full-scale sine in one band reads about 1.

### 4.5 Vocoding

*Vocode* scales each band by its envelope:
`gain_k ×= (1 − V) + V · env_k · 4` (clamped to 0…4). With *Env From* =
Sidechain, a voice on *Sidechain* and a bright synth on *In*, *Vocode* at
100 % is a ten-band vocoder; lower values blend in the unvocoded synth. With
*Env From* = Input, Vocode works as a per-band expander (loud bands get
louder).

The same works with cables: two banks, *Env k* of the first into *Level k*
of the second (amount 100 %, levels at 0). That allows extra processing
between them (slew, quantize, swapping bands for formant shifting) — the
reason the envelopes are outputs at all.

The Meta Mod's *Vocoder* algorithm (`meta-modulator.md` section 4.3) is a
fixed 12-band version for quick use; this bank is the detailed one.

### 4.6 Stereo

The filters run per channel (In R unpatched: once, copied). *Sum L/R* is the
stereo result. With *Stereo* = Odd/Even split, *Sum L* carries the odd bands
and *Sum R* the even bands (of L + R), a classic spectral widener for mono
sources. The single-band, Odd and Even outputs are always mono (L + R)/2 of
the stereo band signals, so they cost no extra filtering.

### 4.7 CPU

Per sample: 10 SVFs per channel (20 at 24 dB/oct), plus 10 (or 20) for the
sidechain, plus 10 followers — at most 60 SVF ticks, roughly the cost of six
Filter modules in *SVF Multimode*. Bands whose gain is 0 and whose *Band*
output is unpatched are skipped (their filters keep running only while the
envelope output is patched).

## 5. Module view

The usual knobs and settings, with the ten *Level* knobs drawn as a slider
bank:

```
 ┌───────────────────────────────────────────────────────────────┐
 │  ▇   ▆   ▇   ▅   ▇   ▃   ▇   ▅   ▆   ▇    ← levels (drag)      │
 │  ▂   ▅   ▇   ▃   ▁   ▁   ▂   ▃   ▁   ▁    ← envelopes (live)   │
 │  55  102 189 349 646 1.2k 2.2k 4.1k 7.6k 14k Hz                │
 │  ╰────── scan window ──────╯                                   │
 └───────────────────────────────────────────────────────────────┘
```

- **Level sliders:** drag across the bank to draw a curve (one undo step per
  drag); double-click resets a band to 0 dB. A mod ring on each slider shows
  cable modulation.
- **Envelope meters** under the sliders show the live envelopes; the effective
  gain (after tilt, odd/even, scan, vocode) is drawn as an outline on each
  slider.
- **Band labels** show the current frequencies (or note names in Harmonic
  and Scale tuning).
- **Presets** button: *Flat*, *Smile*, *Telephone*, *Odd only*, *Comb*
  (alternate bands at −∞): writes the ten levels, one undo step.

## 6. Saved state

Only knob and setting values; no node data. The ten levels are ordinary
knobs (`level1` … `level10`), so they are automatable and modulatable.

```json
{
  "type": "filter-bank",
  "params": { "level1": 0.75, "level2": 0.75, …, "level10": 0.75,
              "q": 0.36, "tilt": 0.5, "oddEven": 0.5, "scan": 0.5,
              "width": 1.0, "shift": 0.5, "spacing": 0.5, "attack": 0.34,
              "release": 0.46, "vocode": 0.0, "mix": 1.0,
              "tuning": 0.0, "root": 0.0, "scale": 0.8125, "slope": 0.0,
              "edgeBands": 1.0, "envFrom": 0.0, "stereo": 0.0 }
}
```

## 7. Engine requirements

1. **Many outputs:** 24 output jacks. The node needs a compact jack layout
   (two columns, grouped *Sum*, *Bands*, *Envs*) on the canvas.
2. **Output connection flags:** `ctx.outputConnected` (new, the counterpart of
   `inputConnected`), so unpatched band outputs and envelopes can be skipped.
   Also used by the Multi-out Filter.
3. **Scales:** `patch/common/dsp/Scales.h` (exists).
4. **Self-patching:** *Env k* into the same module's *Level k* is a cycle and
   becomes a feedback cable with one sub-block delay (`specs.md` section 7.5),
   which is fine for envelopes; the *Vocode* knob avoids it.

## 8. Tests

- Spectral tuning: centre frequencies match the table within 0.1 %; Shift +1
  octave doubles them; Spacing 50 % halves every band's distance (in octaves)
  from `m`.
- A sine at each `f_k` appears at *Band k* at 0 dB (±0.5 dB) and at least 15
  dB lower at the neighbouring bands (default Q).
- Default settings: the sum response of pink noise is within ±1.5 dB of the
  input from 60 Hz to 12 kHz.
- Odd/Even −100 %: even bands are silent; *Odd* + *Even* = the band sum.
- Tilt +6 dB/oct: band 10 is 6 dB/oct × its octave distance above band 5.
- Scan with Width 1 passes one band only; moving Scan from 0 to 100 % passes
  each band once in order.
- Envelopes: a 1 kHz burst raises the envelope of the 1196 Hz band most;
  attack/release times within 10 % of the setting.
- Vocode 100 % with a silent sidechain: *Sum* is silent; with a sidechain
  equal to the input, the result is the input expanded per band.
- Harmonic tuning with Pitch 0: band k at 65.41 · k Hz.
- No band frequency exceeds 0.45 · fs at any Shift, Spacing or Pitch.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A *Freeze* button that holds the current envelopes.
- Band count setting (6/10/16) and user-entered frequencies.
- Per-band pan for spectral stereo placement.
- A *Swap* setting that maps sidechain band k to synthesis band 11 − k (or a
  shifted index) for formant effects without cables.
- Envelope outputs as one multichannel cable, once the board has them.
