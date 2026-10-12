# Monitor

Type id `monitor` · category *Utility* · colour `#7dd3fc`

## 1. Purpose

Shows what is on a cable, in one window: a table of the MIDI events that
arrive (notes, controllers, program changes, bend, pressure, clock), an audio
meter, a CV readout and a gate meter. Every input passes through to its
output unchanged, so the Monitor can sit in the middle of a patch or hang off
a cable on the side. It has no signal outputs of its own.

## 2. Jacks

**Inputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | The stream to show in the MIDI table. |
| Audio L | `audio` | Left channel, or mono. |
| Audio R | `audio` | Right channel. Unpatched: follows *Audio L*, and the view shows one mono bar. |
| CV | `control` | Any control or pitch signal. |
| Gate | `gate` | Any gate or trigger. |

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| Notes | `notes` | The input's events, unchanged. |
| Audio L, Audio R | `audio` | The inputs, unchanged (*Audio R* = *Audio L* when *Audio R* is unpatched). |
| CV | `control` | The input, unchanged. |
| Gate | `gate` | The input, unchanged. |

An unpatched input reads 0, and its card in the view dims.

## 3. Controls

**Knobs**

| Knob | Range | Default | Notes |
|---|---|---|---|
| Response | 10 ms – 2 s (skewed, centre 300 ms) | 300 ms | RMS time constant and peak release of the audio meter. |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Floor | −24, −36, −48, −60, −72, −96 dB | −60 dB |

The audio meter is `LevelMeterDsp` (level-meter.md §4), so it reads the same
as the Level Meter. The view's own controls (event filters, Pause, Clear) are
not saved.

## 4. Behaviour

### MIDI

- Each event on *Notes* is logged in a ring of 256 and passed on at its
  sample offset. A log slot is one 64-bit atomic (type, channel, number,
  data), so the message thread never reads half an event.
- What the log holds, in MIDI's units: **Note On/Off** (note, velocity
  0 – 127), **Poly Pressure** (note, pressure), **CC** (controller, value),
  **Program** (program), **Pitch Bend** (−8192 … +8191), **Channel Pressure**
  (pressure), **System** (the status byte of a realtime message: clock
  0xF8, start 0xFA, continue 0xFB, stop 0xFC). Channels are 0 – 15 in the
  log, 1 – 16 in the view. Event types the Monitor does not know are passed
  on and not logged.
- **Held notes** are a set of 128 bits, kept by note number: a note on sets
  a bit, a note off from any channel clears it, *All Sound Off* (CC 120) and
  *All Notes Off* (CC 123) clear all. With nothing patched to *Notes* the set
  is empty. The view draws them as a keyboard strip.
- For the view, `liveArrays` publishes `midi`: the count of events ever
  logged (modulo 2²⁴, exact in a float), then the newest 64 events as
  `type, channel, number, data`. The count is read before the events. It is
  stateless, so any number of views can read it; the view adds what is new
  since the count it has seen, and shows "n missed" when more than 64 arrived
  between two reads.

### Audio

As the Level Meter: peak and RMS per channel, clip flags since the last read
(`liveValues` returns the largest sample since its last call, so no short
peak is missed). Ballistics (the bar falls 24 dB/s) and the 3 s peak hold are
the view's.

### CV

The audio thread publishes the last value and the lowest and highest value
since the last read (`CvStats`: a one-sample spike shows). The view adds
the history, the all-time range (reset by a click) and the note name the
value would play on 1 V/octave with 0 = C4, e.g. `A4 −43 ct`.

### Gate

`GateStats` runs on every sample. The gate is high at 0.5 and above.

- **Pulses:** rising edges since the start (the view subtracts the count at
  its last reset).
- **Length:** how long the last gate stayed high (the running time while it is high).
- **Rate:** 1 / the time between the last two rising edges, shown in Hz and
  BPM; 0 (shown "–") once the gate has been quiet for twice that period or 2 s.
- **Duty:** the share of the last second the gate was high (one-pole, 1 s).
- **Any high since the last read:** so a one-sample trigger still lights the
  lamp, once.

## 5. Module view

Three bands, top to bottom.

