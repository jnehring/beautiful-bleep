// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Bleep Live Link: the logic of one row, for a Max `js` object (doc/specs/live-link.md §3).
//
// The BOARD decides the value: a row of the Live Params node is a knob (plus the cables that feed it) scaled into the row's
// Min..Max, and /bleep/param brings that to the device as an absolute position, 0..1 within the parameter's own range, or -1
// when the node no longer drives the row. The row only writes it, and tells the board what it is mapped to (/bleep/info).
//
// The row finds out what it was mapped to by asking live.object `get is_quantized`:
//
//   continuous (0)  a dial. The position goes to `live.remote~` (0..1 is the parameter's whole range).
//   discrete (1)    a switch or a menu. `get value_items` gives the item names. The position picks an item:
//                   `set value <n>`, n = min + round(position × (max − min)), only when the item changes. A switch is a menu
//                   of two items: it is on at 0.5 or more.
//
// When a row is mapped it holds the parameter where it is, and the board moves the row's knob to that position
// (/bleep/info with adopt = 1), so nothing jumps. The board's values are ignored for a moment (ADOPT_MS) while it does.
// Unmapping, or the board sending -1, puts the parameter back where it was when it was mapped.
//
//   inlet 0 messages:
//     id <n>             from live.map (its id outlet), straight in: a parameter was picked ("mapped <n>" also works)
//     <float>            the board's position for this row (from `route 0 1 2 3`): 0..1, or -1: no longer driven
//     channel <n>        this device's channel 1..8 (from the Channel menu, any time it changes): for /bleep/info
//     row <n>            which row this is, 1..4 (the bpatcher's argument): for /bleep/info
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
//                parameter's name; "not mappable" while waiting for a click; "no answer" after a failed read.
//     9  info    (repeated every 2 s while the row is mapped) to `udpsend 127.0.0.1 9880`: "/bleep/info <channel> <row> <kind> <name> <current> <min> <max> <adopt> <items…>"
//                what this row is mapped to (kind: continuous or discrete; current: the parameter's position 0..1 when it was
//                mapped; min, max: its range; adopt: 1 right after mapping), or "/bleep/info <channel> <row> none".

inlets = 1;
outlets = 10;

var channel = 0, row = -1;                // this device's channel 1..8 and this row 0..3, for /bleep/info (0 / -1: not told yet)
var id = 0;
var answers = {};
var attached = false;
var kind = null;                          // "dial" or "discrete", once the row is mapped
var lo = 0, hi = 1;                       // the parameter's own range
var orig = 0;                             // the parameter's own value when it was mapped: put back on release
var items = [];                           // discrete: the item names (`get value_items`)
var lastSent = null;                      // discrete: what was last sent to the parameter
var paused = false;                       // the board sent -1: the parameter was put back and is not driven until a value comes
var adopting = false;                     // just mapped: the board is moving the row's knob to the parameter's position
var held = null;                          // the last board value that arrived while adopting
var infoName = null;                      // the parameter's name once known (and /bleep/info with it has been sent)
var expectZero = false;                   // we told live.map to unmap, and it answers with `id 0`: not a parameter it cannot map
var awaitingName = false;                 // live.object was asked for the parameter's name
var ANSWER_MS = 500;                      // live.object answers at once; no answer by then means it cannot
var ADOPT_MS = 300;                       // how long the board's values are ignored after mapping
var INFO_MS = 2000;                       // while a row is mapped its report is repeated this often (a board that starts late, or was busy, then catches up)
var waiting = new Task(giveUp, this);
var adoptTask = new Task(endAdopt, this);
var infoTask = new Task(repeatInfo, this);

// "set <text>": a comment or textedit shows it (a plain symbol would not be shown).
function status(text) { outlet(1, "set", text); }

/// The row is no longer mapped: its name label says so (live.map's name outlet only ever sets a name).
function clearName() { outlet(7, "set", "not mapped"); }

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

/// The parameter's value as a position 0..1 within its own range.
function position(value) { return hi > lo ? clamp01((value - lo) / (hi - lo)) : 0; }

/// Discrete row: shows the item the row last set.
function showState(t) {
    if (kind !== "discrete") return;
    var name = items[t - lo];
    if (name === undefined) name = hi - lo === 1 ? (t === hi ? "on" : "off") : String(t);
    outlet(6, "set", String(name));
}

// ---- telling the board ------------------------------------------------------------------------------------------

function infoReady() { return channel >= 1 && row >= 0; }

/// What this row is mapped to. `adopt`: the row was just mapped, so the board moves its knob to `current`.
function sendInfo(adopt) {
    if (!infoReady() || !attached) return;
    var message = ["/bleep/info", channel, row, kind === "dial" ? "continuous" : "discrete", infoName === null ? "" : infoName,
                   position(orig), lo, hi, adopt ? 1 : 0];
    if (kind === "discrete") message = message.concat(items);
    outlet(9, message);
}

