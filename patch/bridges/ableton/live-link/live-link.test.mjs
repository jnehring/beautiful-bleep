// SPDX-License-Identifier: GPL-3.0-or-later
// Runs live-link.js outside Max with a small stand-in for the js object's environment:
//   node patch/bridges/ableton/live-link/live-link.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function row() {
    const out = [];
    const ctx = {
        // (an array made inside the sandbox has the sandbox's Array: copy it, so strict comparisons work)
        outlet: (n, ...args) => out.push([n, ...args.map((a) => (Array.isArray(a) ? Array.from(a) : a))]),
        arrayfromargs: (a) => Array.from(a),
        messagename: "",
        Math,
        // Max's Task: schedule() arms it, cancel() disarms it; the test fires it by hand.
        Task: class {
            constructor(fn, owner) { this.fn = fn; this.owner = owner; this.armed = false; }
            schedule() { this.armed = true; }
            cancel() { this.armed = false; }
        },
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(new URL("./live-link.js", import.meta.url), "utf8"), ctx);
    const send = (name, ...args) => { ctx.messagename = name; ctx.anything(...args); };
    const drain = () => out.splice(0);
    const fire = (task) => { if (task.armed) { task.armed = false; task.fn(); } };
    return {
        ctx, send, drain, out,
        timeout: () => fire(ctx.waiting),          // live.object did not answer in time
        settle: () => fire(ctx.adoptTask),         // the board had its moment to move the row's knob
        value: (x) => ctx.msg_float(x),            // a value from the board
    };
}

// Outlets: 0 signal, 1 status, 2 id to live.remote~, 3 id to live.object, 4 query to live.object, 5 unmap to live.map,
// 6 state text, 7 name label, 8 Map button, 9 /bleep/info to udpsend.
const on = (m, n) => m.filter((x) => x[0] === n);
const sets = (m) => m.filter((x) => x[0] === 4 && x[1] === "set").map((x) => x[3]);
const statuses = (m) => m.filter((x) => x[0] === 1).map((x) => x[2]);
const states = (m) => m.filter((x) => x[0] === 6).map((x) => x[2]);
const names = (m) => m.filter((x) => x[0] === 7).map((x) => x[2]);
const button = (m) => m.filter((x) => x[0] === 8).map((x) => x.slice(1).join(" "));
const infos = (m) => m.filter((x) => x[0] === 9).map((x) => x[1]);
const signals = (m) => m.filter((x) => x[0] === 0).map((x) => x[1]);

/// live.object answers the four queries. `q`: 1 for a discrete parameter. Returns what the row sent when it was mapped.
function map(r, { id = 7, q = 0, value = 0.25, min = 0, max = 1 } = {}) {
    r.send("id", id);
    const queries = r.drain();
    r.send("is_quantized", q);
    r.send("min", min);
    r.send("max", max);
    r.send("value", value);
    return { queries, after: r.drain() };
}
const mapDial = (r, id = 7, value = 0.25, min = 0, max = 1) => map(r, { id, q: 0, value, min, max });
const mapDiscrete = (r, id = 7, value = 1, min = 0, max = 1) => map(r, { id, q: 1, value, min, max });
/// Maps, lets the board adopt (the hold ends), and drops what the row said so far.
const ready = (r, mapFn = mapDial, ...args) => { mapFn(r, ...args); r.settle(); r.drain(); };

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok:", name); };

// ---- a continuous parameter: a dial ------------------------------------------------------------------------------

test("mapping asks live.object first, and attaches live.remote~ only after all four answers", () => {
    const r = row();
    r.send("id", 7);
    const q = r.drain();
    assert.deepEqual(on(q, 3), [[3, "id", 7]]);
    assert.deepEqual(on(q, 4).map((m) => m[2]), ["is_quantized", "min", "max", "value"]);
    assert.equal(on(q, 2).length, 0, "no id to live.remote~ yet");
    r.send("is_quantized", 0);
    r.send("min", 0);
    r.send("max", 1);
    assert.equal(on(r.drain(), 2).length, 0, "still waiting for the value");
    r.send("value", 0.25);
    const after = r.drain();
    assert.deepEqual(on(after, 2), [[2, "id", 7]]);
    assert.deepEqual(signals(after), [0.25], "the row holds the parameter where it is: no jump");
});

