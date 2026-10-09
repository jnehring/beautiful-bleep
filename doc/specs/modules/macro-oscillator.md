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
models are reduced versions of their cores (4.2).

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct, added to *Octave*, *Coarse* and *Fine*; 0.0 = C4. |
| FM | `audio` | Linear, through-zero frequency modulation, scaled by *FM Depth*. *Pluck* and *Modal* take it at control rate (every 16 samples, as \|f\|). The models without a playable pitch (Noise Band, Dust, Kick, Snare, Metal) use it as *Tone* modulation instead (see 4.4). |
| Trigger | `trigger` | Strikes the internal envelope (4.3) and excites the percussive models. In a Voice Cell, patch *Voice In › Trigger* here. |
| Accent | `control` (unipolar) | Strength of each strike, sampled at the trigger; unpatched counts as 1. Patch *Voice In › Velocity* here. |

Every knob is also an input (`specs.md` section 7.3), including *Model*.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The model's main signal, about −1…+1, through the low-pass gate when *Trigger* is patched. |
| Aux | `audio` | The model's second signal (listed per model in 4.2), also through the gate. Its name follows the model ("Aux (Osc 2)", "Aux (Root)", …). |
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
| FM Depth | 0–100 % | 0 % | Depth of the *FM* input; at 100 % a ±1 signal swings the frequency by ±4× (through zero); for unpitched models a +1 signal adds the whole *Tone* range. |
| Decay | 5 ms – 10 s | 400 ms | Decay time (−60 dB) of the internal envelope and of the percussive models' resonators. |
| Gate Colour | 0–100 % | 50 % | How the low-pass gate closes: 0 % pure VCA, 100 % pure low-pass, between both (4.3). |
| Level | 0–100 % | 80 % | Output level of *Out* and *Aux*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Quality | Eco, Normal, High | Normal |
| Seed | 0–999 | 1 |

*Quality* sets the oversampling factor of the models that need it and the
mode count of *Modal*:

| Quality | Fold, FM, Phase Warp | VA Pair, Chord, Vowel glottis (polyBLEP) | Modal modes |
|---|---|---|---|
| Eco | 1× | 1× | 8 |
| Normal | 2× | 4× | 16 |
| High | 4× | 4× | 24 |

The polyBLEP models use 4× already at *Normal* because at 2× the residual
aliasing of polyBLEP is only about −55 dB at C7; they are cheap enough
(≈ 1 % CPU) that this costs little.

Knobs are grouped *Model*, *Pitch* (Octave, Coarse, Fine, FM Depth), *Macro*
(Tone, Shape, Blend) and *Gate* (Decay, Gate Colour, Level).

## 4. Behaviour

### 4.1 Pitch

`f = 261.63 Hz × 2^(Octave + Coarse/12 + Fine/1200 + Pitch)`, clamped to
1 Hz…0.45 × sample rate (the FM result too). FM is applied as in the Oscillator:
`f × (1 + 4 × FM Depth × FM)`; negative frequencies run the phase backwards.
For the noise models *f* is the centre of the filter; for the drum models it
is the body pitch (C4 default = a mid tom; *Octave* −2 gives a kick).

### 4.2 Models

The view shows each knob's per-model label (in brackets below).

