# Button

Type id `button` · category *Controllers* · colour `#fda4af`

## 1. Purpose

A pad to press with the mouse, a finger or the computer keyboard. It starts
envelopes, resets LFOs and sequencers, fires drums or switches something on
and off, by hand, while the patch plays.

## 2. Jacks

**Inputs:** none.

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Gate | `gate` | *Momentary:* high while the pad is held. *Toggle:* the toggle's state. |
| Trigger | `trigger` | One sample on every press. |
| Release | `trigger` | One sample on every release. |
| Toggle | `gate` | Flips on every press, in both modes. |

## 3. Controls

**Settings**

| Setting | Values | Default |
|---|---|---|
| Mode | Momentary, Toggle | Momentary |

## 4. Behaviour

- Presses and releases reach the audio thread through the engine's
  performance channel (`Engine::perform`, section 7) and take effect at the
  next samples, one event per sample, so a quick tap inside one engine chunk
  still gives a one-sample gate, a *Trigger* and a *Release*.
- A press while held, or a release while up, is ignored.
- The toggle's state is saved in the node's data. The view decides the new
  state on press and sends it with the press, and saves it, so engine and
  document always agree. A press without a state (later: MIDI) flips it.

## 5. Module view

A large pad (150 × 110 px) lit in the module colour while the gate is high,
with the label *Press* / *Held* (Momentary) or *On* / *Off* (Toggle), and an
LED for the *Toggle* output. Space or Enter press the pad while it has focus;
losing focus releases it.

## 6. Saved state

`data: {"on": bool}`, the toggle. Pressing the pad changes the set (so it is
saved) but makes no undo entry.

## 7. Engine requirements

- **Performance channel** (new): `perform(node, action, args)` from the view
  to the module (`Module::perform`, message thread). No document change, no
  undo entry. Modules hand gestures to the audio thread through a
  `ControlQueue` (single producer, single consumer). Also used by *Keyboard*.

## 8. Tests

- Press: Gate, Trigger at the first sample; Release on release; Toggle flips.
- A tap inside one chunk gives a one-sample gate and both triggers.
- Toggle mode: Gate follows the toggle state sent with the press.
- The node data restores the toggle without a trigger.

## 9. Later

- Show the pad on the node itself; panel control and MIDI learn.
- Velocity from where the pad is hit; a *Level* output for it.
