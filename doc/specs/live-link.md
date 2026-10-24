# Bleep Live Link

Status: the board side (the Live Params node with its view, the sender, the engine calls), the device's logic
(`live-link.js`, 46 tests outside Max) and a one-row device prototype are built and were tried in Live. The four-row device
and the new board-driven model (below) have not been built in Max or tried in Live together. Sections 6 and 7 list what was
tried and what is open.

Bleep Live Link is a Max for Live device (Suite only) that lets the board modulate, switch and select parameters of Ableton
Live, or of any plugin in the set. It is the "M4L bridge" of [specs.md §5.8](specs.md). Without Max for Live, use the MIDI Out
workaround described there.

**The model.** The *board* decides each row's value. A row of the Live Params node is a **knob that cables can feed** (the board's
usual "knob plus cables"), with a **Min** and a **Max** that scale it into part of a continuous parameter's range. The device
only writes the value: a position `0..1` within the Live parameter's own range. When a row is mapped, the device **tells the
board what it is mapped to** (name, continuous or discrete, range, choices), and the board shows it in the node's view and moves
the row's knob to the parameter's position, so nothing jumps. There is no base value and no amount dial in the device.

## 1. Pieces

| Piece | Where | State |
|---|---|---|
| **Live Params** node: a *Channel* setting (1–8) and four rows, each a knob with a Min and a Max and a CV input jack that adds to the knob (cables can also go straight onto the knob) | board, built into the engine (`patch/engine/PortModules.cpp`, with the ports) | built |
| Mailbox: 8 channels × 4 rows of absolute values (0..1, or -1: not driven); a flag per row for "discrete" | engine, `LiveParams.h` | built |
| `IEngine::liveParams()` (ABI minor 3): the plugins read the values through the shared engine | `EngineApi.h` | built |
| `IEngine::setLiveRowInfo()` (ABI minor 4): a device reports what a row is mapped to; the engine keeps it and moves the node's knob | `EngineApi.h`, `Engine.cpp` | built |
| The node's **view**: per row the name, continuous or discrete, for a discrete one its choices and the value that picks each | `board/ui/live-params.js`, text from `Module::liveText` | built, shown in a browser with a made-up state; not yet seen in the plugin |
| **Sender**: Bleep Board, 100 Hz, OSC over UDP; reads the devices' `/bleep/info` | `bridges/ableton/LiveLinkSender.*`, `LiveLinkOsc.h` | built |
| **Device**: 4 rows, one channel; receives the OSC, owns the mappings, drives `live.remote~` (continuous) or `set value` (discrete), reports to the board | `.amxd`, on any track, up to eight of them; logic in `live-link.js` | logic built and tested; one-row prototype tried in Live (the older offset model) |

The standalone app has no Live Params sender yet; with the board in the app (Board = App) the node publishes, but
nothing sends. Add the same sender there once the device works.

## 2. Protocol

OSC 1.0 over UDP, localhost only. Packets are one message each.

A device has **4 rows** and a **channel** (1..8). A UDP port can be bound only once, so each channel has its own: channel *c*
listens on port `9871 + c − 1`. Board row *k* (0..31) belongs to channel `k ÷ 4 + 1` as row `k mod 4`; so a board has up to eight
channels (one Live Params node and one device each), 32 rows. Two devices on one channel cannot both listen.

| Direction | Port | Message | Meaning |
|---|---|---|---|
| board → device | 9871 + channel − 1 | `/bleep/param ,if <row 0..3> <position>` | The row's position, 0..1 within the Live parameter's own range (a menu: 0 is the first choice, 1 the last). Sent when it changed by 0.0005 or more. |
| board → device | 9871 + channel − 1 | `/bleep/param ,if <row> -1.0` | Sent once when no node drives the row any more (the node was deleted or changed channel): let the parameter go, put it back. |
| device → board | 9880 | `/bleep/hello ,i <channel>` | The device (re)started or was loaded: send that channel's rows again. |
| device → board | 9880 | `/bleep/info ,iis…` | What a row is mapped to, see below. |

