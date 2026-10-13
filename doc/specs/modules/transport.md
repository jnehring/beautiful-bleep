# Transport

Type id `transport` · category *Utility* · colour proposal `#ff9f43`

## 1. Purpose

The song's clock in one module: set the tempo, switch Ableton Link on and off,
send MIDI clock to other gear, follow the MIDI clock of a drum machine or a
DAW, and start and stop the song from buttons, cables or incoming MIDI. The
other modules only *read* the transport (`Transport` in `Module.h`); this one
asks the host to *change* it.

Only the standalone app can do that (it owns the clock, `specs.md` section
11.4), whether the module is compiled in or installed from the store as a
`.wasm` file (4.1). In Live the host's transport leads; in the browser there is
none. There the module still sends MIDI clock out and shows the host's tempo,
but its requests go nowhere.

## 2. Jacks

**Inputs**

| Jack | Type | What it does |
|---|---|---|
| Play | `trigger` | A rising edge starts the transport from the beginning (does nothing while it runs). |
| Stop | `trigger` | A rising edge stops it. |
| MIDI In | `notes` | Realtime messages (`NoteEvent::System`: clock, start, continue, stop) to follow, from a MIDI In or MIDI Device module. Used with *MIDI Clock In* on. |

**Outputs**

| Jack | Type | What it carries |
|---|---|---|
| MIDI Out | `notes` | MIDI clock, start, continue and stop, to a MIDI Out module. Used with *MIDI Clock Out* on. |
| Playing | `gate` | High while the transport runs. |
| Tempo | `control` (unipolar) | The tempo in BPM / 100 (120 BPM = 1.2), like the Link node. |

## 3. Controls

**Knobs**

| Knob | Range | Default | What it does |
|---|---|---|---|
| Tempo | 20…400 BPM | 120 | Moving it sets the tempo (see 4.1). |

**Settings**

| Setting | Values | Default |
|---|---|---|
| Link | Off, On | On |
| Link Start/Stop | Off, On | On |
| MIDI Clock In | Off, On | Off |
| MIDI Clock Out | Off, On | Off |

**Buttons:** *Play / Stop* (starts a stopped transport, stops a running one) and *Tap* (tap tempo).

## 4. Behaviour

### 4.1 Requests to the host

The module writes its requests into `HostControl` (`engine/HostControl.h`, one
mailbox per process). The standalone app polls it every 10 ms and applies the
requests to its `LinkClock`: tempo, play (from the start) or continue, stop,
Link on/off, Link start/stop sync. A request replaces an older one that was
not yet taken. While Live drives the app through Bleep Audio Bridge, Live
leads: the requests are dropped.

- **Tempo** is a gesture, not a state. The module sends it only when the knob
  *changes* (by 0.05 BPM or more), by hand, by modulation, by *Tap* or by an
  incoming MIDI clock, never when the board loads, so a project's saved tempo
  survives. The knob itself does not follow the tempo set elsewhere (Link
  peers, MIDI clock); the module view shows the tempo that is actually running.
- **Link** and **Link Start/Stop** describe how the board wants the app set up.
  They are sent on the first block and when they change. Link on is only
  possible when the app was built with Link (`HostControl::linkAvailable`). The
  setting is not stored as the app's own preference (File → Settings keeps that).
  If the board also has a *Link* node, its *Start/Stop Sync* wins.
- **Play** and **Stop** act at once on the rising edge or the button.

As a `.wasm` file the module has a mailbox of its own in its memory (the same
`HostControl` struct, 40 bytes with a fixed layout) and exports its address as
`bleep_host_ptr` (an optional export of module ABI 1, `module-abi.md`, "Host
mailbox"). `WasmModule` copies the host's status into it before each block
and, after the block, moves the requests into the process's mailbox and
clears them. A host that does not know the export simply ignores the
requests.

### 4.2 MIDI clock out

With *MIDI Clock Out* on and the transport running, the module sends 24 clock
pulses per quarter note on *MIDI Out*, each on the sample where the song
position crosses a 1/24-beat boundary (`MidiClockOut`). When the transport
starts it sends **Start** (position 0) or **Continue** (anywhere else; no song
position pointer is sent), then the pulse of that position. It sends **Stop**
when the transport stops or the setting is switched off. A jump back in
position (loop, restart) sends nothing extra: the pulses resume from there.

Wire *MIDI Out* into a MIDI Out module (which sends realtime messages as single bytes).

### 4.3 MIDI clock in

With *MIDI Clock In* on and a cable in *MIDI In*:

- **Clock** pulses give the tempo (`MidiClockIn`): the average spacing over up to
  96 pulses (four beats), first after one beat, then every quarter beat, only when
  it differs by 0.2 BPM or more (rounded to 0.1). Block timing jitter averages out
  (±5 ms of jitter stays within 1 BPM after two bars). A gap of more than 1.5 pulse
  spacings at 20 BPM starts the average afresh. Tempi outside 20…400 are ignored.
- **Start** starts the transport from the beginning (and restarts the average),
  **Continue** continues, **Stop** stops.

The follower sets the tempo; it does not lock the phase. Use Link or a shared
clock for tight alignment. Do not patch the module's own *MIDI Out* back into
its *MIDI In* with both settings on (the MIDI loop it makes is yours to break).

### 4.4 Tap

*Tap* averages the spacing of up to the last five taps (four intervals); a pause
of two seconds starts again. The first tap after a pause only starts counting.

### 4.5 Outputs

*Playing* and *Tempo* read `Transport` of the running block, so they show what
the host is really doing, whoever changed it.

## 5. Module view

The generic module view (knobs, settings, the two buttons). `liveValues`:
`bpm`, `playing`, `hosted` (a host answers requests), `linkAvailable`,
`linkEnabled`, `peers`, `clockIn` (a MIDI clock arrived in the last half second).

## 6. Saved state

Only knob and setting values; no node data.

## 7. Engine requirements

- `engine/HostControl.h` (new): the request mailbox and the host's status.
- `AppController::applyHostControl()` (new): a 100 Hz timer answering it.
- `bleep_host_ptr` / `bleep_host_size` in `WebShim.cpp`, and `WasmModule::hostToModule()` / `hostFromModule()`: the mailbox for the `.wasm` build.
- `LinkClock::setPlaying(on, fromStart)`: continue without going back to the first beat.
- *MIDI Out* sends `NoteEvent::System` as single-byte realtime messages, and ignores other event types it cannot express (it used to send them as key pressure).

## 8. Tests

`patch/modules/transport/tests/test_transport.cpp`:

- Clock out: Start, then 24 pulses per beat; the pulses are evenly spaced; Continue away from the start; Stop once; silent when off; Stop when switched off; no burst after a loop jump.
- Clock in: a steady clock gives its tempo after a beat and reports once; jitter washes out; a tempo change is followed; a gap starts afresh; a clock beyond 400 BPM is ignored.
- Tap tempo and its reset.

`patch/tests/wasm_host_control_test.cpp` (needs `transport.wasm`): the module as a `.wasm` file puts its requests into the host's mailbox (Link and its start/stop on load, no tempo on load, a tempo change, Play and the button) and takes the host's status.

## 9. Later

- Song Position Pointer out and in, so Continue lands on the right beat.
- Phase-locking to an incoming clock (a PLL instead of a tempo average).
- Time signature (bar length) for Link's quantum and the bar outputs.
- Count-in and a *Stop at bar end* option; a display with the beat.
