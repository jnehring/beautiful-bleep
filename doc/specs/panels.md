# Panels

A **panel** is a front panel for a cell, or for the whole board: sliders, dials, buttons, a keyboard, labels, displays, and the views of the modules inside. It is how a patch becomes an instrument. Section 9.7 of the main spec has the short version; this is the design.

A panel has two views:

| View | For | What you do |
|---|---|---|
| **Interface** | playing | Use the controls. Nothing else is on screen. |
| **Wiring** | building | Every control shows what it is connected to; you connect it to a knob, a jack, a button or a note input and set the range. |

Layout (adding, moving, resizing controls) is part of the Interface view behind an unlock; wiring is its own view, because it needs room for the connections.

**A panel shows what you play with, not everything.** A cell can have hundreds of knobs; a panel has the dozen that matter, and everything else stays in the module's own view one click away (a control's right-click menu: *Open module view*). Large panels are split into tabs, and parts that exist elsewhere (a sequencer's panel) are loaded rather than copied.

## 1. Controls

Controls are placed freely on a grid (one unit = 20 px at 100 %). Every control with a value has a label, a readout in the *target's* units (Hz, ms, %), a default (double-click resets) and a colour (the first target module's colour unless set).

| Control | Gives | Notes |
|---|---|---|
| **Dial** | a value 0…1 | Optional detents (`steps`) for choices and integers; Shift = fine; wheel; mod ring when wired in *mod* mode. |
| **Slider** | a value 0…1 | Vertical or horizontal. Mixer faders. |
| **Wheel** | a value −1…+1 | Optional spring back to centre (pitch bend, mod wheel). |
| **Button** | 0/1 or a pulse | *Momentary*, *latch*, *trigger* (a pulse on press) or *gate* (high while held). A lamp shows the target's state when it has one. |
| **Switch** | a choice | Two to four labelled positions side by side. |
| **Select** | a choice | A dropdown, for long lists (Filter Type, Chord). |
| **Keys** | notes | A keyboard roll, 1–6 octaves, velocity from where the key is pressed; plays the cell's notes input. (The computer keyboard and a MIDI controller playing it: later.) |
| **XY pad** | two values | Two axes, each wired on its own. |
| **View** | — | The full view of one module inside the cell (a step sequencer, a drum grid, a drawn envelope), with all its own controls. Stage 1 of the panel work: no wiring needed, it *is* the module's view. |
| **Panel** | — | Loads another panel into a frame (section 1.1). |
| **Meter / Scope** | — | A display of an output jack: level for audio, a trace for control signals. |
| **Label** | — | Text. Styles: title, caption, note. |
| **Section** | — | A titled frame that groups controls. Moves its controls along when dragged. |

### 1.1 Tabs and loaded panels

- **Tabs.** A panel can have tabs (`Play`, `Sound`, `Mix`): a strip along the top of the panel, ⌘1…⌘9 or a click to switch. Each tab has its own size and its own controls; controls that belong to no tab (the title, a keyboard, a master meter) show on every tab. Wiring view shows the same tabs. A small panel needs none; a cell with ten modules usually wants two or three.
- **Loading a panel.** A *Panel* control loads another panel into a frame of the same size, live: the loaded panel's controls work in place, on the same board. Panels load panels to any depth (a loop is rejected). Two uses:
  - **Reuse.** A *module panel* is a panel for one kind of module (`"for": {"module": "drum-grid"}`): its wires and views name the pseudo node `this`, and the loading control says which node that is (`"node": "grid"`). A Drum Grid panel, a Step Sequencer panel or a filter panel is drawn once and loaded wherever such a module sits, in any cell, and an improvement to it reaches every panel that loads it.
  - **Splitting.** A big panel can be built from several smaller ones, each of which can also be opened on its own.
- A loaded panel can be *detached* (copied into the panel, then edited on its own) from its right-click menu.

Later: **Step bar** (a row of step toggles or faders for any lane), **Text input**, **Image**, **Custom view** (sandboxed HTML/JS using the module-view API).

## 2. Wiring

A control has an ordered list of **wires**. Each wire connects the control to one **target**:

