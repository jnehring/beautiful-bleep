# Building the Bleep Live Link device (Max for Live)

A recipe for the four-row device: a **Channel** menu, and per row a **Map** toggle, a **×** button and a **state** text. The **Map
button** is the status line: it shows the parameter's name. It is the prototype you already built (`udpreceive` → `live.map` →
`live.remote~`), wrapped in four rows around `live-link.js`. Nothing here has been run in Live by the person who wrote it;
section 7 lists what to check. Background: [`doc/specs/live-link.md`](../../../../doc/specs/live-link.md).

Needs Live Suite (Max for Live). The logic is `live-link.js`, tested outside Max (`node live-link.test.mjs`).

**What the device does, in one paragraph.** The *board* decides each row's value: a row of the Live Params node is a knob that
cables can feed, scaled into its Min..Max, and it arrives as a position `0..1` within the Live parameter's own range (`-1` means
the board no longer drives the row). The device only writes it: a continuous parameter through `live.remote~`, a discrete one
(a switch, a menu) with `set value`. When you map a row, the device tells the board what it is (name, continuous or discrete, its
range and its choices), and the board moves the row's knob to the parameter's position, so nothing jumps. There is no base value
and no amount dial in the device any more: the knob is the base, and the cable's amount is the depth.

## 0. Before you start

1. In Live, add a **Max Audio Effect** to a track and click **Edit** to open it.
2. Save it as `Bleep Live Link.amxd` **in this folder**, next to `live-link.js`, so `js live-link.js` finds the file. Close any
   other editor window that has `live-link.js` open, so it cannot write old text back.
3. `plugin~` → `plugout~` stay connected (left to left, right to right), or the track goes silent.

Objects are made with **N**, typed, **Esc**. **Cmd+E** toggles edit and locked. To set an attribute, select the object and
press **Cmd+I** (Inspector).

## 1. The top level of the patch

```
live.thisdevice ──► [ bang ] ──► live.menu "Channel"
live.menu "Channel" ─ left outlet (index 0..7) ─► [ t i i i ]
     [ t i i i ] right  ─► [ + 9871 ] ─► [ prepend port ] ─► udpreceive 9871
     [ t i i i ] middle ─► [ + 1 ] ─► [ prepend channel ] ─► each row's SECOND inlet (the row's js)
     [ t i i i ] left   ─► [ + 1 ] ─► [ / bleep/hello $1 ( ] ─► udpsend 127.0.0.1 9880
udpreceive 9871 ─► route /bleep/param ─► route 0 1 2 3 ─► row 1 … row 4 (one outlet each, into each row's FIRST inlet)
each row's js outlet 9 ─► udpsend 127.0.0.1 9880        (what the row is mapped to: /bleep/info)
```

- **Channel menu:** `live.menu`. Inspector → *Parameter* → *Type* **Enum**, *Range/Enum* `1 2 3 4 5 6 7 8`, *Long Name*
  `Channel`, *Parameter Visibility* **Stored Only**. Its left outlet is the index (0 to 7).
- **`[t i i i]` fires right to left:** the port changes first, then each row learns its channel, then the hello is sent.
- **Port:** channel *c* listens on `9871 + c − 1`, which is why `+ 9871` on the index. Check that `udpreceive` accepts a
  `port` message (right-click it → *Open udpreceive Help*). **If it does not,** replace it by scripting:
  `thispatcher` with the messages `script delete rx`, then `script newdefault rx 20 200 udpreceive <port>`, then
  `script connect rx 0 <route> 0`.
- **Hello:** `/bleep/hello $1` goes out through `udpsend 127.0.0.1 9880` (`udpsend` formats messages that start with `/` as
  OSC; check it with `osc_test.py watch`, section 6). The board then sends this channel's rows again.
- **`route /bleep/param`** removes the address. What is left is `row value`, e.g. `1 0.31`. **`route 0 1 2 3`** then sends the
  value alone out of the outlet of that row. The value is a position `0..1`, or `-1`.

## 2. One row (a subpatcher)

