# Bridges between Live, the Bleep App and Bleep Play

Status: built for one computer (build order §8, with what is open marked there); the protocols in §10 are the contract and the tests follow them. How MIDI, audio and sync travel between the three places Bleep runs: **Live** (plugins), the **app** (standalone) and the **web** (Bleep Play). Extends `specs.md` §6, §11 and §18.

## 0. Today and the goal

| | Live ⇄ App | App ⇄ Web | Live ⇄ Web |
|---|---|---|---|
| MIDI | OS virtual ports (*Bleep App 1/2*) | nothing | nothing |
| Audio | Bleep Audio Bridge (shared memory, sample-locked) | nothing | nothing |
| Sync | Ableton Link, and Live's transport through the bridge | nothing | nothing |

Goal: any of the three can send and receive MIDI, audio and sync to any other, chosen **in the place where you are**, with the same few controls everywhere.

## 1. The idea: a port names the board on its other side

Every Bleep plugin in Live already is a hole between a track and a board (`specs.md` §6). Today that board is always *this set's* Bleep Board. The new setting says **which board is on the other side**:

| Board | Meaning |
|---|---|
| **This set** (default) | The board in this Live set's Bleep Board, as today |
| **App** | The running Bleep App |
| **Web** | Bleep Play that joined (§4) |

So the answer to "can an audio out plugin choose whether it sends to web, app or Live": **yes, as a *Board* menu on each port plugin.** *Bleep Audio Out* with Board = App makes the app's board a sound source on a Live track. *Bleep Audio In* with Board = Bleep Play sends the track's audio to Bleep Play. *Bleep MIDI In/Out* the same for MIDI.

- **The old Bleep Audio Bridge becomes Bleep Audio In + Out with Board = App.** One concept instead of a special plugin. (A single plugin with Send and Return stays available as *Bleep Audio Bridge*, the same plugin with both directions, because Audio In passes audio through and Audio Out is an instrument, which is awkward on one track.)
- **The other side needs no setting.** A remote port appears on the receiving board as a node named after its track and its plugin, as bridges do today: *Live: Drums* with *Send L/R* and *Return L/R*. Remote nodes are ghosts while their plugin is gone (`specs.md` §6).
- **App ⇄ Web without Live** uses the same nodes, added by hand: *Remote Audio*, *Remote MIDI* and *Sync* (Add → Module → Sources), each with a **Peer** menu listing who is reachable.
- **Where it shows in the UI:** the Board menu is in the plugin's window and its node view on the board. Peers are listed by name (*Ableton Live: Set Name*, *Bleep App*, *Web: Chrome, 14:02*). A peer that is gone stays selected and shows as offline.

## 2. Topology: the app is the hub

```
        Live set ═══ shared memory ═══▶ APP ◀═══ WebSocket on localhost ═══ Bleep Play
       (plugins)    (sample-locked)    (hub)     (buffered, not sample-locked)
```

- **Live ⇄ App** keeps the existing shared-memory protocol (`BridgeProtocol.h`), extended in §3.
- **App ⇄ Web** is new: a WebSocket server in the app, on `127.0.0.1` (§4).
- **Live ⇄ Web** goes through the app. A port with Board = Bleep Play needs the app running, and the app relays. The user doesn't see the hop; the app's board is not involved unless the user cables it (the relay is a plain pass-through, with no node on the board).
- **Why a hub:** browsers can't open shared memory or talk to a plugin, and a plugin hosting a socket server would make every Live set run a server. The app is already the one place that always runs once per machine. *Later:* if no app runs, the first plugin to start may take the hub role, with the same protocol (the hub is whoever listens first; clients don't care which). Not in the first version.
- **Same machine only** in the first version. Different machines (Bleep Play on a phone, a shared session) need a relay server and an account, and are a separate design.

## 3. What travels

One **channel** per bridged thing; a channel is a stream of one kind between two peers. A peer is a Live port, the app, or Bleep Play.

| Kind | Content | Live ⇄ App | App ⇄ Web |
|---|---|---|---|
| **Audio** | stereo float, block-sized | Frames in shared memory, as today | 128-frame packets, int16 or float32, with a timestamp |
| **MIDI** | note, CC, bend, pressure, clock events | A MIDI ring per port in the shared segment, events with a sample offset inside the block | Events with a timestamp, in a JSON or binary message |
| **Sync** | tempo, beat position, bar, play/stop, and *who leads* | Already in `Frame.transport` and Link | Messages at about 20 Hz plus a beat anchor, so the receiver computes the phase between messages |