`/bleep/info` arguments, in order: `channel` (i), `row` (i), `kind` (s: `continuous`, `discrete` or `none`), `name` (s), `current`
(f: the parameter's position 0..1 when it was mapped), `min`, `max` (f: its own range), `adopt` (i: 1 right after mapping), then for
a discrete parameter its choices, one string each. `none` ends after the kind: the row is not mapped. Max sends whole numbers as
ints and a name like "4" as a number, so every argument is read as either. The board moves the node's row knob to `current` when
`adopt` is 1; the device ignores the board's values for 300 ms meanwhile, so the parameter does not jump. While a row is mapped the
device repeats its report every 2 seconds (with adopt 0), so a board that started later, or whose port was busy, catches up.

`patch/bridges/ableton/live-link/osc_test.py` plays either side: it sends the board's `/bleep/param` (`--channel` picks the
device), plays the device's `/bleep/info` to a running board (`info`), shows what the board sends (`listen`) and what the devices
send (`watch`).

## 3. What the device does

4 rows, and a **Channel** menu (1–8, a `live.menu` stored with the set) that picks which rows of the board the device serves and
which UDP port it listens on (section 2):

```
 Channel [1 ▾]
 1  [ Frequency        ]  [x]          the locked Map button shows the parameter's name
 2  [ Filter Type      ]  Highpass  [x]
 3  [ Map              ]               not mapped yet
 4  [ Map              ]
```

- **Map** (a `live.map` object): the user presses it, then clicks a parameter in Live. The button then shows the parameter's
  name, is locked, and only × lets go of it. Mappings are saved with the set.
- **Two kinds of parameter.** The row asks `live.object` for `is_quantized`. Continuous (0): the position goes to `live.remote~`,
  whose 0..1 is the parameter's whole range. Discrete (1): `get value_items` gives the choices, and the position picks one,
  `min + round(position × (max − min))`, set with `set value` only when it changes. A switch is a menu of two choices.
- **Mapping holds the parameter where it is**, reports to the board (`/bleep/info` with adopt), and ignores the board's values for
  300 ms while the board moves the node's knob there.
- **Release**: × (or the board sending -1) puts the parameter back where it was when it was mapped. While a continuous row is
  driven the knob does not follow the user's mouse; that is how `live.remote~` works and is also why nothing is written to
  automation or undo.
- **Hello**: on load, and when the channel changes, the device sends `/bleep/hello`; it also tells the board its rows again.
- **No sound**: the device passes audio through untouched; it is an audio effect so it can sit on any track.
- **Speed**: about 100 values per second per row. Modulation, not audio rate (`live.remote~` is control rate in Live).

Parameters that were found not to work: song-level ones (Tempo, which was disabled, Solo, which `live.map` refuses). Not in the
first version: more than 4 rows per device, mapping a row to several parameters, a custom curve per row, trigger rows.

## 4. Failure behaviour

- Board not running or the sender not bound: the device receives nothing; mapped parameters stay where they are.
- Device not loaded: the board's `sendto` to a closed UDP port is ignored. Nothing is reported, and nothing breaks.
- Two devices on one channel, or two Live instances on one machine: the ports are fixed, so the second device cannot bind its
  port and gets nothing; it shows "channel in use". For now there is one Live per machine.
- Two Live Params nodes on one board: the last one to run wins (the mailbox is one per process).

## 5. Building the first prototype (the older model: the device added an offset to a base)

In Live (Suite) with Max for Live:

1. Create a Max Audio Effect, open it for editing.
2. `[udpreceive 9871]` → `[oscparse]` → `[route /bleep/param]` → `[unpack i f]`. Print the result with `[print]` and
   start `osc_test.py sine 0`: the Max console should show `0 <offset>` at 100 Hz.
3. `[route 0 1 2 …]` splits by input. Per row, `[live.map]` → `[live.remote~]` (right inlet takes the id from
   `live.map`), and the offset goes into a `[sig~]` → `[live.remote~]` left inlet after `base + offset`.
4. For the base: read the parameter once with `[live.object]` (`get value`) when `live.map` reports an id, and on
   release.
5. Send `/bleep/hello 1` (the channel) through `[udpsend 127.0.0.1 9880]` from `[loadbang]`.

Then run the test script:

```bash
python3 patch/bridges/ableton/live-link/osc_test.py sine 0
```