| # | Model | Tone | Shape | Blend | Aux |
|---|---|---|---|---|---|
| 1 | **VA Pair** — two band-limited oscillators (`SyncOsc`) | [Detune] 0–70 %: osc 2 up 0…1 semitone on a slow curve (100·(t/0.7)⁵ cents, 50 % ≈ 19 ct); above: 3rd, 4th, 5th, octave | [Wave] saw → square (0–50 %), then the pulse narrows to 5 % (DC removed) | [Sync] 0 free; up: osc 2 hard-synced to osc 1, its ratio raised by up to 3 octaves | osc 2 alone |
| 2 | **Fold** — sine/triangle into 4 fold stages (`Folder`, ADAA) | [Fold] drive 1…16× (quadratic) | [Bias] offset before folding (50 % = none, ±0.6) | [Source] sine → triangle | the driven source, hard-clipped |
| 3 | **FM** — 2-operator phase modulation | [Ratio] ½, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 7, 9: each owns 1/11 of the knob (50 % = 3), neighbours crossfade around the borders | [Index] 0–8 (quadratic, 50 % = 2) | [Feedback] modulator self-feedback 0–1.2 rad | the modulator |
| 4 | **Phase Warp** — −cos read through a 2-segment phase curve | [Warp] knee 0.5 → 0.05 (sine → saw-like) | [Resonance] (1 − φ)²·(1 − cos 2πrφ), r = 1…16 × f, restarted each cycle | [Mix] warp ↔ resonance | a square one octave down |
| 5 | **Grain** — one windowed sine burst per cycle (`FormantOsc`) | [Formant] burst frequency ½…16 × f | [Width] burst length (100 % = whole cycle) | [Pair] adds a second burst at 1.5 × the formant | a sine at f |
| 6 | **Harmonic** — 24 additive partials (`PartialBank`) | [Centre] Gaussian peak at partial 1…24 (quadratic) | [Width] 0.4…8.4 partials | [Odd/Even] all → odd only (50 %) → even only (100 %, fundamental kept) | the odd partials |
| 7 | **Table** — Wavetable Osc factory banks | [Bank] Analog, Harmonic, Pulse, Sync, FM, Organ, Digital, Bell (eighths, 5 ms crossfade) | [X] position | [Y] position | the same one octave down |
| 8 | **Chord** — four voices of a chord, 0 / +3 / −3.5 / +5 cents | [Chord] octaves, 5th, sus2, sus4, minor, major, m7, maj7, 7, m9, maj9, 6/9 | [Voicing] root, 1st, 2nd, 3rd inversion, Drop 2, Open, Wide, Spread (`Chords.h`) | [Wave] sine → triangle → saw | the root voice |
| 9 | **Vowel** — glottal pulse and breath into 3 formant band-passes | [Vowel] a → e → i → o → u | [Size] formant shift +1 → −1 octave (small to large vocal tract) | [Breath] voiced → whispered | the unvoiced (noise) part |
| 10 | **Noise Band** — white noise into a resonant SVF at *f* | [Resonance] Q 0.5…40 | [Mode] LP → BP → HP | [Clock] clean → sample-and-hold noise down to ≈ 90 Hz | the other side (HP for LP, notch for BP, LP for HP) |
| 11 | **Dust** — sparse random impulses, heights 0.4–1 | [Density] 1…20 000 /s (50 % ≈ 140) | [Colour] resonant low-pass f/8 … f × 128 | [Bipolar] positive-only → half negative | the impulses before filtering |
| 12 | **Pluck** — waveguide string, noise-burst pluck one period long | [Bright] exciter colour 300 Hz…19 kHz | [Damping] the loop's low-pass | [Position] pluck position (comb on the exciter) | the exciter |
| 13 | **Modal** — 8 / 16 / 24 struck modes, mallet strike | [Material] stiff string → bar → plate → bell | [Bright] high-mode level and mallet hardness | [Stretch] inharmonic stretch 0…+15 % | the odd modes |
| 14 | **Kick** — ringing resonator swept down, plus a 4 ms noise click | [Sweep] pitch drop 0–4 octaves | [Punch] sweep time 80 → 4 ms | [Drive] soft clip | the click |
| 15 | **Snare** — two resonators (f, 1.75 f) plus band-passed noise | [Snappy] noise level | [Tone] resonator balance | [Noise Colour] band-pass 1.5…12 kHz | the noise only |
| 16 | **Metal** — six detuned polyBLEP squares (808 ratios), two high-passes | [Colour] high-pass 300 Hz…12 kHz | [Spread] ratio^(0.5…1.5) | [Ring] adds a band-pass at 5.3 f, Q 8 | the unfiltered metal |

