# Concept Note: A Modular Control Ecosystem for Ableton Live

**Working titles:** *Beautiful Bleep* (the whole technology), the *board* (the shared patching canvas), *Bleep Bus* (open protocol). Product and protocol names are placeholders.
**Author:** Jan Nehring / Brilliant Bleep
**Status:** Draft v0.2, October 2026. The core (engine, board, cells, Ableton bridge) is implemented in `patch/`; see `patch/README.md`.

**Changes since v0.1:** Modules are no longer individual plugins in Live's device chain. They are nodes on one shared canvas, the **board**, processed by a shared engine. In Live, users only add **ports** (MIDI/audio in and out) and the **Bleep Board** plugin that opens the board. New: cells and Voice Cells, cable rules, the Ableton bridge, board persistence.

---

## Contents

[1. Summary](#1-summary)<br>
[2. Problem](#2-problem)<br>
[3. Vision and principles](#3-vision-and-principles)<br>
[4. Concepts and naming](#4-concepts-and-naming)<br>
[5. Architecture](#5-architecture)<br>
&emsp;&emsp;[5.1 Overview](#51-overview)<br>
&emsp;&emsp;[5.2 Plugin formats and the plugin bundle](#52-plugin-formats-and-the-plugin-bundle)<br>
&emsp;&emsp;[5.3 The shared engine](#53-the-shared-engine)<br>
&emsp;&emsp;[5.4 Board state and persistence](#54-board-state-and-persistence)<br>
&emsp;&emsp;[5.5 Bleep Bus: external plugins on the board](#55-bleep-bus-external-plugins-on-the-board)<br>
&emsp;&emsp;[5.6 How modules and receiving plugins apply modulation](#56-how-modules-and-receiving-plugins-apply-modulation)<br>
&emsp;&emsp;[5.7 Automation from Live](#57-automation-from-live)<br>
&emsp;&emsp;[5.8 Integration with Ableton Live](#58-integration-with-ableton-live)<br>
[6. The Ableton bridge: ports](#6-the-ableton-bridge-ports)<br>
[7. Cable rules](#7-cable-rules)<br>
&emsp;&emsp;[7.1 Signal types](#71-signal-types)<br>
&emsp;&emsp;[7.2 Direction and count](#72-direction-and-count)<br>
&emsp;&emsp;[7.3 Knobs and amounts](#73-knobs-and-amounts)<br>
&emsp;&emsp;[7.4 Type compatibility](#74-type-compatibility)<br>
&emsp;&emsp;[7.5 Feedback](#75-feedback)<br>
&emsp;&emsp;[7.6 Cells and cables](#76-cells-and-cables)<br>
&emsp;&emsp;[7.7 Click-free changes](#77-click-free-changes)<br>
[8. Cells](#8-cells)<br>
&emsp;&emsp;[8.1 Cells](#81-cells)<br>
&emsp;&emsp;[8.2 Why cells matter](#82-why-cells-matter)<br>
&emsp;&emsp;[8.3 Voice Cells](#83-voice-cells)<br>
[9. The board UI](#9-the-board-ui)<br>
&emsp;&emsp;[9.1 Window model](#91-window-model)<br>
&emsp;&emsp;[9.2 Layout](#92-layout)<br>
&emsp;&emsp;[9.3 Nodes on the canvas](#93-nodes-on-the-canvas)<br>
&emsp;&emsp;[9.4 Module views](#94-module-views)<br>
&emsp;&emsp;[9.5 Patching](#95-patching)<br>
&emsp;&emsp;[9.6 Editing and cells](#96-editing-and-cells)<br>
&emsp;&emsp;[9.7 Panels](#97-panels)<br>
&emsp;&emsp;[9.8 Connection to Live](#98-connection-to-live)<br>
&emsp;&emsp;[9.9 Visual language](#99-visual-language)<br>
&emsp;&emsp;[9.10 Undo](#910-undo)<br>
&emsp;&emsp;[9.11 Keyboard shortcuts](#911-keyboard-shortcuts)<br>
&emsp;&emsp;[9.12 Example workflows](#912-example-workflows)<br>
[10. Audio on the board](#10-audio-on-the-board)<br>
[11. The standalone app](#11-the-standalone-app)<br>
&emsp;&emsp;[11.1 What it is](#111-what-it-is)<br>
&emsp;&emsp;[11.2 MIDI: the app's own MIDI ports](#112-midi-the-apps-own-midi-ports)<br>
&emsp;&emsp;[11.3 Audio: Bleep Audio Bridge](#113-audio-bleep-audio-bridge)<br>
&emsp;&emsp;[11.4 Ableton Link](#114-ableton-link)<br>
&emsp;&emsp;[11.5 Preset browser](#115-preset-browser)<br>
&emsp;&emsp;[11.6 Limits and open questions](#116-limits-and-open-questions)<br>
&emsp;&emsp;[11.7 System audio](#117-system-audio)<br>
[12. First module set](#12-first-module-set)<br>
[13. Native support in Brilliant Bleep plugins](#13-native-support-in-brilliant-bleep-plugins)<br>
[14. Positioning](#14-positioning)<br>
[15. Open technology](#15-open-technology)<br>
&emsp;&emsp;[15.1 What "open" means concretely](#151-what-open-means-concretely)<br>
&emsp;&emsp;[15.2 Why open is good for the business](#152-why-open-is-good-for-the-business)<br>
&emsp;&emsp;[15.3 Documentation, split by audience](#153-documentation-split-by-audience)<br>
&emsp;&emsp;[15.4 Sketch of the API shape (illustrative, not final)](#154-sketch-of-the-api-shape-illustrative-not-final)<br>
[16. Homepage](#16-homepage)<br>
&emsp;&emsp;[16.1 Content for musicians](#161-content-for-musicians)<br>
&emsp;&emsp;[16.2 Content for developers](#162-content-for-developers)<br>
&emsp;&emsp;[16.3 Shared and community](#163-shared-and-community)<br>
&emsp;&emsp;[16.4 Requirements](#164-requirements)<br>
[17. Repository structure](#17-repository-structure)<br>
[18. More bridges and interoperability (future work)](#18-more-bridges-and-interoperability-future-work)<br>
[19. Roadmap](#19-roadmap)<br>
[20. Risks and open questions](#20-risks-and-open-questions)<br>
[21. Legal note on inspiration](#21-legal-note-on-inspiration)

---

## 1. Summary

Beautiful Bleep is a family of small, Eurorack-inspired building blocks that make Ableton Live feel modular: function generators, random sources, clocks, morph macros, filters, utilities.

All blocks live on one shared canvas per Live set, the **board**. On the board, modules are **nodes** and patch cables are directed connections between them. Nodes can be grouped into **cells**, which nest and can be copied. A **Voice Cell** turns one synthesizer voice into a polyphonic instrument.

The board connects to Live through **ports**: small plugins that users drop onto tracks (*Bleep MIDI In*, *Bleep MIDI Out*, *Bleep Audio In*, *Bleep Audio Out*, *Bleep Instrument*, *Bleep FX*). Each port appears as a node on the board. Together, the ports form the **Ableton bridge**. Later bridges (OSC, CV, VCV Rack) connect the board to other worlds the same way.

**Every Live set that uses Beautiful Bleep requires exactly one *Bleep Board* plugin**, loaded anywhere in the set (any track, including the master). It is the main plugin: it stores the board and opens it (section 5.4).

External plugins connect through **Bleep Bus**, an open, documented protocol. Brilliant Bleep's own effects and instruments (Grit, Cinch, Hum, Wander, …) get native Bleep Bus modulation inputs and appear as nodes on the board.

## 2. Problem

Ableton Live is linear. Its strengths are clips, device chains and a fast workflow, but complex modulation is awkward:

- **Live's modulators work one-to-one.** Live's LFO/Shaper devices map to parameters, but chaining modulators (an LFO modulating another LFO's rate, then feeding several destinations at different amounts) quickly becomes a pile of devices and mappings.
- **Routing costs tracks.** Flexible control and audio routing usually means extra tracks, sends and sidechains.
- **Modulation isn't visible.** It's hard to see what modulates what across a set.
- **The existing alternatives leave Live's workflow.** Full modular environments (VCV Rack, Bitwig's Grid) are powerful but either replace Live's workflow or aren't available in Live at all.

## 3. Vision and principles

1. **Building blocks, not clones.** We take generic concepts from the modular world (slope generators, quantized randomness, chaos, clock division, keyframe morphing, comparators) and design our own modules around them. We do not copy any specific module's panel, name, or exact feature set.
2. **Modulation-first.** Every knob on every module is a modulation destination. Modulating the modulator is the default, not a special case.
3. **One board, woven into the set.** The patch lives on one board per set, but it touches Live wherever the user drops a port: any track, any device chain. It syncs to Live's transport and saves with the set. Users don't leave Live to patch.
4. **Small and composable.** Many small modules beat one giant one. Cells make bigger structures reusable.
5. **Open technology.** The bus is an open standard. Anyone can build compatible plugins (see section 15).
6. **Deterministic.** Seeded randomness, transport-locked phase and fixed latencies, so a set renders the same way every time.

## 4. Concepts and naming

| Term | Meaning |
|---|---|
| **Board** | The shared canvas of a Live set. Exactly one per set. Shows all nodes, cells and cables. |
| **Bleep Board plugin** | The main plugin. Every set that uses Beautiful Bleep requires exactly one, loaded anywhere in the set. It stores the board. |
| **Node** | Anything on the board with jacks: a module, a port, a cell, an external plugin. |
| **Module** | A processing node built into Beautiful Bleep (Function, Random, Filter, …). Modules exist only on the board, not as plugins in Live. |
| **Cable** | A directed connection from an output jack to an input jack. |
| **Cell** | A named group of nodes with its own input and output jacks. Cells can contain cells. Cells can be copied and saved as presets. |
| **Voice Cell** | A special cell: the user patches one voice inside; the cell runs it once per voice, assigns notes, steals voices (section 8.3). |
| **Bridge** | A family of nodes that connect the board to the outside world. v1 has one: the **Ableton bridge**. |
| **Port** | One plugin instance in Live that belongs to a bridge, e.g. one *Bleep MIDI Out* on a track. Each port is one node on the board. |
| **Ghost** | A node whose port is currently unavailable (deleted, deactivated, frozen, not yet loaded). Shown greyed out. Its cables are kept. |
| **Module view** | A module's full UI (knobs, switches, mod rings, scopes). Opens as a floating window inside the board window. |
| **Panel** | A front panel for a cell or the board: controls (dials, sliders, buttons, keys, labels) wired to knobs and jacks, and module views. Interface and Wiring views; shown on the board, in a port's plugin window or in a Bleep Panel plugin (section 9.7). |
| **Bleep Panel plugin** | A plugin that shows one panel in its own plugin window, so the panel can be placed anywhere in Live. Not a node on the board. |
| **Bleep App** | The standalone app: engine and board without a DAW, with its own projects (section 11). |
| **Bleep Audio Bridge** | A plugin in Live that connects a track's audio to the running app; a node on the app's board (section 11.3). |
| **Engine** | The shared code that processes the board's graph (section 5.3). |
| **Bleep Bus** | The open protocol through which external plugins (Grit, Cinch, third-party) join the board (section 5.5). |

## 5. Architecture

### 5.1 Overview

```
 Live set: tracks and device chains
   Track "Keys"        Track "Drums"                  Track "Poly Synth"
   [Bleep MIDI In]     Drum Rack → [Bleep Audio In]   [Bleep Audio Out]
         │ notes                    │ audio                  ▲ audio
 ════════╪══════════════════════════╪════════════════════════╪═════  Bleep Board
         │                          ▼                        │       (shared engine,
         │                  Envelope follower                │        one per set)
         │                          │ control → cutoff       │
         ▼                          ▼                        │
   ┌─ Voice Cell "Pad" (8 voices) ───────────────────────┐   │
   │ Voice In → Osc → Filter → Amp → Voice Out           ├───┘
   └─────────────────────────────────────────────────────┘

   Drift ──► Grit (external plugin, joins the board via Bleep Bus)
```

### 5.2 Plugin formats and the plugin bundle

- **Target host: Ableton Live only** (for now), plus the standalone app (section 11). Other hosts, including those that sandbox plugins into separate processes (e.g. Bitwig), are out of scope.
- **Format: VST3 only** (for now), on macOS and Windows. This avoids a set loading two formats of the bundle and running two engines. AU and CLAP are possible later.
- **One engine per process.** JUCE builds one plugin per binary, so the *Bleep Board* plugin and every port are separate VST3 binaries that all contain the engine code. The first Bleep plugin loaded into Live's process creates the engine and publishes it (an environment variable holding the process ID, the engine's address and an ABI tag); every later Bleep plugin uses that instance. The binary that created it pins itself in memory, so the engine's code is never unloaded while others use it. A binary from a different build (another ABI tag) doesn't share: its plugins show "Another version of Bleep Board is loaded".

### 5.3 The shared engine

The board's DSP runs in a **shared engine**: a process-wide singleton inside the plugin bundle. There is no dedicated host plugin that must exist for the board to run.

- **Who processes the graph.** Live calls each plugin's `process()` on worker threads in no guaranteed order. For every host block, the **first** Bleep plugin whose `process()` runs claims that block (a lock-free compare-and-swap on a shared block counter) and processes the entire board graph for it. All other plugins in that block only exchange data with the engine and never wait.
- **Which block is this?** Transport positions can't identify a block (they stand still while Live is stopped), so every plugin counts its own `process()` calls and compares that count with the engine's. A plugin that joins late, or that Live skipped, resynchronises by following the engine's count. Data goes through small rings of frames tagged with their block number and guarded by sequence locks, so a frame is never read while it's being written, even during a resync. Plugins show resyncs and dropped frames in their status line (phase 0 measures them in Live).
- **Fixed latencies at the ports.** To stay deterministic regardless of thread order:
  - an input port writes block *N*; the engine consumes it in block *N+1*;
  - the engine's output for block *N* is read by output ports in block *N+1*.
  - So a signal from an input port to an output port is delayed by up to two blocks. Within the board, signals are sample-accurate (except feedback, section 7.5).
- **Latency in samples, reported to Live.** Block sizes can vary, so the engine pads the path through the board to a **fixed latency in samples**, `L = 2 × maximum block size` (e.g. 256 samples at a 128-sample buffer, about 5.8 ms at 44.1 kHz). Output ports (*Audio Out*, *Bleep Instrument*, *Bleep FX*) report `L` to Live as their plugin latency, and Live's delay compensation then lines their audio up with the rest of the set:
  - **Bleep FX:** fully compensated, like any plugin with latency.
  - **Audio Out** fed from *Audio In* or *MIDI In*: Live delays all other tracks by `L`, so the board's output lines up with its sources.
  - **Board-internal clocks** run on the timestamps of the input data they belong to, so transport-synced modules stay on the grid after compensation.
  - `L` changes only when the buffer size or sample rate changes, never during playback or export.
  - **Not compensated:** *MIDI Out* → another track (Live doesn't compensate this routing reliably); modulation into external plugins via Bleep Bus (one block late, inaudible for modulation); monitored tracks when *Reduced Latency When Monitoring* is on (it bypasses delay compensation for those tracks).
  - Playing live through the board (MIDI In → Voice Cell → Audio Out) adds `L` to the feel. Ports show their latency.
- **Timestamps.** Every block is stamped with the host's transport sample position, so the engine stays aligned under variable block sizes, transport jumps and offline rendering.
- **Idle.** If no Bleep plugin is processing (e.g. all their tracks are deactivated), the engine does not run.
- **CPU.** The whole board runs on whichever thread claimed the block, so it doesn't spread across Live's cores. Later: process independent cells (and poly voices) in parallel on a small worker pool.
- **Engine lifetime.** The engine is created by the first Bleep plugin instance in the process and destroyed with the last. Loading a new set therefore starts with a fresh board.
- **Offline export.** Live doesn't reliably notify VST3 plugins before an offline render, so the engine must not depend on such a notice. It relies on timestamps and block claiming only, which work the same in real time and offline.
- **Signal types:** see section 7.1.

### 5.4 Board state and persistence

Live saves state per plugin instance, but the board belongs to the whole set. The **Bleep Board** plugin is the **main plugin**: it stores the board.

- **Exactly one main plugin per set.** It holds the complete board: nodes, cells, cables, knob values, node data (e.g. a sequencer's steps), names, layout, macros. It's usually placed on its own track or the master track.
- **A second Bleep Board** shows a warning and stays inactive: "This set already has a board. Remove this device, or replace the current board with this one." If it came from another set (it carries a different board ID), it also offers: "Import its board as a cell."
- **Without a main plugin,** ports keep passing audio through and show "No board in this set. Add Bleep Board." The board window offers to add it.
- **Ports store only themselves:** stable port ID, name, port settings. The board refers to ports by ID. A port that loads before the main plugin waits for it.
- **Duplicated ports** (track duplication, copy/paste) arrive with an ID that's already in use. The copy gets a new ID and appears as a new, unconnected node.
- **Ports from another set** carry IDs the board doesn't know. They appear as new, unconnected nodes.
- **Live's undo.** Deleting a port in Live turns its node into a ghost; undoing the deletion restores the port with its ID, and it reconnects. Deleting the main plugin removes the board from the set; Live's undo restores the plugin, and with it the board.
- **Dirty flag.** Each board edit bumps a hidden "board version" parameter on the main plugin, so Live marks the set as changed.
- **The engine doesn't depend on the main plugin's track.** If that track is deactivated or frozen, the board keeps running (any Bleep plugin can claim a block, section 5.3); the main plugin only stores the board.
- **Undo.** Live doesn't record board edits. The board has its own undo/redo stack (section 9.10).

### 5.5 Bleep Bus: external plugins on the board

The engine and the bundle's own ports talk in-process. Plugins **outside** the bundle (Brilliant Bleep's commercial plugins, third-party plugins) join the board through **Bleep Bus**:

- **Transport layer: named OS shared memory** (POSIX `shm_open` / Windows file mappings). Plugins from different vendors are different binaries and can't share in-process state.
- **Layout:** a versioned, documented, lock-free memory layout with a registry of endpoints (instances, their inputs and outputs) and per-endpoint signal buffers.
- **On the board:** each registered external instance appears as a node with its declared inputs and outputs. It behaves like a port: it can be ghosted, but not deleted from the board.
- **Timing:** the same fixed one-block latency rule as for ports (section 5.3).
- **Session namespace:** the shared-memory name includes a host-process ID, so two running hosts never cross-talk.

### 5.6 How modules and receiving plugins apply modulation

Modulation is an **offset applied inside the DSP**, not a movement of a host-visible parameter:

```
effective_value = clamp(knob_value + Σ (source_i × amount_i))
```

- **The knob stays where the user set it.** Nothing writes automation, spams the undo history, or fights existing automation lanes.
- **The UI shows the live value** as a coloured ring around the knob, as in Serum or Bitwig.
- The same model applies to native Bleep Bus inputs in Brilliant Bleep plugins.

### 5.7 Automation from Live

Modules aren't plugins, so their knobs aren't host parameters. Proposal: the **Bleep Board** plugin exposes a fixed pool of **16 macro parameters**. On the board they appear as a *Macros* node with 16 `control` outputs, which users cable to any knob. Live can automate, MIDI-map and clip-envelope these macros as usual.

### 5.8 Integration with Ableton Live

| From → To | Works? | Mechanism |
|---|---|---|
| Live MIDI track → board | Yes | **Bleep MIDI In** port (section 6) |
| Board → MIDI notes/CC for any instrument | Yes | **Bleep MIDI Out** port. Another MIDI track uses "MIDI From: [track] → [plugin]", monitoring set to "In". |
| Live audio → board | Yes | **Bleep Audio In** or **Bleep FX** port |
| Board → Live audio | Yes | **Bleep Audio Out**, **Bleep Instrument** or **Bleep FX** port |
| Live automation → board | Yes | Macros on the **Bleep Board** plugin (section 5.7) |
| Board → Brilliant Bleep / Bleep Bus plugins | Yes | Bleep Bus (section 5.5) |
| Board → Live / third-party parameters (v1) | Workaround | MIDI Out to a virtual loopback port (IAC on macOS, loopMIDI on Windows), MIDI-mapped in Live. 7-bit, main-thread rate, overrides automation. |
| Board → Live / third-party parameters (later) | Yes (Suite) | **M4L Bridge** device using `live.remote~`. Fast, doesn't write automation or undo history. |

Known Live constraints:
- **Merged channels.** Live merges MIDI channels when routing internally, so one MIDI In or MIDI Out port carries one stream. Users add more ports for more streams.
- **No VST3 MIDI-effect slot.** MIDI ports are instruments. We need to test whether an audio-effect variant of MIDI Out can also be picked up via "MIDI From".

**Ableton Extensions SDK** (JavaScript, Live 12 Suite, beta): not suited to real-time work, but a good fit for companion tools such as "Create MIDI Out routing" and "Render modulation to automation".

## 6. The Ableton bridge: ports

In Live, users can only add the plugins in this section. Each port appears automatically as a node on the board when it's added to the set.

**Requirement:** every set that uses Beautiful Bleep must contain **exactly one *Bleep Board* plugin**, on any track. Without it, there is no board: ports pass audio through and ask the user to add it. A second one shows a warning and stays inactive (section 5.4).

| Plugin | Live device type | On the board | Notes |
|---|---|---|---|
| **Bleep Board** | Audio effect (passes audio through) | *Macros* node: 16 `control` outputs | **Required, exactly one per set.** Stores the board (section 5.4), opens it, and holds the 16 automatable macros. |
| **Bleep MIDI In** | Instrument (silent audio output) | Outputs: `notes`; mono `pitch`, `gate`, `velocity`, `trigger` (note on); `pressure` (channel/poly aftertouch); `pitch bend`; `mod wheel`; up to 8 user-chosen CCs as `control` | Placed on a MIDI track; receives the track's MIDI. Mono outputs follow the last played note. |
| **Bleep MIDI Out** | Instrument (VST3 only) | Inputs: `notes`; mono `pitch` + `gate` + `velocity`; up to 8 `control` → CC; one `control` → pitch bend (14-bit) | Another track records or plays from it via "MIDI From". |
| **Bleep Audio In** | Audio effect (passes audio through) | Outputs: `audio` L, R | Taps the track's audio at its position in the chain. |
| **Bleep Audio Out** | Instrument | Inputs: `audio` L, R | A sound source on its own track, so board audio gets a normal mixer channel, sends and effects. Typical use: a poly synth built on the board. |
| **Bleep Instrument** | Instrument | Outputs: same as Bleep MIDI In. Inputs: `audio` L, R | MIDI In and Audio Out in one plugin, so a board synth sits on one track with normal record-arm and monitoring. Loads one instrument cell preset ([`cell-plugins.md`](cell-plugins.md)) and opens on its panel (section 9.7); the cell is on the board, where it can be edited and cabled. Reports its latency like Audio Out. |
| **Bleep FX** | Audio effect | Outputs: `audio` L, R (dry signal). Inputs: `audio` L, R (return) | Loads one effect cell preset ([`cell-plugins.md`](cell-plugins.md)) and routes the track's audio through it and back; it opens on the preset's panel. Dry/wet control on the plugin; the dry signal is delayed to match. With nothing patched into the return, the send passes through. Two blocks of latency (section 5.3). |

**Bleep Panel** is also part of the bundle but isn't a port: it carries no signals and doesn't appear as a node (section 9.7).

| Plugin | Live device type | On the board | Notes |
|---|---|---|---|
| **Bleep Panel** | Audio effect (passes audio through) | Nothing (not a node) | Shows one panel of the board in its plugin window. Any number per set; several can show the same panel. |

Every port's own plugin UI is small: the node's name, a status line (board, latency, resyncs), an *Open Board* button, and Dry/Wet for Bleep FX. Port-specific settings (MIDI channel, CC numbers, transpose) are knobs and settings of the port's node, in its module view on the board.

**Port nodes on the board:**
- can be renamed (the name is shown in both the board and the plugin UI);
- can't be deleted from the board, only by removing the plugin in Live;
- live on the board's top level, not inside cells (a port is one physical plugin and can't be copied with a cell).

**Unavailable ports.** When a port's track is deactivated or frozen, or the device is deactivated or deleted, the node becomes a **ghost** and **its outputs are deactivated**:
- inputs fed only by deactivated outputs fall back to their knob value (or silence for `audio`);
- cables to and from a ghost are kept and drawn dimmed;
- when the port comes back (reactivated, undo in Live), it reconnects automatically.

## 7. Cable rules

### 7.1 Signal types

All signals use **virtual volts** (section 18), so they map one to one to CV and VCV Rack later.

| Type | Value | Cable colour (proposal) |
|---|---|---|
| `control` | float, bipolar −1…+1 or unipolar 0…1, declared per output | yellow |
| `gate` | float, high ≥ 0.5 | green |
| `trigger` | single-sample pulse at a sample offset | green, dashed |
| `pitch` | float, 1.0 = 1 octave (1 V/oct), 0.0 = C4 | blue |
| `audio` | float, per sample | red |
| `notes` | polyphonic event stream: note on/off with pitch, velocity, per-note pressure, release velocity; also control changes, program changes, bend, channel pressure and realtime messages (a module ignores what it does not know) | purple, thick |

All types except `notes` are written per sample, so audio-rate modulation is always possible.

### 7.2 Direction and count

- Cables always run **from an output to an input**.
- **Fan-out:** an output can feed any number of inputs.
- **Fan-in:** an input can receive any number of cables. They are combined:
  - `control`, `pitch`, `audio`: summed (each scaled by its amount, section 7.3);
  - `gate`: logical OR (high if any source is high);
  - `trigger`: merged (all pulses pass);
  - `notes`: merged streams.

### 7.3 Knobs and amounts

- **Every knob is an input.** A cable dropped onto a knob modulates it with the offset model from section 5.6.
- **Each cable has its own amount** (−1…+1, attenuverter) at the destination, shown as a mod ring and adjusted by dragging the ring. Dedicated input jacks (e.g. *Audio In* of the Filter) default to amount 1.
- **Pitch inputs** default to amount 1 (exact tracking).

### 7.4 Type compatibility

| Output → Input | Allowed? | Behaviour |
|---|---|---|
| Same type | Yes | Direct |
| `control` / `pitch` / `audio` ↔ each other | Yes | Direct, values pass unchanged (all are floats) |
| any float type → `gate` | Yes | High while ≥ 0.5 |
| any float type → `trigger` | Yes | Pulse on each rising edge through 0.5 |
| `gate` / `trigger` → float input | Yes | 0 or 1 |
| `notes` → `notes` | Yes | Direct |
| `notes` → anything else | No | Use a *Notes to CV* utility or a Voice Cell's *Voice In* |
| anything else → `notes` | No | Use a *CV to Notes* utility |

Implicit conversions show a small converter icon on the cable.

### 7.5 Feedback

- **Cycles are allowed.** The engine detects them and marks the cable that closes each loop as a **feedback cable** (drawn with a loop icon).
- A feedback cable delays its signal by **one engine sub-block** (default 32 samples, about 0.7 ms at 44.1 kHz).
- Later: a per-cell "tight feedback" option processes that cell sample by sample, so feedback inside it costs one sample, at a CPU cost.

### 7.6 Cells and cables

- **Cables don't cross cell borders directly.** A cell's inside connects to its outside only through the cell's own jacks (section 8.1). This keeps cells self-contained, so they can be copied and saved as presets.
- **Ports live on the top level** (section 6). Inside a cell, a port's signal arrives through a cell jack.

### 7.7 Click-free changes

Connecting, disconnecting or changing an amount on an `audio` or `control` input ramps over a few milliseconds, so editing a running patch doesn't click.

## 8. Cells

### 8.1 Cells

- **Creating:** select nodes and group them into a cell; or create an empty cell and fill it.
- **Jacks:** inside a cell, *Cell In* and *Cell Out* nodes define the cell's input and output jacks (name and signal type). Selecting nodes with cables leading outside creates these jacks automatically.
- **Cell controls:** a cell can expose up to 8 inner knobs as its own knobs, so a collapsed cell is playable like a module.
- **Nesting:** cells can contain cells, to any depth.
- **Navigation:** double-click enters a cell; a breadcrumb (*Board › Pad › Env*) leads back out.
- **Copying:** copies are independent. Editing one copy doesn't change the others.
- **Presets:** any cell can be saved as a preset file and loaded into any board. Cell presets are the basis of the patch library (section 16.1).

### 8.2 Why cells matter

- **Overview.** Large patches collapse into a few named blocks.
- **Reuse.** "Wobble bass mod", "Euclidean hats", "Ambient drift pack" become one-click building blocks.
- **Polyphony.** A Voice Cell runs one voice's patch once per voice (section 8.3).

### 8.3 Voice Cells

A **Voice Cell** turns one synthesizer voice into a polyphonic instrument. Inside, the user patches *one* voice, like a mono synth; the cell runs it once per voice and assigns incoming notes to the voices.

```
 Outside (the board)                Voice Cell "Basic Poly" ×8
                                    ┌─────────────────────────────────────────────┐
 MIDI Device ── Notes ─────────────►│ Notes ─► voice allocation                  │
 (C, E, G held)                     │   voice 1 ─► Voice In: Pitch C, Gate ─► Osc → VCA ─┐
                                    │   voice 2 ─► Voice In: Pitch E, Gate ─► Osc → VCA ─┼─► Out L/R
                                    │   voice 3 ─► Voice In: Pitch G, Gate ─► Osc → VCA ─┘   (summed)
                                    └─────────────────────────────────────────────┘
```

#### 8.3.1 The voice interface

Notes and per-voice signals live on two levels: outside, one `notes` cable carries all notes; inside, *Voice In* gives each voice the signals of the note it plays. *Notes* is the only way notes enter a Voice Cell. The Step Sequencer's *Notes* output plays a Voice Cell directly; any other mono source (pitch and gate) plays one through the **CV to Notes** module (section 12). When what feeds *Notes* changes (a cable removed, the source deleted or muted), the cell releases its held notes, since the old source can no longer send their note-offs.

**From outside**, fixed jacks (can't be removed or retyped) plus optional shared jacks:

| Jack | Type | Fixed? | Meaning |
|---|---|---|---|
| **Notes** | `notes` | fixed | All notes; the cell assigns them to voices |
| **Out L**, **Out R** | `audio` | fixed | All voices, summed |
| Shared inputs | any but `notes` | optional | The same signal for every voice (an LFO, a cutoff macro, pitch bend) |
| Shared outputs | `control`, `audio` | optional | Summed over the voices |

**Inside**, two fixed nodes that can't be deleted, plus *Cell In* / *Cell Out* for the shared jacks:

*Voice In* — outputs, per voice:

| Output | Type | Meaning |
|---|---|---|
| Pitch | `pitch` | the note's pitch (1 V/oct, 0 = C4), with glide |
| Gate | `gate` | high while the note is held |
| Trigger | `trigger` | at each note start, also when a voice is stolen |
| Velocity | `control` 0…1 | note-on velocity |
| Release | `control` 0…1 | release velocity |
| Pressure | `control` 0…1 | polyphonic aftertouch |
| Voice # | `control` | 0 … voices − 1 |
| Random | `control` −1…+1 | a new value per note, fixed while it plays: slight variation between voices (seeded, so renders repeat) |

*Voice Out* — inputs, per voice:

| Input | Type | Meaning |
|---|---|---|
| Out L | `audio` | the voice's audio |
| Out R | `audio` | optional; without it, Out L feeds both sides |
| Active | `gate` | optional; high while the voice still sounds (e.g. the amp ADSR's *Active*). Without it, a voice is free once its gate is off and its audio has stayed below −90 dB for 50 ms |

**Rules:**
- Ordinary cells may go inside a Voice Cell; Voice Cells can't be nested, and ports can't go inside.
- A Voice Cell whose *Out L* isn't patched inside shows "no sound" on its node.
- **Pitch bend** is per MIDI channel, not per note: it enters as a shared input (MIDI Device *Bend*) and is added to the oscillator's pitch inside. MPE (section 18) will put bend and slide on the notes themselves.

#### 8.3.2 Settings

| Setting | Values | Default |
|---|---|---|
| Voices | 1–16 | 8 |
| Allocation | Round robin · lowest free · reuse the voice playing the same note | Round robin |
| Stealing (all voices busy) | Oldest · quietest · lowest note · highest note · none (drop the new note) | Oldest |
| Mode | Poly · mono · legato (mono, retrigger only on detached notes) | Poly |
| Glide | time; always / legato only | 0 (off) |
| Stereo spread | pans the voices across L/R | 0 % |
| Output | sum · sum with gain compensation (÷√voices) | compensated |
| Unison (later) | voices per note, detune spread | 1 |

- **One definition, N voices.** Editing a knob inside changes it in every voice; variation comes from *Voice #* and *Random*.
- **Sleeping voices** use no CPU.
- **Cell controls** (section 8.1): a Voice Cell can expose up to 8 inner knobs as its own, which apply to all voices and are modulation targets from outside.

#### 8.3.3 How users work with Voice Cells

1. **Add.** *Add → Cell → New Voice Cell* (or Tab, "voice"). The cell arrives with its fixed jacks and a **starter voice** inside: Oscillator → VCA, an ADSR on the VCA's gain, the ADSR's *Active* on *Voice Out*. It makes sound right away; everything can be changed.
2. **Connect** *Notes* (e.g. from MIDI Device) and *Out L/R* (e.g. to Audio Out).
3. **Design the voice.** Double-click to enter; patch one voice.
4. **Play it from outside.** Click the cell: its view shows the voice settings and the cell controls; dots on the node show which voices play.
5. **Reuse.** Right-click → *Save as preset*, with a name and a category (e.g. *Synthesizers*). The preset appears under *Add → Cell → Synthesizers*, next to the factory presets.
6. **Convert.** Right-click on an ordinary cell → *Make Voice Cell* adds *Voice In* and *Voice Out*; the cell's existing jacks become shared jacks.

**Factory preset *Basic Poly*** (*Add → Cell → Synthesizers*): Oscillator → Multi Filter → VCA, one ADSR for the filter, one for the VCA, 8 voices, with shared inputs *Cutoff* and *Bend*.

#### 8.3.4 Preset library

- **Preset document:** a cell and everything inside it: `{format, root, category, description, tags, nodes, cables}`, knob values normalised as on the board. A user preset is one `.bleepcell` file (`{name, preset}`) in the app data folder, shared by all sets.
- **Factory presets** ship in categories of ten (*Feedback & Pings* has twenty): *Synthesizers*, *Basses*, *Leads*, *Pads*, *Plucks & Mallets*, *Feedback & Pings*, *Drum Machines*, *Sequencers* (cells with a *Notes* output), *Effects* (stereo in and out), *Modulators* (control outputs) and *Generative* (self-playing). They are written in units in `patch/presets/` and compiled into the board UI (`factory-presets.json`); hand-written ones (`factory-presets.js`, e.g. the single drum sounds under *Drums ›*) join the same menu. Factory presets are read-only; names are unique.
- **Browsing:** *Add → Cell → category → preset*, factory presets in their authored order, then the user's own (A–Z). Hovering a preset shows its description under the menu; the Tab search matches names, categories, tags and descriptions.
- **Saving:** *Save as preset* asks for a name, a category and an optional description.
- **Checks:** every factory preset loads through `board::sanitise` without a warning (ctest `patch.factory-presets`).

## 9. The board UI

### 9.1 Window model

- **One board window.** The board is a separate top-level window owned by the engine, not part of any plugin's editor. Only one board window exists at a time.
- **Opening it.** When any Bleep plugin's editor opens, the plugin decides, based on the shared engine state, whether to also open the board:
  - board closed → open it, centred on this plugin's node (default behaviour, can be switched off in the board's settings);
  - board already open → bring it to the front and highlight this plugin's node.
- The **Bleep Board** plugin's UI is just the board: opening it opens the board.
- **Port plugin windows** show the port's own settings, or a panel (section 9.7).
- **Bleep Panel** plugin windows show their panel and don't open the board by default (section 9.7).
- Closing the board doesn't close any plugin windows, and vice versa.
- To verify in phase 0: focus, keyboard input and hide/show behaviour of a non-host top-level window in Live on macOS and Windows.

### 9.2 Layout

```
┌─ Board › Pad ─────────────── [Add] ↶ ↷ ────────────── CPU 7%  L 256 smp ─┐
│ CANVAS (inside the cell "Pad")                           [Close cell ×]  │
│                                                                          │
│  Voice In ●━━▶ Oscillator ━━▶ Multi Filter ━━▶ VCA ━━▶ Voice Out          │
│      ●───────▶ ADSR ─────────────────────────────▲                       │
│                                       ┌─ Oscillator ──────────────┐      │
│  Cell In ●┄┄▶ (Cutoff, Bend)          │ (Octave) (Shape) ...      │      │
│                                       │  floating module view     │      │
│                                       └───────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** breadcrumb (*Board › Pad*), Add (the Add menu, section 9.6), undo/redo, CPU load, port latency.
- **Canvas:** nodes and cables. Inside a cell, a *Close cell* button at the top right leads back out (like Esc and the breadcrumb). Pan by dragging empty space or scrolling, zoom with pinch or ⌘-scroll.
- **Module views** float over the canvas (section 9.4).

### 9.3 Nodes on the canvas

Nodes are compact: name, type, jacks and a mini scope per output. Knobs live in the module view, not on the node.

| Node | Look |
|---|---|
| Module | Flat card |
| Port | Stripe in its Live track's colour, track name (if Live passes track name and colour to plugins; to be tested) |
| External plugin | Card with a "Bus" badge |
| Cell | Thicker border, its jacks and up to 8 cell controls |
| Voice Cell | Voice count (e.g. ×8) and one dot per voice that lights while the voice plays |
| Ghost | Dashed and greyed; cables dimmed |

- **Semantic zoom:** zoomed out, only names and cables; zoomed in, jack names and scopes.
- **Look:** flat, clean cards, consistent with the Brilliant Bleep design language. No imitation of Eurorack hardware.

### 9.4 Module views

A **module view** is a module's full UI: its knobs, switches, mod rings, scopes and jacks.

- **Opening:** click a node. The view opens as a **free-floating window inside the board window**, next to the node.
- **Floating:** views can be moved anywhere, stay open while the user works on the canvas, and several can be open at once. Clicking the node again, or Esc, closes its view.
- **Pinning:** a pinned view stays open when the user enters or leaves cells.
- **Linking:** a thin line connects an open view to its node while either is hovered.
- **Mod rings:** dropping a cable on a knob in a view modulates that knob (section 9.5).

- **Presets:** a module that has factory presets (`board/ui/module-presets.json`, written in units in `patch/presets/modules/<type>.mjs`) shows the same **preset bar** above its controls: previous / next, a menu (**Factory**, read-only, and **User**) and Save. A preset is `{params: {id: 0…1}, data?}`; a factory preset lists only the knobs it sets and the rest follow their defaults. A user preset stores every knob, plus the node's `data` when it has any, in the native library `module:<type>` (`<app data>/Beautiful Bleep/Module Presets/<type>/*.bleepmodule`). Loading one is a single undo step and never touches cables. Factory names can't be reused for user presets. Modules without a preset file (the Patch Bay, meters, mixers, controllers, samplers) get no bar.
Module view sketch:

```
┌─ FUNCTION ── "Bass Wobble" ───────────────────────────┐
│   (Rise)   (Fall)   (Shape)   (Spread)   [Cycle]      │
│     ◯━━      ◯        ◯━━        ◯         ▣          │  ━━ = mod ring
│   Sync: [1/4 ▾]   Phase reset: [Bar ▾]   Seed: 42     │
│   OUT  A ●~~~  B ●~~~  C ●~~~  D ●~~~   EOC ●┐_┌      │  ~ = mini scope
│   IN   Trig ○   Reset ○                               │
└───────────────────────────────────────────────────────┘
```

### 9.5 Patching

- **Drag from an output.** Compatible inputs light up, incompatible ones fade (section 7.4).
- **Drop on an input jack** to connect it, or **on a knob** (in a module view or a panel) to modulate it. A mod ring appears; dragging the ring sets the amount.
- **Drop on empty canvas** to open the module search, filtered to modules that accept the signal. The chosen module is created already connected.
- **Pick up and drop:** click an output to take the cable "in hand", then click a target in any view, panel or plugin window.
- **Cables:** click to select; Delete removes it; dragging an end moves it. Hovering a cable or output shows a live scope.
- **Trace (T):** highlight everything feeding into and fed by the selected node; dim the rest. Answers "what modulates what?"
- **Mute (M):** a muted node's outputs fall back to silence or the knob value, for quick A/B comparisons.

### 9.6 Editing and cells

- **Add** from the **Add menu** (the top bar's *Add* button or right-click on empty space):
  - *Module ›* one submenu per category (*Sources*, *Modulation*, *Audio*, *Effects*, *Utility*, *Controllers*, *Sequencing*, *Drums*), each split into subcategories with its modules; a category with a slash nests, e.g. *Sequencing/Drum* is *Sequencing › Drum ›* and *Drums/Ring* is *Drums › Ring ›*;
  - *Cell ›* *New Cell*, *New Voice Cell*, and one submenu per preset category (*Synthesizers ›* *Basic Poly*, …, then the user's own categories).
  Tab or a double-click on empty space opens a search field at the cursor. Under *Cell ›*, each category of the user's own presets also has *Delete preset ›*.
- **Rename** with a double-click on the title.
- **Select** with a drag box; Shift adds to the selection.
- **Duplicate** with ⌘D: copies the nodes and the cables between them. ⌘⇧D also keeps the incoming cables.
- **Copy, cut and paste** with ⌘C, ⌘X and ⌘V: the selection (cells with their contents) and the cables between them go to the system clipboard, so they can be pasted into another cell, another set or another board. Paste puts them at the pointer (or where the canvas was right-clicked), keeps their layout and selects them. Ports aren't copied; a Voice Cell isn't pasted inside another Voice Cell.
- **Delete** works on everything except ports (section 6).
- **Fit** the patch to the window with F; **auto-layout** tidies the selection from left to right.
- **Cells:**
  - ⌘G groups the selection into a cell; cables crossing the new border become cell jacks. ⌘⇧G ungroups.
  - Double-click enters a cell; Esc or the breadcrumb leads back out.
  - Right-click → *Make Voice Cell* turns a cell into a Voice Cell (section 8.3.3).
  - Right-click → *Save as preset*, with a name and a category, adds the cell to the Add menu.

### 9.7 Panels

A **panel** is a custom UI for a cell or the board, like the front panel of a hardware synth: sliders, dials, buttons, a keyboard roll, text labels, displays, and the views of modules from inside the cell. The full design is in [`doc/specs/panels.md`](panels.md); this is the summary.

- **Two views.** *Interface* is for playing. *Wiring* is for building: every control shows what it is wired to, and the user connects it to a knob, a cell jack, a note input or a module's button, with a range and a curve per wire. One control can drive several targets (a macro). Layout editing (add, move, resize, label, colour) is in the Interface view behind an unlock.
- **Panels belong to the board.** A board can have any number of panels. A panel can front a cell and wire into anything inside it, at any depth. Panels are saved with the board; *panels in cell presets:* the panels whose controls all wire inside a cell are saved with it, and factory cell presets come with panels.
- **Board panels and show on load.** A panel can belong to a cell (opened with its ▦) or to the board (the **Panels** list in the toolbar, wiring to any node). A board panel can be set to open when the board loads, in a window or full screen, so a patch opens as an instrument.
- **Tabs and loaded panels.** A panel can have tabs (Play, Sound, …) and can load another panel into a frame: a drum machine's panel loads the *Drum Grid* panel, a synth loads a *Step Sequencer* panel. A panel shows the controls that matter, not every knob.
- **Opening and editing.**
  - A cell with a panel shows ▦ on its node: one click opens the panel in a floating window; double-click still enters the cell.
  - Inside a cell the breadcrumb bar has **Inside | Panel**; ⌘E switches Interface and Wiring.
  - The toolbar's **Panels** button (P) lists every panel with a thumbnail.
  - Right-click a knob → *Add to panel* puts a dial wired to it on a panel; right-click a cell → *Build panel from cell* makes a first panel automatically.
  - Wiring: drag a control's connector onto a knob or jack, or *Learn* (press, then move a knob), or pick from the cell's outline.
- **Where panels show up:**
  - in the board window, as a floating window like a module view;
  - **in a Bleep Panel plugin** (see below), for playing without the board;
  - **inside a port's plugin window.** Each port can be set to show one panel instead of its default settings view. Main case: the *Bleep Instrument* plugin window shows the panel of the Voice Cell it plays, so a board synth feels like a normal instrument in Live;
  - as the standalone app's main view (*Perform* mode).
- **Bleep Panel plugin.** A VST3 plugin whose only job is to show one panel:
  - The user drops it on any track (it passes audio through untouched) and picks a panel from a dropdown in its window. Live's floating plugin window can then be placed anywhere on screen, next to the arrangement, the mixer or a second monitor.
  - Any number of Bleep Panels per set; several can show the same panel. Each remembers its panel by ID; if the panel is deleted from the board, it shows "Panel not found" and the dropdown.
  - It stores only the panel reference. Without a Bleep Board plugin in the set, it shows "No board in this set".
  - Opening its window doesn't open the board (an *Open Board* button is available).
  - Controls marked *expose* are automatable parameters of the Bleep Panel plugin, so Live can automate and MIDI-map them.
- **Mapping layer.** Panel controls never change engine state directly. They go through a mapping layer: control → target(s), each with range, curve and mode (*set* the knob, or *mod* it like a cable). Knob wires run on the message thread; modulation, jack and note wires compile to a hidden panel source node.
- **Stages.** 1: reading panels (factory panels, module views on a panel, ▦, the Panels list, port windows, the Bleep Panel plugin). 2: wiring and editing. 3: MIDI-learn, XY pads, step bars, custom HTML views.

### 9.8 Connection to Live

- Opening a port's plugin window opens or fronts the board and highlights the port's node (section 9.1).
- Adding a port in Live places its node at the edge of the visible canvas, with a short highlight.
- The Bleep Board plugin's macros appear as one *Macros* node.

### 9.9 Visual language

- Cables coloured by signal type (section 7.1); mod rings on knobs; mini scopes on outputs.
- Ghost nodes greyed out with dimmed cables.
- Latency badges on ports.

### 9.10 Undo

The board has its own undo/redo stack covering all edits: adding, removing, moving, naming, cabling, amounts, knob changes, grouping and ungrouping cells, panel edits. Live's undo doesn't include board edits.

### 9.11 Keyboard shortcuts

| Key | Action |
|---|---|
| Tab / double-click | Add module (search at cursor) |
| ⌘G / ⌘⇧G | Group into cell / ungroup |
| ⌘D / ⌘⇧D | Duplicate / duplicate with incoming cables |
| ⌘C / ⌘X / ⌘V | Copy / cut / paste |
| Delete | Remove selection |
| Esc | Close view, leave cell |
| F | Fit the board to the window |
| T | Trace signal flow of the selection |
| M | Mute node |
| ⌘Z / ⌘⇧Z | Undo / redo |

### 9.12 Example workflows

1. **Modulate Grit with an LFO.** Add Bleep Board; the board opens, and Grit is already on it. Tab, type "fun", Enter. Drag output A onto Grit's Drive knob and drag the ring to −25%. Four actions.
2. **Play a poly synth.** Add *Bleep Instrument* on a MIDI track. Drag the *Basic poly* cell preset onto the board, connect notes in and audio out. The preset brings its panel; set the Bleep Instrument to show it, and the synth's front panel opens like any instrument in Live.
3. **Sidechain from drums.** Add *Bleep Audio In* after the Drum Rack. Drop its output on empty canvas, choose *Envelope follower*, cable that to Pad's cutoff.

## 10. Audio on the board

Audio is a first-class signal type on the board from v1, because the engine runs in one process and passes audio between nodes like any other signal. This enables, without extra tracks or sends:

- **Synthesis:** oscillators, filters and amps on the board, played and heard through Bleep Instrument (or Bleep MIDI In plus Bleep Audio Out on separate tracks).
- **Effects:** route a track through the board with Bleep FX.
- **Routing between tracks:** Bleep Audio In on one track → Bleep Audio Out on another.
- **Audio as modulation:** any audio signal used directly as a mod source, or through an envelope follower.
- **Feedback loops:** e.g. Filter → Grit → back into the Filter (section 7.5).

Constraints:

- **Port latency** (section 5.3): audio crossing from Live into the board and back costs two blocks. Fine for creative routing and sound sources, not for phase-tight parallel processing. Ports show it.
- **Determinism** during offline rendering: same rules as for control signals, but failures are more audible.
- **Audio over Bleep Bus** (to external plugins) is reserved for a later bus version.

## 11. The standalone app

The **Bleep App** runs the engine, the board, modules, cells and panels without a DAW: for playing and sound design on its own, or next to Live. It is the same engine as in the plugins; only its bridges differ.

### 11.1 What it is

- **A desktop app** (macOS, Windows). Its main window is the board.
- **Its own projects.** The app saves its board in a project file (`.bleepboard`), not in a Live set.
- **Its own audio device** when it runs alone: inputs and outputs of the selected audio interface appear as Audio In/Out nodes (the **device bridge**).
- **Bridges to the outside world:**

| Connection | How | Section |
|---|---|---|
| MIDI to and from Live, other apps and hardware | The app's own virtual MIDI ports | 11.2 |
| Audio to and from Live | **Bleep Audio Bridge** plugin on any track in Live | 11.3 |
| Tempo, beat, start/stop | **Ableton Link** | 11.4 |
| What the computer plays | **System audio**: the *System* node | 11.7 |

A Live set either has its board in Bleep Board (section 6) or works with the app through Bleep Audio Bridge. Both can be used at the same time; they are separate boards.

### 11.2 MIDI: the app's own MIDI ports

- **The app creates its own virtual MIDI ports**, "Bleep App 1" … "Bleep App n" (the number is set in the app's settings, default 2). Live and other apps see them like a hardware MIDI interface: no loopback tool needed.
- **The MIDI bridge** puts each port on the board as two nodes: **MIDI In** (same outputs as Bleep MIDI In: notes, pitch, gate, velocity, CCs …) and **MIDI Out** (same inputs as Bleep MIDI Out). Hardware MIDI interfaces appear the same way.
- **In Live:** a MIDI track sets *MIDI From* "Bleep App 1" to play from the app, or *MIDI To* "Bleep App 1" to play into it. Live's MIDI preferences can also send MIDI clock to a port.
- **Platforms:** macOS CoreMIDI virtual endpoints. Windows: virtual devices of Windows MIDI Services (Windows 11); on older systems a loopMIDI port can be selected instead.
- **Limits:** MIDI between apps is not sample-accurate (about a millisecond of jitter) and not delay-compensated.

### 11.3 Audio: Bleep Audio Bridge

**Bleep Audio Bridge** is a VST3 audio effect for Live that connects a track to the running app. No virtual audio driver, no aggregate device.

```
 Ableton Live                                  Bleep App
 ┌─ Track "Drums" ───────────────┐             ┌─ Board ─────────────────────────┐
 │ Drum Rack → [Bleep Audio      │ ══ shared ══│  [Bridge "Drums"] → Filter ─┐   │
 │              Bridge] → out    │   memory    │        ▲                    │   │
 └───────────────────────────────┘             │        └────────────────────┘   │
                                               └─────────────────────────────────┘
```

- **In the app,** each bridge is a node named after its track: outputs **Send L/R** (the track's audio) and inputs **Return L/R** (audio back to the track). Any number of bridges, one node each. A bridge that isn't connected is a ghost (section 6).
- **In Live,** the plugin window has a **Monitor** setting: *Send* (the track's audio passes through), *Return* (the app's audio replaces it) or *Mix* (dry/wet; the dry signal is delayed to match). Plus the node's name, a status line and *Open App*.
- **Live sets the pace.** While at least one bridge is connected, the app's engine follows Live's audio blocks instead of its own audio device, with the same scheme as inside Live (section 5.3): for every block the first bridge hands its audio over and signals the app; the app processes the block on a real-time thread; every bridge picks up the result two blocks later. One clock, so no drift, no resampling and no extra buffering. The app's own audio device is muted meanwhile.
- **Fixed latency** of two blocks, reported to Live, so Live's delay compensation lines it up (section 5.3).
- **Deadline.** The app has one block to process. If it misses, that block is silent on the return and counted in the plugin's status line.
- **Offline export.** When Live renders faster than real time, the bridge waits for the app (allowed outside real time), so exports include the app's audio.
- **Without the app** the bridge passes the track's audio through and shows "Bleep App not running". It reconnects when the app starts.
- **Identity.** Each bridge keeps a stable ID in the Live set; the app's project remembers the nodes by these IDs, so cables survive closing and reopening both.
- **Open:** the shared-memory protocol between bridge and app is a versioned Bleep Bus extension (section 15), so other hosts or plugins could implement a bridge too.

### 11.4 Ableton Link

- **A Link node** on the app's board: outputs *Tempo* (control), *Beat* and *Bar* phase (control, 0…1), *Clock* (gate, 24 per quarter note), *Playing* (gate), and triggers on every beat and bar. Settings: quantum (beats per bar), start/stop sync on/off.
- **Transport.** When the app runs alone, the board's musical time (Sync settings of Function, Random, Clock …) follows Link: tempo, beat position and start/stop. With Bleep Audio Bridge connected, Live's transport (from the bridge) takes priority; the Link node stays available.
- **In Live,** turn Link on (and Start Stop Sync), and Live and the app share tempo, phase and transport.
- **License.** Ableton Link is GPLv2-or-later. Builds that include it are distributed under the GPL (compatible with JUCE under AGPLv3 and with our MIT source) with their source. A closed-source build would need a license from Ableton.

### 11.5 Preset browser

*File → Presets…* (⌘P) and the **Presets** button in the board's top bar open the preset browser: whole boards that load directly into the app.

The same button is in the plugins' board window and Bleep Play. In a plugin, loading a patch replaces the board as one undoable edit (no tempo or transport change); the patch's *Out 1/2* nodes take over the board's existing Audio Out ports by type, and extra ones are left out, so a set without an Audio Out port hears nothing from a demo.

- **Demo boards.** Five for every advanced module (every module except the basic building blocks; **Sampler** has none, because it plays a WAV file the user loads and a patch can't ship one), listed under *Demos by module*. Each plays by itself with the transport, needs no MIDI or audio input and reaches *Out 1/2*. They are written in units in `patch/presets/demos/<module>.mjs`, compiled with the cell presets into `board/ui/demo-patches.json` (`node patch/presets/build.mjs`), and described in each module's documentation under *Demo boards*. See `patch/presets/demos/README.md`.
- **My board presets.** *Save current board…* keeps the board you are working on as one `.bleeppreset` file (`{name, preset}`, the board's nodes and cables, a description) in the app data folder, `Beautiful Bleep/Boards/`. User patches can be deleted in the browser.
- **Browsing.** A list of groups on the left (*All board presets*, *My board presets*, one per module), cards on the right with name, description and tags; the search field matches names, modules, tags and descriptions. *Load* or a double-click loads.
- **Loading** replaces the project: the app asks about unsaved changes first, the board becomes an untitled project (Save asks for a file), the demo's tempo is set and the transport starts. Port nodes (Out 1/2, Bleep App 1) bind to the app's own ports by their IDs; other ports come back on their own, unpatched.
- **Checks.** `bleep_demo_patches` (ctest `patch.demo-patches`) loads every demo through `board::sanitise` without a warning, renders 12 s with the transport running and fails on silence, clipping, non-finite output or a heavy CPU load.

### 11.6 Limits and open questions

- **Cross-process deadline.** Processing in another process within one block is soft real-time. Phase 0 measures misses at small buffer sizes and under load.
- **One host at a time.** The app accepts bridges from one host process at a time.
- **Two boards.** A Live set with Bleep Board and the app are separate boards; cables don't cross between them (except via MIDI ports and bridges).

### 11.7 System audio

The app can take in **what the computer plays** (a music player, a browser, a call) as the *System* node, an *Audio In* named after it, with the operating system's own capture API and no virtual audio driver: a Core Audio process tap on macOS 14.2+, WASAPI loopback on Windows, a PulseAudio/PipeWire monitor on Linux. It is off until the user turns it on in Settings; the app's own sound is left out of the capture where the platform can do that, so *System* patched to an *Audio Out* does not feed back. Standalone app only. The full specification, with the platform backends, the clock-drift handling and the open points, is [system-audio.md](system-audio.md).

## 12. First module set

Each module is our own design, built from generic modular concepts. Each module gets its own specification file in `doc/specs/modules/` (purpose, jacks, controls, behaviour, view, saved state, tests); the table below is the overview.

| Module | Building blocks | Key ideas |
|---|---|---|
| **LFO** | Sine, triangle, saw up/down, square (pulse width), random step and smooth; free or tempo-synced; phase, fade-in, reset | The quickest modulation source, phase-locked to the bars when synced. Every wave on its own output. See `doc/specs/modules/lfo.md`. |
| **Function** | Rise/fall slope generator, cycle mode, end-of-cycle gate, chaining | One primitive that acts as envelope, LFO, slew or portamento depending on patching. A *spread* control derives several related outputs (rate ratios, phase offsets) from one gesture. |
| **Random** | Sample & hold random, distribution (spread/bias), smoothing, quantize, looping memory | A single knob between "always new" and "locked loop". Seeded, so renders are reproducible. |
| **Drift** | Slow chaotic systems (coupled differential equations) | Organic, never-repeating movement over seconds to hours. |
| **Clock** | Transport-locked divisions/multiplications, Euclidean patterns, probability gates, swing | A full rhythmic modulation source, phase-locked to Live's bars. |
| **Morph** | Keyframe snapshots + interpolation, XY pad | One knob or one LFO morphs many destinations through stored states. |
| **Utility** | Attenuverter, offset, mix, slew, S&H, comparator, logic, rectify/fold, quantizer | The glue. Small, cheap, endlessly combinable. |
| **Multi Filter** | Several filter algorithms behind one panel: a **Type** dropdown, plus mode morph, drive, key-tracking, envelope follower out | See below. |
| **Oscillator** | Triangle-core oscillator: waveform morph, through-zero FM, hard sync, sub | See below. The basic sound source for synths on the board. |
| **Noise** | White, pink, brown, blue; continuous colour sweep | *Colour* morphs brown → pink → white → blue → violet at constant loudness. Every instance plays its own noise. See `doc/specs/modules/noise.md`. |
| **VCA** | Voltage-controlled amplifier, linear or exponential response, stereo | Turns envelopes into loudness. Its *Gain* knob starts at 0, so an envelope patched into it opens it fully. |
| **ADSR** | Attack, decay, sustain, release; velocity amount; retrigger | Outputs *Env*, *End* (trigger when the release finishes) and *Active* (gate while the envelope runs, for a Voice Cell's *Voice Out*). |
| **Step Sequencer** | Up to 32 steps with gate (on/off/tie), pitch and velocity lanes; scale quantizing; randomizer and seeded *Variation* | Transport-locked or clocked. *Notes* output plays a Voice Cell directly. See `doc/specs/modules/step-sequencer.md`. |
| **Drum Grid** | 8 tracks × up to 32 steps (off/on/accent); per-track gate, accent and velocity outputs; 16 pattern slots; pattern library | Transport-locked, own tempo or clocked; a Run gate starts and stops it. Patterns switch at the end or immediately and save to a library shared by all sets. See `doc/specs/modules/drum-grid.md`. |
| **CV to Notes** | Pitch + gate → `notes` | Lets mono sources (sequencers, Random + Utility) play Voice Cells. Legato on pitch changes while the gate is high. |
| **Ring Drums** | One node per drum: kick, snare, clap, tom, rim/clave, cowbell, hats, cymbal | Deep, round kit from struck resonators, band-passed noise and six detuned squares. Shared outside: *Trig*, *Velocity*, *Out*, *Level*. See `doc/specs/modules/ring-drums.md`. |
| **Punch Drums** | One node per drum: kick, snare, clap, tom, rim, hats, crash/ride | Tight, hard kit from fast-swept sines, noise clicks and crunchy metal. Same outside as Ring Drums. See `doc/specs/modules/punch-drums.md`. |
| **Notes to CV** | `notes` → pitch, gate, trigger, velocity, pressure; note priority, retrigger, glide | The way out of `notes` (section 7.4) for modules outside a Voice Cell. See `doc/specs/modules/notes-to-cv.md`. |
| **Attenuverter** | Four rows of scale (−2…+2) and offset, sum output, clip | Unpatched rows are manual constants: four macro knobs. See `doc/specs/modules/attenuverter.md`. |
| **CV Mixer** | Four bipolar channels; sum, average, max, min, scan; master, offset | Combines modulators in more ways than fan-in's sum. See `doc/specs/modules/cv-mixer.md`. |
| **Multiplier** | Two four-quadrant multipliers with bias, chained; optional oversampling | Ring mod at audio rate, depth-by-modulator for control. See `doc/specs/modules/multiplier.md`. |
| **Logic** | AND, OR, XOR, NAND, NOR, NOT, flip-flop, edge triggers; threshold with hysteresis | Rhythms from rhythms; clock ÷2. See `doc/specs/modules/logic.md`. |
| **Quantizer** | Scale quantizer sharing the Step Sequencer's scales, custom scale, transpose before/after, note-change trigger | Turns any modulator into a melody. See `doc/specs/modules/quantizer.md`. |
| **Switch** | Sequential switch, up to 8 steps: 8 → 1 and 1 → 8 at once; stepped by triggers, the transport or Select; fades that never jump; per-step levels | Source selector, router and 8-step value sequencer in one. See `doc/specs/modules/switch.md`. |
| **Audio Mixer** | Four stereo channels: level (dB), pan, mute/solo, send; return, master, limiter, meters | Several sound sources into one stereo pair. See `doc/specs/modules/audio-mixer.md`. |
| **Crossfader** | Stereo A/B blend, equal-power or linear | Dry/wet and source morphing under modulation. See `doc/specs/modules/crossfader.md`. |
| **Level Meter** | Stereo peak and RMS meters, peak hold, clip lights; audio thru; Level and Clip outputs | See how loud a signal is anywhere in the patch, and use the loudness as modulation. See `doc/specs/modules/level-meter.md`. |
| **Monitor** | MIDI event table with filters and held notes; audio, CV and gate meters; everything passes through | See what is on a cable: notes, CCs, program changes, levels, values and pulses. See `doc/specs/modules/monitor.md`. |
| **Dial** | One big knob as a control signal: Min/Max range, detents, smoothing | A macro or selector by hand. See `doc/specs/modules/dial.md`. |
| **Button** | A pad: gate (momentary or toggle), press and release triggers, toggle | Starts, resets and mutes by hand; the toggle is saved. See `doc/specs/modules/button.md`. |
| **Keyboard** | Three octaves to play with the mouse or the computer keyboard; hold | *Notes* plays a Voice Cell; mono pitch, gate, velocity, trigger with priority and glide. See `doc/specs/modules/keyboard.md`. |
| **MIDI Device** | A connected MIDI controller, chosen from a dropdown | **Standalone app only** (section 11). Outputs *Notes* plus mono *Pitch*, *Gate*, *Velocity*, *Trigger*, *Pressure*, *Bend*, *Mod Wheel* and CCs. |

**Multi Filter details:**
- **Type** dropdown with the 25 algorithms of Zavalishin's *The Art of VA Filter Design* (rev. 1.0.3), all in zero-delay-feedback (TPT) form, grouped by family (the dropdown shows the groups as headings):
  - *State Variable*: SVF multimode, unit-gain band-pass, band shelf, peaking, allpass.
  - *1-Pole*: low-pass, high-pass, allpass, low shelf, high shelf.
  - *Transistor Ladder* (24 dB): linear, high-pass feedback shaping, tanh and hyperbolic feedback saturators (solved numerically), nonlinear stages. Multimode LP/BP/HP/notch from the ladder taps.
  - *Diode Ladder* (24 dB): linear, tanh feedback saturator.
  - *Allpass Effects*: 1-pole phaser, 2-pole phaser, flanger, each with zero-delay feedback.
  - *Classic Digital*: naive 1-pole, direct form I biquad (for comparison).
  - *Nonlinear State Variable*: atanh and hyperbolic damping, saturating integrators (the former *Rough*).
- **Mode** morphs continuously LP → BP → HP → notch on the multimode types; on the phasers and flanger it sets polarity or notch spacing.
- **Controls:** cutoff, resonance, drive, mode/morph, mix, key track, gain (dB, for the shelves).
- **Cutoff modulation** is applied in the exponential (octave) domain, so a bipolar signal sweeps musically.
- **Pitch input** for key-tracking.
- **Envelope follower** on the filtered signal as a `control` output, so audio drives modulation elsewhere.
- **4× oversampling**, always on: drive and filter run at four times the host rate between the half-band stages of `patch/common/dsp/Oversampler.h`, so the saturating types and hard drive alias far less (a fully driven 7.3 kHz sine at 48 kHz: aliases ≥ 49 dB down, against ~17 dB without). The output is delayed by 71 samples; the dry signal for *Mix* is delayed to match. It is fixed rather than switched by type or drive, since switching would jump the latency mid-signal.
- The module keeps its saved type id (`filter`), so boards from before keep loading. *Type* is saved normalised: *SVF Multimode* (the former *Clean*) stays first and *SVF Saturating* (the former *Rough*) stays last, so old boards keep their sound. New types go in between.

**Oscillator details:** a triangle core, as in classic through-zero analog oscillators, designed from general principles:
- **Pitch:** octave (−3…+3), coarse (±12 semitones), fine (±100 cents), plus the 1 V/oct *Pitch* input.
- **Waveforms:** separate outputs *Sine*, *Triangle*, *Saw*, *Square* and *Sub* (square, one octave down), and *Out*, a continuous morph sine → triangle → saw → square (*Shape*). *Pulse Width* for the square. Saw and square are band-limited.
- **Through-zero FM:** the *FM* input (audio) with *FM Depth*; the core runs backwards for negative frequencies, so deep FM stays in tune.
- **Hard sync:** a rising edge on *Sync* restarts the cycle.

MIDI In and MIDI Out are no longer modules; they are ports (section 6). In the standalone app, the **MIDI Device** module reads a controller directly.

Function plus Utility already cover the motivating case: an LFO modulates another LFO, and the result is routed to several destinations at different amounts. MIDI Device + a Voice Cell (Oscillator, Multi Filter, VCA, ADSR) + an audio output is a complete polyphonic synth; *Basic Poly* is exactly that.

**Software advantages to exploit:**
- **Transport sync** and phase reset to bars.
- **Seeded randomness.**
- **Unlimited mod inputs**, since every knob is one.
- **A scope on every output.**
- **Polyphony** through Voice Cells.

## 13. Native support in Brilliant Bleep plugins

Grit, Cinch, Tame, Rasp, Hum, Wander, Spore, Probe and future products expose Bleep Bus modulation inputs on their parameters. On the board, each instance appears as a node (section 5.5). Effects:

- **Ecosystem value.** Every Brilliant Bleep plugin a user owns makes the board more useful, and the reverse.
- **No bridge needed** for Brilliant Bleep destinations, so it works in every Live edition, not just Suite.
- **Differentiation** from generic modulation tools.

## 14. Positioning

- **VCV Rack 2 Pro** runs a complete Eurorack environment inside one plugin, on one track. Beautiful Bleep's board spans the whole set: its ports sit on any track and in any device chain.
- **Bitwig's Grid** isn't available in Live, and each Grid patch lives inside one device.
- **Live's built-in modulators and Kilohearts-style containers** are one-to-one or container-bound.
- **Beautiful Bleep's position:** one board for the whole set, Live-native, modulation-first, open.

## 15. Open technology

Bleep Bus is an open standard. Anyone (individual developers, other plugin companies, open-source projects) can build plugins that join the board through the bus, without permission and without fees.

**Scope for now:** third-party plugins join the board as external nodes (section 5.5). Loading third-party *modules* onto the board (a module SDK) is out of scope for now.

### 15.1 What "open" means concretely

| Element | Commitment |
|---|---|
| **Specification** | Public, versioned spec of the shared-memory layout, signal types, timing model and endpoint registry. Semantic versioning; backward compatibility within a major version. |
| **Stable C ABI** | The core API is a plain C interface, so it can be used from C, C++, Rust, Zig, Swift, etc. |
| **Reference SDK** | Open source, MIT-licensed, header-only C/C++ library plus a JUCE module and a CLAP/iPlug2-friendly wrapper. Contains no Brilliant Bleep proprietary code. |
| **Open modules** | For now, the Beautiful Bleep engine, board, ports and modules are MIT-licensed and live in the public repository. Commercial plugins (Brilliant Bleep's or others') are developed in separate repositories. |
| **Conformance test suite** | Open-source test host and validator: checks memory layout, timing behaviour, registry hygiene, state persistence and graceful handling of version mismatches. |
| **Public documentation** | Spec, API reference, tutorials and examples, all public, with no login or NDA. |
| **Governance** | Public GitHub repository. Changes via an open RFC process (issues + design docs). Brilliant Bleep maintains the standard but accepts outside proposals and documents decisions. |
| **Compatibility mark** | Plugins passing the conformance suite may use a "Bleep Bus compatible" badge. The protocol is free; the product names and logo remain trademarks. |
| **Registry (optional)** | A public, community-editable list of compatible plugins. |
| **No lock-in** | No license fees, no mandatory registration, no runtime that calls home. |

### 15.2 Why open is good for the business

- **More plugins on the bus make the board more valuable.** Bleep Bus and Beautiful Bleep are free and open (MIT). Brilliant Bleep earns money with its commercial plugins and instruments (developed in separate repositories), which become more valuable the bigger the open ecosystem gets.
- **An open standard builds trust** with developers and power users, and is a strong story for talks and community building.
- **Other developers adding Bleep Bus inputs** to their synths solves the "can't modulate third-party plugins" problem without any host support.
- **Risk:** competitors build plugins for the bus. That's intended. Brilliant Bleep's edge is design quality, native integration across its own product line, and being the reference implementation.

### 15.3 Documentation, split by audience

Documentation is split by **audience**, not crammed into one file. It lives in the website's content folder (section 17) and is published on the homepage. The README files in the repository stay short: what this folder is, how to build it, and links to the website.

| Document | Audience | Content |
|---|---|---|
| **Quickstart** | Every developer, first contact | Minimal plugin that appears on the board with one input and one output, built and running in Live in 15 minutes. Small enough to paste into a coding AI in full. |
| **API reference** | Plugin developers using the SDK | Concepts, signal conventions, lifecycle, every function/struct/enum/error code, C++/JUCE wrapper, complete examples, host notes, pitfalls, conformance checklist. |
| **Specification** | People reimplementing the bus without the SDK (other languages, bridges) | Shared-memory layout, atomics and memory ordering, registry internals, versioning and extension rules. |
| **User docs** | Musicians | Getting started, the board, ports, cells and Voice Cells, module manuals, Ableton integration guides, tutorials (section 16.1). |

Requirements:

- **Written in small pieces, published in several forms.** Docs are written as small Markdown files (one per topic or function group). CI builds them into:
  - web pages on the homepage, for humans;
  - one **single-file version per audience** (e.g. `api-reference-full.md`), for coding AIs that work best with one complete document;
  - an **`llms.txt`** index at the site root pointing to the quickstart, the full API reference and the spec.
- **Stable URLs.** Every single-file version has a stable raw URL per spec version.
- **Consistent, explicit wording.** "MUST / SHOULD / MAY" (RFC 2119) for normative statements; every function documented in the same template.
- **Code over prose.** Every concept accompanied by a short code example.
- **Kept in sync.** The API reference is checked against the SDK headers in CI. The headers are themselves thoroughly commented, because coding AIs read source files too.
- **Size check.** If the full API reference grows past ~80k tokens, that's a signal to simplify the API or split the audience further.

### 15.4 Sketch of the API shape (illustrative, not final)

```c
bb_bus*      bb_bus_open(uint32_t spec_version, bb_error* err);
bb_endpoint* bb_register_instance(bb_bus*, const bb_instance_info*);
bb_output*   bb_add_output(bb_endpoint*, const char* name, bb_signal_type, bb_polarity);
bb_input*    bb_add_input (bb_endpoint*, const char* name, bb_signal_type);

/* audio thread, real-time safe */
void bb_begin_block (bb_endpoint*, int64_t transport_sample_pos, uint32_t num_samples);
void bb_write_output(bb_output*, const float* samples, uint32_t num_samples);
uint32_t bb_read_input(bb_input*, float* dest, uint32_t num_samples);
void bb_end_block   (bb_endpoint*);

/* state */
size_t bb_save_state(bb_endpoint*, void* buf, size_t cap);
bool   bb_load_state(bb_endpoint*, const void* buf, size_t len);

void bb_unregister_instance(bb_endpoint*);
void bb_bus_close(bb_bus*);
```

## 16. Homepage

Beautiful Bleep gets its own homepage. It serves both audiences: **musicians** who use the board, and **developers** who build for the bus. It's an extension of the Brilliant Bleep site and reuses its stack (FastAPI backend, Next.js frontend, Docker Compose), its shop and its brand. It gets its own section or subdomain (e.g. `patch.brilliantbleep…` or a dedicated domain, to be decided).

### 16.1 Content for musicians

- **Landing page.** What Beautiful Bleep is, the "one modular board for your whole Live set" pitch, short videos and GIFs of patching in action.
- **Module pages.** One page per module, with description, controls, example patches and audio demos.
- **Getting started.** Installation, first board in five minutes, the board, ports and cells.
- **Ableton integration guides:**
  - MIDI In and MIDI Out routing;
  - audio ports and their latency;
  - macros and automation;
  - the virtual-loopback CC workaround (IAC / loopMIDI);
  - later, the M4L Bridge and Extensions companion tools.
- **Patch library.** Downloadable cell presets and example Live sets; later, community-submitted cells.
- **Tutorials and recipes.** For example "LFO modulating LFO", "build a poly synth with a Voice Cell", "generative melodies with Random + MIDI Out", "slow drift for ambient textures".
- **Browser playground (later).** A web version of the board with a few modules (e.g. Function + Utility + Oscillator + Filter) to try patching without installing anything.

### 16.2 Content for developers

- **Developer landing page.** What the open standard is, why to adopt it, and how to start in 15 minutes.
- **Quickstart, API reference and specification** (section 15.3) as readable pages, plus their **raw single-file versions** at stable URLs and an `llms.txt` index for coding AIs.
- **Specification** with version history and changelog; older spec versions remain available.
- **SDK downloads** (links to the GitHub releases) and reference examples.
- **Conformance suite.** How to run it and how to obtain the "Bleep Bus compatible" badge.
- **RFC process.** How to propose changes, with a list of open and accepted RFCs (mirrored from GitHub).

### 16.3 Shared and community

- **Compatible plugins registry.** Searchable list of Bleep Bus plugins from all vendors, with filters (sender/receiver, format, free/paid).
- **News / changelog / blog** for releases, spec updates and showcases of third-party plugins.
- **Community links:** GitHub, Discord or a forum, and a newsletter signup.
- **FAQ and support,** with a clear split between user support (Brilliant Bleep products) and developer questions (public GitHub issues).

### 16.4 Requirements

- **Docs as code.** Docs live in the same repository as the SDK (`website/content/`, section 17) and are built and deployed by CI, so the website, docs and SDK never drift apart.
- **No login** for any documentation, spec or SDK download (consistent with section 15).
- **Fast, searchable, mobile-friendly.** Full-text search across docs.
- **Bilingual later:** English first, German as an option.

## 17. Repository structure

Everything lives in **one repository**, in three clearly separated top-level folders, one per part of the project.

```
bleep/
├── README.md                  Short overview: the three parts, links to the website
├── bus/                       Bleep Bus: the open standard library external plugins use
│   ├── README.md              Short: what it is, build, link to developer docs
│   ├── LICENSE                MIT
│   ├── include/bleep_bus.h    The stable C API (thoroughly commented)
│   ├── src/                   Implementation (shared memory, registry, buffers)
│   ├── wrappers/              C++/JUCE module, CLAP/iPlug2-friendly wrapper
│   ├── examples/              Minimal sender, minimal receiver, attenuverter
│   └── conformance/           Test host and validator
├── patch/                     Beautiful Bleep: one plugin bundle
│   ├── README.md              Short: what's in the bundle, build, link to user docs
│   ├── engine/                Shared engine: graph, scheduling, cells, Voice Cells, state, undo
│   ├── board/                 The board window: canvas, Add menu, module views, panels
│   ├── app/                   The standalone Bleep App (section 11)
│   ├── common/                Shared UI and DSP: mod rings, cables, scopes, filters, smoothing
│   ├── modules/               Board modules (not plugins)
│   │   ├── function/
│   │   ├── lfo/
│   │   ├── random/
│   │   ├── utility/
│   │   ├── filter/
│   │   ├── oscillator/
│   │   ├── step-sequencer/
│   │   ├── noise/
│   │   ├── ring-drums/
│   │   ├── punch-drums/
│   │   └── amp/
│   └── bridges/
│       ├── ableton/           Bleep Board, Bleep Panel and port plugins (MIDI In/Out, Audio In/Out, Instrument, Insert)
│       ├── standalone/        The app's bridges: audio device, virtual MIDI ports, Ableton Link, Bleep Audio Bridge
│       └── …                  Later: M4L, Extensions SDK tools, OSC, CV, VCV
├── website/                   The Beautiful Bleep homepage
│   ├── README.md              Short: how to run and deploy
│   ├── app/                   Site code (same stack as the Brilliant Bleep site)
│   └── content/
│       ├── users/             Getting started, board, ports, cells, modules, guides, tutorials
│       ├── developers/        Quickstart, API reference, conformance, RFC process
│       └── spec/              Specification, one folder per version
├── tools/                     Build scripts, docs generator (single-file versions, llms.txt)
└── .github/workflows/         CI: build plugins, run conformance, build and deploy docs
```

**Dependency rules (enforced in CI):**
- `bus/` depends on nothing else in the repository. It must build and be usable on its own.
- `patch/` uses `bus/` only through its public API (`include/`), exactly as a third-party developer would, for everything that talks to external plugins. Inside the bundle, the engine and ports talk in-process. This keeps the open standard honest: if Brilliant Bleep needs a private shortcut to reach external plugins, the public API is missing something.
- `patch/modules/` depends only on `patch/common/` and the engine's module interface, not on the board UI or the ports.
- `website/` reads from `bus/` (headers, examples) and `patch/` (module metadata) only to generate documentation. Nothing depends on `website/`.

**READMEs are short.** Every README says what the folder is, how to build or run it, and links to the matching website section. All real documentation lives in `website/content/`.

**Licensing.** For now, **everything in this repository is released under the MIT license**: the bus, Beautiful Bleep, the website and the docs. The repository is fully public. Every folder carries a `LICENSE` file, and every source file has an SPDX header (`SPDX-License-Identifier: MIT`).

Plugins under other licenses, including commercial ones, live **in separate repositories** and use the bus through its public API, exactly like any third-party developer. This applies to Brilliant Bleep's own commercial products (Grit, Cinch, Hum, …) as well as to plugins from other vendors. The MIT license on the bus explicitly allows this.

## 18. More bridges and interoperability (future work)

> **Status: future work.** Nothing in this section is part of the first releases. It describes how the board can later connect to external systems, so that early design decisions don't block it.

The Ableton bridge (section 6) is the first bridge. Further bridges connect the board to established standards the same way: each is a family of nodes on the board.

| Bridge | What it connects | Notes |
|---|---|---|
| **OSC bridge** | TouchOSC, Max, Pure Data, SuperCollider, TouchDesigner, game engines, lighting software, custom apps | OSC is packet-based (UDP) and not sample-accurate, so it's an edge gateway, never the internal transport. Node and jack names follow an OSC-compatible address scheme (`/bass/function1/a`) so they map one to one. |
| **VCV Rack bridge** | The largest software-modular community; inside Live via VCV Rack Pro | A Rack module that appears on the board as a node. The Rack SDK is GPLv3: either open-source the bridge or obtain a commercial license from VCV. |
| **CV bridge** | Real Eurorack hardware via DC-coupled audio interfaces (e.g. Expert Sleepers) | Virtual volts (1.0 = 1 V/oct for pitch, bipolar ±1 ≈ ±5 V, gate high at 0.5) map directly to real voltages. |
| **MIDI extensions** | MPE synths, high-resolution MIDI receivers, future MIDI 2.0 hosts | MIDI In/Out ports gain MPE (per-note pitch bend, pressure, slide), 14-bit CC / NRPN, and MIDI 2.0 / UMP as hosts adopt it. MPE maps naturally onto the `notes` type and Voice Cells. |
| **M4L bridge** | Any Live or third-party parameter (Suite) | `live.remote~`; see section 5.8. |
| **Ableton Link** | The standalone app (section 11.4), the browser playground, hardware bridges | Not needed inside plugins (the host provides transport). Link is GPLv2-or-later for open source; closed-source use needs a license from Ableton. |
| **Network bridge** | Board signals between computers on a LAN | E.g. via OSC or a dedicated protocol, with discovery via mDNS/DNS-SD. Latency and clock-sync caveats apply. |
| **Other plugin ecosystems** | CLAP hosts with native parameter modulation (e.g. Bitwig) | Map board signals onto CLAP's non-destructive parameter modulation where the host supports it. |

**Design decisions to make now, so these stay possible later:**
- **Signal conventions** are defined in virtual volts from v1.
- **Node and jack names** follow an OSC-compatible address scheme from v1.
- **Bus extensions** use versioned, string-ID'd extensions (as in CLAP), so bridges can declare what they support.
- **The `notes` type and the MIDI ports** use high-resolution, per-note values internally, so MPE and MIDI 2.0 can be added without a rewrite.

## 19. Roadmap

| Phase | Content |
|---|---|
| **0: Technical prototype** | Plugin bundle with two ports and the shared engine in Live: block claiming, port latency, timing and jitter under different buffer sizes, thread loads and offline export. Port latency reporting and Live's delay compensation. Board window as a non-host top-level window (focus, keyboard, hide/show) on macOS and Windows. Main-plugin persistence across save/load, track duplication, copy/paste between sets and undo in Live. Test MIDI ports as instrument vs. effect. |
| **1: Core release** | Engine, board (nodes, cables, cells, floating module views, undo, cell presets), Ableton bridge (Bleep Board with macros, MIDI In, MIDI Out, Audio In, Audio Out, Bleep Instrument, Bleep FX). Modules: Function, Utility, Random, Filter. Bus v1 spec, open SDK, developer docs, conformance suite, **Beautiful Bleep homepage**. Bus inputs in Grit and Cinch. |
| **2: Synthesis and expansion** | Voice Cells, Oscillator, Multi Filter, VCA, ADSR, CV to Notes, MIDI Device (standalone); panels stage 1 (combined module views, shown in the board, in port plugin windows and in the **Bleep Panel** plugin); Oscillator, Amp/Mixer; Clock, Drift, Morph; native bus inputs across the Brilliant Bleep line; patch library on the homepage. |
| **2b: Standalone** | The Bleep App (section 11): projects, device bridge, virtual MIDI ports, Bleep Audio Bridge, Ableton Link node. |
| **3: Live bridge** | M4L Bridge device (`live.remote~`); Extensions SDK companion tools (routing setup, render-to-automation). |
| **4: Beyond** | Panel controls (encoders, faders, XY pads with multi-target mappings), custom-programmed HTML/JS views, MIDI-learn for panels; multi-core engine, "tight feedback" cells, audio over Bleep Bus, MPE, CLAP per-voice modulation in supporting hosts, community registry, community patch library and browser playground. |
| **5: Interoperability** | Further bridges from section 18: OSC, VCV Rack, CV, MIDI 2.0, network bridge. |

## 20. Risks and open questions

- **Engine ticking in Live.** The engine assumes that, for each audio buffer, Live calls `process()` on all active Bleep plugins with the same transport position, and that the first call can safely process the board. Phase 0 tests this with a logging prototype (block positions, thread IDs, call order) under:
  - different buffer sizes and heavy CPU load;
  - offline export, freeze and flatten;
  - deactivated devices and tracks (forum reports say a switched-off device may still be processed, so ghost detection can't rely on `process()` stopping);
  - Live's delay compensation with latent plugins on some tracks (do all tracks still get the same transport position per buffer?);
  - tempo changes, loop jumps and transport stop.
- **Port latency compensation.** Section 5.3 relies on Live compensating the latency reported by Audio Out, Bleep Instrument and Bleep FX. Phase 0 verifies this, including during export.
- **Board persistence.** Main-plugin model (section 5.4): verify duplication, copy/paste between sets and Live's undo in phase 0.
- **Board window.** A non-host top-level window may misbehave in some Live versions (focus, z-order, full-screen, multiple monitors).
- **Bleep Audio Bridge deadline.** The app must process each block within one buffer, in another process (section 11.6).
- **CPU.** One thread for the whole board until the multi-core engine exists. Large Voice Cells may hit this early.
- **Offline rendering.** The engine must behave deterministically when Live exports faster or slower than real time.
- **Spec stability vs. speed.** Opening the spec early invites adoption but makes changes costlier. Mark v0.x as experimental.
- **Naming and trademarks.** Final product and protocol names; avoid any confusion with existing modules or brands.
- **Support burden** of an open standard (issues, RFCs, third-party bugs that look like ours).

## 21. Legal note on inspiration

The modules are inspired by general concepts common in modular synthesis. No module reproduces a specific hardware module's panel layout, name, branding or exact feature combination. Where open-source firmware or plugin code is used as a reference or ported, its license is checked per file and respected: the module names the source in `module.json` (`origin`) and in its doc, keeps the original license (copyleft stays copyleft) and ships the license text. The rules are in `patch/modules/README.md`, "Ported code and licences", and CI enforces them.
