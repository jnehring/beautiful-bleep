# Bleep Live Link

Status: engine side and OSC sender are built; the Max for Live device is **not** built. Sections 6 and 7 list what
has to be tried in Live before the device is final.

Bleep Live Link is a Max for Live device (Suite only) that lets the board modulate parameters of Ableton Live, or of any
plugin in the set. It is the "M4L bridge" of [specs.md §5.8](specs.md). Without Max for Live, use the MIDI Out workaround
described there.

## 1. Pieces

| Piece | Where | State |
|---|---|---|
| **Live Params** node: 4 `control` inputs and a *Channel* setting (1–8) | board, `patch/modules/live-params/` | built |
| Mailbox: 8 channels × 4 rows; each node publishes its cabled inputs' last sample into its channel's rows | engine, `LiveParamsDsp.h` | built |
| `IEngine::liveParams()` (ABI minor 3): the plugins read the mailbox through the shared engine | `EngineApi.h` | built |
| **Sender**: Bleep Board, 100 Hz, OSC over UDP | `bridges/ableton/LiveLinkSender.*` | built |
| **Device**: 4 rows, one channel; receives the OSC, owns the mappings, drives `live.remote~` | `.amxd`, on any track, up to four of them | one row works as a prototype |

The standalone app has no Live Params sender yet; with the board in the app (Board = App) the node publishes, but
nothing sends. Add the same sender there once the device works.

## 2. Protocol

OSC 1.0 over UDP, localhost only. Packets are one message each.

A device has **4 rows** and a **channel** (1, 2, 3, 4). A UDP port can be bound only once, so each channel has its own:
channel *c* listens on port `9871 + c − 1`. Board input *k* (0..31) belongs to channel `k ÷ 4 + 1` as row `k mod 4`; so a
board has up to eight channels (one Live Params node and one device each), 32 rows. Two devices on one channel cannot both listen: the second shows "channel in use".

| Direction | Port | Message | Meaning |
|---|---|---|---|
| board → device | 9871 + channel − 1 | `/bleep/param ,if <row 0..3> <offset>` | The offset of the row. Sent when it changed by 0.0005 or more, and once when a cable is added. |
| board → device | 9871 + channel − 1 | `/bleep/param ,if <row> 0.0` | Sent once when the cable of the row is removed (or the node is deleted): release the parameter. |
| device → board | 9880 | `/bleep/hello ,i <channel>` | The device (re)started or was loaded: send that channel's rows again. |

Offsets are plain control values (not limited to 0..1). The sender never sends NaN or infinity.

`patch/bridges/ableton/live-link/osc_test.py` sends the same packets (`--channel` picks the device), so a device can be built
without the board.

## 3. What the device does

4 rows, and a **Channel** menu (1–4, a `live.menu` stored with the set) that picks which inputs of the board the device
serves and which UDP port it listens on (section 2):

```
 Channel [1 ▾]
 1  [Map]  Filter 1 Freq  (Wavetable)     amount ─●──  [x]
 2  [Map]  Track Volume                   amount ─●──  [x]
 3  [Map]  (waiting)
 4  [Map]  (waiting)
```

