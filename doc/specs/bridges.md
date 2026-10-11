# Bridges between Live, the app and the web

Status: design (not built). How MIDI, audio and sync travel between the three places Bleep runs: **Live** (plugins), the **app** (standalone) and the **web** (browser board). Extends `specs.md` §6, §11 and §18.

## 0. Today and the goal

| | Live ⇄ App | App ⇄ Web | Live ⇄ Web |
|---|---|---|---|
| MIDI | OS virtual ports (*Bleep Patch 1/2*) | nothing | nothing |
| Audio | Bleep Audio Bridge (shared memory, sample-locked) | nothing | nothing |
| Sync | Ableton Link, and Live's transport through the bridge | nothing | nothing |

Goal: any of the three can send and receive MIDI, audio and sync to any other, chosen **in the place where you are**, with the same few controls everywhere.

## 1. The idea: a port names the board on its other side

Every Bleep plugin in Live already is a hole between a track and a board (`specs.md` §6). Today that board is always *this set's* Bleep Patch. The new setting says **which board is on the other side**:

| Board | Meaning |
|---|---|
| **This set** (default) | The board in this Live set's Bleep Patch, as today |
| **App** | The running Bleep Patch app |
| **Web** | A browser board that joined (§4) |

So the answer to "can an audio out plugin choose whether it sends to web, app or Live": **yes, as a *Board* menu on each port plugin.** *Bleep Audio Out* with Board = App makes the app's board a sound source on a Live track. *Bleep Audio In* with Board = Web sends the track's audio to a browser board. *Bleep MIDI In/Out* the same for MIDI.

- **The old Bleep Audio Bridge becomes Bleep Audio In + Out with Board = App.** One concept instead of a special plugin. (A single plugin with Send and Return stays available as *Bleep Audio Bridge*, the same plugin with both directions, because Audio In passes audio through and Audio Out is an instrument, which is awkward on one track.)
- **The other side needs no setting.** A remote port appears on the receiving board as a node named after its track and its plugin, as bridges do today: *Live: Drums* with *Send L/R* and *Return L/R*. Remote nodes are ghosts while their plugin is gone (`specs.md` §6).
- **App ⇄ Web without Live** uses the same nodes, added by hand: *Remote Audio*, *Remote MIDI* and *Sync* (Add → Module → Sources), each with a **Peer** menu listing who is reachable.
- **Where it shows in the UI:** the Board menu is in the plugin's window and its node view on the board. Peers are listed by name (*Ableton Live: Set Name*, *Bleep Patch app*, *Web: Chrome, 14:02*). A peer that is gone stays selected and shows as offline.

## 2. Topology: the app is the hub

```
        Live set ═══ shared memory ═══▶ APP ◀═══ WebSocket on localhost ═══ Browser board
       (plugins)    (sample-locked)    (hub)     (buffered, not sample-locked)
```

- **Live ⇄ App** keeps the existing shared-memory protocol (`BridgeProtocol.h`), extended in §3.
- **App ⇄ Web** is new: a WebSocket server in the app, on `127.0.0.1` (§4).
- **Live ⇄ Web** goes through the app. A port with Board = Web needs the app running, and the app relays. The user doesn't see the hop; the app's board is not involved unless the user cables it (the relay is a plain pass-through, with no node on the board).
- **Why a hub:** browsers can't open shared memory or talk to a plugin, and a plugin hosting a socket server would make every Live set run a server. The app is already the one place that always runs once per machine. *Later:* if no app runs, the first plugin to start may take the hub role, with the same protocol (the hub is whoever listens first; clients don't care which). Not in the first version.
- **Same machine only** in the first version. Different machines (a web board on a phone, a shared session) need a relay server and an account, and are a separate design.

## 3. What travels

One **channel** per bridged thing; a channel is a stream of one kind between two peers. A peer is a Live port, the app, or a web board.

| Kind | Content | Live ⇄ App | App ⇄ Web |
|---|---|---|---|
| **Audio** | stereo float, block-sized | Frames in shared memory, as today | 128-frame packets, int16 or float32, with a timestamp |
| **MIDI** | note, CC, bend, pressure, clock events | A MIDI ring per port in the shared segment, events with a sample offset inside the block | Events with a timestamp, in a JSON or binary message |
| **Sync** | tempo, beat position, bar, play/stop, and *who leads* | Already in `Frame.transport` and Link | Messages at about 20 Hz plus a beat anchor, so the receiver computes the phase between messages |

### 3.1 Live ⇄ App (extends the protocol, version 2)

- A port can be **audio, MIDI or both**; each slot gets a `kind` field and a MIDI ring (in/out). The segment version goes to 2; a v1 bridge against a v2 app still works for audio.
- **MIDI no longer needs the OS virtual ports** for Live ⇄ App. They stay (other apps and hardware still use them), but *Bleep MIDI In/Out* with Board = App carry MIDI inside the block, with its sample offset. That removes loopMIDI on older Windows and the ±1 ms jitter, and MIDI gets the same two-block delay as audio, so it lines up.
- **Sync** from the bridge stays: Live's transport leads while a port with Board = App is connected (`specs.md` §11.4).

### 3.2 App ⇄ Web