test("a continuous parameter does not ask for item names", () => {
    const r = row();
    const { queries } = mapDial(r);
    assert.ok(!queries.some((x) => x[2] === "value_items"));
    assert.ok(!r.drain().some((x) => x[2] === "value_items"));
});

test("a parameter on another scale is held at its position within min..max", () => {
    const r = row();
    const { after } = mapDial(r, 7, 5, 0, 10);
    assert.deepEqual(signals(after), [0.5]);
});

test("while the board is moving the knob, its values are held; the last one is applied afterwards", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.drain();
    r.value(0.9);   // the knob's old position, before the board adopted
    r.value(0.25);  // the adopted one
    assert.deepEqual(r.drain(), [], "nothing is written yet");
    r.settle();
    assert.deepEqual(signals(r.drain()), [0.25], "afterwards only the last value counts");
});

test("after that the board's value is the position: absolute, clamped to 0..1", () => {
    const r = row();
    ready(r, mapDial, 7, 0.25);
    r.value(0.7);
    assert.deepEqual(r.drain(), [[0, 0.7]]);
    r.value(1.5);
    assert.deepEqual(signals(r.drain()), [1]);
    r.value(0);
    assert.deepEqual(signals(r.drain()), [0]);
});

test("the board sending -1 lets the parameter go; the next value takes it again", () => {
    const r = row();
    ready(r, mapDial, 7, 0.4, 0, 10);
    r.value(0.9);
    r.drain();
    r.value(-1);
    const m = r.drain();
    assert.deepEqual(on(m, 2), [[2, "id", 0]], "live.remote~ lets go");
    assert.deepEqual(sets(m), [0.4], "and the parameter is back where it was mapped");
    r.value(-1);
    assert.deepEqual(r.drain(), [], "once is enough");
    r.value(0.5);
    const m2 = r.drain();
    assert.deepEqual(on(m2, 2), [[2, "id", 7]], "driven again");
    assert.deepEqual(signals(m2), [0.5]);
});

test("a value before anything is mapped does nothing", () => {
    const r = row();
    r.value(0.5);
    r.value(-1);
    assert.deepEqual(r.drain(), []);
});

test("unmap releases the remote and puts the parameter back where it was", () => {
    const r = row();
    ready(r, mapDial, 7, 0.25, 0, 10);   // raw 0.25 on a 0..10 scale
    r.value(0.4);
    r.drain();
    r.send("unmap");
    const m = r.drain();
    assert.deepEqual(on(m, 2), [[2, "id", 0]]);
    assert.deepEqual(sets(m), [0.25]);
    r.value(0.4);
    assert.deepEqual(r.drain(), [], "nothing is written after release");
});

test("the old range message is ignored: the board decides the depth now", () => {
    const r = row();
    ready(r);
    r.send("range", 0.1);
    r.send("type", "switch");
    assert.deepEqual(r.drain(), []);
    r.value(0.5);
    assert.deepEqual(signals(r.drain()), [0.5]);
});

// ---- a discrete parameter: a switch or a menu ---------------------------------------------------------------------

test("a quantised parameter is a discrete row: no live.remote~, no signal, and mapping does not set it", () => {
    const r = row();
    r.send("id", 9);
    r.drain();
    r.send("is_quantized", 1);
    const afterQ = r.drain();
    assert.ok(afterQ.some((x) => x[0] === 4 && x[1] === "get" && x[2] === "value_items"), "item names are asked for at once");
    r.send("min", 0);
    r.send("max", 3);
    r.send("value", 1);
    const m = r.drain();
    assert.deepEqual(on(m, 2), [], "no id to live.remote~");
    assert.deepEqual(on(m, 0), [], "no signal");
    assert.deepEqual(sets(m), [], "the parameter is left as it was");
    assert.ok(statuses(m).includes("mapped"));
    assert.ok(!on(m, 5).some((x) => x[1] === "unmap"), "not unmapped");
});

