# Macro Osc

Type id `macro-osc` · category *Sources* · colour proposal `#38bdf8`

## 1. Purpose

Sixteen synthesis models behind one *Model* selector, each played with the
same three macro knobs. The knobs keep their place on the panel but change
their meaning (and their label) with the model, so one patch can move from a
detuned analog pair to FM, a vowel, a plucked string or a snare by turning
one knob. A secondary *Aux* output carries a related second voice of each
model, and a *Trigger* input with a built-in decay and low-pass gate turns any
model into a struck, percussive sound without extra modules.

The Macro Osc is a sketching tool and a compact voice for Voice Cells. The
dedicated oscillators (Oscillator, Dual Osc, Formant Osc, Additive Osc,
Swarm, Wavetable Osc) go deeper into one technique each; several Macro Osc
models are reduced versions of their cores (section 7).

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct, added to *Octave*, *Coarse* and *Fine*; 0.0 = C4. |
| FM | `audio` | Linear, through-zero frequency modulation, scaled by *FM Depth*. Ignored by the noise and drum models (they use it as *Tone* modulation instead, see 4.4). |
| Trigger | `trigger` | Strikes the internal envelope (4.3) and excites the percussive models. In a Voice Cell, patch *Voice In › Trigger* here. |
| Accent | `control` (unipolar) | Strength of each strike, sampled at the trigger; unpatched counts as 1. Patch *Voice In › Velocity* here. |

Every knob is also an input (`specs.md` section 7.3), including *Model*.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The model's main signal, about −1…+1, through the low-pass gate when *Trigger* is patched. |
| Aux | `audio` | The model's second signal (listed per model in 4.2), also through the gate. |
| Env | `control` (unipolar) | The internal decay envelope, 0–1. Useful for a filter or a VCA elsewhere. 0 while *Trigger* is unpatched. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Model | 1–16 (stepped) | 1 (VA Pair) | Picks the synthesis model. Modulation steps through the models (4.5). |
| Octave | −4…+4 (stepped) | 0 | Whole octaves. |
| Coarse | −12…+12 st | 0 | Semitones. |
| Fine | −100…+100 ct | 0 | Cents. |
| Tone | 0–100 % | 50 % | Macro 1: the model's main timbral axis (label changes per model). |
| Shape | 0–100 % | 50 % | Macro 2: the model's second axis. |
| Blend | 0–100 % | 0 % | Macro 3: a mix, balance or morph within the model. |
| FM Depth | 0–100 % | 0 % | Depth of the *FM* input; at 100 % a ±1 signal swings the frequency by ±4× (through zero). |
| Decay | 5 ms – 10 s | 400 ms | Decay time (−60 dB) of the internal envelope and of the percussive models' resonators. |
| Gate Colour | 0–100 % | 50 % | How the low-pass gate closes: 0 % pure VCA, 100 % pure low-pass, between both (4.3). |
| Level | 0–100 % | 80 % | Output level of *Out* and *Aux*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Quality | Eco, Normal, High | Normal |
| Seed | 0–999 | 1 |

*Quality* sets the oversampling factor of the models that need it (Eco 1×,
Normal 2×, High 4×) and the resonator count of *Modal*.

## 4. Behaviour

### 4.1 Pitch

`f = 261.63 Hz × 2^(Octave + Coarse/12 + Fine/1200 + Pitch)`, clamped to
1 Hz…0.45 × sample rate. FM is applied as in the Oscillator:
`f × (1 + 4 × FM Depth × FM)`; negative frequencies run the phase backwards.
For the noise models *f* is the centre of the filter; for the drum models it
is the body pitch (C4 default = a mid tom; *Octave* −2 gives a kick).

### 4.2 Models

The view shows each knob's per-model label (in brackets below).

