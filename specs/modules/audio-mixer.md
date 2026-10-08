# Audio Mixer

Type id `audio-mixer` · category *Audio* · colour proposal `#fb7185`

## 1. Purpose

A small stereo mixer for audio on the board: four channels with level, pan,
mute and one send each, a stereo return, and a master. It brings several
sound sources (oscillators, drums, Voice Cells) into one stereo pair before an
output port, and its send feeds one shared effect chain. It is built for
audio: levels in dB, equal-power panning, a master limiter and meters.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1–4 L | `audio` | Left (or mono) input of each channel. |
| In 1–4 R | `audio` | Right input. Unpatched: the channel is **mono** and takes *L* for both sides (see 4.2). |
| Return L / R | `audio` | Stereo return from an effect chain; *Return R* unpatched copies *L*. Added to the master bus at *Return Level*. |
| Mute 1–4 | `gate` | While high, the channel is muted, whatever its *Mute* setting. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L / R | `audio` | The master mix. |
| Send L / R | `audio` | The send bus: the sum of each channel at its *Send* level. |
| Level | `control` (unipolar) | An envelope follower on the master (peak, 10 ms attack, 200 ms release), 0…1, for ducking and visualisation. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Level 1–4 | −60 (silence)…+6 dB | 0 dB | Channel fader. The bottom of the travel is silence. |
| Pan 1–4 | −1 (L)…+1 (R) | 0 | Mono channels: position. Stereo channels: balance. |
| Send 1–4 | −60 (silence)…+6 dB | silence | Level into the send bus. |
| Return Level | −60 (silence)…+6 dB | 0 dB | Level of the return into the master. |
| Master | −60 (silence)…+6 dB | 0 dB | Master fader. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mute 1–4 | Off, On | Off |
| Solo 1–4 | Off, On | Off |
| Send Point 1–4 | Post-fader, Pre-fader | Post-fader |
| Limiter | Off, On | On |

## 4. Behaviour

### 4.1 Signal flow per channel

```
In → Level (dB) → Mute/Solo → Pan → master bus
                    └─ Send (post-fader, or taken before Level when pre-fader) → send bus
```

Levels are converted from dB per sample (`10^(dB/20)`), with the engine's
usual parameter smoothing, so modulating a fader is click-free. Faders run
from −60 dB to +6 dB, and −60 dB is silence (−inf). The fader law (a skewed
knob with −12 dB in the middle) places 0 dB at about 80 % of the travel.

### 4.2 Mono and stereo

- **Mono** (*R* unpatched): equal-power pan, `L = x·cos θ`, `R = x·sin θ`
  with `θ = (Pan + 1)·π/4`. At the centre both sides are −3 dB, so a mono
  source keeps its loudness as it moves.
- **Stereo** (*R* patched): *Pan* is a balance. At the centre both sides
  pass unchanged; moving right attenuates *L* with the same cosine law
  (and vice versa) and never boosts.

### 4.3 Mute and solo

- A channel is silent when its *Mute* setting is on or its *Mute* gate is
  high, or when any other channel has *Solo* on and this one doesn't.
- Solo affects the master bus only; sends keep running, so reverb tails stay
  consistent when soloing.
- Mute, unmute and solo changes ramp over 5 ms (`specs.md` section 7.7).

### 4.4 Master

`Out = limit((master bus + Return × Return Level) × Master)`.

The **limiter** is a lookahead peak limiter at −0.3 dBFS (linked stereo):
the gain is the minimum required over the next 1 ms, released over 50 ms,
then averaged over the lookahead window, so it ramps down smoothly and
reaches each peak's gain before the peak leaves the delay line. The ceiling
is never exceeded. It keeps the board's output safe when four loud sources
meet. Off leaves the signal untouched; the board's output ports clip as usual.
The limiter's lookahead adds 1 ms of latency to *Out* only.

### 4.5 Send and return

*Send L/R* feeds an effect chain on the board (or leaves through a port), and
the effect's output comes back into *Return*. The engine orders the graph per
node, so Send → effect → Return is a cycle: the cable into *Return* becomes a
feedback cable (`specs.md` section 7.5) and the return arrives one sub-block
late (32 samples, about 0.7 ms). That is inaudible for reverbs and delays,
the usual send effects. For phase-tight parallel processing, use a second
Audio Mixer as the return instead.

## 5. Module view

A mixing-console layout: one vertical strip per channel with *Send* and *Pan*
knobs at the top, *M* and *S* buttons, a fader and a stereo peak meter
(−60…+6 dB, peak hold 1 s, red above 0 dB). A master strip on the right with
*Return Level*, *Master*, the limiter switch and a gain-reduction meter.
The channel's name in the strip is the name of the node patched into *In L*
(or "1"…"4" when unpatched). The *Send Point* setting is in the strip's
right-click menu.

The first version uses the generic module view (knobs and settings); the
displays described here come later.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

- Meters and the limiter's gain reduction via `liveValues` (one peak per
  channel, the master peak and the gain reduction).
- A shared dB/fader-law helper in `patch/common/dsp/` (the *VCA* and future
  modules can reuse it).
- The limiter's 1 ms latency is not reported to the host; it only shifts
  *Out* relative to *Send*. Noted in the module docs.
- Later: the engine could order a node's inputs separately, so a return
  path costs no delay. Not needed for the first version.

## 8. Tests

- Level −inf mutes; 0 dB passes unchanged; +6 dB doubles the amplitude.
- Mono pan: centre gives −3 dB per side; hard left gives L = x, R = 0; L² + R² constant across the range.
- Stereo balance: centre passes unchanged; hard right silences L, R unchanged.
- Mute setting or a high Mute gate mutes the channel; Solo on one channel silences the others on Out but not on Send.
- Pre-fader send ignores Level; post-fader follows it.
- Limiter: a +12 dB sine stays below −0.3 dBFS after the attack; Off is bit-exact.
- Moving a fader at full speed produces no step larger than the smoothing allows (no clicks).
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Eight-channel variant and a second send bus.
- Per-channel high-pass and a simple tilt EQ.
- Channel names editable in the view (node data).
- Stereo width per channel (mid/side).
