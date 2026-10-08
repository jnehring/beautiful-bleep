# Perc Voice

Type id `perc-voice` · category *Sources* · colour proposal `#fdba74`

## 1. Purpose

One percussion voice that covers kicks, toms, hand drums, bells, metal and
noisy hits from a single model. *Pitch* sets the fundamental, *Tone* walks the
spectrum from a pure sine through drum-membrane and bar partials to
inharmonic clang, *Morph* shapes what happens within the chosen engine, and
*Click*, *Decay* and *Sweep* shape the hit. Three engines (FM, Modal and
Noise Bank) give three families of sounds behind the same knobs, so a
sequencer or LFO can morph a kick into a bell. Put it in a Voice Cell for a
polyphonic, pitched percussion instrument.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Trig | `trigger` | Strikes the voice. |
| Accent | `control` (unipolar) | Hit strength, sampled at the trigger: louder, brighter and a deeper sweep (4.5). Unpatched counts as 0.7. In a Voice Cell, patch *Voice In › Velocity* here. |
| Pitch | `pitch` | Added to *Pitch*, 1 V/oct. Sampled at the trigger unless *Track* is on. |
| Choke | `trigger` | Fades the sound out over 5 ms (open/closed pairs, muting a ringing bell). |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The voice; *Spread* sets its stereo image. |
| Env | `control` (unipolar) | The amplitude envelope, for ducking or for a Voice Cell's *Voice Out › Active* (via *Active*). |
| Active | `gate` | High from the strike until the sound has fallen below −80 dB or was choked. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Pitch | 20 Hz – 4 kHz | 55 Hz | Fundamental (exponential; 1 V/oct input adds). |
| Tone | 0–100 % | 20 % | Spectrum: sine (0 %) → membrane modes (33 %) → bar modes (67 %) → inharmonic metal (100 %); morphs continuously (4.2). |
| Morph | 0–100 % | 50 % | Engine-specific (4.3): FM index, partial balance, or noise band width. Its name follows the engine (*FM Index*, *Balance*, *Width*). |
| Click | 0–100 % | 30 % | Transient: a short filtered noise burst plus a pitch blip at the start. |
| Decay | 10 ms – 8 s | 400 ms | T60 of the body. |
| Damp | 0–100 % | 40 % | How much faster upper partials decay (0 = all equal, 100 % = highs 8× shorter). |
| Sweep | 0–100 % | 40 % | Pitch drop at the start: up to +3 octaves falling to *Pitch*, time ≈ Decay / 8. |
| Spread | 0–100 % | 20 % | Stereo spread: Modal and Noise Bank pan odd partials left and even right (the fundamental stays centred); FM detunes the two sides' carriers by up to ±8 cents. |
| Level | 0–100 % | 80 % | Output level. |

**Settings**

*Engine* is a stepped knob (modulatable, read at each strike), so a
sequencer can pick the engine per hit.

| Setting | Values | Default |
|---|---|---|
| Engine | FM, Modal, Noise Bank (stepped knob) | Modal |
| Track | off (pitch sampled at trigger) / on (follows live) | off |
| Drive | Clean, Warm, Hot | Clean |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 The model

Every engine produces up to **8 partials**. Partial *k* has a frequency ratio
`r_k` (from *Tone*, 4.2), an amplitude `a_k` and its own decay
`T60_k = Decay × d_k` with `d_k = (1 / r_k) ^ (3 × Damp)`, so higher partials
die faster when *Damp* is up. The fundamental's pitch envelope (*Sweep*)
applies to all partials, keeping the ratios: it starts at
`3 oct × Sweep × accent depth` and falls exponentially to 5 % in Decay / 8.

The amplitudes are `a_k = fade_k · k^tilt`, normalised (FM: to a sum of 1;
Modal and Noise Bank: to a power of 1), with `fade_k` the Tone fade-in of
partials 2–8 (4.2) and the tilt per engine: Modal `−2 + 3 · Morph`, FM `−1`,
Noise Bank `−0.5`, each lowered by `0.8 · (1 − Accent)` (4.5). Modal and
Noise Bank outputs are scaled by 0.7 and 0.8 so the default hit peaks below
the output limiter's knee.

