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
    const timeout = () => { if (ctx.waiting.armed) { ctx.waiting.armed = false; ctx.waiting.fn(); } };
    const drain = () => out.splice(0);
    return { ctx, send, drain, out, timeout };
}

// live.object answers the four queries of a continuous parameter at 0.25 on a 0..1 scale.
function mapDial(r, id = 7, value = 0.25, min = 0, max = 1) {
    r.send("mapped", id);
    const queries = r.drain();
    r.send("is_quantized", 0);
    r.send("min", min);
    r.send("max", max);
    r.send("value", value);
    return { queries, after: r.drain() };
}

test_ids();
function test_ids() {
    const r = row();
    r.send("id", 12);
    assert.deepEqual(r.drain().filter((m) => m[0] === 3), [[3, "id", 12]], "\"id 12\" straight from live.map");
    const q = row();
    q.send("mapped", "id", 12);
    assert.deepEqual(q.drain().filter((m) => m[0] === 3), [[3, "id", 12]], "\"mapped id 12\" (a `mapped $1` box) is tolerated");
}

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok:", name); };

test("mapping asks live.object first and attaches the remote only after all four answers", () => {
    const r = row();
    r.send("mapped", 7);
    const q = r.drain();
    assert.deepEqual(q.filter((m) => m[0] === 3), [[3, "id", 7]]);
    assert.deepEqual(q.filter((m) => m[0] === 4).map((m) => m[2]), ["is_quantized", "min", "max", "value"]);
    assert.equal(q.filter((m) => m[0] === 2).length, 0, "no id to live.remote~ yet");
    r.send("is_quantized", 0);
    r.send("min", 0);
    r.send("max", 1);
    assert.equal(r.drain().filter((m) => m[0] === 2).length, 0, "still waiting for the value");
    r.send("value", 0.25);
    const after = r.drain();
    assert.deepEqual(after.filter((m) => m[0] === 2), [[2, "id", 7]]);
    assert.deepEqual(after.filter((m) => m[0] === 0), [[0, 0.25]], "the first signal is the base itself: no jump");
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

test("a quantised parameter is refused and unmapped", () => {
    const r = row();
    r.send("mapped", 9);
    r.drain();
    r.send("is_quantized", 1);
    r.send("min", 0);
    r.send("max", 7);
    r.send("value", 3);
    const m = r.drain();
    assert.ok(m.some((x) => x[0] === 1 && x[1] === "set" && x[2] === "dials only"));
    assert.ok(m.some((x) => x[0] === 5 && x[1] === "unmap"));
    assert.equal(m.filter((x) => x[0] === 2).length, 0, "never attached");
    r.ctx.msg_float(0.5);
    assert.deepEqual(r.drain(), [], "no signal for a refused row");
});

test("unmap releases the remote and puts the knob back at its base", () => {
    const r = row();
    mapDial(r, 7, 0.25, 0, 10);   // raw 0.25 on a 0..10 scale: the knob goes back to 0.25, not to 2.5
    r.ctx.msg_float(0.4);
    r.drain();
    r.send("unmap");
    const m = r.drain();
    assert.deepEqual(m.filter((x) => x[0] === 2), [[2, "id", 0]]);
    assert.deepEqual(m.filter((x) => x[0] === 4), [[4, "set", "value", 0.25]]);
    r.ctx.msg_float(0.4);
    assert.deepEqual(r.drain(), [], "nothing is sent after release");
});

test("mapping a second parameter first releases the first", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("mapped", 8);
    const m = r.drain();
    assert.deepEqual(m.filter((x) => x[0] === 2), [[2, "id", 0]]);
    assert.deepEqual(m.filter((x) => x[0] === 3), [[3, "id", 8]]);
});

test("a late answer after release does not attach", () => {
    const r = row();
    r.send("mapped", 7);
    r.send("unmap");
    r.drain();
    r.send("is_quantized", 0);
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0.5);
    assert.equal(r.drain().filter((x) => x[0] === 2).length, 0);
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
    assert.equal(m.filter((x) => x[0] === 2).length, 0, "never attached");
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
    assert.ok(m.some((x) => x[0] === 1 && x[1] === "set" && x[2] === "not mappable"));
    assert.equal(m.filter((x) => x[0] === 2 || x[0] === 3 || x[0] === 4).length, 0, "nothing sent to live.object or live.remote~");
    assert.equal(r.ctx.waiting.armed, false);
});

test("id 0 while a parameter is mapped releases it first", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("id", 0);
    const m = r.drain();
    assert.deepEqual(m.filter((x) => x[0] === 2), [[2, "id", 0]]);
});

// ---- switch and menu rows ------------------------------------------------------------------------------

// live.object answers for a quantised parameter: `orig` now, on the scale min..max.
function mapDiscrete(r, kind, id = 7, orig = 1, min = 0, max = 1) {
    r.send("type", kind);
    r.drain();
    r.send("id", id);
    const queries = r.drain();
    r.send("is_quantized", 1);
    r.send("min", min);
    r.send("max", max);
    r.send("value", orig);
    return { queries, after: r.drain() };
}
const sets = (m) => m.filter((x) => x[0] === 4 && x[1] === "set").map((x) => x[3]);

test("a switch row: mapping does not set the parameter; it never uses live.remote~ or the signal", () => {
    const r = row();
    const { after } = mapDiscrete(r, "switch", 7, 1);
    assert.ok(after.some((x) => x[0] === 1 && x[1] === "set" && x[2] === "mapped"));
    assert.deepEqual(after.filter((x) => x[0] === 0 || x[0] === 2), [], "no signal and no id to live.remote~");
    assert.deepEqual(sets(after), [], "the parameter is left as it was");
});