| # | Model | Tone | Shape | Blend | Aux |
|---|---|---|---|---|---|
| 1 | **VA Pair** — two polyBLEP oscillators | [Detune] 0–1 semitone, then quantised intervals (3rd, 4th, 5th, octave) above 50 % | [Wave] saw → square → 5 % pulse | [Sync] 0 free, up: osc 2 hard-synced to osc 1 at rising ratio | osc 2 alone |
| 2 | **Fold** — sine/triangle into a 4-stage folder | [Fold] drive 1…16× | [Bias] DC offset before folding: even harmonics | [Source] sine → triangle | the pre-fold source × drive, hard-clipped |
| 3 | **FM** — 2-operator phase modulation | [Ratio] modulator ratio from ½, 1, 1.5, 2, 3, 3.5, 4, 5, 7, 9 (crossfaded) | [Index] 0–8 | [Feedback] modulator self-feedback 0–1.2 | the modulator |
| 4 | **Phase Warp** — a sine read through a bent phase | [Warp] knee of a 2-segment phase curve | [Resonance] window × sine at 1…16× the frequency, reset each cycle | [Mix] warp ↔ resonance | the square of the phase reset (sub-like) |
| 5 | **Grain** — windowed sine bursts per cycle | [Formant] grain frequency ½…16× | [Width] grain length | [Pair] adds a second grain at a ×1.5 formant | the carrier sine |
| 6 | **Harmonic** — 24 additive partials | [Centre] spectral peak partial 1…24 | [Width] peak width | [Odd/Even] odd only → all → even only | the odd partials only |
| 7 | **Table** — Wavetable Osc factory banks | [Bank] 8 banks (stepped) | [X] position | [Y] position | the same at half rate (one octave down) |
| 8 | **Chord** — four voices of a chord | [Chord] octave, 5th, sus2, sus4, minor, major, m7, maj7, 7, m9, maj9, 6/9 | [Voicing] inversion and spread | [Wave] sine → triangle → saw | the root alone |
| 9 | **Vowel** — glottal pulse into 3 formant band-passes | [Vowel] a → e → i → o → u morph | [Size] formant shift −1…+1 octave (small to large vocal tract) | [Breath] voiced → whispered | the unvoiced (noise) part |
| 10 | **Noise Band** — white noise into a resonant SVF at *f* | [Resonance] Q 0.5…40 | [Mode] LP → BP → HP | [Clock] clean → sample-rate reduced noise | the other side of the mode (HP when LP, …) |
| 11 | **Dust** — sparse random impulses | [Density] 1…20 000 /s | [Colour] impulse filter, dark → bright | [Bipolar] positive-only → random sign | the impulses before filtering |
| 12 | **Pluck** — a plucked string (delay line + damping) | [Bright] exciter colour | [Damping] loss per round trip | [Position] pluck position (comb on the exciter) | the exciter |
| 13 | **Modal** — 8–24 struck resonators | [Material] mode ratios: string → bar → plate → bell | [Bright] high-mode level | [Stretch] inharmonic stretch of the mode ratios ±15 % | the odd modes only |
| 14 | **Kick** — swept sine with click | [Sweep] pitch drop 0–4 octaves | [Punch] sweep speed | [Drive] soft clip | the click |
| 15 | **Snare** — two resonators plus noise | [Snappy] noise level | [Tone] resonator balance | [Noise Colour] band-pass of the noise | the noise only |
| 16 | **Metal** — six detuned squares, filtered | [Colour] high-pass cutoff | [Spread] detune spread | [Ring] adds a band-pass resonance | the unfiltered metal |

DSP notes per family:

- **Discontinuous waveforms** (1, the reset in 4, 8 saw) use polyBLEP / polyBLAMP,
  as the Oscillator does. Hard sync uses the BLEP at the reset point.
- **Nonlinear models** (2, 3 with feedback, 4) run at the *Quality*
  oversampling factor, with a polyphase half-band decimator (stopband −90 dB).
- **Harmonic** drops partials above 0.45 × sample rate with a short fade
  (last octave before Nyquist), so sweeping the pitch never aliases or clicks.
- **Table** reads the mipmapped Wavetable Osc banks (wavetable-oscillator.md).
- **Vowel** formants are zero-delay-feedback SVF band-passes (`Svf.h`), with
  formant tables for the five vowels interpolated in log frequency.
