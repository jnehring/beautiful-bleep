# Keyboard

Type id `keyboard` · category *Controllers* · colour `#fda4af`

## 1. Purpose

A playable keyboard in the module view, for the mouse, a finger or the
computer keyboard. Its *Notes* output plays a Voice Cell directly, so a
patch can be tried without a MIDI controller; the mono outputs play a single
oscillator and envelope outside a cell.

## 2. Jacks

**Inputs:** none besides the knobs.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | Every key played: note on with velocity, note off. |
| Pitch | `pitch` | The active note (by *Priority*), 1 V/oct, 0 = C4; holds after release. |
| Gate | `gate` | High while any key is held; drops for one sample when the active note changes (retrigger). |
| Velocity | `control` (unipolar) | The active note's velocity. |
| Trigger | `trigger` | Each time the active note changes. |

## 3. Controls

**Knobs**

| Knob | Range | Default | What it does |
|---|---|---|---|
| Velocity | 1…100 % | 80 % | Velocity of every key played (read at the note-on). |
| Glide | 0…2 s | 0 | Portamento on *Pitch* (not on *Notes*). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Octave | −3…+3 | 0 (keys C3–C6) |
| Priority | Last, Lowest, Highest, First | Last |
| Hold | Off, On | Off |

## 4. Behaviour

- The view sends `on note [velocity]`, `off note` and `allOff` through the
  performance channel (`button.md` section 7). The module plays them at the
  start of the next engine chunk: *Notes* events at offset 0, and the mono
  outputs through the same held-note logic as *Notes to CV* (retrigger on,
  glide always).
- A key already down is ended and played again. A key that isn't down
  ignores *off*. Notes outside 0…127 are ignored.
- *All off* ends every key, over several chunks if a chunk's note buffer is
  full; nothing newer plays before it is done.
- The view keeps track of who holds a key (mouse, each computer key, Hold),
  so a note ends only when the last of them lets go.
- *Octave* and *Hold* are view settings: the engine only sees notes.
  Switching *Hold* off ends the latched keys.
- The transport doesn't end notes: the keyboard is played by hand.

## 5. Module view

Three octaves of keys (37) from the C chosen by *Octave*, with C names on
the white keys; held keys lit in the module colour, latched keys with a bar,
the active note outlined. A bar above: octave ‹ ›, the range, *Hold* and
*All off*.

- **Mouse / touch:** press a key; drag across keys for a glissando. With
  *Hold*, a click latches the key and another click frees it.
- **Computer keyboard** (while the keys have focus, by physical key, so any
  layout works): A W S E D F T G Y H U J K O L P ; ' play C4…F5 (shifted by
  *Octave*), Z and X move the octave. Losing focus ends these notes.

## 6. Saved state

Only knob and setting values. Notes are played, never saved.

## 7. Engine requirements

- The performance channel (`button.md` section 7).
- `liveValues`: `active` (the active note, −1 for none) and `held`.

## 8. Tests

- Note on with and without a velocity; pitch in volts; mono outputs follow the last note and fall back on release.
- Off for a key that's up does nothing; out-of-range notes are ignored.
- All off with 100 keys down ends all of them across chunks, then plays the next note.

## 9. Later

- Velocity from where a key is hit; pressure from holding it longer.
- Scale highlighting and a *fold to scale* option shared with the Quantizer.
- A pitch-bend and a mod strip; MPE-style slides.
- A scrolling range wider than three octaves.
