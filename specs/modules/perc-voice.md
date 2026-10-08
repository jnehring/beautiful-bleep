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
| Morph | 0–100 % | 50 % | Engine-specific (4.3): FM index, partial balance, or noise band width. |
| Click | 0–100 % | 30 % | Transient: a short filtered noise burst plus a pitch blip at the start. |
| Decay | 10 ms – 8 s | 400 ms | T60 of the body. |
| Damp | 0–100 % | 40 % | How much faster upper partials decay (0 = all equal, 100 % = highs 8× shorter). |
| Sweep | 0–100 % | 40 % | Pitch drop at the start: up to +3 octaves falling to *Pitch*, time ≈ Decay / 8. |
| Spread | 0–100 % | 20 % | Stereo spread of the partials (odd left, even right) plus slight per-side detune. |
| Level | 0–100 % | 80 % | Output level. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Engine | FM, Modal, Noise Bank | Modal |
| Track | off (pitch sampled at trigger) / on (follows live) | off |
| Drive | Clean, Warm, Hot | Clean |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 The model

Every engine produces up to **8 partials**. Partial *k* has a frequency ratio
`r_k` (from *Tone*, 4.2), an amplitude `a_k` and its own decay
`T60_k = Decay × d_k` with `d_k = (1 / r_k) ^ (3 × Damp)`, so higher partials
die faster when *Damp* is up. The fundamental's pitch envelope (*Sweep*)
applies to all partials, keeping the ratios.

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
  `dsp/Drums.h Resonator`), excited by the click burst and an impulse.
  *Morph* tilts the amplitude balance: 0 % fundamental-heavy (drums), 100 %
  upper partials (glassy bells). A second strike adds to the ringing like a
  real body, so rolls build up naturally.
- **Noise Bank** — Seeded white noise feeds 8 resonant band-passes (TPT SVF)
  at the partial frequencies. *Morph* is the bandwidth: 0 % narrow (Q 40,
  almost pitched: steel drums, wood), 100 % wide (Q 0.7: snares, shakers,
  breathy hits). Combined with Tone 100 % it gives cymbals and gongs.

Switching *Engine* (a setting) applies at the next strike; the sounding hit
finishes with the old engine.

### 4.4 Click

The click is 1–6 ms of seeded noise through a band-pass at 2–8 kHz (higher
with *Tone*), plus a +2 octave pitch blip on the fundamental for the first 2
ms. *Click* scales both. In Modal and Noise Bank it also excites the
resonators, so the click colours the body.

### 4.5 Accent

Accent `a` (0–1) sets: level × (0.4 + 0.6 a), Click × (0.5 + a), Sweep depth
× (0.6 + 0.4 a), FM index × (0.7 + 0.6 a). So soft hits are duller as well as
quieter, like a real drum.

### 4.6 Retriggering and clicks

Outside a Voice Cell the module is monophonic but uses **two internal
voices**: a new strike starts on the free one while the previous hit fades
over 3 ms (Modal: keeps ringing and is re-struck instead, 4.3). Retriggering
never clicks. *Choke* fades the sounding voice(s) over 5 ms.

Knob changes during a hit apply immediately and smoothly: all partial
frequencies, amplitudes and decays are recomputed per sample from the
effective values (cheap: 8 partials); FM uses phase accumulators, so
modulating *Pitch* or *Tone* at audio rate gives FM-like timbres, not clicks.
*Decay* modulation changes the decay rate from that sample on.

### 4.7 Polyphony and transport

- **Voice Cells:** works per voice like the Oscillator. Patch *Voice In ›
  Trigger* into *Trig*, *Pitch* into *Pitch*, *Velocity* into *Accent*, and
  *Active* into *Voice Out › Active*. The *Basic Perc* factory preset (7.3)
  does this.
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

## 6. Saved state

Knob and setting values only. No node data.

## 7. Engine requirements

1. Reuse `patch/common/dsp/Drums.h` (`Resonator`, `Decay`, `SweepOsc`) and
   `dsp/Noise.h`; add an 8-partial bank and the ratio tables there so Analog
   Drums and Drum + Mod can share them.
2. **Audition from the view:** a message-thread → audio-thread "strike" event
   for the *Hit* button (a one-shot flag on the module, consumed at the start
   of the next block). Useful for every drum module.
3. **Factory preset *Basic Perc*** (*Add → Cell → Drums*): Voice Cell with
   Perc Voice, 8 voices, Allocation *lowest free*, Stealing *quietest*.

## 8. Tests

- Tone 0 %, Sweep 0, Click 0: a pure sine at *Pitch* (THD < −60 dB) with the
  set T60 ± 10 %.
- Ratio tables: Tone 33 % and 67 % produce partials at the table ratios
  (FFT peaks within 1 %).
- Damp 100 %: partial 2's T60 is shorter than partial 1's by the formula.
- Each engine at the default settings produces a finite, non-silent output
  and decays below −80 dB within 1.2 × Decay; *Active* falls then.
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
