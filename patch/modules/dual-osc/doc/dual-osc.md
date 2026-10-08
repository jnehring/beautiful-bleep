# Dual Osc

## Introduction

The Dual Osc is two analog-style oscillators, *A* and *B*, wired together
for the sounds that need two oscillators talking to each other. B can
frequency-modulate A, A can sync to B, and the pair runs into a wavefolder
that turns soft waves into bright, moving spectra. It is a complete
complex-oscillator voice in one module, and still two ordinary oscillators
when that's all you need.

## How does it work?

**Two cores.** Each core reads sine, triangle, saw and pulse from one phase
and morphs between them with its *Shape* knob (as the Oscillator). Saw,
pulse, triangle and every sync jump are band-limited at their exact moment
in time, so even hard-synced and frequency-modulated waves stay clean.

**Pitch.** A plays C4 × 2^(Octave A + Tune A/12 + Fine A/1200 + Pitch).
B follows the same *Pitch* input while *B Track* is on, plus its own
*Pitch B* input; with *B Track* off only *Pitch B* moves it. *B Range Low*
divides B by 100 (about 0.03–200 Hz), turning it into a vibrato or
growl-rate modulator.

**FM (B → A).** B's sine (whatever *Shape B* is), plus the *FM* input,
modulates A's frequency by *FM Depth*:

- *Linear* is through-zero: A's frequency is f × (1 + 4 × depth × m). When
  it goes negative the phase runs backwards, so the note stays in tune at any
  depth. Integer ratios between A and B give harmonic, bell- and brass-like
  tones.
- *Exponential* is analog-style: f × 2^(4 × depth × m), ±4 octaves at 100 %.
  The pitch drifts upward with depth: the classic growl and siren.

**Sync (A → B).** Each time B finishes a cycle it acts on A. Up to 50 % this
is a *reversing* soft sync: if A is in the last part of its cycle it changes
direction instead of jumping, a gentle, vocal colour. From 50 % to 100 % the
reset gets harder until, at 100 %, A restarts with every cycle of B: the
classic tearing sync lead when you sweep A's pitch.

**Folder.** The A/B mix (*Balance*) is driven by *Fold* (gain 1 to 12) plus
the *Fold CV* input, biased by *Symmetry*, and folded back into ±1 by four
stages. At *Fold* 0 the folder is transparent; the first quarter of the knob
moves it from clean to a soft sine fold, and further stages join as you turn
it up. *Symmetry* adds even harmonics and makes the folds move. A DC blocker
follows (Symmetry adds DC).

**Oversampled.** Cores, FM, sync and folder run at 2× (*Normal*) or 4×
(*High*) and every output is decimated by the same filter, so A, B, Mix,
Ring, Sub and Out stay in phase with each other.

**Stereo.** With *Width* above 0, Out L and Out R fold slightly different
mixes (Balance ∓ Width/4) and R's Symmetry is mirrored at full width. The
image collapses cleanly to mono. At *Width* 0 both outputs are identical.

**Drift.** A seeded slow wander of each core's pitch, up to ±8 cents at
100 %. The same *Seed* gives the same drift on every render; it restarts when
the transport starts.

## How to use it?

- **Complex voice:** Pitch from Voice In, *Out L/R* → VCA. Raise *Fold* and
  modulate it with an envelope for plucked, west-coast tones.
- **FM bell:** *Shape A* 0 % (sine), *Octave B* +1 or *Tune B* +7, *FM
  Depth* 30–60 %, Linear. Put an envelope on *FM Depth*.
- **Sync lead:** *Sync* 100 %, *Octave B* −1, sweep *Tune A* or modulate
  *Pitch* of A only (patch into *Pitch* with *B Track* off and feed B from
  *Pitch B*).
- **Growl:** *B Range* Low, *FM Mode* Exponential, *FM Depth* 20 %.
- **Two oscillators:** use *A* and *B* outputs separately; *Ring* gives A × B.
- **Wide pad:** *Width* 60 %, a little *Fold* and *Symmetry*, *Drift* 30 %.

## Reference

### Knobs and settings

| Control | Range | Default |
|---|---|---|
| Octave A, Octave B | −4 … +4 (stepped) | 0, −1 |
| Tune A, Tune B | −12 … +12 st | 0 st |
| Fine A, Fine B | −100 … +100 ct | 0 ct |
| Shape A, Shape B | 0 – 100 % | 67 % (saw), 0 % (sine) |
| Width A | 5 – 95 % | 50 % |
| FM Depth | 0 – 100 % | 0 % |
| Sync | 0 – 100 % | 0 % |
| Balance | 0 – 100 % | 50 % |
| Fold | 0 – 100 % | 0 % |
| Symmetry | −1 … +1 | 0 |
| Drift | 0 – 100 % | 10 % |
| Width | 0 – 100 % | 0 % |
| FM Mode | Linear, Exponential | Linear |
| B Track | On, Off | On |
| B Range | Audio, Low (÷ 100) | Audio |
| Quality | Normal (2×), High (4×) | Normal |
| Seed | 0 – 999 | 1 |

- **Shape A / Shape B:** 0 % sine, 33 % triangle, 67 % saw, 100 % pulse.
- **Width A:** pulse width of A's pulse end.
- **FM Depth:** smoothed over 5 ms, so it can be swept without clicks.
- **Balance:** 0 % only A, 100 % only B into *Mix* and the folder.
- **Quality:** High costs about twice the CPU and lowers aliasing of synced
  and folded sounds further.

All knobs are modulation destinations; the settings are not.

### Inputs

| Input | Signal | What it does |
|---|---|---|
| Pitch | pitch, 1 V/oct | both cores (B only while *B Track* is on); 0.0 = C4 |
| Pitch B | pitch, 1 V/oct | added to B only |
| FM | audio | added to B's sine as the modulator of A, scaled by *FM Depth* |
| Sync | trigger | a rising edge restarts both cores (one per note, for example) |
| Fold CV | audio | added to the folder's input at audio rate |

### Outputs

| Output | Signal | What it does |
|---|---|---|
| A | audio | core A with FM and sync, shaped by *Shape A* |
| B | audio | core B, shaped by *Shape B* |
| Mix | audio | A and B by *Balance*, before the folder |
| Out L, Out R | audio | the folded mix; identical at *Width* 0 |
| Ring | audio | A's sine × B's sine |
| Sub | audio | square an octave below A; it flips on every cycle of A, also after a hard sync reset |

A, B, Mix, Ring and Sub run between about −1 and +1; Out L/R stay within
about ±1.2 (band-limited folds overshoot slightly). Unpatched outputs cost
no CPU for their decimation.
