# Low Pass Gate

Type id `low-pass-gate` · category *Audio* · colour proposal `#4ade80`

## 1. Purpose

A filter and an amplifier in one, opened by a modelled light-sensitive
resistor. When the control rises, the gate opens almost at once; when it falls,
it closes slowly and unevenly, getting darker as it gets quieter, the way
struck and plucked things die away. A single trigger at *Ping* gives a natural,
organic pluck with no envelope at all. It's stereo, cheap, and made to sit in
every voice of a Voice Cell, where it replaces the usual VCA + filter + ADSR
trio with something more alive.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In L | `audio` | Left input; also feeds the right channel when *In R* is unpatched. |
| In R | `audio` | Right input. |
| CV | `control` | The "light" driving the cell, 0…1 (above 1 is clipped, below 0 is dark). Added to *Level*. A gate or ADSR goes here. |
| Ping | `trigger` | A short flash of light (4.3): a pluck. |
| Velocity | `control` (unipolar) | Scales the next *Ping*'s flash, sampled at the pulse. Unpatched: 1. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out L, Out R | `audio` | The gated signal. |
| Light | `control` (unipolar) | The cell's state `c` (0 = dark, 1 = fully open): a ready-made pluck envelope for other modules. |
| Active | `gate` | High while `c` > 0.001 or the output is above −80 dB; patch into *Voice Out › Active*. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Level | 0–100 % | 0 % | Constant light, added to *CV*. Closed by default, so a patched CV or Ping opens it fully. |
| Response | 0–100 % | 50 % | Speed of the cell: all time constants scaled from 0.25× (snappy) to 4× (slow, ringing); 50 % = 1×. |
| Ping | 0–100 % | 80 % | Strength of the flash on each *Ping* pulse. |
| Resonance | 0–100 % | 0 % | Emphasis at the cutoff (Q 0.5 → 6) in *LP* and *Both*. |
| Brightness | 0–100 % | 75 % | Highest cutoff when fully open: 1 kHz … 20 kHz (exponential). |
| Drive | 0–100 % | 0 % | Soft saturation of the input (`softClip` from `Drums.h`), for warmth on loud plucks. |
| Bleed | 0–100 % | 0 % | How far the closed gate leaks: at 0 % it is silent, at 100 % the dark state still passes a muffled −24 dB. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | LP, VCA, Both | Both |
| Cell | Fast, Classic, Slow memory | Classic |

## 4. Behaviour

### 4.1 The cell model

The light `L = clamp(Level + CV, 0, 1) + flash(t)` drives the cell's
conductance `c` in 0…1 (briefly up to 1.2 on strong pings). A real
photoresistive cell is fast to respond to light and slow, nonlinearly slow, to
recover in the dark; its decay also depends on how long and bright it was lit
before. The model is the shared `dsp::Vactrol` (`common/dsp/Vactrol.h`): an
openness state `c` and a slow memory state `m`:

    m += (L − m) · (1 − exp(−1 / (τ_mem · fs)))       τ_mem: rise or fall time
    if L > c:  c += (L − c) · (1 − exp(−1 / (τ_rise · fs)))
    else:      c += (L − c) · (1 − exp(−1 / (τ_fall · fs)))

    τ_fall = τ₀ · (1 + k · (1 − c)²) · (1 + M · m)    (slower in the dark and after long light)

| Cell | τ_rise | τ₀ | k | memory rise / fall | M |
|---|---|---|---|---|---|
| Fast | 1 ms | 12 ms | 3 | 150 ms / 0.5 s | 1 |
| Classic | 3 ms | 28 ms | 4 | 300 ms / 1 s | 1.5 |
| Slow memory | 6 ms | 60 ms | 5 | 600 ms / 3 s | 3 |

All times are multiplied by the *Response* factor `0.25 · 16^Response`. The
memory state is what gives the cell memory: a short ping barely charges it,
while a long, bright gate fills it and stretches the next fall by up to
`(1 + M)`×, so the tail after a held note is longer than after a ping. The
rise and memory coefficients are computed when *Response* or *Cell* change;
the fall uses a Padé approximation of `1 − exp(−x)` per sample, so the model
costs a handful of operations per sample.

### 4.2 From cell to sound

With `c` the conductance, per mode:

| Mode | Gain | Low-pass cutoff |
|---|---|---|
| LP | 1 | `f(c)` |
| VCA | `c^1.4` | none (bypassed) |
| Both | `c^1.2` | `f(c)` |

`f(c) = 30 Hz · (f_max / 30 Hz)^(c^0.7)` with `f_max` from *Brightness*, so
the cutoff rises quickly at the start of a pluck and lingers in the low range
as it fades. The filter is the shared gate's 2-pole TPT state-variable
low-pass (`dsp::LowPassGate`, the same topology as `dsp::Svf`), Q
`0.5 + 5.5 · Resonance²`, updated per sample (the cutoff moves smoothly
because `c` is smoothed by construction; `tan` uses a Padé approximation
accurate to 0.003 % below 0.45 fs). In *Both* the resonance gain
is compensated by `1 / (1 + 0.3 · Resonance)` so high resonance doesn't jump in
level. *Bleed* adds `bleed · 0.063` to the gain and lifts the closed cutoff from
30 Hz up to 300 Hz, so the "closed" state can murmur.

Both channels share one cell, so stereo images stay stable as the gate closes.

### 4.3 Ping

