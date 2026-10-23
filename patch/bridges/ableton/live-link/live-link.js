// SPDX-License-Identifier: GPL-3.0-or-later
// Bleep Live Link: the logic of one row, for a Max `js` object (doc/specs/live-link.md §3).
//
// A row has a TYPE (message `type dial|switch|menu`, default dial):
//
//   dial    the parameter is continuous. The row reads its own value BEFORE `live.remote~` takes it over (afterwards
//           `get value` returns the driven value and `set value` is refused), and from then on sends
//           base + offset × range, clamped to 0..1, to `live.remote~`.
//   switch  the parameter is a quantised on/off. The board's value is a gate: at 0.5 or more it is on. `live.object`
//           gets `set value <min|max>`, only when the state changes.
//   menu    the parameter is a quantised list. The board's value 0..1 picks an item: `set value <n>`, n = min +
//           round(value × (max − min)), only when the item changes. (`get value_items` lists the item names.)
//
// A switch or menu is set from the board's value, not offset from its own position; it is put back to what it was when
// the row is unmapped. Mapping a switch or menu does not set it: the first change after mapping does.
//
//   inlet 0 messages:
//     id <n>             from live.map (2nd outlet), straight in: a parameter was picked ("mapped <n>" also works)
//     type <t>           dial, switch or menu: releases whatever is mapped
//     <float>            the board's value for this row (from `unpack 0 0.`, right outlet)
//     range <r>          the row's amount, default 1
//     unmap              the Map toggle went off, or the X was pressed: release, put the parameter back at its base
//     min/max/value/is_quantized <x>, value_items <names…>   live.object's answers (its outlet)
//   outlets:
//     0  float   dial only: the signal for `sig~` → `live.remote~` (normalised 0..1)
//     1  text    `set <status>` for a `comment`/`textedit`: "waiting", "reading", "mapped", "dials only",
//                "switches and menus only", "not mappable", "no answer: …"
//     2  id      dial only: `id <n>` to live.remote~'s right inlet (`id 0` releases it)
//     3  id      `id <n>` to live.object's right inlet
//     4  query   messages to live.object's left inlet ("get min", "set value …")
//     5  unmap   `unmap` to live.map
//     6  state   `set <text>` for a comment: a switch row shows "on"/"off", a menu row the item's name (empty otherwise)

inlets = 1;
outlets = 7;

var type = "dial";
var id = 0;
var answers = {};
var attached = false;
var base = 0;      // 0..1, the parameter's own position when it was mapped
var offset = 0;
var range = 1;
var lo = 0, hi = 1;
var orig = 0;                            // switch/menu: the parameter's own value when it was mapped
var items = [];                          // menu: the item names (`get value_items`)
var lastSent = null;                     // switch/menu: what was last sent to the parameter
var ANSWER_MS = 500;                      // live.object answers at once; no answer by then means it cannot
var waiting = new Task(giveUp, this);

// "set <text>": a comment or textedit shows it (a plain symbol would not be shown).
function status(text) { outlet(1, "set", text); }

/// switch/menu: shows the state the row last set (a comment under or beside the row).
function showState(t) {
    if (type === "switch") outlet(6, "set", t === hi ? "on" : "off");
    else if (type === "menu") outlet(6, "set", items[t - lo] !== undefined ? String(items[t - lo]) : String(t));
}

function giveUp() {
    if (id === 0 || attached) return;
    var missing = [];
    ["is_quantized", "min", "max", "value"].forEach(function (k) { if (!(k in answers)) missing.push(k); });
    status("no answer: " + missing.join(" "));
    outlet(3, "id", 0);
    id = 0;
    answers = {};
    outlet(5, "unmap");
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

function emit() {
    if (attached && type === "dial") outlet(0, clamp01(base + offset * range));
}

/// switch/menu: the parameter value the board's value stands for.
function target(x) {
    if (type === "switch") return x >= 0.5 ? hi : lo;
    return lo + Math.round(clamp01(x) * (hi - lo));
}

function release(putBack) {
    waiting.cancel();
    if (attached) {
        if (type === "dial") {
            outlet(2, "id", 0);
            attached = false;
            // The knob goes back to where it was; the remote has let go, so the write is allowed.
            if (putBack) outlet(4, "set", "value", lo + base * (hi - lo));
        } else {
            attached = false;
            if (putBack) outlet(4, "set", "value", orig);
        }
    }
    id = 0;
    answers = {};
    lastSent = null;
    items = [];
    outlet(6, "set", "");
}

function mapped(newId) {
    release(true);
    // live.map sends `id 0` when the click did not pick a parameter it can map ("mapping none").
    if (!(newId > 0)) {
        status("not mappable");
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
    if (type !== "dial") outlet(4, "get", "value_items");
}

function answer(name, x) {
    if (id === 0 || attached) return;
    answers[name] = x;
    if (!("is_quantized" in answers && "min" in answers && "max" in answers && "value" in answers)) return;

    waiting.cancel();
    // A dial must not be quantised; a switch or menu must be.
    if (Boolean(answers.is_quantized) !== (type !== "dial")) {
        status(type === "dial" ? "dials only" : "switches and menus only");
        outlet(3, "id", 0);
        id = 0;
        answers = {};
        outlet(5, "unmap");
        return;
    }
    lo = answers.min;
    hi = answers.max;
    if (type === "dial") {
        base = hi > lo ? clamp01((answers.value - lo) / (hi - lo)) : 0;
        attached = true;
        outlet(2, "id", id);
        status("mapped");
        emit();
    } else {
        orig = answers.value;
        lastSent = null;
        attached = true;
        status("mapped");
        showState(orig);
    }
}

function msg_float(x) {
    offset = x;
    if (type === "dial") {
        emit();
        return;
    }
    if (!attached) return;
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
        case "type":
            if (args[0] === "dial" || args[0] === "switch" || args[0] === "menu") {
                release(true);
                type = args[0];
                status("waiting");
            }
            break;
        case "range": range = args[0]; emit(); break;
        case "unmap": release(true); status("waiting"); break;
        case "is_quantized": case "min": case "max": case "value": answer(messagename, args[0]); break;
        case "value_items":
            items = args;
            if (attached && lastSent !== null) showState(lastSent);
            else if (attached) showState(orig);
            break;
        default: break;
    }
}
