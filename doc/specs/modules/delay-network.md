# Delay Net

Type id `delay-network` · category *Audio* · colour proposal `#0ea5e9`

## 1. Purpose

A network of up to eight delay lines whose repeats feed each other. One
*Time* knob sets the span of the network, *Taps* how many lines take part and
*Scatter* how they're spaced, from even rhythmic echoes to clustered bursts.
Some lines can play backwards, each feedback pass can be filtered, saturated
or degraded, and a routing setting decides how the lines feed each other:
side by side, in a chain, in a ring or all into all. Small settings give
multi-tap rhythms; large ones turn a single hit into an evolving texture.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is not patched. |
| In R | `audio` | Right input. |
| Clock | `trigger` | When patched, *Time* is a multiple or division of the clock interval (4.2). |
| Freeze | `gate` | While high, the network stops taking input and circulates its contents without loss (4.6). |
| Clear | `trigger` | Empties all lines with a 10 ms fade. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | Dry/wet mix. |
| Wet L, Wet R | `audio` | Network only. |
| Tap 1 … Tap 4 | `audio` | The (mono) outputs of lines 1–4 before panning, for patching individual echoes elsewhere. |
| Pulse | `trigger` | A pulse each time a tap's delay time has elapsed since the last input onset (a transient detector, −30 dB threshold), i.e. a rhythm of the echoes. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Time | 5 ms – 8 s | 600 ms | The time of the longest active tap. Synced: a note value. |
| Taps | 1–8 (continuous) | 4 | Number of active lines. Fractional values fade the next line in, so modulating it is smooth. |
| Scatter | −1 … +1 | 0 | Spacing of the taps within *Time* (4.1): 0 even, + bunched towards the end, − bunched towards the start. |
| Jitter | 0–100 % | 0 % | Seeded random offset of each tap from its scattered position (up to ± half the gap to its neighbours). |
| Reverse | 0–100 % | 0 % | Share of the active taps that play backwards (4.4). |
| Feedback | 0–110 % | 45 % | Loop gain of the network. Above 100 % the *Character* saturation bounds it. |
| Character | 0–100 % | 20 % | Processing in every feedback path (4.5). |
| Tone | −1 … +1 | 0 | Moves the character filters ± 2 octaves. |
| Width | 0–100 % | 70 % | Pans the taps across the stereo field (4.3). |
| Mix | 0–100 % | 40 % | Dry/wet, equal-power. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Routing | Parallel, Chain, Ring, Mesh | Ring |
| Sync | Free, 4 bars … 1/16T (straight, dotted, triplet) | Free |
| Time Change | Tape, Crossfade | Crossfade |
| Clear on Play | off / on | off |
| Seed | 0–999 | 1 |

## 4. Behaviour

### 4.1 Tap positions

Tap *i* of *n* active taps (`n = ceil(Taps)`) sits at
`t_i = Time × p_i`, where the even position `x_i = i / n` is warped by
*Scatter*:

```
 p_i = x_i ^ (2 ^ (2 × Scatter))       Scatter 0   |   |   |   |
                                       Scatter +1         | | ||
                                       Scatter −1  || | |       |
```

then offset by *Jitter* (a seeded value per tap, fixed per seed, so a
jittered network keeps its groove; up to half the gap to the neighbour on
that side). Tap *n* always sits at *Time* (no jitter). Positions are computed
at control rate (every 16 samples) and scaled by *Time* per sample. The
fractional part of *Taps* is the level of tap *n* (0 → 1 over the fraction)
and the positions of the others are interpolated between the n − 1 and n
layouts, so sweeping *Taps* slides the echoes into new places instead of
jumping.

### 4.2 Sync and Clock

- **Sync** to a note value: *Time* is that note at the current tempo (4/4),
  clamped to 8 s; the *Time* knob then scales it by ×¼, ×½, ×1, ×2 (stepped,
  4 zones). With Scatter 0 and Jitter 0, all taps land on even subdivisions:
  4 taps over 1/2 gives straight eighths.
- **Clock patched:** the base is the measured pulse interval; *Time* selects
  ¼, ½, 1, 2, 3, 4 × that interval.

