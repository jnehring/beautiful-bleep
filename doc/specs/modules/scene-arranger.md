# Scene Arranger

Type id `scene-arranger` · category *Sequencing* · colour `#e9b44c`

## 1. Purpose

Arranges scenes. Up to 16 scenes are played in a play order of up to 16
slots (scene + repeat count). A per-scene follow action picks what comes next
when the repeats are over. Launches wait for the beat or bar if asked. The
scene leaves as a CV that pattern selectors (the Drum Grid's *Pattern*
input: slot ⌊v · 16⌋) read directly, as a change trigger and as eight lane
gates.

## 2. Jacks

| Jack | Type | What it does |
|---|---|---|
| Clock (in) | `trigger` | Each pulse is one beat. Unpatched: the song's quarter notes. |
| Reset (in) | `trigger` | Back to slot 1; the next beat is beat 0. |
| Next / Previous (in) | `trigger` | Launch the scene after / before the current (or queued) scene. |
| Launch (in) | `control` | Scene ⌊v · 16⌋ + 1 (clamped to *Scenes*), launched when it changes. |
| Scene (out) | `control` | Slot of 16: `(s + 0.5) / 16`; Linear: `s / 15` (s = 0-based scene). |
| Change (out) | `trigger` | A new visit starts (a repeated scene on the list included). |
| Cycle (out) | `trigger` | The play order wraps from its last slot to slot 1. |
| Queued (out) | `gate` | A launch waits for its beat or bar. |
| Lane 1 … 8 (out) | `gate` or `trigger` | The scene is within the lane's From … To; trigger mode pulses when a visit in range starts. |

Triggers are 2 ms pulses.

## 3. Controls

Knobs (all stepped): *Scenes* (1–16, 8), *Order Steps* (1–16, 8), *Launch*
(0–16, 0 = none), *Slot n* (scene, default n) and *Repeat n* (1–16, 1) for
slots shown up to *Order Steps*, *Follow n* (Order, Next, Previous, Random,
Hold, Jump, Chance; shown up to *Scenes*), *Jump n* (shown for Jump/Chance),
*Chance n* (shown for Chance), *Lane k From* (0 = off, default k) and *Lane k
To* (default k).
Settings: *Scene Length* (1 beat, 2 beats, 1/2/4/8/16 bars; 2 bars), *Launch
Quantize* (Immediate, Beat, Bar; Bar), *Beats per Bar* (4), *Scene CV*, *Lane
Output*, *Seed*, *Sync To*. Buttons: Next, Previous, Restart.

## 4. Behaviour

- **Beats:** Transport mode: `beat = floor(ppq − off)`; Clock mode: pulse
  counter (0 on the first pulse / after Reset). A *unit* boundary is a beat
  divisible by the Scene Length in beats; a *bar* boundary one divisible by
  *Beats per Bar*.
- **Visits:** a visit of a scene lasts `repeats` units; repeats come from the
  scene's first slot in the list, else 1. Starting a visit resets the count (a
  launch mid-unit counts that partial unit as the first).
- **End of a visit:** the follow action of the scene: Order → next slot
  (wrapping; the wrap fires Cycle); Next/Previous → ±1 scene wrapping at
  *Scenes*; Random → uniform over the other scenes from `u(seed, visit, 7)`
  (Hold if only one scene); Hold → stay; Jump → scene *Jump*; Chance → Jump
  if `u(seed, visit, 8) < Chance`, else Order.
- **Launches:** Immediate applies at once; Beat at the next beat event; Bar at
  the next bar line. One pending launch; a newer replaces it. At a boundary a
  launch wins over the end of a visit. While stopped (no clock yet), a launch
  applies at once and decides the scene that play starts on.
- **Start/Reset:** play starts on slot 1 (or the launched scene) and the
  beat that starts it is not counted as the end of a unit. A Reset goes to
  slot 1 now and ignores the first unit boundary of the new count. Loop
  jumps re-sync the beat counter without advancing.
- **Stop:** lanes low; Scene holds.

## 5. Module view

The generic view, grouped *Play Order*, *Follow Actions* and *Lanes*.

## 6. Saved state

Knob and setting values only.

## 7. Tests

`patch/modules/scene-arranger/tests/test_scene_arranger.cpp`: order and
repeats, Scene Length, every follow action (seeded Random), launch quantize,
Next/Previous/Launch jack, Scene CV against a 16-slot selector, lanes (gate,
range, off, trigger), Reset, loop jump, stop and start.