- **Chord** reads its chord list from `Chords.h`, the table of the Chord Osc
  (chord-oscillator.md); the Macro Osc offers the 12 most common entries.
- **Pluck** uses the shared waveguide string (`Waveguide.h`, resonator.md):
  a delay line with a fractional (Thiran allpass) read and a one-pole damping
  filter, the loop delay compensated for the filter's phase delay so the
  string stays in tune up to C8.
- **Modal** uses the shared modal bank (`ModalBank.h`, resonator.md) with
  8 / 16 / 24 modes by *Quality*. For a full exciter-plus-resonator
  instrument use Modal Voice; for struck percussion with more control, Perc
  Voice.
- **Snare / Kick / Metal** reuse `Resonator`, `SweepOsc`, `Metal` and
  `Decay` from `patch/common/dsp/Drums.h`, as Punch Drums and Ring Drums do.

### 4.3 Trigger, envelope and low-pass gate

- **Trigger unpatched:** the pitched models (1–9) sound continuously;
  *Decay* and *Gate Colour* do nothing; *Env* is 0. *Pluck* and *Modal* are
  excited by a low, continuous noise (a bowed/blown sound). *Kick*, *Snare*
  and *Metal* are silent and the node shows "patch Trigger".
- **Trigger patched:** each trigger sets the envelope to *Accent* (no attack
  ramp, but a 0.5 ms anti-click rise), which then falls exponentially to −60 dB
  in *Decay*. Out and Aux pass through a **low-pass gate**: a VCA and a
  2-pole ZDF low-pass (`Svf.h`, Q 0.7) in series, both driven by the envelope.
  With `c` = *Gate Colour*, the VCA gain is `env^(3(1 − c))` and the cutoff
  is `20 Hz × 2^(10 × (1 − c + c × env))`, so 0 % is a plain VCA (cubic law,
  cutoff fully open at 20 kHz), 100 % is a pure filter sweep (the level falls
  as the cutoff closes), 50 % both. The envelope runs through a 3 ms one-pole
  smoother so the gate closes with a soft, slightly lagging tail. This is a
  deliberately simple gate; the Low Pass Gate module (low-pass-gate.md) is
  the full model with its slow, uneven release.
- The percussive models (12–16) are struck by the same trigger with strength
  *Accent*; their internal decays follow *Decay*. A retrigger adds energy to
  ringing resonators instead of restarting them, so fast rolls build up.
- *Shape* / *Blend* changes are sampled per sample; drum models additionally
  latch *Tone* at the trigger so a moving knob doesn't smear a hit.

### 4.4 Noise and determinism

Noise in models 9–16 comes from a xorshift generator seeded with
`hash(Seed, voice index)` (`Random.h`). It is reseeded when the transport
starts, so offline renders repeat. *Dust* impulse times are derived from the
same generator. For models without a pitch, the *FM* input adds to *Tone*
(cable amount 100 % = the full knob range).

### 4.5 Model changes

*Model* is a stepped knob: modulation rounds to the nearest model. A change
crossfades over 5 ms from the old model to the new one (both run during the
fade), so sequencing *Model* from a Step Sequencer or Random gives clean
changes. Each model keeps its own state, so switching away and back mid-note
doesn't reset a ringing string. Models only run while selected or fading.

### 4.6 Transport

The oscillators run freely and ignore the transport, except that noise is
reseeded at transport start (4.4). Stopping the transport does not mute the
module; that is the job of the gate or VCA after it.

### 4.7 CPU

Per voice at 48 kHz, Normal quality, target on one core of a 2020 laptop:
≤ 1 % for models 1, 5–8, 10–11, 14–16; ≤ 2 % for 2–4 (oversampled), 9, 12;
≤ 4 % for *Modal* at 24 modes (High) and *Harmonic* at 24 partials. Outputs
not patched aren't computed where a model allows it (*Aux* of *Chord*, *Vowel*).

## 5. Module view