test("a switch (two steps) is on at 0.5 or more, and only changes when the state does", () => {
    const r = row();
    ready(r, mapDiscrete, 7, 0, 0, 1);
    r.value(1);
    assert.deepEqual(sets(r.drain()), [1]);
    r.value(1);
    r.value(0.9);
    assert.deepEqual(sets(r.drain()), [], "same state: nothing sent");
    r.value(0.4);
    assert.deepEqual(sets(r.drain()), [0]);
});

test("a menu picks the item from the 0..1 position, min + round(position × (max − min)), clamped", () => {
    for (const [x, item] of [[0.5, 2], [0.34, 1], [1, 3], [5, 3], [0.16, 0], [0, 0]]) {
        const r = row();
        ready(r, mapDiscrete, 7, 2, 0, 3);
        r.value(x);
        const got = sets(r.drain());
        // the item the parameter already has is set again (nothing was sent before): that is harmless
        assert.deepEqual(got, [item], `${x} -> item ${item}`);
    }
    const q = row();
    ready(q, mapDiscrete, 7, 2, 0, 3);
    q.value(0.34);
    assert.deepEqual(sets(q.drain()), [1]);
    q.value(0.5);
    assert.deepEqual(sets(q.drain()), [2]);
    q.value(0.5);
    assert.deepEqual(sets(q.drain()), [], "the same item is not sent again");
});

test("a menu on a scale that starts above 0 adds the minimum", () => {
    const r = row();
    ready(r, mapDiscrete, 7, 11, 10, 14);
    r.value(0.5);
    assert.deepEqual(sets(r.drain()), [12]);
});

test("while the board is moving the knob a discrete row sets nothing; afterwards the last value counts", () => {
    const r = row();
    mapDiscrete(r, 7, 2, 0, 3);
    r.drain();
    r.value(0.0);
    r.value(2 / 3);
    assert.deepEqual(r.drain(), []);
    r.settle();
    assert.deepEqual(sets(r.drain()), [2]);
});

test("the board sending -1 puts a discrete parameter back and waits; the next value sets it again", () => {
    const r = row();
    ready(r, mapDiscrete, 7, 2, 0, 3);
    r.value(1);
    r.drain();
    r.value(-1);
    assert.deepEqual(sets(r.drain()), [2]);
    r.value(0);
    assert.deepEqual(sets(r.drain()), [0]);
});

test("unmapping a discrete row puts the parameter back as it was", () => {
    const r = row();
    ready(r, mapDiscrete, 7, 2, 0, 3);
    r.value(1);
    r.drain();
    r.send("unmap");
    assert.deepEqual(sets(r.drain()), [2]);
    r.value(0);
    assert.deepEqual(on(r.drain(), 4), [], "nothing is set after unmapping");
});

test("a discrete row shows its state: the number of steps decides on/off versus the item's name", () => {
    const sw = row();
    sw.send("id", 7);
    sw.drain();
    sw.send("is_quantized", 1);
    sw.send("min", 0);
    sw.send("max", 1);
    sw.send("value", 1);
    assert.deepEqual(states(sw.drain()), ["on"], "two steps, no names: on/off");
    sw.settle();
    sw.value(0);
    assert.deepEqual(states(sw.drain()), ["off"]);

    const m = row();
    m.send("id", 7);
    m.drain();
    m.send("is_quantized", 1);
    m.send("min", 0);
    m.send("max", 3);
    m.send("value", 1);
    assert.deepEqual(states(m.drain()), ["1"], "more steps, no names yet: the number");
    m.send("value_items", "Lowpass", "Highpass", "Bandpass", "Notch");
    assert.deepEqual(states(m.drain()), ["Highpass"], "the names arrive: the current item's name");
    m.settle();
    m.drain();
    m.value(1);
    assert.deepEqual(states(m.drain()), ["Notch"]);
    m.value(0);
    assert.deepEqual(states(m.drain()), ["Lowpass"]);
});