- **Map** (a `live.map` object): the user presses it, then clicks a parameter in Live. The row shows the parameter's
  name. Mappings are saved with the set (the device's `pattr` state), per row.
- **Base**: the parameter's own value when the row was mapped, or when its offset returned to 0. It is the position the
  user set; the device never changes it by itself.
- **Value sent to Live**: `clamp(base + offset × range)`, where *range* is a per-row amount control (default 1.0, i.e.
  an offset of 1.0 moves the parameter over its whole range). The cable amounts on the board scale the offset before it
  arrives, so the board decides the depth and the row amount is only a trim.
- **Release**: when a row gets offset 0 from an uncabled input, it stops driving the parameter (`live.remote~` receives
  `id 0`), so the user can move the knob again. While a row is driven the knob does not follow the user's mouse; that is
  how `live.remote~` works and is also why nothing is written to automation or undo.
- **Hello**: on load, and when a row's mapping changes, the device sends `/bleep/hello`.
- **No sound**: the device passes audio through untouched; it is an audio effect so it can sit on any track.
- **Speed**: about 100 values per second per row. Modulation, not audio rate (`live.remote~` is control rate in Live).

**Scope of the first version: dials only.** The device drives continuous parameters only. At map time it asks
`live.object` for the parameter's `is_quantized` property (to be confirmed in Live) and refuses a quantised one with a
message in the row ("dials only") instead of mapping it. Switches, menus, Solo, Tempo and other song-level
parameters are out of scope. A row whose parameter does not respond must show that it does not.

Not in the first version: more than 4 rows per device, mapping a row to several parameters, a custom curve per row, a MIDI or
audio input.

## 4. Failure behaviour

- Board not running or the sender not bound: the device receives nothing; mapped parameters keep their base value.
- Device not loaded: the board's `sendto` to a closed UDP port is ignored. Nothing is reported, and nothing breaks.
- Two devices on one channel, or two Live instances on one machine: the ports are fixed, so the second device cannot bind its
  port and gets nothing; it shows "channel in use". For now there is one Live per machine.
- Two Live Params nodes on one board: the last one to run wins (the mailbox is one per process).

## 5. Building the first prototype

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

Still to do: the four-row device with channel, type menu and name display; and the whole chain with a real board (Live Params node, Bleep Board's sender) in place of `osc_test.py`.

## 7. Testing

- Unit tests: `modules/live-params/tests/test_live_params.cpp` (what is sent and when) and `test_live_link_osc.cpp`
  (packet layout).
- With the device: run `osc_test.py` in `sine`, `ramp`, `set` and `release` modes against one mapped row each; then the
  same from a real board: a Live Params node with an LFO cabled to *Param 1*, Bleep Board and the device in one set.
- Check: the knob position survives (the parameter returns to its base after `release`), no automation lane appears,
  and the undo history stays empty.

## 8a. Decisions (2026-10-23)

- **A Live Params node has 4 inputs and a *Channel* setting (1–8)**, matching one device (4 rows, one channel). A board uses as
  many nodes as it has devices; two nodes on one channel are a mistake the node should show. Built (replaces the single
  16-input node); 8 channels, so 32 rows and a 32-value `liveParams()` call.
- **A menu row takes a 0–1 value** (0 is the first item, 1 the last). A "step" mode (a trigger moves to the next item) and one
  gate per option are possible later; the second does not fit long menus with only four jacks.
- The dial row's **amount** dial stays: the board's cable amount sets the depth, the amount is a per-row trim.
- All four jacks are `control`; the row type is chosen in the device, not on the node.

## 8. Other row types (mechanism tried by hand in Live; switch and menu rows are in live-link.js, not yet tried in Live)

First version: dials. The device should later offer a row type per row, so the board can also switch, select and trigger.
`live.remote~` is for continuous values only, so these rows use `live.object` (tried by hand, 2026-10-23, below).

| Row type | Board signal | Mechanism in the device | Notes |
|---|---|---|---|
| Dial | control | `live.remote~`, base + offset × range | works (sections 3 and 6) |
| Switch | gate | `live.object`, `set value 0/1` when the gate changes | **works** on a device on/off button. Only on a change, never at 100 Hz |
| Menu | control, 0..1 → step | `live.object`, `set value <n>` when the step changes | **works** on Auto Filter *Filter Type*: `set value 0` is the first item, `set value 1` the second, …. `get value_items` lists the item names; `n = round(v × (max − min))` |
| Trigger | trigger | `live.object`, `call fire` (clips, scenes), a function of the Live API | transport, scene launch |

**`live.tab` and `live.menu` (Cycling '74 docs) are not these mechanisms.** Both are user-interface objects for the device's *own*
parameters: they show tabs or a dropdown and act as a Live parameter of this device (type Enum, Int or Float, with an item
list). Neither controls a parameter of another device; `param_connect` only reaches compatible Max objects such as `gen~`.
Use them for the device's own controls:

- the **Channel** menu (1–4) and a **row type** menu per row (Dial / Switch / Menu / Trigger), saved with the set;
- `rawfloat` (0..1) and `assign` set them from the patch; with Parameter Visibility "Stored Only", `assign` stays out of Live's
  undo chain.

`live-link.js` has the row types `dial`, `switch` and `menu` (message `type <t>`; 21 tests outside Max). A switch or menu row sets
the parameter only when the board's value changes the state or the item, does not set it when it is mapped, and puts it back
as it was when unmapped. A board value of 0 means off, or the first item, so removing a cable also does that. Trigger rows
are not written.

Questions to answer in Live before relying on these rows:

1. Can `live.map` pick a quantised parameter? A `live.object` mapped to an on/off button and to Filter Type could be set (above),
   but the dial prototype's row said "not mappable" (`id 0`) for Filter Type. Find out which of the two (the mapping click,
   or `live.map` in a row without `live.remote~`) makes the difference, and whether the id can come from `live.map` for these.
2. Does `live.object` `set value` on another device's switch or menu write undo steps or automation (it goes through Live's
   normal path, unlike `live.remote~`)?
3. ~~Does a gate or trigger cable fit a Live Params input?~~ Yes: the board only refuses cables to or from `notes` and patch bays
   (`compatible()` in `Spec.h`), so gates, triggers and controls all fit a `control` jack. The node keeps four plain `control` jacks.
4. Do `call fire` and similar functions work on a trigger row from a `live.object` that was picked with `live.map`?
