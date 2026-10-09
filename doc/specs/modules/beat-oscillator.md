# Beat Oscillator

Type id `beat-oscillator` · category *Sources* · colour proposal `#e879f9`

## 1. Purpose

A beat-frequency (heterodyne) oscillator: two high, inaudible-ish carriers
**A** and **B** are mixed, and what you hear is their difference. A small turn
of *Beat* near zero sweeps the tone from several kilohertz down to a slow
pulse and to silence, the way old laboratory tone sources did it.

The point is the imperfection. *Pull* couples the carriers so they try to
lock: inside the lock range the beat collapses, just outside it the tone
lurches in uneven blips. *Drift* lets both carriers wander, and near zero beat
a tiny relative drift is a large change. *Detune* adds hertz to B, like a
hand moved near a tuning capacitor.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Pitch | `pitch` | 1 V/oct on both carriers (4.1), so it transposes the beat tone too. |
| Detune | `control` | Adds `Detune × Detune Range` Hz to B, unscaled by Pitch. |
| FM | `audio` | Linear through-zero FM of B: 1.0 = 1 kHz deviation. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out | `audio` | The detector output: the difference tone (4.3, 4.4). |
| A, B | `audio` | The raw carriers, `cos φ`, after pulling and drift. |
| Beat | `pitch` | The measured beat frequency as 1 V/oct (4.5). |
| Lock | `gate` | High while the carriers are locked (4.2). |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Carrier | 500 Hz–18 kHz (exp.) | 10 kHz | Frequency of A. |
| Beat | −*Range*…+*Range* (cubic) | +261.6 Hz | Offset of B from A: `b = Range · x³`, x in −1…+1 (on ±2 kHz, x = 0.1 is 2 Hz). The knob shows x as −100…+100 % (default 50.76 %); the view shows the beat in Hz. |
| Fine | −2…+2 Hz (linear) | 0 Hz | Added to the offset, for dialling zero beat. |
| Pull | 0–100 % | 0 % | Coupling: lock range `L = 200 · Pull³` Hz (25 % → 3.1 Hz, 50 % → 25 Hz). |
| Detector | 0–100 % | 0 % | Detector cutoff `fd = 2500 · 24^Detector` Hz (2.5 kHz…60 kHz). |
| Drift | 0–100 % | 15 % | Depth of the carriers' wander: `D = 25 · Drift²` cents. |
| Detune Range | 0–200 Hz (cubic) | 20 Hz | Hz added to B per 1.0 at *Detune*. (A Skew map with centre 25 Hz, which is exactly `200 · x³`.) |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Range | ±20 Hz, ±200 Hz, ±2 kHz | ±2 kHz |
| Mixer | Ideal, Diode, Overdriven | Ideal |
| Coupling | AC, DC | AC |
| Warm-up | Off, 10 s, 30 s, 2 min | Off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Carrier frequencies

Per sample, with `p` the *Pitch* input and `d_A`, `d_B` the drift and warm-up
offsets in cents (4.6):

```
fA = Carrier · 2^p · 2^(d_A / 1200)
fB = (Carrier + Beat + Fine) · 2^p · 2^(d_B / 1200) + Detune · DetuneRange + 1000 · FM
```

`fB` is clamped to 0…0.45 · fs and `fA` to 20 Hz…0.45 · fs. The nominal
detuning is `Δf = fB − fA` and `Δω = 2π Δf`.

### 4.2 Pull (injection locking)

The phases (double precision) follow the symmetric coupled equations

```
dφA/dt = 2π fA + (K/2) · sin(φB − φA)
dφB/dt = 2π fB − (K/2) · sin(φB − φA)        K = 2π L
```

so the phase difference `ψ = φB − φA` obeys the Adler equation
`dψ/dt = Δω − K · sin ψ`. They are integrated with forward Euler at the 4×
rate (`K · dt < 0.01`, stable). This is the module's signature:

- **Locked** (`|Δf| ≤ L`): ψ settles at `asin(Δω / K)`; both carriers run at
  the mean `(fA + fB) / 2`, and the beat is zero. With AC coupling, Out falls
  silent; with DC it holds a level `cos ψ`.
- **Just outside** (`|Δf| > L`): the beat frequency is
  `fbeat = √(Δf² − L²)` (the square-root law), far below `|Δf|` near the edge.
  ψ crawls through the bottleneck at π/2, where its speed is only `Δω − K`,
  then whips once round the circle at up to `Δω + K`. Solved:
  `tan(ψ/2) = (K + Ω · tan(Ω t / 2)) / Δω`, `Ω = 2π fbeat`. Out (∝ cos ψ) is a
  train of one-cycle blips, each roughly `1 / L` seconds long, between
  near-silences. Drift, *Detune* or slow FM pushing Δf across the edge make
  the blips lurch, bunch and stop.