test("a two-step parameter that has names (Off, On) shows them; names with a space stay one name", () => {
    const r = row();
    r.send("id", 7);
    r.drain();
    r.send("is_quantized", 1);
    r.send("value_items", "Off", "On");
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0);
    assert.deepEqual(states(r.drain()), ["Off"]);
    const s = row();
    s.send("id", 7);
    s.send("is_quantized", 1);
    s.send("min", 0);
    s.send("max", 1);
    s.send("value", 0);
    s.drain();
    s.send("value_items", "Low Cut", "High Cut");
    assert.deepEqual(states(s.drain()), ["Low Cut"]);
});

test("unmapping clears the state text; a dial row never shows one", () => {
    const r = row();
    mapDiscrete(r, 7, 1);
    r.drain();
    r.send("unmap");
    assert.deepEqual(states(r.drain()), [""]);
    const d = row();
    ready(d, mapDial, 7, 0.25);
    d.value(0.5);
    assert.deepEqual(states(d.drain()), []);
});

// ---- telling the board what the row is mapped to ------------------------------------------------------------------

/// A row that knows its channel and row, mapped to a parameter and named.
function named(r, { name = "Frequency", mapFn = mapDial, args = [] } = {}) {
    r.send("channel", 2);
    r.send("row", 3);   // the third row of the device
    mapFn(r, ...args);
    r.drain();
    r.send("name", ...name.split(" "));
    return r.drain();
}

test("once mapped and named, the board is told: kind, name, position, range, adopt, for the right channel and row", () => {
    const r = row();
    const m = named(r, { args: [7, 0.25, 0, 1] });
    assert.deepEqual(infos(m), [["/bleep/info", 2, 2, "continuous", "Frequency", 0.25, 0, 1, 1]]);
});

test("the position in the info is where the parameter was when it was mapped, on its own scale", () => {
    const r = row();
    const m = named(r, { args: [7, 5, 0, 10] });
    assert.deepEqual(infos(m)[0].slice(5, 8), [0.5, 0, 10]);
});

test("a discrete parameter's info carries its item names; names that arrive later send it again, without adopt", () => {
    const r = row();
    r.send("channel", 1);
    r.send("row", 1);
    r.send("id", 7);
    r.drain();
    r.send("is_quantized", 1);
    r.send("min", 0);
    r.send("max", 3);
    r.send("value", 1);
    r.drain();
    r.send("name", "Filter", "Type");
    assert.deepEqual(infos(r.drain()), [["/bleep/info", 1, 0, "discrete", "Filter Type", 1 / 3, 0, 3, 1]], "no names yet");
    r.send("value_items", "Lowpass", "Highpass", "Bandpass", "Notch");
    assert.deepEqual(infos(r.drain()), [["/bleep/info", 1, 0, "discrete", "Filter Type", 1 / 3, 0, 3, 0, "Lowpass", "Highpass", "Bandpass", "Notch"]]);
});

test("item names that arrive before the name are in the first info", () => {
    const r = row();
    r.send("channel", 1);
    r.send("row", 1);
    r.send("id", 7);
    r.send("is_quantized", 1);
    r.send("value_items", "Off", "On");
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0);
    r.drain();
    r.send("name", "Device", "On");
    assert.deepEqual(infos(r.drain()), [["/bleep/info", 1, 0, "discrete", "Device On", 0, 0, 1, 1, "Off", "On"]]);
});

test("without channel and row nothing is sent to the board", () => {
    const r = row();
    mapDial(r);
    r.drain();
    r.send("name", "Frequency");
    assert.deepEqual(infos(r.drain()), []);
    r.send("unmap");
    assert.deepEqual(infos(r.drain()), []);
});

