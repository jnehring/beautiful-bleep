# Matrix Mixer

Type id `matrix-mixer` · category *Utility* · colour proposal `#4f46e5`

## 1. Purpose

A grid of up to 8 inputs × 8 outputs. Every crosspoint is a bipolar gain
(−1…+1), so each output is its own weighted mix of all inputs. It mixes audio
(send/return networks, feedback patches, stereo spreading) and control
signals (combining LFOs into many related modulations) alike. Because every
crosspoint is a modulatable knob, and whole matrices can be stored as
snapshots and morphed, one cable can move an entire routing.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| In 1 … In *N* | `audio` (any float type) | The sources. *N* = *Inputs* setting. An unpatched input is 0, or 1 with *Unpatched = 1* (so a row becomes a set of offsets). |
| Morph | `control` (unipolar) | Adds to the *Morph* knob (as any knob input); listed here because it's the main performance jack. |

Every knob is also an input (`specs.md` section 7.3), including all 64
crosspoints — they appear as targets when dragging a cable onto the view.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Out 1 … Out *M* | `audio` | `Out_j = Level_j × Σ_i (gain_ij × In_i)`, after the output stage (4.3). *M* = *Outputs* setting. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Gain *i*·*j* (64) | −1…+1 | 0 (1 on the diagonal for a new module) | Crosspoint from input *i* to output *j*. |
| Level 1 … 8 | 0–200 % (−∞…+6 dB) | 100 % | Output level. |
| Morph | 0–100 % | 0 % | Blend between snapshot *A* and *B* (4.4). Only active when *Morph* is on. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Inputs | 1–8 | 4 |
| Outputs | 1–8 | 4 |
| Mute 1 … 8 (per input) | on/off | off |
| Output stage | Clean, Soft clip, Normalize | Clean |
| Unpatched | 0, 1 | 0 |
| Morph | Off, On | Off |
| Morph curve | Linear, Smooth (smoothstep), Equal power | Linear |

## 4. Behaviour

### 4.1 Gains

Each crosspoint gain is a modulated parameter, read per sample like any knob
(`effective = clamp(knob + Σ mod × amount)`, `specs.md` 5.6), so audio-rate
modulation of a crosspoint (amplitude/ring modulation) works. The bipolar
mapping is linear: knob 0.5 = gain 0.

Mutes ramp over 5 ms (`specs.md` 7.7). Changing *Inputs* or *Outputs*
removes jacks: cables to removed jacks are kept in the board but shown as
"jack hidden" and carry nothing, so shrinking and growing the matrix again
loses no patching (see 7).

### 4.2 Sparse processing

A crosspoint whose effective gain is exactly 0 for a whole 32-sample chunk,
with no modulation cable, is skipped. Cost: at most 64 multiply-adds per
sample (8×8 dense), about 0.05 % CPU at 48 kHz on a current machine; a
typical sparse matrix costs a few multiply-adds.

### 4.3 Output stage

- **Clean:** no limiting; sums above ±1 pass (other modules may clip).
- **Soft clip:** `tanh`-shaped soft clip above ±1 (with 2× oversampling only
  when the output is above 0.9; otherwise free).
- **Normalize:** each output is divided by `max(1, Σ_i |gain_ij|)`, so a
  column can never exceed the loudest input. Useful for control mixes that
  must stay in ±1, and for feedback matrices that should not run away.

### 4.4 Snapshots and morph

The view stores up to 8 **snapshots**: each holds all 64 crosspoint values,
the 8 levels and the mutes. *Recall* writes a snapshot into the knobs (one
undo step; the change ramps over 20 ms to avoid clicks). With *Morph* on, two
snapshot slots are assigned as *A* and *B*, and the crosspoint knobs show
(read-only) the morphed matrix:

`gain_ij = lerp(A_ij, B_ij, curve(Morph)) + Σ mod_ij × amount`

i.e. modulation cables on crosspoints still add on top. Mutes switch at
50 %. Levels morph like gains. Editing a crosspoint while morphing edits the
snapshot nearest the current morph position (shown in the view) — so the user
can shape both ends by moving *Morph* to 0 or 100 % and editing.

### 4.5 Feedback