A *Ping* pulse adds a 2 ms rectangular flash of height
`Ping · Velocity` (on top of *Level* and *CV*, the sum clipped to 1.2) to `L`;
a pulse during a running flash restarts the 2 ms at the higher of the two
heights. With *Classic* cell and *Response* 50 %, a full ping opens to about
`c ≈ 0.5` within 3 ms and the output (*Both*) falls back to −60 dB in about
600–700 ms, with the characteristic bright-then-dark decay; *Response*
stretches it from about 150 ms to 2.5 s. A
ping on a still-open cell adds to it (repeated pings swell), never restarts it,
so fast trigger rolls sound like a real struck object rather than retriggered
envelopes.

### 4.4 Voice Cells

The intended patch per voice: Oscillator (or Folder) → *In L*; *Voice In ›
Trigger* → *Ping*; *Voice In › Velocity* → *Velocity*; Out L/R → *Voice Out*;
*Active* → *Voice Out › Active*. For held notes add *Voice In › Gate* → *CV*:
the gate then opens the cell and its release is the cell's own fall. *Light* →
a Folder's *Fold* makes louder plucks brighter in two ways at once.

### 4.5 Edge cases

- Nothing patched at *CV*/*Ping* and *Level* 0 %: closed (silent at *Bleed* 0).
- `c` is clamped to 0…1.2 internally and the gain to ≤ 1 (the cell never boosts);
  values below 1e-6 snap to 0 (no denormals) and the module skips the filter
  while the gain is 0 and the filter states are cleared.
- Changing *Mode* dips the outputs (2.5 ms down, switch, 2.5 ms up) and keeps
  `c`. Changing *Cell* needs no fade: `c` and `m` carry over and only the
  time constants change.
- With *Drive* > 0 the saturator (the curve of `softClip` in `Drums.h`,
  `tanh(g x) / tanh(g)` with `g = 1 + 8 · Drive`, so ±1 stays ±1) runs with
  first-order antiderivative anti-aliasing (ADAA: the average of the curve
  between consecutive samples, from its closed-form integral
  `log cosh(g x) / (g tanh g)`). That suppresses aliasing about as well as
  2× oversampling at a fraction of the cost (the shared 95-tap
  `Oversampler.h` measured about 2 % CPU per stereo instance, too much for a
  module meant for every voice) and adds only half a sample of delay. It is
  crossfaded in and out over 5 ms and stops 100 ms after *Drive* returns to
  0. Otherwise nothing is needed, since the filter and gain are linear.
- While the cell is fully closed (`c` = 0) in *VCA* or *Both* with *Bleed* 0,
  the filter is skipped and its state cleared: the output is exactly 0.
- *Active* stays high for 50 ms after the cell is closed (`c` ≤ 0.001) and
  both outputs are below −80 dB.

## 5. Module view

The usual knobs and settings, plus a **response display**: the last 2 s of `c`
drawn as a curve (light input dimmer behind it), and a small low-pass curve
whose corner follows the current cutoff, so you see the pluck's shape and
brightness together. A *Ping* button (a momentary module button,
`ModuleSpec::buttons`) fires a manual ping at full velocity (not saved), handy
for auditioning *Response* and *Cell*.

## 6. Saved state

Only knob and setting values; no node data. The cell's state is not saved.

```json
{ "type": "low-pass-gate",
  "params": { "level": 0.0, "response": 0.5, "ping": 0.8, "resonance": 0.0, "mode": 1.0, "cell": 0.5, … } }
```

## 7. Engine requirements

1. **UI-triggered pulse:** the view's *Ping* button is a momentary module
   button (`ModuleSpec::buttons`, read with `pollCommands`); a press is a ping.
2. **Live values:** live arrays `c` and `light` (the last 2 s, 128 points, the
   peak of each 15.6 ms slice) and live values `cutoff` (Hz, 0 in VCA mode)
   and `c` for the display.
3. The shared `Vactrol.h` (cell and gate); *Drive* uses its own ADAA (4.5).

## 8. Tests

- Asymmetry: a step of light 0 → 1 reaches `c` > 0.9 within 5 × τ_rise (Classic, Response 50 %), and a step 1 → 0 takes at least 10× longer to fall to 0.1.
- The fall slows as `c` decreases (the time from 0.5 → 0.25 is shorter than 0.25 → 0.125).
- Memory: after a 2 s full gate the tail to −60 dB is longer than after a single ping.
- Ping: a full ping with Classic/50 % decays to −60 dB in 700 ms ± 20 %; two pings 50 ms apart give a higher peak than one.
- Response scales the times by the documented factor (0 % → 0.25×, 100 % → 4×), measured with the memory state settled.
- Modes: VCA has no spectral change at any `c`; LP has unity gain at DC; Both's cutoff and gain follow the table.
- Bleed 0 % with Level 0: output exactly 0 after the tail; Bleed 100 % passes about −24 dB.
- Gain never exceeds 1 (0 dBFS sine in, ≤ 0 dBFS out without Resonance; with Resonance bounded by the compensation).
- Active: falls within 60 ms after the output goes below −80 dB.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Separate cells per channel with a *Stereo* offset (slightly different decays left and right).
- A 6 dB/oct "passive" filter option next to the 12 dB SVF.
- A cell-model *Light* input for other modules: the same asymmetric model as a stand-alone envelope shaper.
- Four-channel version for mixing several plucked voices.