Make `[p row]` with **two** inlets (1: the board's value, 2: the channel) and one outlet (the info for `udpsend`). Build the row
inside it; then copy it three times.

Objects inside:

| Object | Settings | Does |
|---|---|---|
| `inlet` ×2 | | 1: the board's value (a float); 2: `channel <n>` |
| `js live-link.js` | | the row's logic; all of its ten outlets are used |
| `live.thisdevice` → message `row #1` | `#1` is the row's number 1..4 (the bpatcher's argument; in a `[p row]` type the number) | tells `js` which row it is, once, at load |
| `live.text` "Map" | *Mode* **Toggle**, *Text* `Map`, *Text On* `Mapping...`, **Parameter Mode Enable off**; make it wide enough for a parameter name (about 150 px) | mapping mode on or off, and the row's status line: `js` sets its texts |
| `live.text` "×" | *Mode* **Button**, *Text* `×`, **Parameter Mode Enable off** | unmap this row |
| `live.map` | | picks the Live parameter |
| `live.object` | | reads and sets that parameter |
| `sig~`, `live.remote~` | | drives a continuous parameter |
| `comment` (optional) | | the state of a discrete row (on/off, or the item). The status and the name labels are not needed: the Map button shows the name |
| messages | `mapping $1`, `unmap`, `row #1` | see below |

Connections (all of them; the numbers are outlets from the left, starting at 0):

| From | To | Why |
|---|---|---|
| inlet 1 | `js` | the board's value |
| inlet 2 | `js` | `channel <n>`: for the info the row sends |
| `live.thisdevice` left outlet | message `row #1` → `js` | which row this is (1..4) |
| `live.text` Map | message `mapping $1` → `live.map` left inlet | mapping mode |
| `live.map` outlet **1** (the id) | `js` | `id <n>`, exactly as you wired it |
| `js` outlet 0 | `sig~` → `live.remote~` **left** inlet | a continuous parameter's position |
| `js` outlet 2 | `live.remote~` **right** inlet | `id <n>`, or `id 0` to release |
| `js` outlet 3 | `live.object` **right** inlet | the id to read and set |
| `js` outlet 4 | `live.object` **left** inlet | `get …` and `set value …` |
| `js` outlet 5 | `live.map` left inlet | `unmap`, and `mapping 0` once a parameter is mapped |
| `js` outlet 6 | comment **state** (it sends `set <text>`) | "on"/"off", or the item name |
| `js` outlet 8 | `live.text` Map, its left inlet | the Map button follows the row: its look, whether it can be clicked, and its texts. See below |
| `js` outlet 9 | the row's outlet → `udpsend 127.0.0.1 9880` | `/bleep/info …`: what the row is mapped to, for the board |
| `live.object` outlet | `js` | its answers: `min`, `max`, `value`, `is_quantized`, `value_items`, `name` |
| `live.text` × | `[t b b]` | unmap |
| `[t b b]` outlets | message `unmap` → `js` **and** message `unmap` → `live.map` | what `×` does. `js` itself turns the Map button off and clickable again (outlet 8) |
| `js` outlets 1 and 7, and `live.map`'s name outlet | *nothing*: leave them unconnected | the status and the name label are not needed (`js` still sends them if you want a comment for debugging) |

Check each name: the `live.map` outlet numbers are the ones you used in the prototype (the id on the second outlet, the
name on the third); if yours differ, keep what worked.

**No type menu.** A row asks Live what it was mapped to: `get is_quantized` is 0 for a continuous parameter (`live.remote~`)
and 1 for a discrete one (a switch or a menu: `get value_items` gives the names, and the board's 0..1 position picks the
item). A switch is a menu of two items.

**What happens when you map a row.** `js` reads the parameter's own position and holds the parameter there (no jump), then tells
the board (`/bleep/info …`, with "adopt"): the board moves the row's knob to that position, and for 300 ms the device ignores the
board's values while it does. Afterwards the board's value is the position. Unmapping, or the board sending `-1` (its node was
deleted or moved to another channel), puts the parameter back where it was when you mapped it.

**The Map button** is driven by `js`, so that it can only be used the way you want. Give it the texts *Map* and *Mapping...* in the Inspector; `js` changes them as it goes:
- **Unmapped:** dark, says **Map**, clickable. Click it, then click a parameter in Live. While it waits for the click it is yellow and says **Mapping...**.
- **Mapped:** it stays yellow, says the **parameter's name** (for example *Frequency*), and cannot be clicked (`active 0`), and `js` ends mapping mode in `live.map`, so clicking another parameter
  in Live does not remap the row.
