// SPDX-License-Identifier: GPL-3.0-or-later
// Bleep Live Link: the logic of one row, for a Max `js` object (doc/specs/live-link.md §3).
//
// The row finds out what it was mapped to by asking live.object `get is_quantized`:
//
//   continuous (0)  a dial. The row reads the parameter's own value BEFORE `live.remote~` takes it over (afterwards
//                   `get value` returns the driven value and `set value` is refused), and from then on sends
//                   base + offset × range, clamped to 0..1, to `live.remote~`.
//   discrete (1)    a switch or a menu. `get value_items` gives the item names. The board's value 0..1 picks an item:
//                   `set value <n>`, n = min + round(value × (max − min)), only when the item changes. A switch is a menu
//                   of two items: it is on at 0.5 or more. Not offset from the parameter's own position; it is put back to
//                   what it was when the row is unmapped. Mapping does not set it: the first change after mapping does.
//
//   inlet 0 messages:
//     id <n>             from live.map (its id outlet), straight in: a parameter was picked ("mapped <n>" also works)
//     <float>            the board's value for this row (from `route 0 1 2 3`)
//     range <r>          a dial's trim, default 1 (a discrete row ignores it)
//     unmap              the Map toggle went off, or the × was pressed: release, put the parameter back as it was
//     min/max/value/is_quantized <x>, value_items <names…>, name <text…>   live.object's answers (its outlet)
//   outlets:
//     0  float   dial only: the signal for `sig~` → `live.remote~` (normalised 0..1)
//     1  text    `set <status>` for a `comment`/`textedit`: "unmapped", "reading", the parameter's name (or "mapped" until
//                it is known), "not mappable", "no answer: …"
//     2  id      dial only: `id <n>` to live.remote~'s right inlet (`id 0` releases it)
//     3  id      `id <n>` to live.object's right inlet
//     4  query   messages to live.object's left inlet ("get min", "set value …")
//     5  unmap   `unmap` to live.map
//     6  state   `set <text>` for a comment: a discrete row shows the item's name ("on"/"off" for a two-step parameter
//                with no names), empty otherwise
//     7  name    `set not mapped` for the comment that shows the parameter's name, whenever the row ends up unmapped
//                (the name itself comes from live.map's own name outlet, not from here)
//     8  button  to the Map toggle (a live.text), which is yellow while mapping and while mapped:
//                  mapped:   `set 1` (shows it on, no output) and `active 0` (it cannot be clicked), and `mapping 0` goes
//                            to live.map (outlet 5) so that clicking another parameter in Live no longer remaps the row;
//                  unmapped (the × button, no answer from live.object): `active 1` and `0` (off; it outputs, so the
//                            toggle's own `mapping $1` turns mapping mode off too). Only × maps the row again.
//                It also sets the button's texts: `text` (when off) and `texton` (when on). Give the button the texts
//                "Map" and "Mapping..." in its Inspector. Unmapped: "Map" / "Mapping..."; mapped: the on-text is the
//                parameter's name; "not mappable" while waiting for a click; "no answer" after a failed read. With the
//                button showing all that, the status and name comments (outlets 1 and 7) are not needed.

inlets = 1;
outlets = 9;

var id = 0;
var answers = {};
var attached = false;
var kind = null;   // "dial" or "discrete", once the row is mapped
var base = 0;      // dial: 0..1, the parameter's own position when it was mapped
var offset = 0;
var range = 1;
var lo = 0, hi = 1;
var orig = 0;                             // discrete: the parameter's own value when it was mapped
var items = [];                           // discrete: the item names (`get value_items`)
var lastSent = null;                      // discrete: what was last sent to the parameter
var expectZero = false;                   // we told live.map to unmap, and it answers with `id 0`: not a parameter it cannot map
var awaitingName = false;                 // live.object was asked for the parameter's name
var ANSWER_MS = 500;                      // live.object answers at once; no answer by then means it cannot
var waiting = new Task(giveUp, this);

// "set <text>": a comment or textedit shows it (a plain symbol would not be shown).
function status(text) { outlet(1, "set", text); }

/// The row is no longer mapped: its name label says so (live.map's name outlet only ever sets a name).
function clearName() { outlet(7, "set", "not mapped"); }