### 4.3 Lines and stereo

Each tap is its own **mono delay line** (so the feedback routing can treat
taps separately). The line input is the mid signal (L+R)/2, plus feedback.
Taps are panned alternately left and right, spread by *Width*: tap 1 at
−Width, tap 2 at +Width, tap 3 at −Width × 0.6, … so the echoes ping around.
At Width 0 everything is centred. Panning is equal-power (−3 dB per side in
the centre); taps are not normalised, each echo keeps its level.

### 4.4 Reversed taps

The share *Reverse* of the active taps reads backwards. Which taps are
reversed follows a fixed, seeded order (e.g. 5, 2, 7, 1, …), so raising
*Reverse* adds reversed taps one by one; the tap crossing over crossfades its
forward and reverse readers over 20 ms. A reversed tap uses the windowed
two-head reverse reader of the shared delay toolkit (window = the tap's own
delay time, raised-cosine, overlap 50 %), so it plays the last *t_i* of audio
backwards, smoothly. The window is at most half a line (about 5.4 s at
48 kHz), so taps longer than that reverse in windows of that length. The
share is rounded: `round(Reverse × n)` of the *n* active taps.

### 4.5 Character (per feedback path)

Every line's output passes through its own character stage before it's
routed back. *Character* morphs:

| Position | Name | Processing |
|---|---|---|
| 0 % | Clean | flat |
| 20 % | Warm | 1-pole low-pass ≈ 6 kHz, 60 Hz high-pass, soft tanh |
| 40 % | Filter | resonant SVF band-pass (Q 1.5, ≈ unit gain at the centre), centre spread per tap over ±1 octave around 1.2 kHz, so each echo has its own colour |
| 60 % | Drive | asymmetric saturation (+12 dB drive, small-signal gain 1), 4 kHz low-pass |
| 80 % | Crush | 8 kHz sample-rate reduction, 8-bit quantize |
| 100 % | Wear | wow (0.5 Hz) and flutter (7 Hz) per line, −60 dB seeded noise, 3 kHz low-pass, slight level loss: an old tape loop |

Neighbouring characters crossfade. *Tone* shifts all cutoffs. All filters are
TPT so audio-rate modulation is safe. Each pass applies the character again,
so later repeats are darker, dirtier or more worn than earlier ones.

### 4.6 Routing and feedback

The feedback into line *j* is `Feedback × Σ_i M_ij × y_i`, where *y_i* is
line *i*'s processed output and *M* depends on *Routing*:

| Routing | Matrix | Sound |
|---|---|---|
| Parallel | identity: each line feeds itself | independent multi-tap echoes |
| Chain | line *i* → line *i+1*; the last line → none | a cascade: repeats grow longer down the chain, then stop |
| Ring | line *i* → line *i+1*, last → first | repeats walk around the network, rhythm keeps rotating |
| Mesh | normalised Hadamard (all into all, orthogonal) | dense, diffuse, reverb-like build-up |

Parallel, Ring and Mesh are orthogonal and Chain has no loop at all, so
Feedback 100 % is the stability edge for every routing. Mesh always mixes all
eight lines (8-point Hadamard); inactive lines are muted at their input and
output, which only removes energy, so fewer taps never make it unstable.
Ring wraps at the last *active* line. Switching *Routing*
crossfades between old and new matrices over 50 ms.

**Freeze:** within 20 ms the input fades out, feedback becomes exactly 1 and
the character stages (and Wear's wow) are bypassed (Ring or Mesh keeps the
material moving; Parallel loops each tap; Chain wraps from its last line to
the first while frozen, so it holds too). Freeze low fades back. The loop's
safety net (linear to ±1, a soft knee towards ±1.5) is transparent at normal
levels, so the frozen network is lossless with whole tap counts (Mesh: with all
8 taps, since muted lines take energy out).

### 4.7 Time changes

Tap times follow their targets per sample through the shared toolkit:
**Crossfade** (default; two heads per line, 40 ms equal-power fades, latched
retargets) or **Tape** (slew-limited moving heads with a 100 ms glide: pitch
bends). Modulating *Time*, *Scatter*, *Jitter* or *Taps* at audio rate is
therefore always click-free: stepped in Crossfade mode, FM-like in Tape mode.