### 4.2 Tone: ratio tables

*Tone* interpolates the ratio set between four tables (linear in log
frequency, so partials glide rather than jump):

| Tone | Table | Ratios r_1 … r_8 |
|---|---|---|
| 0 % | Sine | 1 (others silent) |
| 33 % | Membrane (circular plate modes) | 1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.50 |
| 67 % | Bar (free bar modes) | 1, 2.76, 5.40, 8.93, 13.34, 18.64, 24.81, 31.87 |
| 100 % | Metal (seeded inharmonic set) | 1, then 7 ratios between 1.3 and 9 drawn from *Seed* |

Between 0 % and 33 % the amplitudes of partials 2–8 fade in, so the low end
of the knob is a clean kick body. Partials above 0.45 × sample rate are
muted with a smooth roll-off (no aliasing when sweeping *Pitch* up).

### 4.3 Engines

- **FM** — Each partial is a sine **modulator** at `r_k × f`, summed and
  phase-modulating one sine **carrier** at *f*. *Morph* is the modulation
  index (0–8), decaying with its own envelope (half of *Decay*), so the
  attack is bright and the tail purer: classic FM toms, kicks and bells.
- **Modal** — The partials are 8 struck resonators (complex one-pole, as in
  `dsp/Drums.h Resonator`), excited by an impulse of `a_k × level` at the
  strike (zero phase, so they start without a click) and by the click burst.
  *Morph* tilts the amplitude balance: 0 % fundamental-heavy (drums), 100 %
  upper partials (glassy bells). A second strike adds to the ringing like a
  real body, so rolls build up naturally.
- **Noise Bank** — Seeded white noise feeds 8 resonant band-passes (TPT SVF)
  at the partial frequencies. *Morph* is the bandwidth: 0 % narrow (Q 40,
  almost pitched: steel drums, wood), 100 % wide (Q 0.7: snares, shakers,
  breathy hits), log-spaced in between. Each band is normalised so white noise
  gives about the same level at any width, then shaped by its partial's
  amplitude and decay. Combined with Tone 100 % it gives cymbals and gongs.

*Engine* is read at each strike; the sounding hit finishes with its own
engine.

### 4.4 Click

The click is 1–6 ms of seeded noise through a band-pass at 2–8 kHz (higher
with *Tone*), plus a +2 octave pitch blip on the fundamental for the first 2
ms. *Click* scales both. In Modal and Noise Bank it also excites the
resonators, so the click colours the body.

### 4.5 Accent

Accent `a` (0–1) sets: level × (0.4 + 0.6 a), Click × (0.5 + a), Sweep depth
× (0.6 + 0.4 a), FM index × (0.7 + 0.6 a), and tilts the partial amplitudes
by `k^(−0.8 (1 − a))`. So soft hits are duller as well as quieter, like a
real drum. The *Hit* button plays at accent 0.7, as does *Trig* with *Accent*
unpatched.

### 4.6 Retriggering and clicks

Outside a Voice Cell the module is monophonic but uses **two internal
voices**: a new strike starts on the free one while the previous hit fades
over 3 ms (Modal on a sounding Modal hit: keeps ringing and is re-struck
instead, 4.3). Retriggering never clicks. *Choke* fades the sounding voice(s)
over 5 ms.

Knob changes during a hit apply immediately and smoothly: partial ratios,
amplitudes and decays are recomputed every 8 samples from the effective
values, and the pitch envelope and partial frequencies per sample (the
resonator rotations and band-pass coefficients use polynomial sin/cos and a
Padé tan, so this stays cheap). FM uses phase accumulators, so modulating
*Pitch* or *Tone* at audio rate gives FM-like timbres, not clicks. *Decay*
modulation changes the decay rate from the next update on.

A hit ends (and *Active* falls) when its body has stayed below −80 dB for 32
samples and its click is over; the voice then costs nothing.

### 4.7 Polyphony and transport

