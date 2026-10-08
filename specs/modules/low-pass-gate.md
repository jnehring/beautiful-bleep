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
conductance `c` in 0…1 (briefly up to 1.2 on strong pings). A real photoresistive cell is fast to respond to light
and slow, nonlinearly slow, to recover in the dark; its decay also depends on
how long and bright it was lit before. The model has two states, a fast and a
slow one, `c = 0.75 · c_f + 0.25 · c_s`, each a one-pole with separate rise and
fall times:

    if L > c_x:  c_x += (L − c_x) · (1 − exp(−1 / (τ_rise · fs)))
    else:        c_x += (L − c_x) · (1 − exp(−1 / (τ_fall(c_x) · fs)))

    τ_fall(c) = τ₀ · (1 + k · (1 − c)²)          (decay slows as the cell darkens)

| Cell | fast: τ_rise / τ₀ / k | slow: τ_rise / τ₀ / k |
|---|---|---|
| Fast | 1 ms / 30 ms / 4 | 20 ms / 150 ms / 4 |
| Classic | 3 ms / 60 ms / 8 | 80 ms / 400 ms / 8 |
| Slow memory | 6 ms / 120 ms / 12 | 400 ms / 1.5 s / 12 |

All times are multiplied by the *Response* factor `0.25 · 16^Response`. The slow
state is what gives the cell memory: after a long, bright gate the tail is
longer than after a short ping. The exponentials are computed once per
sub-block per τ (τ_fall is evaluated at the sub-block start and interpolated),
so the model costs a handful of operations per sample.

### 4.2 From cell to sound

With `c` the conductance, per mode:

| Mode | Gain | Low-pass cutoff |
|---|---|---|
| LP | 1 | `f(c)` |
| VCA | `c^1.4` | none (bypassed) |
| Both | `c^1.2` | `f(c)` |

`f(c) = 30 Hz · (f_max / 30 Hz)^(c^0.7)` with `f_max` from *Brightness*, so
the cutoff rises quickly at the start of a pluck and lingers in the low range
as it fades. The filter is the shared ZDF state-variable filter (`dsp::Svf`)
in low-pass, Q `0.5 + 5.5 · Resonance²`, updated per sample (the cutoff moves
smoothly because `c` is smoothed by construction; `tan` uses a polynomial
approximation accurate to 0.01 % below 0.45 fs). In *Both* the resonance gain
is compensated by `1 / (1 + 0.3 · Resonance)` so high resonance doesn't jump in
level. *Bleed* adds `bleed · 0.063` to the gain and lifts the closed cutoff from
30 Hz up to 300 Hz, so the "closed" state can murmur.

Both channels share one cell, so stereo images stay stable as the gate closes.

### 4.3 Ping

A *Ping* pulse adds a 2 ms rectangular flash of height
`Ping · Velocity` (on top of *Level* and *CV*, the sum clipped to 1.2) to `L`.
With *Classic* cell and *Response* 50 %, a full ping opens to about `c ≈ 0.5`
within 3 ms and falls back to −60 dB in about 700 ms, with the characteristic
bright-then-dark decay; *Response* stretches it from about 200 ms to 3 s. A
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
- Changing *Mode* or *Cell* crossfades the outputs over 5 ms and keeps `c`.
- With *Drive* > 0 the saturator runs at 2× oversampling (the shared
  `Oversampler.h`, `wavefolder.md` section 7); otherwise no oversampling is
  needed, since the filter and gain are linear.

## 5. Module view

The usual knobs and settings, plus a **response display**: the last 2 s of `c`
drawn as a curve (light input dimmer behind it), and a small low-pass curve
whose corner follows the current cutoff, so you see the pluck's shape and
brightness together. A *Ping* button under the display fires a manual ping (UI
only, not saved), handy for auditioning *Response* and *Cell*.

## 6. Saved state

Only knob and setting values; no node data. The cell's state is not saved.

```json
{ "type": "low-pass-gate",
  "params": { "level": 0.0, "response": 0.5, "ping": 0.8, "resonance": 0.0, "mode": 1.0, "cell": 0.5, … } }
```

## 7. Engine requirements

1. **UI-triggered pulse:** the view's *Ping* button needs a way to send a
   one-off trigger to the module without a cable (e.g. a momentary hidden
   param read as a rising edge). If the board has no such mechanism yet, add a
   generic "momentary button" param kind that the engine turns into a trigger.
2. **Live values:** `c` history (throttled, 64 points per refresh) and the
   current cutoff for the display.
3. The shared `Oversampler.h` for *Drive*.

## 8. Tests

- Asymmetry: a step of light 0 → 1 reaches `c` > 0.9 within 5 × τ_rise (Classic, Response 50 %), and a step 1 → 0 takes at least 10× longer to fall to 0.1.
- The fall slows as `c` decreases (the time from 0.5 → 0.25 is shorter than 0.25 → 0.125).
- Memory: after a 2 s full gate the tail to −60 dB is longer than after a single ping.
- Ping: a full ping with Classic/50 % decays to −60 dB in 700 ms ± 20 %; two pings 50 ms apart give a higher peak than one.
- Response scales the times by the documented factor (0 % → 0.25×, 100 % → 4×).
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