Blend's default is 0 for every model, so each model's default is its plainest
sound; the ranges above are chosen so that the defaults (Tone and Shape at
50 %) sound good (a 19-cent chorus, ratio 3 at index 2, an m7 Drop 2 chord, …).

DSP notes per family:

- **Discontinuous waveforms** (1, 8) use `SyncOsc` / `OscCore` (polyBLEP and
  polyBLAMP at the exact sub-sample time, sync resets included), run at the
  *Quality* factor of the polyBLEP models (3) into the shared decimator.
- **Nonlinear models** (2, 3, 4) run at the *Quality* oversampling factor
  with the shared polyphase half-band decimator (`Oversampler.h`). Their
  brightness is also limited at high notes so the bandwidth stays below the
  oversampled Nyquist: Fold's drive ≤ 0.11 × rate / f, FM's index so that
  f + (I + 1)·r·f < 0.45 × rate and its feedback faded out once r·f passes
  7 % of the rate, Phase Warp's resonance ≤ 0.3 × rate / f. Fold's later
  stages are hard reflections (no trig), the first a soft sine fold.
- **Harmonic** uses `PartialBank`, which fades partials out between 0.40 and
  0.45 × sample rate, so sweeping the pitch never aliases or clicks.
- **Table** reads the mipmapped Wavetable Osc banks (`Wavetable.h`, built
  once per process in `prepare()`).
- **Vowel** formants are zero-delay-feedback SVF band-passes (`Svf.h`) on the
  shared vowel table (`formant::vowelAt`, log-frequency morph); the glottal
  pulse is a falling polyBLEP ramp through a 1.8 kHz one-pole plus a little
  pitch-synchronous aspiration noise.
- **Chord** reads its chords and voicings from `Chords.h` (`buildChord`).
- **Pluck** uses the shared waveguide string (`Waveguide.h`) and `NoiseBurst`
  (`Exciter.h`); its tuning and T60 are compensated, in tune within 2 cents
  from C2 to C7.
- **Modal** uses `ModalBank.h` with `Mallet` (`Exciter.h`).
- **Kick / Snare / Metal** reuse `Resonator`, `Decay`, `Metal` and `Filter`
  from `Drums.h`. The kick's body is a ringing `Resonator` (not a restarted
  sine) so a retrigger adds to it without a click.

### 4.3 Trigger, envelope and low-pass gate

- **Trigger unpatched:** the pitched and noise models (1–11) sound
  continuously; *Decay* and *Gate Colour* do nothing for them; *Env* is 0.
  *Pluck* and *Modal* are excited by a quiet, continuous noise (a bowed /
  blown sound), scaled for their decay so they speak at about the level of a
  strike; their ring time still follows *Decay*. *Kick*, *Snare* and *Metal*
  are silent and the view shows "patch Trigger".
- **Trigger patched:** each trigger moves the envelope to *Accent* (unpatched
  Accent counts as 1) by a 0.5 ms linear anti-click rise, then it falls
  exponentially to −60 dB in *Decay*. *Env* outputs it. Out and Aux of
  models 1–11 pass through a **low-pass gate**: a VCA and a 2-pole ZDF
  low-pass (Q 0.7, Padé tan per sample) in series, both driven by the
  envelope after a 3 ms one-pole smoother. With `c` = *Gate Colour*, the VCA
  gain is `env^(3(1 − c))` and the cutoff is
  `20 Hz × 2^(10 × (1 − c + c × env))` (≤ 0.45 × sample rate), so 0 % is a
  plain VCA (cubic law, cutoff open), 100 % a pure filter sweep, 50 % both.
  This is a deliberately simple gate; the Low Pass Gate module is the full
  vactrol model.