test("unmapping tells the board the row is no longer mapped", () => {
    const r = row();
    named(r);
    r.send("unmap");
    assert.deepEqual(infos(r.drain()), [["/bleep/info", 2, 2, "none"]]);
    r.send("unmap");
    assert.deepEqual(infos(r.drain()), [], "an unmapped row has nothing to retract");
});

test("changing the channel moves the info: none to the old channel, the info to the new one", () => {
    const r = row();
    named(r, { args: [7, 0.25, 0, 1] });
    r.send("channel", 4);
    assert.deepEqual(infos(r.drain()), [["/bleep/info", 2, 2, "none"], ["/bleep/info", 4, 2, "continuous", "Frequency", 0.25, 0, 1, 0]]);
    const u = row();
    u.send("channel", 1);
    u.send("channel", 2);
    assert.deepEqual(infos(u.drain()), [], "an unmapped row says nothing");
});

test("a row that gave up, or is remapped, retracts what it had told the board", () => {
    const r = row();
    named(r);
    r.send("id", 8);   // another parameter was picked: the first is released
    assert.deepEqual(infos(r.drain()), [["/bleep/info", 2, 2, "none"]]);
});

// ---- mapping, releasing, waiting ----------------------------------------------------------------------------------

test("mapping a second parameter first releases the first", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("id", 8);
    const m = r.drain();
    assert.deepEqual(on(m, 2), [[2, "id", 0]]);
    assert.deepEqual(on(m, 3), [[3, "id", 8]]);
});

test("a late answer after release does not attach", () => {
    const r = row();
    r.send("id", 7);
    r.send("unmap");
    r.drain();
    r.send("is_quantized", 0);
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0.5);
    assert.equal(on(r.drain(), 2).length, 0);
});

test("no answer from live.object: the row says what is missing and unmaps instead of hanging on \"reading\"", () => {
    const r = row();
    r.send("id", 5);
    r.drain();
    r.send("min", 0);
    r.send("max", 3);
    r.timeout();
    const m = r.drain();
    assert.ok(m.some((x) => x[0] === 1 && x[1] === "set" && x[2] === "no answer: is_quantized value"));
    assert.ok(m.some((x) => x[0] === 5 && x[1] === "unmap"));
    assert.equal(on(m, 2).length, 0, "never attached");
});

test("the timeout is cancelled when all answers arrive", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    assert.equal(r.ctx.waiting.armed, false);
    r.timeout();
    assert.deepEqual(r.drain(), []);
});

test("id 0 from live.map (a parameter it cannot map) is not mapped and does not hang", () => {
    const r = row();
    r.send("id", 0);
    const m = r.drain();
    assert.deepEqual(statuses(m), ["not mappable"]);
    assert.equal(m.filter((x) => x[0] === 2 || x[0] === 3 || x[0] === 4).length, 0, "nothing sent to live.object or live.remote~");
    assert.equal(r.ctx.waiting.armed, false);
});

test("id 0 while a parameter is mapped releases it first", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("id", 0);
    assert.deepEqual(on(r.drain(), 2), [[2, "id", 0]]);
});

test("\"mapped id 12\" (a `mapped $1` box) is tolerated", () => {
    const r = row();
    r.send("mapped", "id", 12);
    assert.deepEqual(on(r.drain(), 3), [[3, "id", 12]]);
});

test("the id 0 that live.map answers to our own unmap does not replace the status", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("unmap");
    r.drain();
    r.send("id", 0);
    assert.deepEqual(r.drain(), [], "the status stays \"unmapped\"");
});

test("a genuine id 0 later (a parameter live.map cannot map) still says \"not mappable\"", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("unmap");
    r.send("id", 0);             // the echo, ignored
    r.drain();
    r.send("id", 0);             // now a click on something live.map cannot map
    assert.deepEqual(statuses(r.drain()), ["not mappable"]);
    const q = row();
    q.send("unmap");
    q.send("id", 9);             // a real mapping clears the expectation
    q.drain();
    q.send("id", 0);
    assert.deepEqual(statuses(q.drain()), ["not mappable"]);
});