- **Voice Cells:** works per voice like the Oscillator. Patch *Voice In ›
  Trigger* into *Trig*, *Pitch* into *Pitch*, *Velocity* into *Accent*, and
  *Active* into *Voice Out › Active*. The *Basic Perc* factory preset (7.3,
  not built yet) will do this.
- The *Pitch* input adds octaves to the *Pitch* knob (0 V = the knob's
  frequency).
- The voice runs regardless of transport; a hit started before stop rings
  out. The noise and Metal ratios come from *Seed* (noise reseeded per strike
  from `hash(Seed, strike counter)`, counter reset on `transportStarted`), so
  renders are repeatable.

### 4.8 CPU

8 sines or resonators per voice: ≈ 0.1 % of one core per voice at 48 kHz,
×2 during a retrigger overlap. Voices sleep when *Active* is low.

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │  Engine [ FM | ●Modal | Noise ]                                │
 │  │ ▌                                                           │
 │  │ ▌  ▍ ▍  ▎ ▎ ▏▏      partials: position = ratio, height =   │
 │  └────────────────     amplitude, shade = decay               │
 │  ▕██▇▅▃▂▁▁▁▁▁           amplitude envelope (Decay, Click)      │
 │  [ ▶ Hit ]                                                     │
 └───────────────────────────────────────────────────────────────┘
```

- **Partial display** drawn from the effective (modulated) values: you see
  *Tone* moving the partials and *Damp* shading the upper ones.
- **Envelope sketch** for the current Decay, Click and Sweep.
- **Hit** button strikes the voice at Accent 0.7 (audition without patching).

Live arrays `ratios`, `amps` and `decays` (8 each; decay as `T60_k / Decay`)
carry the partial set of the newest hit's engine at the current knobs, about
30 times a second.

## 6. Saved state

Knob and setting values only. No node data.

## 7. Engine requirements

1. Uses `dsp/Drums.h` (`decayCoef`, drive `softClip`), `dsp/Exciter.h`
   (`NoiseBurst` for the click), `dsp/Svf.h`, `dsp/Noise.h`, `dsp/Random.h`.
   The 8-partial engine and the ratio tables (`perc::` in
   `modules/perc-voice/dsp/PercVoiceDsp.h`) are local for now, written so they
   can move to `common/dsp` when Analog Drums and Drum + Mod want them.
2. **Audition from the view:** the *Hit* button is a module button
   (`ModuleSpec::buttons`), drained with `pollCommands` at the start of the
   next block.
3. **Factory preset *Basic Perc*** (*Add → Cell → Drums*): Voice Cell with
   Perc Voice, 8 voices, Allocation *lowest free*, Stealing *quietest*. Not
   built yet (board side).

## 8. Tests

- Tone 0 %, Sweep 0, Click 0: a pure sine at *Pitch* (THD < −60 dB) with the
  set T60 ± 10 %.
- Ratio tables: Tone 33 % and 67 % produce partials at the table ratios
  (FFT peaks at the ratios, ±3 % off-peak clearly lower).
- Damp 100 %: partial 2's T60 is shorter than partial 1's by the formula.
- Each engine at the default settings produces a finite, non-silent output
  and decays below −80 dB within 1.4 × Decay (the fundamental's T60 is
  *Decay*, and −80 dB is 1.33 × T60 from full level); *Active* falls then.
- Accent 0 vs 1: level and brightness (spectral centroid) increase.
- Retrigger every 10 ms for 1 s: no sample-to-sample step above a threshold
  relative to the signal; Choke fades in 5 ms ± 1 ms.
- Audio-rate modulation of Pitch and Tone: bounded, no NaNs or Infs.
- Same Seed → identical output for the Noise Bank and Metal ratios.
- In a Voice Cell, 8 overlapping pitched strikes play 8 voices; voices free
  when Active falls.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Exciter input: audio from outside excites the Modal and Noise Bank
  resonators.
- A *Body* stage (a second resonator set) for shells and cavities.
- Per-partial editing in the view (a user ratio table, saved as node data).
- Stereo positional strike (where on the drum it's hit) changing partial
  amplitudes.