```
 ┌────────────────────────────────────────────────────────────┐
 │  Model  [ 3  FM  ▾ ]          ┌──────── scope ─────────┐  │
 │  Pitched │ Noise │ Struck     │ ∿∿∿∿∿  Out   ‒‒ Aux    │  │
 │                               └────────────────────────┘  │
 │   ( Ratio )   ( Index )   ( Feedback )                     │
 │    Tone        Shape        Blend                          │
 │  Octave  Coarse  Fine  FM Depth │ Decay  Gate Colour  Level │
 └────────────────────────────────────────────────────────────┘
```

- **Model picker:** a dropdown grouped *Pitched* (1–9), *Noise* (10–11),
  *Struck* (12–16), plus a 16-cell grid of icons for one-click selection.
- **Macro labels:** the large label under each macro knob is the per-model
  name; the small one is the fixed name (*Tone*, *Shape*, *Blend*) used by
  cables and presets.
- **Scope:** one cycle of *Out* (pitched models, triggered on the phase) or a
  rolling 50 ms window (others), with *Aux* dashed.
- *Decay* and *Gate Colour* are dimmed while *Trigger* is unpatched.
- Width 520 px.

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "macro-osc",
  "params": { "model": 0.1333, "tone": 0.5, "shape": 0.5, "blend": 0.0,
              "decay": 0.42, "gateColour": 0.5, "quality": 0.5, "seed": 0.001, … } }
```

*Model* is saved normalised over a fixed range of 32 slots (16 used), so
models added later at the end never change the meaning of a saved value.

## 7. Engine requirements

1. **Shared oscillator cores** in `patch/common/dsp/`: `OscCore.h` (phase,
   morph, polyBLEP/polyBLAMP, moved out of `OscillatorDsp.h` as proposed in
   chord-oscillator.md), `Oversampler.h` and `Folder.h` (wavefolder.md),
   `SineTable.h`, `Formant.h` (Formant Osc), `Partials.h` (Additive Osc),
   `WavetableBank.h` (Wavetable Osc), `Chords.h` (Chord Osc), `Waveguide.h`
   and `ModalBank.h` (Resonator). The Macro Osc is built from these, not from
   copies; it is best built after the modules that introduce them.
2. **Stepped modulatable knobs.** `ParamSpec` needs an integer knob whose
   modulated value is rounded (also used by Wavetable Osc *Bank*). Today
   integer params are settings only.
3. **Dynamic knob labels.** `Module::liveValues` (or a static table in the UI
   type file) supplies the per-model labels; the UI type file lists them.
4. **Inside Voice Cells:** one instance per voice; *Env* can feed
   *Voice Out › Active* through a Utility comparator, or the voice is freed by
   the default −90 dB rule.

## 8. Tests

- Pitch: 0 V plays 261.63 Hz ±0.1 cent for every pitched model (FFT peak or zero crossings); +1 V doubles it.
- Aliasing: models 1, 2, 3, 4, 6 swept C2→C8 at 48 kHz keep all aliased components below −80 dB (High) / −60 dB (Normal) relative to the fundamental.
- Harmonic: no partial above 0.45 × sample rate is present; sweeping across the cut is click-free (no sample-to-sample jump > 0.1).
- Model change: a modulated *Model* step produces no discontinuity larger than the signal's own slope (crossfade works); each index in 1–16 is reachable.
- Trigger: *Env* jumps to *Accent* on the trigger sample (+ 0.5 ms ramp) and is ≤ −60 dB after *Decay*; with Trigger unpatched, *Env* is 0 and pitched models are ungated.
- Drums are silent without a trigger; Pluck stays in tune within 2 cents from C2 to C7.
- Determinism: two renders with the same Seed are bit-identical for every model; different voice indices give different noise.
- Saved params round-trip; the module appears in the demo types file (`patch.ui-types`).
- CPU benchmark per model stays under the budgets in 4.7 (reported, not a hard fail in CI).

## 9. Later

- A stereo output pair with per-model width (chord voices, modal modes panned).
- More models: speech synthesis from phoneme strings, bowed string, granular noise cloud, 4-operator FM.
- User wavetables in *Table* (shared with the Wavetable Osc's imported banks).
- Per-model knob defaults applied when the model changes by hand (not by modulation).
- *Notes* input with built-in polyphony for chord models.