// ---- the status line, the name label, the Map button -----------------------------------------------------------

test("once mapped, the row asks live.object for the parameter's name and the status shows it instead of \"mapped\"", () => {
    const r = row();
    const { after } = mapDial(r);
    assert.deepEqual(statuses(after), ["mapped"], "\"mapped\" until the name is known");
    assert.ok(after.some((x) => x[0] === 4 && x[1] === "get" && x[2] === "name"));
    r.send("name", "Frequency");
    assert.deepEqual(statuses(r.drain()), ["Frequency"]);
});

test("a parameter name of several atoms is joined; the same for a discrete row; a name not asked for is ignored", () => {
    const r = row();
    mapDiscrete(r, 7, 1, 0, 3);
    r.drain();
    r.send("name", "Filter", "Type");
    assert.deepEqual(statuses(r.drain()), ["Filter Type"]);
    r.send("name", "Something", "Else");
    assert.deepEqual(statuses(r.drain()), []);
});

test("unmapping says \"unmapped\"; a late name after the unmap does not bring a status back", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("unmap");
    assert.deepEqual(statuses(r.drain()), ["unmapped"]);
    r.send("name", "Frequency");
    assert.deepEqual(statuses(r.drain()), [], "ignored");
});

test("unmapping a row sets its name label to \"not mapped\"; so do id 0 and no answer", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("unmap");
    assert.deepEqual(names(r.drain()), ["not mapped"]);
    const c = row();
    c.send("id", 0);
    assert.deepEqual(names(c.drain()), ["not mapped"]);
    const d = row();
    d.send("id", 5);
    d.drain();
    d.timeout();
    assert.deepEqual(names(d.drain()), ["not mapped"]);
});

test("mapping a parameter does not touch the name label (live.map sets the name itself)", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    assert.deepEqual(names(r.drain()), []);
    r.send("id", 8);
    assert.deepEqual(names(r.drain()), []);
});

test("once mapped, the Map button stays lit but cannot be clicked, and live.map leaves mapping mode", () => {
    for (const mapFn of [mapDial, mapDiscrete]) {
        const r = row();
        const { after } = mapFn(r);
        assert.deepEqual(button(after), ["texton mapped", "set 1", "active 0"]);
        assert.ok(on(after, 5).some((x) => x[1] === "mapping" && x[2] === 0));
    }
});

test("the button is not touched while the row waits for a click, except to say a click could not be mapped", () => {
    const r = row();
    r.send("id", 0);
    assert.deepEqual(button(r.drain()), ["texton not mappable"]);
    r.send("id", 7);
    assert.deepEqual(button(r.drain()), [], "reading: not yet mapped");
});

test("× makes the button clickable again, back to Map / Mapping...; a row that gave up says why on the dark button", () => {
    const r = row();
    mapDial(r);
    r.drain();
    r.send("unmap");
    assert.deepEqual(button(r.drain()), ["text Map", "texton Mapping...", "active 1", "0"]);
    const g = row();
    g.send("id", 5);
    g.drain();
    g.timeout();
    assert.deepEqual(button(g.drain()), ["text no answer", "texton Mapping...", "active 1", "0"]);
});

test("the locked Map button shows the parameter it is mapped to", () => {
    const r = row();
    mapDial(r);
    r.drain();
    r.send("name", "Frequency");
    assert.deepEqual(button(r.drain()), ["texton Frequency"]);
    const d = row();
    mapDiscrete(d, 7, 1, 0, 3);
    d.drain();
    d.send("name", "Filter", "Type");
    assert.deepEqual(button(d.drain()), ["texton Filter Type"]);
});

test("a late answer after × does not lock the button again", () => {
    const r = row();
    r.send("id", 7);
    r.send("unmap");
    r.drain();
    r.send("is_quantized", 0);
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0.5);
    assert.deepEqual(button(r.drain()), []);
});

console.log(`${n} tests passed`);