The mapped parameter should swing around its knob position and return to it with `osc_test.py release 0`.

### 5.1 What the first prototype showed (2026-10-22, Live Suite, by hand)

- The packets arrive in Max as plain messages: `udpreceive 9871` (channel 1) gives `/bleep/param <row> <value>` directly. There is no
  `oscparse` in the chain; `udpreceive` → `route /bleep/param` → `unpack 0 0.` is enough.
- **`live.map` is not a button.** It is an invisible helper with two attributes, *Mapping Mode Enabled* and *Disallow Mapping
  to This Device*. The Map button is the device's own: a `live.text` (toggle, text "Map") → message `mapping $1` →
  `live.map`. While it is on, clicking a parameter in Live maps it; the message `unmap` releases it. `live.map`'s
  **second outlet** gives the parameter's id: it goes to `live.remote~`'s right (id) inlet. The third outlet gives the
  name, which the device shows. (The left outlet is not the id; connecting it there is the mistake that made nothing move.)
- `live.map` printed "could not acquire device path" until the device was saved and added to the track again.
- **It works.** `osc_test.py sine 0` moves the Auto Filter's frequency, and any other parameter that is mapped.
- `live.remote~` needs a signal in its left inlet (`sig~`); `snapshot~` shows it, a number box on `sig~` does not.

## 6. Open questions: answers from the prototype (2026-10-22)

| # | Question | Answer |
|---|---|---|
| 1 | Range of the input | `live.remote~` takes 0..1 and covers the parameter's full range. Section 3's scaling holds. |
| 2 | Reading the base while remoted | `get value` returns the **driven** value while `live.remote~` holds the parameter (it changed with the script), and `set value` is refused ("parameter is disabled"). So the base is read **before** the remote is attached, on a scale of `get min` … `get max` (Auto Filter Frequency: 0 … 1). Built in `live-link/live-link.js`, tested outside Max; not yet tried in Live. |
| 3 | Third-party plugins | Works: VST3 parameters are driven, continuous and discrete ones. VST3 parameters have to be configured in Live first (Configure); that is the rule, so unconfigured ones are out of scope. |
| 4 | Smoothness | 100 values per second per row is smooth on a filter sweep. No interpolation needed. |
| 5 | Parameters that refuse | Only continuous parameters ("dials") work reliably. Refused or wrong: Auto Filter *Filter Type* (menu, does not change), a track's *Activator* (stays off), Delay *Sync* (stays at 1), a speaker on/off switch (stays off), *Solo* (Map does not accept it), song *Tempo* (jumps to its minimum, 20, and stays). Continuous parameters of Live devices, mixer dials and VST3 parameters, continuous and discrete, work. |
| 6 | Two rows to one parameter | Skipped. |
| 7 | Reload | The mapping survives saving the set, quitting Live and loading it again. |
| 8 | Automation and undo | The movement is **not** written as automation, and the undo history does not change. |

`live-link.js` was tried in Live with one row (2026-10-23): the status goes waiting → mapped, and with the parameter at 25% the
sine swings around 25% (it rests at the minimum while base + offset is below 0: that is the clamp, as designed).

Also tried: Ctrl-C returns the parameter to its base; the X button gives the knob back at the base; mapping a menu (Filter Type)
shows "not mappable", because `live.map` answers `id 0` for what it cannot map. The `is_quantized` check is a second guard,
not yet seen firing (a quantised parameter that `live.map` accepts).