1. **MIDI:** filter chips (*Notes*, *CC*, *Program*, *Bend*, *Pressure*, *Clock*;
   *Clock* is off at first, because it sends 24 events per quarter note),
   a count (*n held · n missed · n events*), *Pause* and *Clear*. Below, a
   table, newest on top, 120 rows at most (400 events are kept to refill it
   when a filter changes): time since the window was opened, channel, event,
   number (a note shows its name and number; a CC its name where it has a
   standard one), and the value with a small bar. Under the table, a strip
   of 128 keys with the held notes lit. Unpatched, the table says so.
2. **Three cards:**
   - **Audio:** a bar per channel (one when mono) with the RMS inside the peak,
     the held peak line, a dB scale, and per channel the held peak and RMS in
     dB with a clip lamp. Click to reset holds and lamps.
   - **CV:** the value large, its note name below, a history (about 200
     updates) drawn as a line with the min–max band of each update, on a
     scale that grows to the next of 1, 2, 5, 10, 20, 50, 100; the lowest and
     highest value seen and the scale. Click to reset the range.
   - **Gate:** a lamp and *HIGH* / *LOW*, a strip of the gate's recent
     history, and pulses, rate, length and duty. Click to reset the pulse count.
3. The controls: *Response* and *Floor*.

## 6. Saved state

Only the knob and the setting.

## 7. Engine requirements

The `notes` stream carries what the Monitor shows. `NoteEvent` gained the types
**Cc**, **Program**, **Bend**, **ChannelPressure** and **System**, reusing the
`note` and `value` fields so the 16-byte layout, and so the wasm and web ABI
(module-abi.md), stay as they are:

| Type | `note` | `value` |
|---|---|---|
| Cc | controller 0 – 127 | data ÷ 127 |
| Program | program 0 – 127 | – |
| Bend | – | −1 … +1 |
| ChannelPressure | – | 0 … 1 |
| System | status byte (0xF8, 0xFA, 0xFB, 0xFC) | – |

- The MIDI In, MIDI Device and Instrument ports emit them (realtime messages
  ignore the *Channel* setting; they have none).
- Controller-type events use `NoteBuffer::pushController`: they are dropped
  once `kMaxNotesPerChunk − kNoteReserve` (48) slots are used, so a flood of
  CCs cannot crowd out notes.
- **A module must ignore the types it does not know.** Notes to CV treated
  "not on, not off" as pressure and was fixed to test for pressure by name;
  Voice Cells, Sampler, Harmony Master, Drum Notes and MIDI Out already test
  for On and Off by name (every use of `NoteEvent::` in `patch/modules`, `patch/common` and `patch/engine` was checked).
  A third-party wasm module that reads "anything else" as pressure would react to
  the new types, which is why module-abi.md says to test by name.

## 8. Tests

DSP (`modules/monitor/tests/test_monitor.cpp`):

- The log keeps order and data (note, CC, bend ±1 clamps to −8192 / +8191,
  program, system), returns the newest *n* oldest first, wraps around 256
  slots and resets.
- Held notes: set and clear by number, count, out-of-range numbers ignored.
- CV range: lowest and highest since the last read, collapsing to the
  current value; `A4`, `A4 ±25 ct`, octaves from 1 V/octave.
- Gate: 16 pulses in 4 s at 4 Hz, rate 4 Hz, length 50 ms, duty 20 %; a
  one-sample trigger counts and lights the lamp once; the rate drops to 0
  when the gate stops; a held gate reports its running length and no rate.

Node (`tests/utility_modules_test.cpp`):

- Events pass through at their offsets and are logged in order with MIDI-unit
  data; held notes follow note on, note off and *All Notes Off*; unknown
  event types pass through unlogged; nothing logged while *Notes* is unpatched.
- Audio passes through; the peak is reported once. CV and gate: values,
  range since the last read, a one-sample trigger counts and lights once.
- MIDI In emits CC, program change, bend, channel pressure, poly pressure and
  clock/start with channel and offset; a flood of CCs leaves room for notes.
- Notes to CV does not react to the new event types.

## 9. Later

- A scope and spectrum (the Wave Analyzer and XY Scope already exist as
  separate modules).
- Pitch/tuner readout for audio, LUFS loudness, correlation and phase.
- MIDI: a timestamp in beats, RPN/NRPN and 14-bit pairs combined, SysEx,
  and logging to a file.
- A MIDI Out that sends the new event types (it sends notes only).
