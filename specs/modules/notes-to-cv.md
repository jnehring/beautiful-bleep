# Notes to CV

Type id `notes-to-cv` · category *Utility* · colour proposal `#c084fc`

## 1. Purpose

The counterpart of *CV to Notes*: turns a `notes` stream into mono pitch,
gate, velocity and trigger signals, so a Step Sequencer's *Notes*, a
MIDI port or a MIDI Device can drive modules outside a Voice Cell (an
oscillator, a filter's cutoff, a Function). `specs.md` section 7.4 already
points users here for `notes` → anything else.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Notes | `notes` | The note stream. |

Every knob is also an input (`specs.md` section 7.3).

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Pitch | `pitch` | The active note's pitch, 1 V/oct (0.0 = C4), including any fractional pitch carried by the note. Holds after release. |
| Gate | `gate` | High while any note is held (see 4.2 for retriggering). |
| Trigger | `trigger` | A pulse at each new active note, including legato changes. |
| Velocity | `control` (unipolar) | Note-on velocity of the active note, 0–1. Holds after release. |
| Release | `control` (unipolar) | Release velocity of the last note-off, 0–1. |
| Pressure | `control` (unipolar) | Per-note pressure of the active note, 0–1; 0 after release. |
| Count | `control` (unipolar) | Number of held notes / 16, clipped to 1. |

## 3. Controls

**Knobs** (modulatable floats)

| Knob | Range | Default | What it does |
|---|---|---|---|
| Glide | 0…2 s | 0 | Slew on *Pitch*. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Priority | Last, Lowest, Highest, First | Last |
| Retrigger | Off (legato), On | On |
| Glide Mode | Always, Legato only | Always |
| Channel | All, 1–16 | All |

## 4. Behaviour

### 4.1 Note priority

The module keeps the list of held notes (up to 32; beyond that the oldest is
dropped). The **active note** is chosen by *Priority*:

- *Last*: the most recently pressed; releasing it falls back to the previous
  held note (a mono synth's usual behaviour).
- *Lowest* / *Highest*: by pitch.
- *First*: the oldest held note; later notes only take over when it is released.

When the active note changes while others are held, *Pitch* and *Velocity*
move to the new note and *Trigger* fires.

### 4.2 Gate and retrigger

- *Retrigger On*: on every change of the active note, *Gate* drops low for one
  sample before going high again, so envelopes restart.
- *Retrigger Off*: *Gate* stays high as long as any note is held (legato);
  only *Trigger* marks the change.

*Glide Mode Legato only* applies *Glide* only when the new note starts while
another is still held.

### 4.3 Housekeeping

- Notes from other MIDI channels are ignored when *Channel* is set.
- When the transport stops, or the *Notes* cable changes or is removed, all held
  notes are released (the same rule as Voice Cells, `specs.md` section 8.3.1),
  so the gate never hangs.
- Event timing is sample-accurate: outputs change at the event's sample offset.

## 5. Module view

The settings and *Glide*, plus a small keyboard (two octaves around the
active note) showing held notes and highlighting the active one, and the
note name of *Pitch*.

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

- `NoteBuffer` access with sample offsets (exists for *CV to Notes* and Voice Cells).
- The MIDI channel on each note event (`NoteEvent::channel`, exists).
- `liveValues` for the held and active notes.

## 8. Tests

- One note: Pitch, Gate, Velocity, Trigger at the event's exact sample; Gate falls on note-off; Pitch holds.
- Each priority with three overlapping notes, including the fallback on release.
- Retrigger On produces a one-sample low gap; Off keeps Gate high.
- Glide Legato only: no glide on detached notes, glide on overlapping ones.
- Round trip: CV to Notes → Notes to CV reproduces pitch and gate.
- Removing the Notes cable or stopping the transport ends the gate.
- The demo types file includes the module (`patch.ui-types`).

## 9. Later

- Polyphonic split: *Pitch 1–4 / Gate 1–4* outputs (voice allocation outside a Voice Cell).
- Arpeggiator mode (a separate module is more likely).
- Pitch bend input from a MIDI port's channel data.