| Target | Written | What the control does |
|---|---|---|
| **Knob** | `{ "param": "filter.cutoff" }` | Moves the knob. |
| **Cell jack** | `{ "cell": "cut" }` | Adds its value to one of the cell's shared input jacks, like a cable arriving from outside. Triggers and gates go in as pulses and levels. |
| **Notes** | `{ "notes": "cell" }` | Plays the Voice Cell as if the notes came in through its Notes input. Merged with whatever is cabled in. |
| **Module jack** | `{ "jack": "env.gate" }` | Feeds an input jack of a module inside the cell (a Button into an envelope's Gate). |
| **Module command** | `{ "command": "grid.clear" }` | Presses a module's button (Clear, Strum). |
| **Port** (later) | `{ "port": …}` | A Bleep Patch macro, or a parameter of an external plugin through the bus. |

Node ids refer to nodes of the board (in a preset: of the cell). A panel wires into any depth of its cell, including nested cells.

Each wire has:

- **Range**: the part of the target's range the control covers, as two values in the target's units. Low above high inverts. A cutoff dial from 200 Hz to 8 kHz is one wire with that range.
- **Curve**: *linear*, *exponential* or *S* (a bit of dead zone at the ends). The default follows the target's own scale.
- **Mode**:
  - **Set** (default for knobs): the control *is* the knob. Both move together; changing the knob in its module view, by undo or by automation moves the control.
  - **Mod**: the control stays out of the knob's base value and adds to it like a cable with an *amount*. The target shows a mod ring; the same control can fade several knobs at different amounts (a "Brightness" macro on a filter, an envelope depth and a delay mix).

With several wires the first is the **lead**: the control's readout and its starting position follow it.

### 2.1 How the user wires

Wiring view, four ways, all of which write the same wire:

1. **Drag a wire.** Every control has a small connector; drag it onto any knob in a module view, any node's jack, or a row in the Targets list. Wires are drawn dashed and in the control's colour, so they don't look like signal cables.
2. **Learn.** Click *Learn* on a control, then move any knob in any open module view (or press a module button). The first move becomes the wire, with the full range. For a narrower range: *Learn range* takes two moves, the lowest and the highest position.
3. **Targets list.** The left of the Wiring view is an outline of the cell: nodes, and under each its knobs, input jacks and commands, with a search field. Double-click a row to wire the selected control to it.
4. **Inspector.** The selected control's wires as a list: target, range with two handles and a readout, curve, mode, a delete button. A **Test** toggle makes the control move while the inspector is edited, so the range can be heard.

Unwired controls have a red outline, wires to targets that no longer exist (a deleted module) show struck through and are dropped on save with a warning.

### 2.2 Wire from the other side

Right-click a knob in any module view (or on a cell's input jack) → **Add to panel ▸** *(a panel in the list, or New panel)* adds a dial wired to it, with the knob's name, in the first free place. This is the fastest way to build a panel: patch, then pull the knobs you want out onto the front.

## 3. Seeing, opening and editing panels

| Where | What |
|---|---|
| **The cell node** | A cell or Voice Cell with a panel shows a small ▦ on its node. One click opens the panel in a floating window like a module view (pin, drag, close with Esc); double-click still enters the cell. Several panels: ▦ opens a list. |
| **Inside a cell** | The breadcrumb bar gets a segmented control **Inside \| Panel**. *Panel* replaces the canvas with the cell's panel, scaled to fit. ⌘E toggles Interface and Wiring. Side by side: the panel as a floating window over the canvas, so wires can be dragged from a control to a node. |
| **Panels list** | The toolbar's **Panels** button (and P) lists every panel of the board with a thumbnail: open, rename, duplicate, delete, *New panel*, *Build from cell…*. The list also shows where a panel is in use: window, port plugin, Bleep Panel. |
| **Right-click a cell** | *Open panel*, *Edit panel*, *New panel*, *Build panel from cell* (the factory rules below on your own cell). |
| **Add menu** | Cell presets with a panel show ▦ and a thumbnail on hover; the preset's panel comes with it. A cell placed from a preset opens its panel on request, not on its own. |
| **Standalone and plugins** | The panel as the app's main view (*Perform* mode, ⌘P: the board is hidden, the panel fills the window); in a port's plugin window; in a Bleep Panel plugin (section 9.7). |

**Editing.** A panel window has a header with the panel's name and a switch **Interface | Wiring**. In Interface, a padlock unlocks layout:

- A palette on the left lists the control types; drag one onto the panel. Right-click the panel: *Add ▸*.
- Drag to move (Shift: no snapping), handles to resize, arrow keys to nudge, ⌘D duplicates, Delete removes, Shift-click multi-selects, ⌘G puts the selection in a section.
- Alignment guides to neighbours and a 1-unit snap grid.
- A properties strip for the selected control: label, colour, size, style, steps, default.
- Edits are board edits: they are in the undo stack (section 9.10) and saved with the board.

**Build from cell.** One command that builds a panel from a cell the way the factory panels are built (section 5): shared jacks become controls, each module's main knobs become sections, sequencers show their view, a keyboard goes under a Voice Cell. It is the starting point; every control it makes is an ordinary control, free to move or delete.

### 3.1 Board panels and Show on load

- **A panel belongs to a cell or to the board.** A *cell panel* (`"cell": "<id>"`) wires to the nodes inside that cell and is opened with the ▦ on the cell. A *board panel* (no `cell`) wires to any node of the board and is opened from the toolbar's **Panels** list (P), which also has *New board panel*. Cell panels are listed there too.
- **Show on load.** A board panel's settings (select nothing in the editor) have **Show on load**: *Off*, *In a window* or *Full screen*. The panel opens when the board is loaded, so a patch can open as an instrument. One panel per board has it; setting it on another clears the first. Full screen fills the canvas and scales the panel to fit; ⤢ in the panel's title bar toggles it at any time.
- Cell panels placed with a preset do not open on load; Show on load is for panels the user sets.

### 3.2 The editor (as built)

The ✎ in a panel's title bar switches between playing and editing; *New panel* opens straight into the editor.

- **Interface view:** palette on the left (Dial, Fader, Button, Select, Meter, Label, Section, Module view, Load panel); drag a control to move it, the corner to resize, a section carries the controls standing on it; arrow keys nudge, ⌘D duplicates, Delete removes; properties on the right (label, text, colour, X/Y/W/H, which tab it shows on, module or panel to show). With nothing selected the right side holds the **panel's settings**: name, Show on load, tabs (add, rename, delete) and size.
- **Wiring view:** the outline of the cell (or the whole board) on the left: click a node to expand it, click a knob to wire the selected control to it, **double-click a knob to make a new control for it** (a dial, a select for a choice, a button for a toggle). Each control shows its lead target on a chip, red when unwired. On the right, the control's wires with a **range** (the part of the knob's range the control covers; reversed values invert), and **Learn**: press it, then move a knob in any open module view. A meter takes up to two outputs from the list; a module view or loaded panel takes its module from the list.
- Every edit is one step of the board's undo. Panels are saved in the board document (`panels`), and with a cell preset.
- Loaded panels show as one box while editing; *Edit this panel…* opens the loaded panel's own editor.

- **Keys, Wheel, cell inputs.** *Keys* (1–6 octaves, velocity from where the key is pressed; slides across keys) plays a Voice Cell: wire it to **Cell inputs › Notes**. A *Dial*, *Fader*, *Wheel* or *Button* wired to a cell input (**Cell inputs** at the top of the outline) feeds that jack, summed with whatever is cabled in; triggers and gates from a Button arrive as pulses held while pressed. A Wheel can spring back to the middle (Bend). Double-clicking a cell input makes the fitting control. A jack-wired control keeps where it was left in the panel (`value`).

- **Module jacks and buttons.** Under each module in the outline, its input jacks (marked *jack*) and buttons (*button*). A control wired to a jack sends its value into it, like a cable from the panel; a Button wired to a module's button presses it (held while pressed). **Modulation:** Alt-click a knob (or set *Mode* to *Modulates the knob* on the wire) and the control no longer sets the knob but adds to it like a cable, with an *Amount*.
- **XY pad.** Two values from one control: each wire has an axis (the first is *x*, the next *y*; changeable on the wire). Each axis can set knobs, modulate them, or feed jacks. It saves its position as `[x, y]`.
- **Computer keyboard.** While the pointer is over a panel with Keys, A W S E D F T G Y H U J K O L P ; ' play it like a piano, Z / X move the octave. The keys stay out of the board's shortcuts while they do.
- **Add to panel.** Right-click any knob in a module view (also one embedded in a panel) → *Add to panel ▸* a panel that can reach the node, or *New panel* for the cell or the board. The control (dial, select for a long list, button for a toggle) is wired and placed in the first free spot.
- **Build panel from cell.** Right-click a cell (or the toolbar's Panels list with the cell selected) → *Build panel from cell*: the cell's inputs as controls, a section of main knobs for each module (the lists in [`panel-build.js`](../../patch/board/ui/panel-build.js)), faders for mixers, the view of each sequencer, a keyboard and the voice settings for a Voice Cell, and a meter. A starting point: every control is an ordinary one.
- **Copy, paste, duplicate.** Cells carry their panels (and the module panels they load) with ⌘C / ⌘V and ⌘D, into the same board or another, with the wires pointing at the new nodes.

Under the hood the engine makes a hidden source for each jack, modulation or notes wire (a Dial, Button or Keyboard module, id `~<panel>:<control>:<wire>`), cabled into the target when the board compiles; the board file doesn't contain them. They don't reach nodes inside a Voice Cell (its knobs can still be *set* from a panel, which applies to all voices). A board panel's wires may go to any node of the board.

Not built: **Bleep Panel plugin parameters (`expose`) and hardware MIDI-learn** — those belong to the plugin bridge, not the board UI (a MIDI controller plays a Voice Cell today by patching its MIDI In port); custom HTML views; a *Step bar* control; panel pages beyond tabs.

## 4. Document

Panels live in the board document, `"panels": [ … ]` (the engine keeps them as they are), and in cell presets (the panels whose controls all wire inside the cell, with the module panels they load). Wires name nodes by their ids in the board; placing a preset copies its panels in with the ids rewritten to the new nodes. Panels of a deleted cell, and module panels nobody loads, are dropped with the edit. A panel:

```json
{
  "id": "p1", "name": "Warm Saws", "cell": "root",
  "cols": 58, "rows": 38,
  "controls": [
    { "id": "c1", "type": "label", "at": [1, 0], "size": [56, 2], "text": "Warm Saws", "style": "title" },
    { "id": "c2", "type": "section", "at": [1, 3], "size": [10, 8], "text": "Macros", "colour": "#fda4af" },
    { "id": "c3", "type": "dial", "at": [2, 5], "size": [4, 4], "label": "Cutoff",
      "wire": [ { "cell": "cut", "range": [-1, 1] } ] },
    { "id": "c9", "type": "dial", "at": [13, 5], "size": [4, 4], "label": "Cutoff",
      "wire": [ { "param": "filter.cutoff" },
                { "param": "filter.drive", "mode": "mod", "amount": 0.2 } ] },
    { "id": "c40", "type": "keys", "at": [8, 31], "size": [42, 7], "octaves": 3, "from": "C3",
      "wire": [ { "notes": "cell" } ] },
    { "id": "c41", "type": "meter", "at": [49, 31], "size": [2, 8], "label": "Out",
      "source": { "out": ["vca.l", "vca.r"] } }
  ]
}
```

- `at` and `size` are in grid units. `cell` is the cell the panel fronts (none: a board panel); `"open": "window"` or `"full"` is Show on load.
- A control's value is the value of its lead target when that is a knob; controls with no knob behind them (mod mode, jacks) store `"value"` in the panel.
- `wire[].range` is in the target's own normalised range, 0…1 (cell jacks: −1…+1); `curve` and `mode` default as above.
- `view` controls name a node: `{ "type": "view", "node": "grid" }`.
- Tabs: `"tabs": [ { "id": "play", "name": "Play", "rows": 24 } ]` on the panel, `"tab": "play"` on a control (none: on every tab). `cols`/`rows` of the panel are the largest tab's.
- A loaded panel: `{ "type": "panel", "panel": "drum-grid", "node": "grid", "at": [1, 3], "size": [46, 20] }`; a module panel declares `"for": { "module": "drum-grid" }` instead of `"cell"`.
- Unknown control types and wire kinds are kept and shown as an empty box, so a newer panel opens in an older app without losing anything.

## 5. The mapping layer

Panel controls never change engine state directly (section 9.7). They go through the mapping layer in the board, one per panel:

- **Set wires** on knobs run on the message thread: control value → range and curve → `setParam`, as a knob drag does; the reverse path updates the control. No audio-thread cost. A control wired to a knob in a Voice Cell sets it for all voices (the same as a cell control).
- **Mod wires, cell jacks, module jacks** compile to a hidden *panel source* node per panel, with one output per control, cabled to the targets with the wire's amount. Panel sources are the engine's Dial, Button and Keyboard modules without a view; their smoothing and gate/trigger handling is reused. Nothing else about cables changes: mod rings, the cable popover and undo work as for any cable (the panel source's cables are shown in the cable popover as "Panel › Cutoff").
- **Notes** from a Keys control enter the cell's note stream next to cabled notes and MIDI.
- **Performance gestures** (buttons, keys) are not saved and have no undo, like the Button and Keyboard modules (`api.perform`).
- **Automation and MIDI.** A control can be exposed (`"expose": true`): it becomes a parameter of the *Bleep Panel* plugin, so Live can automate and MIDI-map it. Hardware controllers MIDI-learn a control (`"midi": {"cc": 74, "channel": 1}`); Learn works as in the Wiring view, with a message instead of a knob move.

## 6. Factory panels

Every factory cell preset has a panel. Presets without a hand-written one get the draft that *Build panel from cell* makes (`build.mjs` runs [`panel-build.js`](../../patch/board/ui/panel-build.js) on the preset and checks the result like the rest); a hand-written panel in `panels.mjs` takes its place by preset name. Hand-written panels are made one at a time: [`patch/presets/panels.mjs`](../../patch/presets/panels.mjs) holds them, `node patch/presets/build.mjs` checks each against its preset (every wire resolves to a real knob, jack or output; nothing overlaps; loaded panels exist) and writes `patch/board/ui/factory-panels.json`, keyed by preset name. The board attaches a preset's panels when the preset is placed.

**Punch Machine** is the first (drum machine, punch kit):

- A title across the top and two tabs.
- **Play**: the *Drum Grid* panel loaded (a module panel, so every drum cell can load the same one), and a Mixer: a fader per voice, Master, and an output meter.
- **Sound**: the voices, two or three knobs each (Kick: Tune, Decay, Sweep; Snare: Tune, Snappy, Decay; Hats: Tune, Closed, Open; Clap; both Toms; Rim). Level, pan and the other knobs stay in the voice's module view.

Rules the next panels follow:

1. **Few controls.** About three knobs per module, chosen by what changes the sound most; faders for levels; no knob that only matters once.
2. **Tabs when a panel passes about 30 controls or two screens**: *Play* (what you touch while playing), *Sound* (the sound design), more only if needed.
3. **Reuse** module panels for sequencers and the like instead of redrawing them.
4. **Shared jacks** (Cutoff, Bend, Trig, Velocity) are controls too, first on the panel.
5. **Voice Cells** get a keyboard under the tabs, on every tab.
6. Colour sections by module colour; the mixer and shared jacks are rose.

*Build panel from cell* (stage 2) will make a starting panel for a user's own cell with the same rules: shared jacks, about three knobs for each module from a short list of main knobs per type, sequencer views, a keyboard, tabs when it gets large. It builds a draft; the controls are the user's to change.

## 7. Stages

1. **Reading panels.** Panel document, Interface view, tabs, loaded panels, factory panels, *Set* wires on knobs, view controls, the ▦ on cells, the Panels list, port windows, Bleep Panel plugin.
2. **Wiring and editing.** Wiring view with drag, Learn, Targets list, Inspector; layout editing; *Add to panel*; *Build from cell*; mod/jack/notes wires and the panel source node.
3. **Beyond.** Expose and MIDI-learn, XY pads and step bars, custom HTML views, panels published with patches.

Stage 1 can ship before the editor exists: factory panels are plain data, written one preset at a time.

**Implemented so far** ([`patch/board/ui/panels.js`](../../patch/board/ui/panels.js), `board.js`): a cell placed from a preset that has a factory panel carries `panel` (the preset's name) and its nodes carry `pkey` (the id the preset gave them), which is how a panel finds its nodes after ids are renumbered, copied or renamed. The cell shows a ▦ (also *Open panel* in its menu) that opens the panel in a floating, pinned-by-default window. Drawn: labels, sections, tabs, dials and faders with *Set* wires on knobs (drag, Shift for fine, double-click for the default, in step with module views and undo), meters from output activity, module views and loaded panels. Other control types show as an empty box. Not yet: panels in the board document, mod/jack/notes wires, the Panels list, Interface/Wiring views, editing.

## 8. Open questions

- **Two controls, one knob.** A knob wired from two panels: both follow it (last mover wins). Probably fine; nothing to design unless it feels wrong.
- **Wires into cell presets from outside.** A board panel that wires into a cell that is later replaced by another preset loses its wires on the new nodes' ids. Wire by name, or keep the wire and warn?