test("a switch row sets on/off from the gate, and only when the state changes", () => {
    const r = row();
    mapDiscrete(r, "switch", 7, 0);
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

test("a menu row picks the item from the 0..1 value, min + round(value × (max − min)), clamped", () => {
    for (const [x, item] of [[0.5, 2], [0.34, 1], [1, 3], [5, 3], [-1, 0], [0.16, 0]]) {
        const r = row();
        mapDiscrete(r, "menu", 7, 2, 0, 3);   // a fresh row each time: the first value after mapping is always sent
        r.drain();
        r.ctx.msg_float(x);
        assert.deepEqual(sets(r.drain()), [item], `${x} -> item ${item}`);
    }
    const q = row();
    mapDiscrete(q, "menu", 7, 2, 0, 3);
    q.ctx.msg_float(0.34);
    assert.deepEqual(sets(q.drain()), [1]);
    q.ctx.msg_float(0.5);
    assert.deepEqual(sets(q.drain()), [2]);
    q.ctx.msg_float(0.5);
    assert.deepEqual(sets(q.drain()), [], "the same item is not sent again");
});

test("a menu on a scale that starts above 0 adds the minimum", () => {
    const r = row();
    mapDiscrete(r, "menu", 7, 11, 10, 14);
    r.ctx.msg_float(0.5);
    assert.deepEqual(sets(r.drain()), [12]);
});

test("a switch or menu row that is not mapped sets nothing", () => {
    const r = row();
    r.send("type", "switch");
    r.ctx.msg_float(1);
    assert.deepEqual(r.drain().filter((x) => x[0] === 4), []);
});

test("unmapping a switch or menu puts the parameter back as it was", () => {
    const r = row();
    mapDiscrete(r, "menu", 7, 2, 0, 3);
    r.ctx.msg_float(1);
    r.drain();
    r.send("unmap");
    assert.deepEqual(sets(r.drain()), [2]);
    r.ctx.msg_float(0);
    assert.deepEqual(r.drain().filter((x) => x[0] === 4), [], "nothing is set after unmapping");
});

test("a switch or menu row refuses a continuous parameter, and a dial row refuses a quantised one", () => {
    const r = row();
    r.send("type", "menu");
    r.send("id", 7);
    r.drain();
    r.send("is_quantized", 0);
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 0.5);
    const m = r.drain();
    assert.ok(m.some((x) => x[0] === 1 && x[1] === "set" && x[2] === "switches and menus only"));
    assert.ok(m.some((x) => x[0] === 5 && x[1] === "unmap"));
    r.ctx.msg_float(1);
    assert.deepEqual(r.drain().filter((x) => x[0] === 4), []);
});

test("changing the row type releases what was mapped", () => {
    const r = row();
    mapDial(r, 7, 0.25);
    r.send("type", "switch");
    const m = r.drain();
    assert.deepEqual(m.filter((x) => x[0] === 2), [[2, "id", 0]], "the dial is released");
    assert.ok(m.some((x) => x[0] === 1 && x[2] === "waiting"));
    r.ctx.msg_float(0.5);
    assert.deepEqual(r.drain(), [], "nothing mapped, nothing sent");
    r.send("type", "bogus");
    assert.deepEqual(r.drain(), [], "an unknown type is ignored");
});

test("the dial row is unchanged by the new types", () => {
    const r = row();
    r.send("type", "dial");
    r.drain();
    const { after } = mapDial(r, 7, 0.25);
    assert.deepEqual(after.filter((x) => x[0] === 2), [[2, "id", 7]]);
    r.ctx.msg_float(0.5);
    assert.deepEqual(r.drain(), [[0, 0.75]]);
});

const states = (m) => m.filter((x) => x[0] === 6).map((x) => x[2]);

test("a switch row shows its state: the current one when mapped, then each change", () => {
    const r = row();
    r.send("type", "switch");
    r.send("id", 7);
    r.drain();   // (mapping first clears the state text of what was mapped before)
    r.send("is_quantized", 1);
    r.send("min", 0);
    r.send("max", 1);
    r.send("value", 1);
    assert.deepEqual(states(r.drain()), ["on"]);
    r.ctx.msg_float(0);
    assert.deepEqual(states(r.drain()), ["off"]);
});

test("a menu row asks for the item names, and shows the current item, then each pick", () => {
    const r = row();
    r.send("type", "menu");
    r.drain();
    r.send("id", 7);
    const q = r.drain();
    assert.ok(q.some((x) => x[0] === 4 && x[1] === "get" && x[2] === "value_items"));
    r.send("is_quantized", 1);
    r.send("min", 0);
    r.send("max", 3);
    r.send("value", 1);
    assert.deepEqual(states(r.drain()), ["1"], "no names yet: the number");
    r.send("value_items", "Lowpass", "Highpass", "Bandpass", "Notch");
    assert.deepEqual(states(r.drain()), ["Highpass"], "the names arrive: the current item's name");
    r.ctx.msg_float(1);
    assert.deepEqual(states(r.drain()), ["Notch"]);
    r.ctx.msg_float(0);
    assert.deepEqual(states(r.drain()), ["Lowpass"]);
});

test("item names with a space stay one name", () => {
    const r = row();
    r.send("type", "menu");
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
    mapDiscrete(r, "switch", 7, 1);
    r.drain();
    r.send("unmap");
    assert.deepEqual(states(r.drain()), [""]);
    const d = row();
    mapDial(d, 7, 0.25);
    d.ctx.msg_float(0.5);
    assert.deepEqual(states(d.drain()), []);
});

console.log(`${n} tests passed`);