Patching an output back into an input closes a loop; the engine marks it as
a feedback cable with one sub-block delay (`specs.md` 7.5). This is a
supported use (feedback delay networks with delays, filters in the loop); the
*Normalize* stage keeps it stable when the gains form an orthogonal matrix.

### 4.6 Edge cases

- Inputs of type `gate`/`trigger` arrive as 0/1 and mix as values.
- `notes` can't be patched (`specs.md` 7.4).
- Inside a Voice Cell it runs per voice; snapshots and morph are shared.

## 5. Module view

```
           Out1   Out2   Out3   Out4     Level
 In1  [M]  (+1.0)  ·      ·     (−0.3)
 In2  [M]   ·     (+0.7)  ·      ·
 In3  [M]   ·      ·     (+1.0)  ·
 In4  [M]  (+0.2)  ·      ·     (+1.0)
            ▮▮      ▮▮     ▮▮     ▮▮      ← output meters
 Snapshots  [1][2][3]·[4]·…   A:[1] B:[3]  Morph ━━━━○────
```

- Each crosspoint is a circle whose size shows |gain| and whose colour shows
  the sign (warm positive, cool negative); a modulated crosspoint shows a mod
  ring like any knob.
- **Click** an empty crosspoint: sets +1. **Click** a set one: sets 0.
  **Drag** vertically: sets the value (Shift: fine). **Alt-click**: −1.
  **Double-click**: type a value. A drag is one undo step.
- Row/column headers: input and output names (editable labels, saved),
  mute buttons per row, level knobs per column, meters per column.
- Snapshot buttons: click recalls, Shift-click stores, right-click → rename,
  clear, assign to A/B. A *Randomize* menu (sparse/dense, unipolar/bipolar)
  writes random gains (UI-side randomness, one undo step).

## 6. Saved state

Crosspoint gains, levels and morph are params. Labels and snapshots live in
`data`:

```json
{
  "type": "matrix-mixer",
  "params": { "g_1_1": 1.0, "g_1_2": 0.5, …, "level_1": 0.5, "morph": 0.0, … },
  "data": {
    "labels": { "in": ["Kick", "Pad", "", ""], "out": ["Rev", "", "", ""] },
    "snapshots": [ { "name": "Dry", "g": [[1,0,0,0,0,0,0,0], … 8 rows …],
                     "level": [1,1,1,1,1,1,1,1], "mute": [0,0,0,0,0,0,0,0] },
                   null, … 8 entries … ],
    "morphA": 0, "morphB": 1
  }
}
```

Gains in snapshots are stored in their own units (−1…+1); `sanitiseData`
clamps and pads to 8×8 and 8 slots. All 64 crosspoints are saved even when
the matrix is smaller.

## 7. Engine requirements

1. **Variable jack count.** The visible jacks depend on *Inputs*/*Outputs*.
   Proposal: the spec declares all 8+8 jacks and a `visibleJacks(params)`
   hook; hidden jacks keep their cables (dimmed) and read 0. Other modules
   (Sequential Switch, future mixers) can use it.
2. **Many params.** 64 + 8 + settings ≈ 80 params; the param table and the
   knob-target picker must scale (group them as *Crosspoints* in the cable
   target menu).
3. **Params driven by data.** With *Morph* on, the module computes the base
   gain from snapshot data instead of the knob; the view must show the
   morphed value as the knob position (a `liveValues` array `gains[64]`).

## 8. Tests

- Identity matrix passes inputs unchanged; a −1 crosspoint inverts.
- Output sum equals the formula for random gains and inputs (tolerance 1e-6).
- Sparse skipping gives identical output to dense processing.
- Mute ramps without discontinuity above −60 dB step.
- Normalize keeps every output within the maximum |input| for random gains.
- Morph 0 / 100 % reproduce snapshots A and B exactly; modulation adds on top.
- Recall ramps over 20 ms; it's one undo step.
- Shrinking and growing *Inputs* keeps cables; hidden jacks carry 0.
- Saved data round-trips; malformed snapshot arrays load safely.

## 9. Later

- Per-crosspoint slew / delay (a matrix of short delays for spatial networks).
- Stereo mode (inputs and outputs as pairs, crosspoints with pan).
- Snapshot sequencing on a trigger input; morph along a path of more than two snapshots (would overlap with *Morph*, `specs.md` 12 — share code instead).
- Larger matrices (16×16) for multichannel work.