- **Struck models (12–16)** bypass the gate: they are struck by the trigger
  with strength *Accent* and decay by themselves (*Decay* is their T60;
  Snare's body uses 0.6 ×, its noise 0.75 × Decay). Gating them as well
  would square their decay. A retrigger adds energy to ringing resonators
  (strings, modes, the kick and snare bodies) instead of restarting them, so
  fast rolls build up. The drum models (14–16) latch *Tone* at the trigger
  so a moving knob doesn't smear a hit.
- *Tone*, *Shape* and *Blend* are read every sample; parameters that need
  coefficients (filters, partial levels, chord, string, modes) update every
  16 samples and at each strike.

### 4.4 Noise and determinism

Every noise (models 9–13 and 14–15) comes from a per-model xorshift stream
seeded with `hash(Seed, voice index + 1, model)` (`Random.h`); Pluck's bursts
and Modal's mallet scrapes are seeded per strike from the same seed. All of
it is reseeded at transport start, so offline renders repeat, and voices in
a Voice Cell differ. *Dust* impulse times come from the same stream. For
the models without a playable pitch (10, 11, 14–16) the *FM* input adds
`FM Depth × FM` to *Tone* (a +1 signal at 100 % = the whole knob).

### 4.5 Model changes

*Model* is a stepped knob: modulation rounds to the nearest model. A change
crossfades over 5 ms (equal power) from the old model to the new one, both
running. A change asked for while a fade is running waits for its end (the
latest request wins), so fast sequencing stays click-free. Each model keeps
its own state while not selected, so switching away and back mid-note
doesn't reset a ringing string; on reselection only its decimators are
cleared. Models only run while selected or fading.

### 4.6 Transport

The oscillators run freely and ignore the transport, except that noise is
reseeded at transport start (4.4). Stopping the transport does not mute the
module; that is the job of the gate or VCA after it.

### 4.7 CPU

Measured per model (one instance, 48 kHz, Normal, Aux computed, Apple
laptop; `test_macro_osc` prints it): VA Pair ≈ 1.1 %, Fold ≈ 1.0 %, FM
≈ 0.6–1.1 %, Phase Warp ≈ 0.5 %, Grain ≈ 0.3 %, Harmonic ≈ 0.5 %, Table
≈ 0.5 %, Chord ≈ 1.2 %, Vowel ≈ 0.7 %, Noise Band / Dust ≈ 0.15 %, Pluck
≈ 0.2 %, Modal ≈ 0.3 %, Kick / Snare / Metal ≈ 0.25–0.35 %. Every model stays
under 2 %. *Aux* isn't computed while nothing reads it (and the view isn't
capturing), where a model allows it (decimators, Harmonic's odd/even split,
Vowel's separate breath filters, Table's octave-down read).

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────┐
 │ ┌ VA ┐┌Fold┐┌ FM ┐┌Warp┐   3  FM              261.6 Hz    │
 │ ┌Grn ┐┌Harm┐┌Tabl┐┌Chrd┐   ┌──────── scope ─────────┐   │
 │ ┌Vowl┐┌Nois┐┌Dust┐┌Plck┐   │ ∿∿∿∿∿  Out   ‒‒ Aux    │   │
 │ ┌Modl┐┌Kick┐┌Snar┐┌Metl┐   └──── spectrum ──────────┘   │
 │  Model │ Octave Coarse Fine FM Depth │ Ratio Index Feedback │
 │  Decay  Gate Colour  Level │ Quality  Seed                 │
 └───────────────────────────────────────────────────────────┘
```

- **Model picker:** a 4 × 4 grid with a small waveform glyph per model,
  colour-coded *Pitched* (1–9), *Noise* (10–11), *Struck* (12–16); the
  playing model is highlighted, the one being faded to is outlined. The
  stepped *Model* knob stays (cables), and its choices carry the group
  headings for dropdowns (`choiceGroups`).
- **Macro labels:** the knob labels follow the model (`namedBy("model")`):
  Tone / Shape / Blend show the bracketed names of 4.2; cables and presets
  keep the fixed ids `tone`, `shape`, `blend`. The Aux jack is renamed the
  same way.
- **Scope:** *Out* solid and *Aux* dashed, 256 points from the module's live
  arrays, about 25 times a second: two cycles starting at a rising zero
  crossing of Out for the periodic models (1–9, 12, 13), 50 ms for the
  others. **Spectrum:** 1024 raw samples of Out (Hann, log frequency,
  20 Hz–20 kHz, 80 dB).
- *Decay* and *Gate Colour* are dimmed while *Trigger* is unpatched; the
  drum models show "patch Trigger" then, the others the frequency.
- Width 520 px.

## 6. Saved state

Only knob and setting values; no node data.

```json
{ "type": "macro-osc",
  "params": { "model": 0.1333, "tone": 0.5, "shape": 0.5, "blend": 0.0,
              "decay": 0.42, "gateColour": 0.5, "quality": 0.5, "seed": 0.001, … } }
