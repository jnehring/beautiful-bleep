# Level Meter

Type id `level-meter` · category *Utility* · colour `#c4b5fd`

## 1. Purpose

Shows how loud a signal is: stereo peak and RMS meters, a peak hold and clip
lights. The audio passes through unchanged, so the meter can sit anywhere in
an audio path, and its *Level* output turns loudness into modulation (an
envelope follower).

## 2. Jacks

**Inputs**

| Jack | Type | What it carries |
|---|---|---|
| In L | `audio` | Left channel, or mono. |
| In R | `audio` | Right channel. Unpatched: follows *In L*, and the view shows one mono bar. |

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The inputs, unchanged (*Out R* = *In L* when *In R* is unpatched). |
| Level | `control` (unipolar) | The louder channel's level on a dB scale: 0 at *Floor* and below, 1 at 0 dBFS. |
| Clip | `gate` | High while a sample's magnitude exceeds 1.0 (0 dBFS), and 50 ms after the last one. |

## 3. Controls

**Knobs**

| Knob | Range | Default | Notes |
|---|---|---|---|
| Response | 10 ms – 2 s (skewed, centre 300 ms) | 300 ms | RMS time constant and peak release (60 dB over *Response*). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Floor | −24, −36, −48, −60, −72, −96 dB | −60 dB |
| Level Follows | RMS, Peak | RMS |
| Peak Hold | Off, 1 s, 3 s, Until Reset | 3 s |

## 4. Behaviour

- **RMS:** a one-pole average of x² per channel with time constant
  *Response*, then the square root. A full-scale sine reads −3 dB.
- **Peak:** instant attack; falls exponentially by 60 dB over *Response*.
- **Level** follows the RMS or the peak detector (*Level Follows*) of the
  louder channel, mapped `clamp((dB − Floor) / −Floor, 0, 1)`.
- **Clip** goes high at the first sample over 0 dBFS and holds for 50 ms.
- **For the view**, the audio thread publishes per channel the largest
  sample since the view last read it (so no short peak is missed between UI
  frames), the current RMS, a clip flag since the last read, and whether
  *In R* is patched. Ballistics (the bar falls 24 dB/s) and the peak hold
  are applied by the view.
- The Response coefficients are recomputed only when *Response* changes.

## 5. Module view

A canvas, 180 px high: a dB scale from 0 down to *Floor* (ticks at 0, −3,
−6, −12, −18, −24 and every 12 dB below, skipping ticks that would crowd)
and one bar per channel (one when mono). The pale part of a bar is the peak,
the solid part inside it the RMS; bars are green, amber from −6 dB and red
over 0 dB. A line marks the held peak.
Below: per channel the held peak and RMS in dB, and a clip light that stays
on until clicked. Clicking the canvas or a light resets holds and lights.

## 6. Saved state

Only the knob and settings. Holds and clip lights are not saved.

## 7. Engine requirements

None. Uses `Module::liveValues`; the read-and-reset of peaks happens there
(message thread), with atomics shared with the audio thread.

## 8. Tests

- Level conversion: 0 dBFS → 1, *Floor* → 0, silence → 0.
- A full-scale sine settles at an RMS of 0.707 and Level ≈ (−3 − Floor)/−Floor.
- Peak mode: instant attack, about 60 dB lower after *Response*.
- Clip: high on a sample over 1.0, still high 40 ms later, low after 60 ms.
- Node: audio passes through unchanged; mono input feeds both outputs;
  `liveValues` reports the chunk's peak once, then 0, and the clip flag once.

## 9. Later

- A small meter on the node itself, without opening the view.
- LUFS (K-weighted) loudness and a correlation/phase meter.
- A gain knob so the meter can also trim.