/// The report again, without "adopt": nothing moves on the board, but a board that missed it (it started later, its port was busy)
/// learns it. Repeats itself while the row is mapped.
function repeatInfo() {
    if (!attached || infoName === null) return;
    sendInfo(false);
    infoTask.schedule(INFO_MS);
}

function sendNone(forChannel) {
    if (forChannel >= 1 && row >= 0) outlet(9, ["/bleep/info", forChannel, row, "none"]);
}

// ---- mapping ------------------------------------------------------------------------------------------------------

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

/// Asks for the mapped parameter's name; the status shows it, and the board is told, once it arrives ("mapped" until then).
function askName() {
    awaitingName = true;
    outlet(4, "get", "name");
}

function endAdopt() {
    adopting = false;
    if (held !== null) {
        var x = held;
        held = null;
        apply(x);
    }
}

/// discrete: the parameter value a position stands for.
function target(x) { return lo + Math.round(clamp01(x) * (hi - lo)); }

/// Writes the board's position to the parameter.
function apply(x) {
    if (paused) {
        paused = false;
        if (kind === "dial") outlet(2, "id", id);   // the board drives the row again
    }
    if (kind === "dial") {
        outlet(0, clamp01(x));
        return;
    }
    var t = target(x);
    if (t === lastSent) return;
    lastSent = t;
    outlet(4, "set", "value", t);
    showState(t);
}

/// The board no longer drives this row (its node was deleted, or moved to another channel): the parameter goes back.
function boardReleased() {
    held = null;
    if (!attached || paused) return;
    paused = true;
    if (kind === "dial") outlet(2, "id", 0);
    outlet(4, "set", "value", orig);
    lastSent = null;
    if (kind === "discrete") showState(orig);
}

function release(putBack) {
    waiting.cancel();
    adoptTask.cancel();
    infoTask.cancel();
    var wasMapped = attached;
    if (attached) {
        if (kind === "dial") {
            if (!paused) outlet(2, "id", 0);
            attached = false;
            // The knob goes back to where it was; the remote has let go, so the write is allowed.
            if (putBack) outlet(4, "set", "value", orig);
        } else {
            attached = false;
            if (putBack) outlet(4, "set", "value", orig);
        }
    }
    if (wasMapped) sendNone(channel);
    kind = null;
    id = 0;
    answers = {};
    lastSent = null;
    awaitingName = false;
    infoName = null;
    paused = false;
    adopting = false;
    held = null;
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
    orig = answers.value;
    attached = true;
    paused = false;
    lastSent = null;
    infoName = null;
    // The row holds the parameter where it is until the board has moved its knob there.
    adopting = true;
    held = null;
    adoptTask.schedule(ADOPT_MS);
    if (!answers.is_quantized) {
        kind = "dial";
        outlet(2, "id", id);
        outlet(0, position(orig));
    } else {
        kind = "discrete";
        showState(orig);
    }
    status("mapped");
    mapButtonMapped();
    askName();
}

function msg_float(x) {
    if (x < 0) {   // -1: the board no longer drives this row
        boardReleased();
        return;
    }
    if (!attached) return;
    if (adopting) {
        held = x;
        return;
    }
    apply(x);
}
function msg_int(x) { msg_float(x); }

function anything() {
    var args = arrayfromargs(arguments);
    switch (messagename) {
        // live.map's id outlet sends "id 7"; a `mapped $1` message box in between would turn that into "mapped id".
        case "id": mapped(args[0]); break;
        case "mapped": mapped(args[0] === "id" ? args[1] : args[0]); break;
        case "channel": {
            var old = channel;
            channel = args[0];
            if (attached && old !== channel) {
                sendNone(old);       // the old channel's node no longer has this row
                sendInfo(false);
            }
            break;
        }
        case "row": row = args[0] - 1; break;
        case "unmap": release(true); status("unmapped"); clearName(); mapButtonFree(); expectZero = true; break;
        case "is_quantized": case "min": case "max": case "value": answer(messagename, args[0]); break;
        case "name":
            if (attached && awaitingName) {
                awaitingName = false;
                infoName = args.join(" ");
                status(infoName);
                outlet(8, "texton", infoName);   // the locked Map button shows what it is mapped to
                sendInfo(true);
                infoTask.schedule(INFO_MS);
            }
            break;
        case "value_items":
            items = args;
            if (attached && kind === "discrete") {
                showState(lastSent !== null ? lastSent : orig);
                if (infoName !== null) sendInfo(false);   // the names came after the info: send it again with them
            }
            break;
        default: break;   // (`type` and `range` from an older patch are ignored: the board decides the value now)
    }
}