- **×:** the only way back. It makes the button dark and clickable again (`active 1`, then `0`, which also sends
  `mapping 0` to `live.map` through the toggle's own `mapping $1`). Then click Map again.
- If the click cannot be mapped, the button stays yellow and says **not mappable**, still clickable, so you can try again. If `live.object` never answers, it goes dark and says **no answer**.

## 3. Four rows

1. Copy `[p row]` three times (select, **Cmd+C**, **Cmd+V**), and change the `row #1` message in each copy to 2, 3 and 4.
2. Connect the outlets of `route 0 1 2 3` to the first inlets of row 1 to row 4, the channel chain to their second inlets, and
   their outlets to the one `udpsend 127.0.0.1 9880`.

## 4. Presentation view (what the device shows in Live)

For each of these, right-click → **Add to Presentation**, then press **Cmd+Alt+E** to switch to presentation view and place them:

- the **Channel** menu once at the top;
- per row: Map (it shows the name), the state comment, ×.

Objects inside a subpatcher are not shown in the device unless the subpatcher is a `bpatcher`. **Use `[bpatcher]` instead
of `[p row]`:** save the row as `ll-row.maxpat` in this folder, and put `bpatcher ll-row.maxpat` four times with the
*Argument* `1`, `2`, `3`, `4`, and `row #1` in the message box. That shows the row in the device and gives each row its number
for free. If you start with `[p row]`, move to a `bpatcher` once the logic works.

Live limits a device's height: the line **Device vertical limit** in the editor shows it. Four rows of about 30 pixels
and a header fit under it.

Suggested row (left to right): the Map button about 170 px (it shows the parameter's name), the state text 90 px, × 18 px.

## 5. Save

**Cmd+S** in the Max editor. Keep `live-link.js` next to the device. **File → Freeze Device** copies the script into the
`.amxd`, which is what you would share; do that last, as a frozen device is not editable.

## 6. Check it with the test script

The test script stands in for the board (`osc_test.py`; it sends positions `0..1`, not offsets). With Live's audio engine on and
Bleep Board **not** running (or its Live Params node on another channel), so the script is the only sender:

| Check | Do | Expect |
|---|---|---|
| Load | Add the device | no errors in the Max console |
| Dial | Row 1: Map, click Auto Filter's Frequency. `osc_test.py sine 0 --amp 0.2` | the status shows the parameter's name; the frequency swings between 30% and 70% of its range; Ctrl-C puts it back where it was |
| Position | `osc_test.py set 0 0.5`, then `set 0 0` and `set 0 1` | the frequency goes to the middle, the bottom and the top of its range |
| Release | `osc_test.py release 0` | the parameter goes back to where it was when you mapped it |
| Switch | Row 2: Map, click a device's on/off. `osc_test.py on 1`, then `off 1` | the device switches; the state text says *on* then *off* |
| Menu | Row 3: Map, click Filter Type. `osc_test.py item 2 0`, `item 2 1`, `item 2 3` (a menu of 4 items; for another size add it: `item 2 1 6`) | the first, the second and the last item; the state text shows their names |
| Channel | Set the Channel to 2. `osc_test.py sine 0 -c 2` | the row moves on channel 2 only |
| Hello | `osc_test.py watch`, then change the channel | it prints `hello: the device on channel N (re)started` |
| Info | `osc_test.py watch`, then map a row | it prints the channel and row, *continuous* or *discrete*, the name, the range, and for a discrete parameter its choices; × prints *not mapped* |
| Reload | Save the set, quit Live, reopen | the mappings and the Channel are still there |

With the board: Bleep Board, a **Live Params** node on the device's channel, a source cabled into a row's **CV** input (or onto its
knob). After you map a row, the node's view shows what it is mapped to, and its knob jumps to the parameter's position.

## 7. Open points to look at

- **Mappings after a reload:** it is not known whether `live.map` sends the id again when the set loads. If it does, `js` reads the
  parameter's position again and tells the board, which moves the knob there; that may be a driven position, not the one you set.
  Check after reopening.
- **A board that starts after the device, or whose port 9880 was busy:** the device repeats each mapped row's report every 2 seconds, so the node
  catches up by itself. (A leftover `osc_test.py watch` holds port 9880 and keeps the board from hearing anything: stop it.)
- **`channel in use`:** two devices on one channel is not detected; the second one silently receives nothing.
- **`udpreceive` `port` message:** see section 1.
- **The first 300 ms after mapping** ignore the board's values (they would be the knob's old position). If the board is slow to
  answer, the parameter may jump once afterwards; tell me and the time can change.
