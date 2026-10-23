// SPDX-License-Identifier: GPL-3.0-or-later
// Runs live-link.js outside Max with a small stand-in for the js object's environment:
//   node patch/bridges/ableton/live-link/live-link.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function row() {
    const out = [];
    const ctx = {
        outlet: (n, ...args) => out.push([n, ...args]),
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
    const timeout = () => { if (ctx.waiting.armed) { ctx.waiting.armed = false; ctx.waiting.fn(); } };
    return { ctx, send, drain, out, timeout };
}

// Outlets: 0 signal, 1 status, 2 id to live.remote~, 3 id to live.object, 4 query to live.object, 5 unmap to live.map,
// 6 state text, 7 name label.
const on = (m, n) => m.filter((x) => x[0] === n);
const sets = (m) => m.filter((x) => x[0] === 4 && x[1] === "set").map((x) => x[3]);
const statuses = (m) => m.filter((x) => x[0] === 1).map((x) => x[2]);
const states = (m) => m.filter((x) => x[0] === 6).map((x) => x[2]);
const button = (m) => m.filter((x) => x[0] === 8).map((x) => x.slice(1).join(" "));
const names = (m) => m.filter((x) => x[0] === 7).map((x) => x[2]);

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

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok:", name); };

// ---- dial (is_quantized 0) --------------------------------------------------------------------------------------

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
    assert.deepEqual(on(after, 0), [[0, 0.25]], "the first signal is the base itself: no jump");
});

test("a continuous parameter does not ask for item names", () => {
    const r = row();
    const { queries } = mapDial(r);
    assert.ok(!queries.some((x) => x[2] === "value_items"));
    assert.ok(!r.drain().some((x) => x[2] === "value_items"));
});

test("the signal is base + offset × range, clamped to 0..1", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.ctx.msg_float(0.5);
    assert.deepEqual(r.drain(), [[0, 0.75]]);
    r.ctx.msg_float(-0.5);
    assert.deepEqual(r.drain(), [[0, 0]]);
    r.ctx.msg_float(0.9);
    assert.deepEqual(r.drain(), [[0, 1]]);
    r.send("range", 0.5);
    r.drain();
    r.ctx.msg_float(0.5);
    assert.deepEqual(r.drain(), [[0, 0.5]]);
});

test("an offset of 0 (a removed cable) returns the parameter to its base", () => {
    const r = row();
    mapDial(r, 7, 0.4);
    r.ctx.msg_float(0.3);
    r.drain();
    r.ctx.msg_float(0);
    assert.deepEqual(r.drain(), [[0, 0.4]]);
});

test("a parameter on another scale is normalised with min and max", () => {
    const r = row();
    mapDial(r, 7, 5, 0, 10);
    assert.deepEqual(r.drain(), []);
    r.ctx.msg_float(0);
    assert.deepEqual(r.drain(), [[0, 0.5]]);
});

test("unmap releases the remote and puts the knob back at its base", () => {
    const r = row();
    mapDial(r, 7, 0.25, 0, 10);   // raw 0.25 on a 0..10 scale: the knob goes back to 0.25, not to 2.5
    r.ctx.msg_float(0.4);
    r.drain();
    r.send("unmap");
    const m = r.drain();
    assert.deepEqual(on(m, 2), [[2, "id", 0]]);
    assert.deepEqual(sets(m), [0.25]);
    r.ctx.msg_float(0.4);
    assert.deepEqual(r.drain(), [], "nothing is sent after release");
});

test("the range (amount) is for dials: a discrete row ignores it", () => {
    const r = row();
    mapDiscrete(r, 7, 0, 0, 3);
    r.send("range", 0.1);
    r.drain();
    r.ctx.msg_float(1);
    assert.deepEqual(sets(r.drain()), [3]);
});

// ---- discrete (is_quantized 1): switches and menus --------------------------------------------------------------

