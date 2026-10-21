---
title: Custom UIs and widgets
description: Give a Code node a panel of knobs, faders and meters with a layout, or draw a fully self-made UI in JavaScript.
order: 45
---

# Custom UIs and widgets

By default a Code node shows one control for every `@param`, a meter for every `@probe` and a button for every `@button`. You can replace that in two ways:

1. a **layout** in the `@module` decorator, which arranges the standard widgets: no code, safe, and enough for most modules;
2. a **self-made UI** in JavaScript, which draws whatever it likes on a canvas.

The Code node's editor has a **Script** tab and a **UI** tab for this.

## Resizing and fullscreen

Drag the lower right corner of the Code window to make it larger or smaller: the editors and the UI area grow with it. The fullscreen button in the title bar (or F11, or a double click on the title bar) fills the board; Esc or the same button brings the window back to its size.

## Layout

```ts
@module({
  name: "Mixer",
  settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 16, init: 4 }],
  layout: [
    { row: [
      { repeat: CHANNELS, title: "Ch {n}", column: [
        { fader: "level{n}", meter: "peak{n}" },
        "pan{n}",
        "mute{n}",
      ] },
      { title: "Master", column: [{ fader: "master", meter: "peakMaster" }] },
    ] },
  ],
})
```

A layout is a list. Each item is one of:

| Item | Shows |
| --- | --- |
| `"id"` | The widget that suits the id: a knob for a number, a toggle for a boolean, a select for a choice, a meter for a probe, a button for a `@button`. |
| `{ knob: "id" }` | A round knob for a number param. |
| `{ fader: "id" }` | A vertical fader. Add `meter: "probeId"` to put a level meter beside it. |
| `{ toggle: "id" }` | An on/off switch for a boolean param. |
| `{ select: "id" }` | A drop-down for a choice param. |
| `{ meter: "id" }` | A meter for a `@probe`. |
| `{ value: "id" }` | The value of a param as text, read only. |
| `{ button: "id" }` | A button for a `@button` method. |
| `{ label: "text" }` | A line of text. |
| `{ spacer: true }` | Empty space. |
| `{ row: [...] }`, `{ column: [...] }` | Groups items side by side or one above the other. |

Any item can have `label` (replaces the name) and `title`. A container with `repeat` makes one copy per channel: `repeat` is a number or the name of a setting, and `{n}` in ids and titles becomes the copy number from 1. Repeats can be nested.

The transform checks the layout when you compile: every id must be a param, probe or button of the module, a `toggle` needs a boolean, a `select` needs a choice, and a layout holds at most 400 widgets. Errors name the id and the line.

## A self-made UI

Open the **UI** tab, write JavaScript, and use the `bleep` object. Here is a small meter:

```js
const level = bleep.canvas(60);
bleep.onFrame(() => {
  const { g, width, height } = level;
  g.clearRect(0, 0, width, height);
  g.fillStyle = bleep.theme.accent;
  g.fillRect(0, 0, width * bleep.probe("level"), height);
});
```

The playground example **Fold (own UI)** draws a transfer curve and lets you drag it to set Drive and Mix.

### The `bleep` object

| Member | What it does |
| --- | --- |
| `bleep.params` | Every param of the module. |
| `bleep.param(id)` | One param; throws with the known ids when there is none. |
| `bleep.probe(id)` | The latest value of a `@probe`, 0 until the module reports one. |
| `bleep.button(id)` | Presses a `@button` method. |
| `bleep.onFrame(fn)` | Calls `fn(dt)` every animation frame, `dt` in seconds. |
| `bleep.onValues(fn)` | Calls `fn()` when a param or probe has changed. |
| `bleep.size(h)` | Asks for a height in pixels, 40 to 800. The width is the node's. |
| `bleep.canvas(h)` | Makes a canvas as wide as the view and `h` high, scaled for the screen: `{ el, g, width, height }`. `bleep.canvas("fill")` makes it as high as the view too, so it follows the window when it is resized or fullscreen. |
| `bleep.theme` | The board's colours: `bg`, `panel`, `line`, `text`, `muted`, `accent`, `warn`. |

A param has `id`, `name`, `kind`, `unit`, `min`, `max`, `steps`, `choices`, a `value` in its own units, a `normalised` position from 0 to 1, and `set(units)` and `setNormalised(x)` to change it. A UI can set at most 240 values per second. An error in your code stops the UI and is shown in the editor with its line.

### What a UI can use

A UI draws on canvases and listens to the pointer. It runs in a worker, so there is **no DOM**: no `document`, no `window`, no buttons or inputs (draw them on the canvas, as the vintage modules' UIs do). The element `canvas.el` is a small stand-in with what a picture needs:

| On `canvas.el` | |
| --- | --- |
| `addEventListener(type, fn)` | `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerenter`, `pointerleave`, `wheel`, `click`, `dblclick`. The event has `clientX`, `clientY`, `pointerId`, `pointerType`, `button`, `buttons`, the modifier keys and `deltaX`, `deltaY`. A press captures the pointer, so a drag keeps working outside the picture |
| `getBoundingClientRect()` | Where the canvas is, for turning `clientX` and `clientY` into picture coordinates |
| `style.cursor` | `pointer`, `crosshair`, `grab`, `move`, `ns-resize`, `ew-resize` and the other common cursors |

`canvas.g` is an ordinary 2D context (the browser's `OffscreenCanvas`): paths, gradients, shadows, `roundRect`, text with system fonts. `Math`, `Date`, typed arrays and the rest of JavaScript's own library are there.

## The sandbox

A self-made UI is code written by whoever made the script, so it runs where the browser keeps it apart from the board, and it runs **without asking**:

- it runs in a worker inside a sandboxed frame with no network, storage, cookies or access to the board, your patches or the native app: it can compute, draw and talk to its module through `bleep`, nothing else;
- the frame hands each finished picture to the board and watches the worker. A UI that stops answering for a moment (an endless loop in a frame callback) or never gets started (an endless loop at the top of the code) is **stopped**, the UI shows the error, and the board carries on. It cannot freeze the page;
- a UI cannot use more than the messages `bleep` has: it sets at most 240 values per second, and a flood of messages stops it.

What a UI can still do is use your processor until the watchdog stops it, and draw whatever it likes inside its own box. Neither reaches your patches or your data.

The UI is stored with the script, so it is shared and versioned with it. See [Limits and safety](implementation/limits.md).