- **Audio is buffered, not sample-locked.** The browser's audio clock and the app's drift apart. The web side runs a jitter buffer in its AudioWorklet and nudges its resampling ratio to keep it at a target fill; the app side sends on its block clock. Typical added latency **40 to 100 ms** (setting *Latency*, shown on the node). It never glitches the other side: an underrun is silence on the web side, an overrun drops the oldest packet.
- **Not delay-compensated.** Live's plugin delay compensation needs a fixed, known latency. A port with Board = Web reports **the setting's latency** to Live, not the measured one, so it stays stable. Good for sound design and effects you hear, not for tight rhythm lock; the docs say so.
- **MIDI** is timestamped; the receiver schedules it against its own clock with the same latency offset as the audio, so notes and sound stay together.
- **Sync:** the web board follows the app's tempo and phase, within the transport latency (a few ms on one machine). A web board can *request* a tempo or start/stop; the leader decides (§5).

## 4. Joining from the web

- The app listens on `ws://127.0.0.1:<port>` (default `47100`, configurable, off by default; *File → Settings → Web connection*). The browser board has a **Connect to app** button.
- **Pairing:** the first time a page connects, the app shows "*bleep.example (Chrome)* wants to connect" with **Allow / Deny**, and remembers the origin. Every WebSocket handshake checks `Origin` against the allowed list, so any random website cannot talk to the app just because it knows the port. The hello message carries a protocol version and a display name.
- **Browser limits:** Chrome and Edge allow an `https` page to open `ws://127.0.0.1` and may ask for *Local network access*; Firefox allows it; **Safari blocks it**. Fallback that works everywhere: the app also serves the web board itself at `http://127.0.0.1:<port>/`, same origin, no mixed content. The *Connect to app* button on the website explains this when it fails.
- **Web MIDI stays**: the web board can still use MIDI devices directly; the bridge is for MIDI to and from the app and Live.
- **Offline use is unchanged:** nothing connects unless the user presses the button.

## 5. Sync

- **One leader at a time.** Priority: Live (while a port with Board = App or Web is connected) > the app's own Link session > the web board. The leader's tempo, beat and play/stop win; others show *Following: Live* on their Sync node.
- **Inside the app:** Ableton Link as today. The app is a Link peer, so any other Link app on the machine or network follows as well. Link is GPL, so the **web has no Link**: it follows the app through the hub.
- **The Sync node** (all three places) has outputs *Tempo, Beat, Bar, Clock, Running* (as the Link node now) and settings *Follow / Lead* and *Source* (Auto, Live, Link, Web). *Lead* from the web board makes it the leader only when no higher peer is present.
- **Clock pulses** (24 ppqn) for modules that sync to a clock are derived on the receiving board from tempo and beat, not sent as MIDI.

## 6. Failure and identity

- **Peer missing:** audio passes through where it did today (a Live track's audio is unchanged); a remote node's outputs fall silent; cables stay. Reconnecting restores them, as with ghosts.
- **Identity:** each port keeps a stable ID in its set or project. The board's remote nodes are keyed by *peer + ID*, so cables survive reopening everything. Web boards get a stable ID in the browser's storage.
- **Feedback loops:** a port with Board = App on a track the app also feeds from the same track would loop audio. Each bridged channel carries a *hop id*; a board refuses (greys out) a channel that would return to its source and says why.
- **Versioning:** both transports start with a hello (`magic`, `version`, `peer kind`, `name`); a mismatch is shown on the node, not silently ignored.

## 7. What changes in each place

| | Change |
|---|---|
| **Live plugins** | *Board* menu on Bleep MIDI In/Out and Audio In/Out; Bleep Audio Bridge = both directions; sync follows Live's transport as today. |
| **App** | Segment v2 with MIDI rings; WebSocket server, pairing and the relay; remote nodes for Live ports and web boards; *Remote Audio/MIDI/Sync* nodes with a Peer menu; *Settings → Web connection*; optional hosting of the web board. |
| **Web** | A `bridge-client.js` (WebSocket, jitter buffer worklet, MIDI and sync messages); the same remote nodes; a *Connect to app* button. |
| **Docs** | `specs.md` §6 and §11 reference this file; user docs: *Ways to use Bleep* gets its "what works today" table updated as each part lands. |

## 8. Build order

| # | Deliverable | Gate |
|---|---|---|
| 1 | **Board menu on the plugins:** the existing audio bridge expressed as Audio In/Out with Board = App; same wire protocol | Old and new bridges both work with the app; ctest bridge tests green |
| 2 | **MIDI over the bridge** (segment v2, MIDI ring) | A note from Live plays the app, sample-aligned with audio; the OS ports still work |
| 3 | **Hub and web link:** WebSocket server, pairing, `bridge-client.js`; MIDI and sync first (cheap), the web board shows *Live* and *App* nodes | Playing from Live reaches the web board; tempo follows |
| 4 | **Web audio:** packets, jitter buffer, drift control, reported latency | An hour of audio both ways without a dropout or a growing delay |
| 5 | **Remote nodes between app and web without Live**, relay Live ⇄ Web | Live → App → Web chain in one session |
| 6 | Safari path (app serves the board), no-app hub role in a plugin, cross-machine sessions | Decide after 1 to 5 |

## 9. Open questions

1. **Is the app required for Web ⇄ Live?** Proposed yes (§2). The alternative, a plugin acting as hub, saves one install but puts a server in every Live set.
2. **Latency promise for Web.** A fixed reported latency (proposed, default 64 ms) or "not compensated" and let the user nudge the track delay.
3. **Audio format over WebSocket:** float32 (simple, about 770 kB/s per stereo channel at 48 kHz) or a lossless 16-bit (half). Start with float32.
4. **Multiple Lives or multiple apps:** one host process at a time (as the audio bridge has today), or several. Proposed one until a use appears.
5. **Name:** the plugin set keeps the Bleep Audio/MIDI names; the *Board* menu is the user-facing concept. If *Board* is confusing next to the single board per set, call it *Connect to*.