### 3.1 Live ⇄ App (extends the protocol, version 2)

- A port can be **audio, MIDI or both**; each slot gets a `kind` field and a MIDI ring (in/out). The segment version goes to 2; a v1 bridge against a v2 app still works for audio.
- **MIDI no longer needs the OS virtual ports** for Live ⇄ App. They stay (other apps and hardware still use them), but *Bleep MIDI In/Out* with Board = App carry MIDI inside the block, with its sample offset. That removes loopMIDI on older Windows and the ±1 ms jitter, and MIDI gets the same two-block delay as audio, so it lines up.
- **Sync** from the bridge stays: Live's transport leads while a port with Board = App is connected (`specs.md` §11.4).
- **Who owns the audio device.** While a Live bridge is connected, Live's audio blocks drive the app and the app's own audio device is silent (`app/README.md`). So Live ⇄ App has **one clock and no drift**: it needs no resampler and its latency is exactly the two blocks. Each place configuring its own device applies only to the web link (§3.2). A consequence to document: the app's hardware inputs and outputs are not available while it is bridged to Live.

### 3.2 App ⇄ Web

- **Audio is buffered, not sample-locked.** The browser's audio clock and the app's drift apart. The web side runs a jitter buffer in its AudioWorklet and nudges its resampling ratio to keep it at a target fill; the app side sends on its block clock. It never glitches the other side: an underrun is silence on the web side, an overrun drops the oldest packet.
- **Latency setting** (*Latency*, shown on the node). Two modes:
  - **Low latency** (default when the page is served by the app, §4.1): a target fill of about **10 to 20 ms**. On localhost the jitter comes from the browser's main thread, not the network, and §4.1 takes it off the main thread.
  - **Safe** (default for a page on another origin, where §4.1 isn't available): **40 to 100 ms**.
  The setting is the *target*; it is what gets reported (below), never the measured value.
- **Delay-compensated by a fixed value.** Live's plugin delay compensation needs a fixed, known latency. A port with Board = Bleep Play reports **the setting's latency** to Live, not the measured one, so it stays stable. Changing the setting while running changes the reported latency, which makes Live move the track; the UI says so and applies the change only when the transport is stopped.
- **Round trip.** A web instrument or effect is a loop: Live → port out → Bleep Play → port in → Live. The latency Live must compensate is the **sum of both legs** plus Bleep Play's own processing (at least one render quantum, 128 frames), not one direction. The port that returns the audio to Live reports that sum: its own *Latency* plus the *Latency* of the port that sent, which it learns from the shared hub (the two are linked by the same peer). A web effect on an audio track (*Audio In* with Board = Bleep Play, *Audio Out* with Board = Bleep Play) therefore reports about twice the setting; the node shows the total.
- **Predictable and reactive sources.** Latency can be hidden for sources that follow the transport, and not for sources that answer live input:
  - A **predictable source** (a web sequencer, a patch driven by Live's transport, programmed MIDI to a web instrument) runs ahead in *beat time* by the reported latency, so its output arrives on the beat after the compensation. Sound and timeline line up, whatever the latency.
  - A **reactive source** (a web instrument played from a controller, a web effect on a live input) can't run ahead. Its latency is real, and the node says so (*Reactive: 24 ms*). Only *Low latency* makes it playable; the docs tell people to run the instrument in the app for live playing.
  Each channel carries a flag, *predictable* or *reactive*, set by the node that produces it; it only drives what the UI shows.
- **MIDI** is timestamped **in beats**, not in wall-clock time: `{beat, status, data1, data2}`, plus the sender's clock for events that don't follow the transport (live playing). The receiver converts beats to sample offsets with its own tempo map and the same latency offset as the audio, so notes and sound stay together.
- **Two blocks of the bridge, counted.** A slot's output reaches the plugin two host blocks after the hub produced it. For beat-stamped MIDI the hub therefore places each event against the beat the plugin will be at when it plays the block (the block's position plus two blocks), so a note stamped for a beat sounds in the block that contains that beat. Events stamped `-1` are played as soon as possible, and events stamped for a transport that is not running are dropped.
- **Lookahead for MIDI from the web into Live.** A web sequencer sends events **50 to 100 ms ahead** (a setting, *Lookahead*), and the receiving *Bleep MIDI Out* places each one at its sample offset inside the right block. That absorbs the WebSocket jitter. On a tempo change, a loop wrap or a playhead jump the leader sends a **flush** (position and tempo epoch number); the receiver drops events from an older epoch, and the sequencer resends from the new position. Lookahead of 0 is allowed for live playing.
- **Sync:** Bleep Play follows the app's tempo and phase, within the transport latency (a few ms on one machine). Bleep Play can *request* a tempo or start/stop; the leader decides (§5).

## 4. Joining from the web

- The app listens on `ws://127.0.0.1:<port>` (default `47100`, configurable, off by default; *File → Settings → Web connection*). Bleep Play has a **Connect to app** button.
- **Pairing:** the first time a page connects, the app shows "*bleep.example (Chrome)* wants to connect" with **Allow / Deny**, and remembers the origin. Every WebSocket handshake checks `Origin` against the allowed list, so any random website cannot talk to the app just because it knows the port. The hello message carries a protocol version and a display name.
- **Browser limits:** Chrome and Edge allow an `https` page to open `ws://127.0.0.1` and may ask for *Local network access*; Firefox allows it; **Safari blocks it**. Fallback that works everywhere: the app also serves Bleep Play itself at `http://127.0.0.1:<port>/`, same origin, no mixed content. The *Connect to app* button on the website explains this when it fails.
### 4.1 Serving the board from the app (low latency)

Besides being the Safari fallback, the app serving the board is how the web link gets its low latency.

- The app sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, so the page is cross-origin isolated and has `SharedArrayBuffer`.
- The WebSocket then runs in a **dedicated Worker**, not on the main thread. The Worker writes received audio into a lock-free ring in a `SharedArrayBuffer` that the AudioWorklet reads (and the reverse for audio sent to the app). The main thread (UI, garbage collection) is no longer in the audio path, which is what allows a 10 to 20 ms target.
- A page on another origin (the website, §4) can't be isolated by the app, so it uses the main-thread path and the *Safe* latency. The *Connect to app* button suggests opening the app's own page when low latency matters.
- Open: audio can also use a single WebSocket message per block or a stream; the ring makes the choice invisible to the worklet. Start with one message per 128-frame packet.

### 4.2 Web MIDI

- **Web MIDI stays**: Bleep Play can still use MIDI devices directly; the bridge is for MIDI to and from the app and Live.

Offline use is unchanged: nothing connects unless the user presses the button.

## 5. Sync

- **One leader at a time.** Priority: Live (while a port with Board = App or Web is connected) > the app's own Link session > Bleep Play. The leader's tempo, beat and play/stop win; others show *Following: Live* on their Sync node.
- **Inside the app:** Ableton Link as today. The app is a Link peer, so any other Link app on the machine or network follows as well. Link is GPL, so the **web has no Link**: it follows the app through the hub.
- **The Sync node** (all three places) has outputs *Tempo, Beat, Bar, Clock, Running* (as the Link node now) and settings *Follow / Lead* and *Source* (Auto, Live, Link, Web). *Lead* from Bleep Play makes it the leader only when no higher peer is present.
- **Clock pulses** (24 ppqn) for modules that sync to a clock are derived on the receiving board from tempo and beat, not sent as MIDI.

## 6. Failure and identity

- **Peer missing:** audio passes through where it did today (a Live track's audio is unchanged); a remote node's outputs fall silent; cables stay. Reconnecting restores them, as with ghosts.
- **Identity:** each port keeps a stable ID in its set or project. The board's remote nodes are keyed by *peer + ID*, so cables survive reopening everything. Bleep Play pages get a stable ID in the browser's storage.
- **Feedback loops:** a port with Board = App on a track the app also feeds from the same track would loop audio. Each bridged channel carries a *hop id*; a board refuses (greys out) a channel that would return to its source and says why.
- **Versioning:** both transports start with a hello (`magic`, `version`, `peer kind`, `name`); a mismatch is shown on the node, not silently ignored.

## 7. What changes in each place

| | Change |
|---|---|
| **Live plugins** | *Board* menu on Bleep MIDI In/Out and Audio In/Out; Bleep Audio Bridge = both directions; sync follows Live's transport as today. |
| **App** | Segment v2 with MIDI rings; WebSocket server, pairing and the relay; remote nodes for Live ports and Bleep Play pages; *Remote Audio/MIDI/Sync* nodes with a Peer menu; *Settings → Web connection*; optional hosting of Bleep Play. |
| **Web** | A `bridge-client.js` (WebSocket in a Worker, shared-memory ring, jitter buffer worklet, MIDI and sync messages); the same remote nodes; a *Connect to app* button. |
| **Docs** | `specs.md` §6 and §11 reference this file; user docs: *Ways to use Bleep* gets its "what works today" table updated as each part lands. |

## 8. Build order

| # | Deliverable | Gate | State |
|---|---|---|---|
| 1 | **Board menu on the plugins:** the existing audio bridge expressed as Audio In/Out with Board = App; the wire protocol gains version 2 (§10.1) | Old and new bridges both work with the app; ctest bridge tests green | Done: Board menu on MIDI In/Out and Audio In/Out; `port-plugins` test through the built VST3s |
| 2 | **MIDI over the bridge** (segment v2, MIDI ring) | A note from Live plays the app, sample-aligned with audio; the OS ports still work | Done: `bridge` test, sample offsets exact |
| 3 | **Hub and web link:** WebSocket server, pairing, `bridge-client.js`; MIDI and sync first (cheap), Bleep Play shows *Live* and *App* nodes | Playing from Live reaches Bleep Play; tempo follows | Done: `hub` test, browser connected to the real app |
| 3b | **Beat-stamped MIDI with lookahead and flush** (web sequencer → Live, §3.2) | A web sequencer plays a Live instrument on the beat through tempo changes and loop wraps | Done in the hub test (tempo change and jump flush); not yet with a web sequencer module |
| 4 | **Web audio:** packets, jitter buffer, drift control, reported latency (round-trip sum), app-served page with cross-origin isolation, Worker + shared ring (§4.1) | An hour of audio both ways without a dropout or a growing delay; *Low latency* holds a 10 to 20 ms target on localhost; a web instrument driven from Live lines up with Live's timeline | Done except the hour-long run; measured in a real browser: fill held at the target |
| 5 | **Remote nodes between app and web without Live**, relay Live ⇄ Web | Live → App → Web chain in one session | Done: web nodes appear in the app; the relay is the Live ports' *Board = Bleep Play* |
| 6 | Safari path (app serves the board), no-app hub role in a plugin, cross-machine sessions | Decide after 1 to 5 | Safari path done (the app serves the page); the rest open |

**Not yet tried:** the plugins have been run as hosted VST3s in tests, never inside Ableton Live (Live's delay compensation for the reported latencies, its handling of MIDI Out to other tracks and of the Board parameter, and export are the things to check first); the browser side has been run in one browser (Chromium, served by the app), not in Firefox or Safari; nothing has run for an hour.

## 9. Open questions

1. **Is the app required for Web ⇄ Live?** Proposed yes (§2). The alternative, a plugin acting as hub, saves one install but puts a server in every Live set.
2. **Latency promise for Web.** Decided: a fixed reported latency, the sum of both legs for a round trip (§3.2), default 16 ms per leg in *Low latency* and 64 ms in *Safe*. Open: whether the round-trip total should be editable by hand, to trim a measured offset.
2b. **Export with Bleep Play in the loop.** The bridge to the app waits during Live's offline render (`specs.md` §11.3), but a browser's AudioWorklet runs on a real-time clock and can't be waited for. Proposed: while Live renders offline, a port with Board = Bleep Play outputs silence and the plugin shows *Bleep Play can't follow an export: freeze or resample the track first*. Check whether the AudioWorklet can be driven faster than real time through an `OfflineAudioContext`; if so, Bleep Play could follow.
3. **Audio format over WebSocket:** float32 (simple, about 770 kB/s per stereo channel at 48 kHz) or a lossless 16-bit (half). Start with float32.
4. **Multiple Lives or multiple apps:** one host process at a time (as the audio bridge has today), or several. Proposed one until a use appears.
5. **Name:** the plugin set keeps the Bleep Audio/MIDI names; the *Board* menu is the user-facing concept. If *Board* is confusing next to the single board per set, call it *Connect to*.

## 10. Wire protocols (version 2 of the segment, version 1 of the web link)

This is the contract between the parts; code and tests follow it.

### 10.1 Shared-memory segment, version 2 (Live ⇄ App)

`BridgeProtocol.h`, `kVersion = 2`. A v1 plugin against a v2 segment (or the reverse) refuses it by magic/version/layout size and shows *version mismatch* in its window; there is no mixed operation. (An earlier draft of this document promised that v1 audio keeps working; the layouts differ too much, so it doesn't.) Changes against v1:

- `Slot` gains `portKind` (the `engine::PortKind` the plugin stands for: `AudioBridge`, `AudioIn`, `AudioOut`, `MidiIn`, `MidiOut`, `Instrument`, `AudioInsert`; the numbers are `PortKind` values and part of the format), `board` (`1` App, `2` Web) and `extraLatency` (written by the app: samples the plugin adds to its two blocks when Bleep Play is in the loop, §3.2). The Bleep Audio Bridge plugin sends `portKind = AudioBridge` and `board = App`; a slot with `portKind = 0` is read the same way.
- `Frame` gains `numMidi` and `midi[kMaxMidi = 256]` of `{int32 offset; uint8 bytes[3]; uint8 size}`, the same layout as `engine::MidiEvent`. A frame in `in` carries the track's MIDI (MIDI In, Instrument); a frame in `out` carries MIDI for the track (MIDI Out). Offsets are samples inside the block.
- The app turns every claimed slot into an instance of `portKind` (a *proxy*) in its engine, fills `BlockIO` exactly as the plugin would in Live (`audioIn`, `audioOut`, `midiIn`, `midiOut`) and returns the result two blocks later. Slots with `board = Web` are not given to the app's engine: the hub relays them (§10.3).
- Latency stays exactly two host blocks; MIDI uses the same ring and delay as audio.

### 10.2 Web link: transport and framing

- `ws://127.0.0.1:<port>/ws` (default `47100`). `GET /` serves the board page (§4.1) with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; `GET /health` returns `{"app":"bleep-app","protocol":1}`.
- `Origin` is checked at the handshake: the page the app serves (`http://127.0.0.1:<port>`, `http://localhost:<port>`) is always allowed; any other origin needs the pairing dialog of §4 (the handshake waits up to 30 s for the answer, then answers `403`).
- Text frames are JSON objects `{"op": "...", ...}`. Binary frames are audio (below). All numbers are little-endian.
- Binary **audio packet**: `u8 kind (=1)`, `u8 channel`, `u16 frames` (1 to 2048), `u32 seq`, `i64 sampleTime` (the sender's running frame counter at the first frame), then `float32` planar left, then right (2 × `frames` values). Header 16 bytes. Packets are sent in the sender's block size (the web sends 128-frame packets, the app sends one packet per host block).
- A **channel** is one direction of one kind between the web peer and the hub. Channel numbers are `u8`, allocated by the hub.

### 10.3 Messages

Web → hub:

| `op` | Fields | Meaning |
|---|---|---|
| `hello` | `v:1`, `id` (stable UUID), `name`, `sampleRate`, `quantum` (128), `mode` (`low` or `safe`) | First message. |
| `ping` | `t` (web ms) | Clock probe, answered by `pong`. |
| `open` | `key` (stable per web node), `kind` (`audio`/`midi`), `dir` (`fromWeb`/`toWeb`/`both`), `name` | Bleep Play bridges one of its nodes (*Remote Audio/MIDI*). The app shows a node *Web: name*. |
| `close` | `key` | Closes it. |
| `midi` | `ch`, `epoch`, `ev: [[beat, status, d1, d2], …]` | MIDI for a `fromWeb` channel. `beat ≥ 0`: play at that beat of the leader's transport; `beat = -1`: as soon as possible. Events from an older `epoch` than the hub's are dropped. |
| `request` | `tempo?`, `play?` | Ask the leader for a tempo or start/stop (§5). |
| `latency` | `ch`, `ms` | The web side's own processing delay for this channel (render quantum, buffer), so the hub can report round trips (§3.2). |

Hub → web:

| `op` | Fields | Meaning |
|---|---|---|
| `welcome` | `v:1`, `hub`, `sampleRate`, `block`, `epoch`, `leader` | Accepted. `error` with `code` (`denied`, `version`, `busy`) otherwise. |
| `pong` | `t`, `hub` (hub ms) | The hub's steady clock in ms; the web keeps the sample with the smallest round trip as its offset. |
| `channel` | `ch`, `kind`, `dir` (`toWeb`/`fromWeb`), `key`, `name`, `port` (the port kind it mirrors: `audio-in`, `audio-out`, `midi-in`, `midi-out`, `instrument`, `audio-insert`, `remote`), `source` (`live`/`app`), `online`, `latency` (samples to report to Live), `reactive` | A channel exists or changed. A Live port with *Board = Bleep Play* appears like this, named after its track. |
| `channel-gone` | `ch` | It is a ghost now (the web keeps the node and cables). |
| `midi` | `ch`, `epoch`, `t` (hub ms), `ev: [[beat, status, d1, d2], …]` | MIDI for a `toWeb` channel. `beat` is the sender's beat if its transport is valid, else `-1`. The web schedules with `t` and its latency setting. |
| `sync` | `epoch`, `tempo`, `beat`, `playing`, `quantum`, `leader` (`live`/`link`/`app`/`web`), `hub` (hub ms when `beat` was sampled) | About 20 Hz and on every change. The web extrapolates: `beat + (hubNow − hub) × tempo / 60000` while playing. |
| `flush` | `epoch` | Tempo change, loop wrap or playhead jump. The web sequencer drops what it queued and resends from the new position with the new epoch. |
| `channels` | `list` | A full list, sent after `welcome`. |

**Channel identity.** A `key` names a port or a web node, not one stream: a Live port's key is the plugin's ID, a web node's key is its node ID. Several channels may carry the same key, one per kind (`audio`, `midi`) and direction (`toWeb`, `fromWeb`): a Bleep Instrument is a MIDI channel `toWeb` and an audio channel `fromWeb` with one key; a web node opened with `dir: both` is two channels with its key. A channel is identified by `(key, kind, dir)`, and the number `ch` is only valid for the life of the connection.

**Handshake refusals.** An origin the user declines gets `403` before any WebSocket exists, so the browser can only report a closed connection: the client says "denied or unreachable" and the app's Settings → Web has the list. `error` with a `code` is only sent after the handshake (`version`).

**Clocks and rates.** Audio packets are in the sender's sample rate: `hello.sampleRate` for the web, `welcome.sampleRate` for the hub (the rate of Live or of the app's device, whichever drives). A MIDI event from the hub is scheduled in the browser at the hub time `t` of its message plus the channel's target fill, not by its beat: the beat only matters in the other direction. `ping` goes from the web to the hub only.

**Declared latency.** `latency` is Bleep Play's own processing in ms (its render quantum and the browser's output delay), not including the jitter buffer: the hub adds `2 × target fill + declared` for a returning audio channel, the way §10.4 says. `flush` carries only the new epoch; the web sequencer resends from the current `sync`.

### 10.4 Audio buffering (both sides use the same rule)

Each receiving end of an audio channel keeps a ring and a **target fill** (*Low latency*: 16 ms, *Safe*: 64 ms). Per read of `n` frames it measures `fill` (frames waiting), computes `err = (fill − target) / target` and reads with the ratio `r = 1 + clamp(0.02 × err, −0.005, +0.005)`, smoothed with a one-pole filter (time constant 0.5 s), using linear interpolation between frames. Underrun: output silence and re-prime to the target; overrun (fill above 4 × target): drop the oldest frames down to the target. Sample-rate differences between peers are part of the same ratio (`r × srSource / srSink`).

The latency a port with *Board = Bleep Play* reports to Live is its channel's target fill in samples (at Live's rate) plus `latency` frames the web declared; a returning port adds the sending leg (§3.2).

**Headroom.** The target never stays below what the consumer needs: it grows to 1.5 blocks of the consumer plus three 128-frame packets (a hub that is pulled in blocks of 512 frames holds at least 1152 frames, 24 ms), and never shrinks. The reported latency follows it.

### 10.5 Sync

- Hub transport is the leader's (§5). `epoch` increments on every tempo change, loop wrap or jump (a jump is any position more than one block off `beat + elapsed × tempo`).
- From the web, MIDI is sent 50 to 100 ms ahead (*Lookahead*) in beats. The hub converts a beat to a sample offset inside the next block with the leader's tempo; an event that is already in the past plays at the start of the block and is counted as *late*.