test("a quantised parameter is not refused: it becomes a discrete row, and mapping does not set it", () => {
    const r = row();
    r.send("id", 9);
    const q = r.drain();
    assert.ok(on(q, 4).some((x) => x[2] === "get" || x[1] === "get"));
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
    mapDiscrete(r, 7, 0, 0, 1);
    r.ctx.msg_float(1);
    assert.deepEqual(sets(r.drain()), [1]);
    r.ctx.msg_float(1);
    r.ctx.msg_float(0.9);
    assert.deepEqual(sets(r.drain()), [], "same state: nothing sent");
    r.ctx.msg_float(0.4);
    assert.deepEqual(sets(r.drain()), [0]);
    r.ctx.msg_float(0);
    assert.deepEqual(sets(r.drain()), []);
});

test("a menu picks the item from the 0..1 value, min + round(value × (max − min)), clamped", () => {
    for (const [x, item] of [[0.5, 2], [0.34, 1], [1, 3], [5, 3], [-1, 0], [0.16, 0]]) {
        const r = row();
        mapDiscrete(r, 7, 2, 0, 3);   // a fresh row each time: the first value after mapping is always sent
        r.drain();
        r.ctx.msg_float(x);
        assert.deepEqual(sets(r.drain()), [item], `${x} -> item ${item}`);
    }
    const q = row();
    mapDiscrete(q, 7, 2, 0, 3);
    q.ctx.msg_float(0.34);
    assert.deepEqual(sets(q.drain()), [1]);
    q.ctx.msg_float(0.5);
    assert.deepEqual(sets(q.drain()), [2]);
    q.ctx.msg_float(0.5);
    assert.deepEqual(sets(q.drain()), [], "the same item is not sent again");
});

test("a menu on a scale that starts above 0 adds the minimum", () => {
    const r = row();
    mapDiscrete(r, 7, 11, 10, 14);
    r.ctx.msg_float(0.5);
    assert.deepEqual(sets(r.drain()), [12]);
});

test("a discrete row sets nothing until it is mapped", () => {
    const r = row();
    r.ctx.msg_float(1);
    assert.deepEqual(r.drain(), []);
});

test("unmapping a discrete row puts the parameter back as it was", () => {
    const r = row();
    mapDiscrete(r, 7, 2, 0, 3);
    r.ctx.msg_float(1);
    r.drain();
    r.send("unmap");
    assert.deepEqual(sets(r.drain()), [2]);
    r.ctx.msg_float(0);
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
    sw.ctx.msg_float(0);
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
    m.ctx.msg_float(1);
    assert.deepEqual(states(m.drain()), ["Notch"]);
    m.ctx.msg_float(0);
    assert.deepEqual(states(m.drain()), ["Lowpass"]);
});

test("a two-step parameter that has names (Off, On) shows them", () => {
    const r = row();
    r.send("id", 7);
    r.drain();
    r.send("is_quantized", 1);
    r.send("value_items", "Off", "On");
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0);
    assert.deepEqual(states(r.drain()), ["Off"]);
    r.ctx.msg_float(1);
    assert.deepEqual(states(r.drain()), ["On"]);
});

test("item names with a space stay one name", () => {
    const r = row();
    r.send("id", 7);
    r.send("is_quantized", 1);
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0);
    r.drain();
    r.send("value_items", "Low Cut", "High Cut");
    assert.deepEqual(states(r.drain()), ["Low Cut"]);
});