### 4.8 Tails, transport, determinism

- Transport stop leaves the network ringing out.
- *Clear on Play* empties the lines on `transportStarted` (at once; the old
  tail's last value ramps out over 5 ms); Jitter offsets, the reverse order,
  Wear wow phases and noise are seeded from *Seed* and restart at the same
  moment, so renders are repeatable.
- The *Clear* input and button fade the network out over 10 ms, empty one
  line per sample, and fade back in over 10 ms.
- *Pulse* uses a peak follower on the mid input: an onset is a rise above
  −30 dB to more than twice the slow average; it re-arms below −40 dB.

### 4.9 CPU and memory

- Per active tap: one write, one or two interpolated reads (two during
  crossfades or when reversed), one character stage. 8 taps ≈ 1.2 % of one
  core at 48 kHz; Mesh adds a 24-addition Hadamard per sample.
- Memory: 8 mono lines × 8 s, rounded up to powers of two by
  `dsp::RingDelay`: 16 MB at 44.1/48 kHz, 32 MB at 96 kHz, 64 MB at 192 kHz,
  allocated in `prepare()`. Flagged memory-heavy for Voice Cells (see Zone
  Delay, section 7). Inactive lines skip their reads.

## 5. Module view

```
 ┌───────────────────────────────────────────────────────────────┐
 │ 0 ─────────────────────────────────────────────── 600 ms      │
 │   ▲1        ▲2          ◀3          ▲4      (◀ = reversed)    │
 │   L         R           L           R      height = level    │
 │                                                               │
 │  routing:  ①→②→③→④→①   (Ring)            [◉ Freeze] [Clear]  │
 └───────────────────────────────────────────────────────────────┘
```

- **Tap timeline:** each active tap as a marker at its effective time, its
  height the current output level of that line, colour-coded L/R, an arrow
  for reversed taps. The fractional tap fades in visibly.
- **Routing diagram:** small node graph of the chosen matrix.
- **Freeze** latches (ORed with the gate); **Clear** pulses.

## 6. Saved state

```json
{
  "type": "delay-network",
  "params": { "time": 0.55, "taps": 0.43, "scatter": 0.5, … },
  "data": { "freezeLatched": false }
}
```

## 7. Engine requirements

1. **Shared delay toolkit** `patch/common/dsp/Delay.h` (with Verb, Zone Delay
   and Bender): fractional lines, two-head crossfader, reverse reader, tape
   follower; plus a small fast Hadamard helper (8 points).
2. **Large buffers in `prepare()`** and the `memoryHeavy` spec flag
   (Zone Delay, section 7).
3. Node data for the latched Freeze.

## 8. Tests

- Tap positions: for Scatter 0, Jitter 0, Taps 4, Time 1 s the taps are at
  250/500/750/1000 ms ± 1 sample; Scatter ±1 matches the formula.
- Fractional Taps: sweeping 3 → 4 changes the output continuously (no step
  larger than the crossfade allows).
- Sync: 4 taps over 1/2 at 120 BPM = 250 ms spacing.
- Reverse 50 % with 4 taps reverses exactly 2 taps, the same ones for a given
  seed; a ramp comes out descending on those taps.
- Each routing: an impulse appears at the expected sums of tap times
  (e.g. Chain: t1, t1+t2, …).
- Stability: Feedback 100 % with Clean character keeps the network's energy
  (all line outputs) constant (± 0.5 dB, 30 s) for Parallel, Ring and Mesh;
  110 % stays bounded with every character and routing.
- Freeze holds the content without loss; release is click-free.
- Crossfade and Tape modes: audio-rate modulation of Time gives no
  discontinuity.
- Determinism: Clear on Play + same Seed → bit-identical renders.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- A drawable custom matrix (8×8 grid of feedback amounts).
- Per-tap level, pan and character overrides in the view.
- Pitch-shifted taps (each line transposes by an interval per pass).
- Up to 16 taps in a "cloud" quality mode.