Still to do: the four-row device with channel and name display; and the whole chain with a real board (Live Params node, Bleep Board's sender) in place of `osc_test.py`.

## 7. Testing

- Unit tests: `patch/tests/live_link_tests.cpp` (`ctest -R live-link`): what the sender sends and when, and the packet layout. And `live-link.js` with
  `node patch/bridges/ableton/live-link/live-link.test.mjs`.
- With the device: run `osc_test.py` in `sine`, `ramp`, `set` and `release` modes against one mapped row each; then the
  same from a real board: a Live Params node with an LFO cabled to *Row 1*, Bleep Board and the device in one set.
- Check: the knob position survives (the parameter returns to its base after `release`), no automation lane appears,
  and the undo history stays empty.

## 8a. Decisions (2026-10-23)

- **A Live Params node has a *Channel* setting (1–8) and four rows**, matching one device (4 rows, one channel). A board uses as
  many nodes as it has devices; two nodes on one channel are a mistake the node should show (not built). 8 channels, so 32 rows
  and a 32-value `liveParams()` call.
- **A row is a knob that cables can feed, with a CV input jack and a Min and a Max** (the board's usual "knob plus cables"). The
  knob is the base value, the cable's amount is the depth, and Min and Max scale a *continuous* row into part of the parameter's
  range. The device therefore has no base logic and no amount dial: it writes the position the board sends.
- **The device tells the board what a row is mapped to** (`/bleep/info`): the node's view shows the name, continuous or
  discrete, and for a discrete parameter every choice with the value that picks it. When a row is mapped, the node's knob moves to
  the parameter's position (adopt), so nothing jumps.
- **A menu row takes a 0–1 value** (0 is the first item, 1 the last). A "step" mode (a trigger moves to the next item) and one
  gate per option are possible later; the second does not fit long menus with only four rows.
- **A row has no type setting**: what it does follows from what it is mapped to. The row asks `get is_quantized`: 0 is continuous
  (`live.remote~`), 1 is discrete (`get value_items` gives the names; the board's 0..1 value picks the item). A switch is a menu
  of two items, since `round(value × 1)` is 0 below 0.5 and 1 from 0.5 up. Min and Max do not apply to a discrete row.
- **-1 is "no longer driven"**: when the node is deleted or changes channel, the device puts the parameter back.

## 8. Discrete parameters (mechanism tried by hand in Live; the logic is in live-link.js, tested outside Max)

`live.remote~` is for continuous values only, so a discrete parameter is set with `live.object` (tried by hand, 2026-10-23).

| Parameter | Board signal | Mechanism in the device | Notes |
|---|---|---|---|
| Continuous (`is_quantized` 0) | control | `live.remote~`, the position from the board | works (section 6) |
| Discrete (`is_quantized` 1): a switch, a menu | control, 0..1 → item | `live.object`, `set value <n>` when the item changes | **works** on a device on/off button and on Auto Filter *Filter Type*: `set value 0` is the first item, `set value 1` the second, …. `get value_items` lists the item names; `n = min + round(v × (max − min))`. Only on a change, never at 100 Hz |
| Trigger | trigger | `live.object`, `call fire` (clips, scenes), a function of the Live API | not written; transport, scene launch |

**`live.tab` and `live.menu` (Cycling '74 docs) are not these mechanisms.** Both are user-interface objects for the device's *own*
parameters: they show tabs or a dropdown and act as a Live parameter of this device (type Enum, Int or Float, with an item
list). Neither controls a parameter of another device; `param_connect` only reaches compatible Max objects such as `gen~`.
Use them for the device's own controls:

- the **Channel** menu (1–8), saved with the set;
- `rawfloat` (0..1) and `assign` set them from the patch; with Parameter Visibility "Stored Only", `assign` stays out of Live's
  undo chain.

`live-link.js` tells the two apart by itself (32 tests outside Max). A discrete row sets the parameter only when the board's value
changes the item, does not set it when it is mapped, and puts it back as it was when unmapped. A board value of 0 means off,
or the first item, so removing a cable also does that. Trigger rows are not written.

Questions to answer in Live before relying on these rows:

1. Can `live.map` pick a quantised parameter? A `live.object` mapped to an on/off button and to Filter Type could be set (above),
   but the dial prototype's row said "not mappable" (`id 0`) for Filter Type. Find out which of the two (the mapping click,
   or `live.map` in a row without `live.remote~`) makes the difference, and whether the id can come from `live.map` for these.
2. Does `live.object` `set value` on another device's switch or menu write undo steps or automation (it goes through Live's
   normal path, unlike `live.remote~`)?
3. ~~Does a gate or trigger cable fit a Live Params input?~~ Yes: the board only refuses cables to or from `notes` and patch bays
   (`compatible()` in `Spec.h`), so gates, triggers and controls all fit a `control` jack. The node keeps four plain `control` jacks.
4. Do `call fire` and similar functions work on a trigger row from a `live.object` that was picked with `live.map`?