test("unmapping clears the state text; a dial row never shows one", () => {
    const r = row();
    mapDiscrete(r, 7, 1);
    r.drain();
    r.send("unmap");
    assert.deepEqual(states(r.drain()), [""]);
    const d = row();
    mapDial(d, 7, 0.25);
    d.ctx.msg_float(0.5);
    assert.deepEqual(states(d.drain()), []);
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

test("\"mapped id 12\" (a `mapped $1` box) is tolerated, and so is a stray type message from an old patch", () => {
    const r = row();
    r.send("mapped", "id", 12);
    assert.deepEqual(on(r.drain(), 3), [[3, "id", 12]]);
    r.send("type", "switch");
    assert.deepEqual(r.drain(), [], "ignored");
});

// ---- the id 0 that live.map answers to our own unmap ---------------------------------------------------------------

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

// ---- the status line and the name label ---------------------------------------------------------------------------

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

test("unmapping a row sets its name label to \"not mapped\"", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("unmap");
    assert.deepEqual(names(r.drain()), ["not mapped"]);
});

test("every way a row ends up unmapped says \"not mapped\": id 0 and no answer", () => {
    const c = row();
    c.send("id", 0);
    assert.deepEqual(names(c.drain()), ["not mapped"], "id 0 (live.map could not map it)");

    const d = row();
    d.send("id", 5);
    d.drain();
    d.timeout();
    assert.deepEqual(names(d.drain()), ["not mapped"], "no answer from live.object");
});

test("mapping a parameter does not touch the name label (live.map sets the name itself)", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    assert.deepEqual(names(r.drain()), []);
    r.send("id", 8);                                  // mapping another one first releases the first
    assert.deepEqual(names(r.drain()), [], "a new mapping must not overwrite the name live.map just sent");
    const s = row();
    mapDiscrete(s, 7, 1);
    assert.deepEqual(names(s.drain()), []);
});

test("once mapped, the Map button stays lit but cannot be clicked, and live.map leaves mapping mode (dial)", () => {
    const r = row();
    const { after } = mapDial(r);
    assert.deepEqual(button(after), ["texton mapped", "set 1", "active 0"]);
    assert.ok(on(after, 5).some((x) => x[1] === "mapping" && x[2] === 0), "mapping mode off, so another click in Live does not remap");
});

test("the same for a discrete parameter", () => {
    const r = row();
    const { after } = mapDiscrete(r);
    assert.deepEqual(button(after), ["texton mapped", "set 1", "active 0"]);
    assert.ok(on(after, 5).some((x) => x[1] === "mapping" && x[2] === 0));
});

test("the button is not touched while the row is only waiting for a click, or when the click cannot be mapped", () => {
    const r = row();
    r.send("id", 0);                       // live.map: nothing mappable was clicked
    assert.deepEqual(button(r.drain()), ["texton not mappable"], "stays lit and clickable so the user can try again; says why");
    r.send("id", 7);
    assert.deepEqual(button(r.drain()), [], "reading: not yet mapped");
});

test("× (unmap) makes the button clickable again and turns it off, which also ends mapping mode", () => {
    const r = row();
    mapDial(r);
    r.drain();
    r.send("unmap");
    assert.deepEqual(button(r.drain()), ["text Map", "texton Mapping...", "active 1", "0"]);
});

test("a row that gave up (no answer from live.object) frees the button too", () => {
    const r = row();
    r.send("id", 5);
    r.drain();
    r.timeout();
    assert.deepEqual(button(r.drain()), ["text no answer", "texton Mapping...", "active 1", "0"], "dark again, and it says why");
});

test("the locked Map button shows the parameter it is mapped to, whether continuous or discrete", () => {
    const r = row();
    mapDial(r);
    r.drain();
    r.send("name", "Frequency");
    assert.deepEqual(button(r.drain()), ["texton Frequency"]);
    const d = row();
    mapDiscrete(d, 7, 1, 0, 3);
    d.drain();
    d.send("name", "Filter", "Type");
    assert.deepEqual(button(d.drain()), ["texton Filter Type"], "a name of several atoms is joined");
});

test("× puts the button's texts back to Map / Mapping..., so a name never lingers after unmapping", () => {
    const r = row();
    mapDial(r);
    r.send("name", "Frequency");
    r.drain();
    r.send("unmap");
    const b = button(r.drain());
    assert.equal(b[0], "text Map");
    assert.equal(b[1], "texton Mapping...");
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