```

*Model* is a 16-step choice, saved normalised as index / 15 (0.1333 = FM).
Models added later need a migration of saved values (or go into a second
Macro Osc type); a 32-slot range was dropped because 16 empty entries in
the knob and dropdown would be worse than that one-time cost.

## 7. Engine requirements

All available: the shared cores (`OscCore.h`, `Oversampler.h`, `Folder.h`,
`Formant.h`, `Partials.h`, `Wavetable.h`, `Chords.h`, `Waveguide.h`,
`ModalBank.h`, `Exciter.h`, `Drums.h`, `Vactrol.h`, `Svf.h`), stepped
modulatable choices (`ParamSpec::stepped`), names that follow a param
(`namedBy`, used with the stepped Model knob), unread outputs
(`isOutputConnected`), `ProcessContext::voice`, live values and arrays.
Inside Voice Cells: one instance per voice; *Env* can feed
*Voice Out › Active* through a Utility comparator, or the voice is freed by
the default −90 dB rule.

## 8. Tests

`patch/modules/macro-osc/tests/test_macro_osc.cpp` (on the DSP class):

- Pitch: 0 V plays 261.63 Hz ±0.1 cent and +1 V doubles it for every
  pitched model (phase advance of the DFT bin at f between two windows;
  VA Pair at unison); Modal's fundamental mode within 0.5 cent.
- Aliasing at C7 (2093 Hz), Normal / High, largest aliased component in
  the audible band (< 20 kHz) relative to the strongest harmonic: VA Pair
  saws and synced pulses, Fold (drive 11), FM (index 5, and full feedback),
  Phase Warp (warp + resonance), Chord (root saw), Grain ≤ −60 dB at Normal
  (most ≤ −70 at High; measured −70…−145); Table ≤ −65; Harmonic ≤ −90.
  Vowel (at C6) ≤ −45: its floor is the aspiration noise, not aliasing.
- Harmonic: nothing sounds above 0.45 × sample rate at C8; a C6 → F8 sweep
  has no step larger than steady tones along the sweep.
- Model change: each index 1–16 is reachable; every neighbour change (and a
  far jump during a fade) has no step larger than √2 × the models' own
  largest steps (equal-power crossfade).
- Trigger: *Env* is 0 before, reaches *Accent* after the 0.5 ms rise and is
  ≤ −60 dB after *Decay*; gated output silent before the strike, decayed
  after; Gate Colour 0 / 50 / 100 % all close; ungated *Env* is 0 and the
  pitched models sound. Drums are silent without a trigger and decay after
  one; Modal retriggers build up. Pluck in tune within 2 cents C2–C7.
- Determinism: two renders with the same Seed are bit-identical for every
  model; voices 0 and 1 differ for the noisy models.
- Random knobs, FM and triggers at all three qualities: outputs finite and
  within ±4.
- Levels (audible at defaults, nominal ±1) and CPU per model are printed.

The module harness (`bleep_module_harness macro-osc`) runs the node with
every input fed; `patch.ui-types` needs `demo-types.json` regenerated
(`bleep_dump_types --write`).

## 9. Later

- A stereo output pair with per-model width (chord voices, modal modes panned).
- More models: speech synthesis from phoneme strings, bowed string, granular noise cloud, 4-operator FM.
- User wavetables in *Table* (shared with the Wavetable Osc's imported banks).
- Per-model knob defaults applied when the model changes by hand (not by modulation).
- *Notes* input with built-in polyphony for chord models.
