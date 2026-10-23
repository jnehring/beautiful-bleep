# Building the Bleep Live Link device (Max for Live)

A recipe for the four-row device: a **Channel** menu, and per row a **type** menu, a **Map** toggle, a **×** button, an
**amount** dial, the mapped parameter's **name**, a **status** line and a **state** text. It is the prototype you already built
(`udpreceive` → `live.map` → `live.remote~`), wrapped in four rows around `live-link.js`. Nothing here has been run in
Live by the person who wrote it; section 7 lists what to check. Background: [`doc/specs/live-link.md`](../../../../doc/specs/live-link.md).

Needs Live Suite (Max for Live). The logic is `live-link.js`, tested outside Max (`node live-link.test.mjs`).

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
live.menu "Channel" ─ left outlet (index 0..7) ─► [ t i i ]
     [ t i i ] right ─► [ + 9871 ] ─► [ prepend port ] ─► udpreceive 9871
     [ t i i ] left  ─► [ + 1 ] ─► [ / bleep/hello $1 ( ] ─► udpsend 127.0.0.1 9880
udpreceive 9871 ─► route /bleep/param ─► route 0 1 2 3 ─► row 1 … row 4 (one outlet each)
```

- **Channel menu:** `live.menu`. Inspector → *Parameter* → *Type* **Enum**, *Range/Enum* `1 2 3 4 5 6 7 8`, *Long Name*
  `Channel`, *Parameter Visibility* **Stored Only**. Its left outlet is the index (0 to 7).
- **`[t i i]` fires right to left:** the port changes first, then the hello is sent.
- **Port:** channel *c* listens on `9871 + c − 1`, which is why `+ 9871` on the index. Check that `udpreceive` accepts a
  `port` message (right-click it → *Open udpreceive Help*). **If it does not,** replace it by scripting:
  `thispatcher` with the messages `script delete rx`, then `script newdefault rx 20 200 udpreceive <port>`, then
  `script connect rx 0 <route> 0`. Send them from the channel menu through a small `js`, or ask for it and I will write it.
- **Hello:** `/bleep/hello $1` goes out through `udpsend 127.0.0.1 9880` (`udpsend` formats messages that start with `/` as
  OSC; check it with the test script in section 6). The board then sends this channel's rows again.
- **`route /bleep/param`** removes the address. What is left is `row value`, e.g. `1 0.31`. **`route 0 1 2 3`** then sends the
  value alone out of the outlet of that row.

## 2. One row (a subpatcher)

Make `[p row]` with one inlet (the board's value). Build the row inside it; then copy it three times.

Objects inside:

| Object | Settings | Does |
|---|---|---|
| `inlet` | | the board's value (a float) |
| `js live-link.js` | | the row's logic; all of its six outlets are used |
| `live.menu` "Type" | Enum `dial switch menu`, Stored Only | the row type |
| `live.text` "Map" | *Mode* **Toggle**, *Text* `Map`, **Parameter Mode Enable off** | mapping mode on or off |
| `live.text` "×" | *Mode* **Button**, *Text* `×`, **Parameter Mode Enable off** | unmap this row |
| `live.dial` "Amount" | *Unit Style* **Float**, *Range* `0 1`, *Initial* `1`, Stored Only | the dial row's trim |
| `live.map` | | picks the Live parameter |
| `live.object` | | reads and sets that parameter |
| `sig~`, `live.remote~` | | drives a dial parameter |
| `comment` × 3 | | name, status, state |
| messages | `mapping $1`, `unmap`, `set 0` | see below |

Connections (all of them; the numbers are outlets from the left, starting at 0):

| From | To | Why |
|---|---|---|
| `inlet` | `js` | the board's value |
| `live.text` Map | message `mapping $1` → `live.map` left inlet | mapping mode |
| `live.map` outlet **1** (the id) | `js` | `id <n>`, exactly as you wired it |
| `live.map` outlet 2 (the name) | `prepend set` → comment **name** | the parameter's name |
| `js` outlet 0 | `sig~` → `live.remote~` **left** inlet | a dial's signal |
| `js` outlet 1 | comment **status** (it sends `set <text>`) | waiting, reading, mapped, errors |
| `js` outlet 2 | `live.remote~` **right** inlet | `id <n>`, or `id 0` to release |
| `js` outlet 3 | `live.object` **right** inlet | the id to read and set |
| `js` outlet 4 | `live.object` **left** inlet | `get …` and `set value …` |
| `js` outlet 5 | `live.map` left inlet | `unmap` when `js` refuses a parameter |
| `js` outlet 6 | comment **state** (it sends `set <text>`) | "on"/"off", or the item name |
| `live.object` outlet | `js` | its answers: `min`, `max`, `value`, `is_quantized`, `value_items` |
| `live.menu` Type, **middle** outlet (the text) | `prepend type` → `js` | `type dial` / `switch` / `menu` |
| `live.dial` Amount | `prepend range` → `js` | the trim |
| `live.text` ×, and `live.menu` Type (left outlet) | `[t b b b]` | on both: unmap and reset the Map toggle |
| `[t b b b]` outlets | message `unmap` → `js` **and** → `live.map`; message `set 0` → `live.text` Map | the three things `×` does |

Check each name: the `live.map` outlet numbers are the ones you used in the prototype (the id on the second outlet, the
name on the third); if yours differ, keep what worked.

## 3. Four rows

1. Copy `[p row]` three times (select, **Cmd+C**, **Cmd+V**).
2. **Every `live.*` parameter needs its own Long Name in a device.** Open each copy (double-click), and rename the Long
   Name of `Type`, `Amount` to `Type 2`, `Amount 2`, and so on. A duplicate name makes Max warn in its console.
3. Connect the outlets of `route 0 1 2 3` to the inlets of row 1 to row 4.

## 4. Presentation view (what the device shows in Live)

For each of these, right-click → **Add to Presentation**, then press **Cmd+Alt+E** to switch to presentation view and place them:

- the **Channel** menu once at the top;
- per row: Type menu, Map, name comment, status comment, state comment, Amount dial, ×.

Objects inside a subpatcher are not shown in the device unless the subpatcher is a `bpatcher`. **Use `[bpatcher]` instead
of `[p row]`:** save the row as `ll-row.maxpat` in this folder, and put `bpatcher ll-row.maxpat` four times with the
*Argument* `1`, `2`, `3`, `4` (use `#1` in the Long Names, e.g. `Type #1`). That gives each row unique names for free and shows
the row in the device. If you start with `[p row]`, move to a `bpatcher` once the logic works.

Live limits a device's height: the line **Device vertical limit** in the editor shows it. Four rows of about 30 pixels
and a header fit under it.

Suggested row (left to right): Type 64 px, Map 40 px, name 150 px with the status line in small type below it, state 90 px,
Amount 34 px, × 18 px.

## 5. Save

**Cmd+S** in the Max editor. Keep `live-link.js` next to the device. **File → Freeze Device** copies the script into the
`.amxd`, which is what you would share; do that last, as a frozen device is not editable.

## 6. Check it with the test script

The test script stands in for the board (`osc_test.py`). With Live's audio engine on:

| Check | Do | Expect |
|---|---|---|
| Load | Add the device | no errors in the Max console |
| Dial | Row 1: type **Dial**, Map, click Auto Filter's Frequency. `osc_test.py sine 0 --amp 0.2` | the status says *mapped*; the frequency swings around its own position; Ctrl-C returns it |
| Switch | Row 2: type **Switch**, Map, click a device's on/off. `osc_test.py set 1 1`, then `set 1 0` | the device switches; the state text says *on* then *off* |
| Menu | Row 3: type **Menu**, Map, click Filter Type. `osc_test.py set 2 0`, `set 2 0.34`, `set 2 1` | the first, the second and the last item; the state text shows their names |
| Refusal | A Dial row on Filter Type; a Menu row on a frequency | the status says *dials only* or *switches and menus only*, and the row unmaps |
| Type change | Change a mapped row's type | it unmaps; the Map toggle resets |
| Channel | Set the Channel to 2. `osc_test.py sine 0 --channel 2` | the row moves on channel 2 only |
| Hello | Run `osc_test.py sine 0` without the board; change the channel | the script prints `device on channel N said hello` |
| Reload | Save the set, quit Live, reopen | the mappings and the type and amount settings are still there |

## 7. Open points to look at

- **Mappings after a reload:** it is not known whether `live.map` sends the id again when the set loads. If it does, `js`
  re-reads the base from the parameter, which may hold the last driven value, so a dial's base can drift across a reload.
  Check the dial after reopening: if it moved, `js` has to keep its own base in the device's state.
- **`channel in use`:** two devices on one channel is not detected; the second one silently receives nothing.
- **The amount dial** is shown for every type; it only does something on a dial row.
- **`udpreceive` `port` message:** see section 1.