/// The Map toggle: lit and not clickable while the row is mapped (only × lets go of it), off and clickable when it is not.
function mapButtonMapped() {
    outlet(8, "texton", "mapped");   // until the parameter's name arrives
    outlet(8, "set", 1);
    outlet(8, "active", 0);
    outlet(5, "mapping", 0);
}
/// `reason`: what the dark button says instead of "Map" (after a failed read); the next time it is freed it says "Map" again.
function mapButtonFree(reason) {
    outlet(8, "text", reason ? reason : "Map");
    outlet(8, "texton", "Mapping...");
    outlet(8, "active", 1);
    outlet(8, 0);
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/// Discrete row: shows the item the row last set.
function showState(t) {
    if (kind !== "discrete") return;
    var name = items[t - lo];
    if (name === undefined) name = hi - lo === 1 ? (t === hi ? "on" : "off") : String(t);
    outlet(6, "set", String(name));
}

function giveUp() {
    if (id === 0 || attached) return;
    var missing = [];
    ["is_quantized", "min", "max", "value"].forEach(function (k) { if (!(k in answers)) missing.push(k); });
    status("no answer: " + missing.join(" "));
    outlet(3, "id", 0);
    id = 0;
    answers = {};
    expectZero = true;
    outlet(5, "unmap");
    clearName();
    mapButtonFree("no answer");
}

/// Asks for the mapped parameter's name; the status shows it once it arrives ("mapped" until then).
function askName() {
    awaitingName = true;
    outlet(4, "get", "name");
}

function emit() {
    if (attached && kind === "dial") outlet(0, clamp01(base + offset * range));
}

/// discrete: the parameter value the board's value stands for.
function target(x) { return lo + Math.round(clamp01(x) * (hi - lo)); }

function release(putBack) {
    waiting.cancel();
    if (attached) {
        if (kind === "dial") {
            outlet(2, "id", 0);
            attached = false;
            // The knob goes back to where it was; the remote has let go, so the write is allowed.
            if (putBack) outlet(4, "set", "value", lo + base * (hi - lo));
        } else {
            attached = false;
            if (putBack) outlet(4, "set", "value", orig);
        }
    }
    kind = null;
    id = 0;
    answers = {};
    lastSent = null;
    awaitingName = false;
    items = [];
    outlet(6, "set", "");
}

function mapped(newId) {
    // The `id 0` that answers our own unmap must not replace the status that says why (or "unmapped").
    if (!(newId > 0) && expectZero) {
        expectZero = false;
        return;
    }
    if (newId > 0) expectZero = false;
    release(true);
    // live.map sends `id 0` when the click did not pick a parameter it can map ("mapping none").
    if (!(newId > 0)) {
        status("not mappable");
        clearName();
        outlet(8, "texton", "not mappable");   // still lit and clickable: try another click
        return;
    }
    id = newId;
    answers = {};
    status("reading");
    waiting.schedule(ANSWER_MS);
    outlet(3, "id", id);
    outlet(4, "get", "is_quantized");
    outlet(4, "get", "min");
    outlet(4, "get", "max");
    outlet(4, "get", "value");
}

function answer(name, x) {
    if (id === 0 || attached) return;
    answers[name] = x;
    // A discrete parameter has item names: ask for them as soon as we know (they may arrive after the row is mapped).
    if (name === "is_quantized" && x) outlet(4, "get", "value_items");
    if (!("is_quantized" in answers && "min" in answers && "max" in answers && "value" in answers)) return;

    waiting.cancel();
    lo = answers.min;
    hi = answers.max;
    if (!answers.is_quantized) {
        kind = "dial";
        base = hi > lo ? clamp01((answers.value - lo) / (hi - lo)) : 0;
        attached = true;
        outlet(2, "id", id);
        status("mapped");
        mapButtonMapped();
        askName();
        emit();
    } else {
        kind = "discrete";
        orig = answers.value;
        lastSent = null;
        attached = true;
        status("mapped");
        mapButtonMapped();
        askName();
        showState(orig);
    }
}

function msg_float(x) {
    offset = x;
    if (!attached) return;
    if (kind === "dial") {
        emit();
        return;
    }
    var t = target(x);
    if (t === lastSent) return;
    lastSent = t;
    outlet(4, "set", "value", t);
    showState(t);
}
function msg_int(x) { msg_float(x); }

function anything() {
    var args = arrayfromargs(arguments);
    switch (messagename) {
        // live.map's id outlet sends "id 7"; a `mapped $1` message box in between would turn that into "mapped id".
        case "id": mapped(args[0]); break;
        case "mapped": mapped(args[0] === "id" ? args[1] : args[0]); break;
        case "range": range = args[0]; emit(); break;
        case "unmap": release(true); status("unmapped"); clearName(); mapButtonFree(); expectZero = true; break;
        case "is_quantized": case "min": case "max": case "value": answer(messagename, args[0]); break;
        case "name":
            if (attached && awaitingName) {
                awaitingName = false;
                status(args.join(" "));
                outlet(8, "texton", args.join(" "));   // the locked Map button shows what it is mapped to
            }
            break;
        case "value_items":
            items = args;
            if (attached && kind === "discrete") showState(lastSent !== null ? lastSent : orig);
            break;
        default: break;   // (a `type` message from an old patch is ignored: the row no longer has a type)
    }
}