- **Far outside** (`|Δf| ≫ L`): the blips merge into a plain sine beat at Δf.

*Lock* is computed, not observed: it rises when `|Δf_s| ≤ L` (`Δf_s` is Δf
without FM, 5 ms one-pole) and falls above `1.02 · L`, so drift doesn't
chatter it. With *Pull* at 0 it is high only at exactly zero beat.

### 4.3 Mixer

At the 4× rate, with `a = cos φA`, `b = cos φB`:

| Mixer | Product `m` | Character |
|---|---|---|
| Ideal | `2 · a · b` | Difference plus sum, nothing else: a clean sine beat. |
| Diode | `g · max(0, 0.5 · (a + b) + 0.2)²`, DC removed by 4.4 | Asymmetric square law. The square gives the difference; the half-wave cut adds the carriers, their harmonics and harmonic beats (2Δf, 3Δf), so the beat tone is bright and slightly buzzy. |
| Overdriven | `a′ · b′ + 0.1 · (a′ + b′)`, `x′ = tanh(4x) / tanh(4)` | Near-square carriers: a triangle-like beat with odd harmonics, plus carrier leakage from the imbalance. |

`g` (and the other modes' scale) is calibrated so a free-running beat peaks
near ±1 at Out. Diode also subtracts its calibrated mid level, so the beat is
centred on 0 with *Coupling* DC too: with `0.5 (a + b) = E cos θ`,
`E = cos(ψ/2)`, the detector keeps `F(|E|)`, the mean of `max(0, E cos θ + 0.2)²`
over θ (closed form), and Diode outputs `g · (… )² − g · (F(1) + F(0)) / 2` with
`g = 2 / (F(1) − F(0))`. Overdriven is scaled by `1 / mean(a′²)`, the
correlation of the shaped carriers at ψ = 0.

### 4.4 Detector and output

The product passes a 4-pole low-pass (two `dsp::Svf` low-passes in series,
Q 0.707, at the 4× rate) at `fd`, then the 4× downsampler. *Detector* at 0 %
leaves only the difference tone (beats up to 2 kHz pass); opening it lets the
sum (`fA + fB`) and the leaked carriers through as a whistle. The downsampler
removes everything above fs/2, so the whistle is audible only for sums below
fs/2, i.e. carriers under about 11 kHz at 44.1 kHz: lowering *Carrier* with
the detector open brings the whistle down into range.

*Coupling* AC removes DC with a 5 Hz one-pole high-pass (`x − OnePole(x)`):
slow beats become swells and a locked pair is silent. DC keeps slow beats as a
usable modulation signal on Out. Out then passes `dsp::softClip`.

The detector cutoff follows *Detector* once per sample (it is not
interpolated across the sub-samples).

### 4.5 Beat measurement

The unwrapped ψ is tracked at the 4× rate. Each time it crosses another
multiple of 2π (a slip, in either direction), the time since the previous slip
gives `fm = 1 / period`. Between slips, if the time since the last slip
exceeds the last period, `fm = 1 / elapsed`, so it falls smoothly towards 0
when the pair locks. *Beat* outputs `log2(max(fm, 0.1) / 261.626)` (0 = C4),
slewed by a 5 ms one-pole. Below 0.1 Hz it reads −11.35 and stays there.
The value is unsigned; the sign of Δf is shown in the view only.

### 4.6 Drift and warm-up

Each carrier has its own wander, deterministic from *Seed*:

`d_X(t) = D · (s_X(u) + 0.25 · f_X(8u)) + w_X(t)` cents

where `s_X` and `f_X` are Catmull-Rom interpolations through seeded knot values
`2 · uniform01(Seed, k, stream) − 1` (streams 1–4 for A slow, A fast, B slow,
B fast), clamped to ±1. The time base `u` is `ppq / 8` while the transport
plays (a slow knot every 8 beats, a fast one every beat), and `seconds / 4`
while stopped (the same spacing at 120 BPM). At 10 kHz, *Drift* 100 % is
±25 cents (about ±145 Hz per carrier): wild near zero beat, gentle at 2 kHz.

Warm-up: `w_X(t) = −40 · c_X · e^(−3t / Tw)` cents, `Tw` the setting length,
`c_A = 1`, `c_B = 0.7 + 0.6 · uniform01(Seed, 0, 5)`: both start flat by
different amounts, so the beat glides in to its dialled value over about `Tw`.
`t` counts from transport start, or (stopped) from load or the *Cold* button.
*Cold* only acts while the transport is stopped (while it plays, warm-up runs
from the start so renders repeat).

While stopped, `u` continues from where playback left it
(`u = u_stop + seconds since stop / 4`, `u_stop = 0` after load), so stopping
does not make the drift jump.

### 4.7 Rates, transport and determinism

- Knobs, *Pitch* and *Detune* are interpolated linearly across the four
  sub-samples: the carrier frequencies `fA`, `fB` (without FM) and `K` are
  computed once per sample and interpolated, which is the same to first
  order. *FM* goes through the 4× upsampler (it rests while unpatched). *A*
  and *B* are `cos φ` at the first sub-sample of each sample.
- Transport start sets `φA = φB = 0`, resets the beat measurement and
  filters and restarts warm-up: renders from one start are identical. To
  avoid a click, the step between the last output before the start and the
  first one after it fades out linearly over 5 ms, so the first 5 ms carry a
  remainder of whatever played before; from then on renders are identical.
- On a jump, phases and filters continue; drift steps to the new position.

## 5. Module view

```
 ┌──────────────────────────────────────────────────────────┐
 │    ╭── A ──╮          B − A           ╭── B ──╮          │
 │   │ 10 kHz │       +3.42 Hz      ●    │10.003k│          │
 │   │   ╲    │                    LOCK  │    ╱   │          │
 │    ╰───────╯        ╭──○──╮           ╰───────╯          │
 │                     │  ╲  │  ψ                           │
 │                     ╰─────╯                              │
 │  Carrier  Beat  Fine  Pull  Detector  Drift  Det.Range   │
 └──────────────────────────────────────────────────────────┘
```

Two large calibrated dials show the actual frequencies of A and B (after
drift, warm-up and pulling), each with a needle and a readout. Between them a
signed readout `B − A` in Hz (three significant figures, mHz below 1 Hz), and
a lamp: lit while *Lock* is high; outside lock it flashes once per slip, so
slow beating is visible as a blinking lamp. Below, the phase-difference
circle: a dot at angle ψ with a fading tail. Locked, it stands still at
`asin(Δf / L)`; near the edge it creeps, then flicks round; far out it spins
(a blur above 20 Hz). A *Cold* button restarts the warm-up while stopped.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

None new. Phases, mixer, detector and beat measurement run at 4 · fs with
`dsp::Upsampler` (FM) and `dsp::Downsampler` (Out) from `Oversampler.h`; the
detector is two `dsp::Svf` set with `sampleRate = 4 · fs` (60 kHz is inside
its clamps). `dsp::noisePoint` / `dsp::catmullRom` (`Random.h`, the knots of
`dsp::smoothNoise`, cached per knot) give the drift, one-pole smoothers with
`dsp::OnePole`'s response (coefficients computed once, double state) the DC
blocker, Δf smoother and Beat slew, `dsp::partials::sin2pi` (`Partials.h`,
|error| < 1e-6) the sines and cosines of the phases, and `dsp::softClip`
(`Clip.h`) the output. Live values carry the actual fA and fB (phase advance,
50 ms average), the nominal ones, the signed beat (`sign(Δf_s) · fm`), Δf_s,
L, ψ, lock and a slip counter (the view flashes the lamp when it changes) to
the view. Inside Voice Cells each voice runs its own pair, with drift streams
`stream + 8 · voice index` (also stream 5 for `c_B`), so voices drift apart.

## 8. Tests

- Pull 0, Ideal, Drift 0: Out is a sine at |Δf| (within 0.1 %); A and B are
  at fA and fB; the Beat output equals `log2(|Δf| / 261.626)`.
- Square-root law: Pull 50 % (L = 25 Hz), Δf = 30 Hz → measured beat
  `√(30² − 25²) = 16.6 Hz` within 2 %; Δf = 20 Hz → Lock high, no slips after
  0.5 s, A and B at the same frequency.
- Near edge (Δf = 1.05 · L): ψ spends over 50 % of the time within ±π/4 of
  π/2, and Out's crest factor is well above a sine's.
- Carrier 5 kHz: the sum product is below −40 dB at Detector 0 % and present
  at 100 %; Diode at 18 kHz shows no alias above −60 dB.
- Coupling AC: a locked pair is silent; DC: a constant level.
- Same Seed twice → identical output; two renders from one position are
  identical. Warm-up: within 5 % of the initial offset after its length.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A *Drift Rate* knob; asymmetric pulling (a stronger A that drags B) and
  lock-range hysteresis as real coupled oscillators show.
- A third carrier, and a transport-synced sweep of *Beat*.
