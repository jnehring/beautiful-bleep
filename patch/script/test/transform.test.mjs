// SPDX-License-Identifier: GPL-3.0-or-later
// The Bleep Script transform: the spec it generates, the errors it reports, and the parameter kinds (int, choice), with the
// result run in the Bleep module host.   node test/transform.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import asc from "assemblyscript/asc";
import { BleepTransform } from "../transform/bleep.mjs";
import { compileScript } from "../compiler/compile.mjs";
import { compileModule, ModuleInstance, CHUNK } from "../../web/js/module-host.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const lib = Object.fromEntries(["abi", "dsp", "format", "notes"].map((n) => [`src/bleep/${n}.ts`, readFileSync(`${root}src/bleep/${n}.ts`, "utf8")]));
let failures = 0;
const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? "  " + detail : ""}`); if (!ok) failures++; };

async function compile(source, name = "t") {
  const files = { ...lib, [`src/${name}.dsp.ts`]: source };
  const transform = new BleepTransform();
  let wasm = null;
  const { error } = await asc.main([`src/${name}.dsp.ts`, "--outFile", "o.wasm", "--runtime", "stub", "--use", "abort=", "--exportStart", "_initialize",
    "--disableWarning", "235", "--noAssert", "--optimizeLevel", "2"], {
    readFile: (n) => files[n.replace(/^\.\//, "")] ?? null, writeFile: (n, d) => { wasm = d; }, listFiles: () => [],
    stderr: { write() {} }, transforms: [transform],
  });
  return { error, wasm, transform };
}

// ---- 1. the generated description equals the one written by hand in the first spike ---------------------------------------
{
  const { error, transform } = await compile(readFileSync(`${root}src/gains.dsp.ts`, "utf8"), "gains");
  const byHand = [{
    type: "gains", name: "Gains", category: "Utility/Mixing", colour: "#94a3b8",
    description: "Volume, mute and solo for one channel, with smoothing. Written in Bleep Script.", port: "", creatable: true, standaloneOnly: false,
    params: [
      { id: "vol", name: "Volume", kind: "float", default: 0.909090909, steps: 0, modulatable: true, min: -60, max: 6, def: 0, format: "number", decimals: 1, minText: "-inf", label: "dB" },
      { id: "mute", name: "Mute", kind: "bool", default: 0, steps: 2, modulatable: false, min: 0, max: 1, def: 0, format: "toggle", decimals: 0 },
      { id: "solo", name: "Solo", kind: "bool", default: 0, steps: 2, modulatable: false, min: 0, max: 1, def: 0, format: "toggle", decimals: 0 },
    ],
    inputs: [{ id: "x", name: "In", type: "audio", bipolar: true }, { id: "othersSolo", name: "Others Solo", type: "gate", bipolar: false }],
    outputs: [{ id: "out", name: "Out", type: "audio", bipolar: true }, { id: "soloOut", name: "Solo Out", type: "gate", bipolar: false }],
    buttons: [],
    probes: [{ id: "level", name: "Level", description: "The output level, for the channel's meter." }],
    settings: [],
  }];
  check(!error, "Gains compiles with the transform", error && error.message);
  const { cost, ...generated } = transform.specs[0];
  check(JSON.stringify([generated]) === JSON.stringify(byHand), "the generated description equals the hand-written one",
    JSON.stringify([generated]) === JSON.stringify(byHand) ? "" : JSON.stringify(generated));
  check(cost && cost.ops > 0 && cost.ops < 20000 && cost.sample > 0, "and carries a cost estimate", JSON.stringify(cost));
}

// ---- 2. errors come with the file and the line ---------------------------------------------------------------------------------
const wrap = (body) => `@module({ name: "T" })\nexport class T {\n${body}\n  constructor(sampleRate: f64) {}\n}\n`;
const mustFail = async (what, body, expect) => {
  const { error } = await compile(typeof body === "string" && /^\s*(@module|@external|declare|import|const )/.test(body) ? body : wrap(body));
  check(!!error && error.message.includes(expect), what, error ? error.message.split("\n")[0] : "it compiled");
};
await mustFail("an input must be f32", `  @input x: i32 = 0;`, "must be f32");
await mustFail("a float param needs min and max", `  @param({ name: "A" }) a: f32 = 0;`, "needs min and max");
await mustFail("decorator arguments must be literals", `  @param({ min: foo, max: 1 }) a: f32 = 0;`, "only literals");
await mustFail("no calls in decorator arguments", `  @param({ min: foo(), max: 1 }) a: f32 = 0;`, "decorator arguments");
await mustFail("one decorator per field", `  @input @param({ min: 0, max: 1 }) a: f32 = 0;`, "more than one");
await mustFail("a module must declare something", `  private a: f32 = 0;`, "declares nothing");
await mustFail("choices need an i32 field", `  @param({ choices: ["a", "b"] }) a: f32 = 0;`, "must be i32");
await mustFail("init inside the range", `  @param({ min: 0, max: 1, init: 5 }) a: f32 = 5;`, "outside");
await mustFail("init and the field's initial value must agree", `  @param({ min: 0, max: 10, init: 3 }) a: f32 = 4;`, "differs from the field");
await mustFail("a signal type must exist", `  @input({ type: "midi" }) a: f32 = 0;`, "type must be one of");
{
  const { error } = await compile(wrap(`  @input x: i32 = 0;`));
  check(error && /t\.dsp\.ts:3:/.test(error.message), "the error names the file and the line", error && error.message.split("\n")[0]);
}
{
  const { error } = await compile(wrap(`  @output out: f32 = 0;\n  sample(): void { this.out = nope; }`));
  check(!!error, "a type error in the user's code is still reported by the compiler");
}

// ---- 2b. the subset: what real-time code may not do --------------------------------------------------------------------------------------
const rt = (body, before = "") => `${before}\n@module({ name: "T" })\nexport class T {\n  @input x: f32 = 0;\n  @output out: f32 = 0;\n  private v: f32 = 0;\n  constructor(sampleRate: f64) {}\n${body}\n}\n`;
const ok = async (what, source) => { const { error } = await compile(source); check(!error, what, error && error.message.split("\n")[0]); };
await ok("a bounded for loop, Math and a helper method are fine", rt(`  helper(a: f32): f32 { return a * 2; }\n  sample(): void { let s: f32 = 0; for (let i = 0; i < 8; i++) { s += this.helper(<f32>Math.sin(<f64>i)); } this.out = this.x + s; }`));
await ok("a top-level const can bound a loop", rt(`  sample(): void { let s: f32 = 0; for (let i = 0; i < N; i += 2) { s += 1; } this.out = s; }`, "const N = 16;"));
await ok("a count down loop is bounded too", rt(`  sample(): void { let s: f32 = 0; for (let i = 8; i > 0; i--) { s += 1; } this.out = s; }`));
await mustFail("a while loop", rt(`  sample(): void { while (this.v < 1) { this.v += 0.1; } }`), "while loop");
await mustFail("a loop bounded by a variable", rt(`  sample(): void { const n = <i32>this.x; for (let i = 0; i < n; i++) { this.v += 1; } }`), "loop bound must be constant");
await mustFail("for...of", rt(`  private a: StaticArray<f32> = new StaticArray<f32>(4);\n  sample(): void { for (const e of this.a) { this.v += e; } }`), "for...of");
await mustFail("a loop that is too long", rt(`  sample(): void { for (let i = 0; i < 100000; i++) { this.v += 1; } }`), "at most 4096");
await mustFail("recursion", rt(`  f(n: f32): f32 { return n <= 0 ? 0 : this.f(n - 1); }\n  sample(): void { this.out = this.f(3); }`), "recursion");
await mustFail("mutual recursion", rt(`  a(): f32 { return this.b(); }\n  b(): f32 { return this.a(); }\n  sample(): void { this.out = this.a(); }`), "recursion");
await mustFail("new in real-time code", rt(`  sample(): void { const a = new StaticArray<f32>(4); this.out = a[0]; }`), "`new` allocates");
await mustFail("an array literal", rt(`  sample(): void { const a: f32[] = [1, 2]; this.out = a[0]; }`), "array and object literals");
await mustFail("a template string", rt("  sample(): void { const t = `v${this.v}`; }"), "template strings");
await mustFail("string concatenation", rt(`  sample(): void { const t = "a" + "b"; }`), "concatenation");
await mustFail("a closure", rt(`  sample(): void { const f = (a: f32): f32 => a; this.out = f(this.x); }`), "closures");
await mustFail("try/catch", rt(`  sample(): void { try { this.v = 1; } catch (e) { } }`), "exceptions");
await mustFail("an allocating method", rt(`  private a: f32[] = [];\n  sample(): void { this.a.push(this.x); }`), "may allocate");
await mustFail("a call to an unknown function", rt(`  sample(): void { somewhere(this.x); }`), "unknown function 'somewhere'");
await mustFail("a call that is only reached through a helper is checked too", rt(`  h(): void { while (true) { } }\n  sample(): void { this.h(); }`), "while loop");
await ok("constructors may allocate (and a field initialiser may call new)", rt(`  private a: StaticArray<f32> = new StaticArray<f32>(8);\n  sample(): void { this.out = this.a[0]; }`));
await mustFail("block() is real-time code too", rt(`  block(): void { while (true) { } }`), "while loop");
await mustFail("a host import", rt(`  sample(): void { }`, `declare function evil(): void;`), "host import");
await mustFail("@external", rt(`  sample(): void { }`, `@external("env", "x")\ndeclare function x(): void;`), "not allowed");
await mustFail("raw memory: load", rt(`  sample(): void { this.out = load<f32>(0); }`), "'load' is not allowed");
await mustFail("raw memory: store", rt(`  sample(): void { store<f32>(0, 1.0); }`), "'store' is not allowed");
await mustFail("raw memory: memory.grow", rt(`  sample(): void { memory.grow(1); }`), "'memory' is not allowed");
await mustFail("raw memory: changetype", rt(`  sample(): void { const p = changetype<usize>(this); }`), "'changetype' is not allowed");
await mustFail("unreachable", rt(`  sample(): void { unreachable(); }`), "'unreachable' is not allowed");
{
  const r = await compile(rt(`  sample(): void { }`, `import { x } from "./other";`));
  check(!r.wasm && !!r.error, "an import from outside bleep/ is refused (only the bleep/ library files exist for the compiler)", r.error && r.error.message);
}
await mustFail("a module over the cost limit", rt(`  sample(): void { for (let i = 0; i < 4000; i++) { for (let j = 0; j < 4000; j++) { this.v += Math.sin(<f64>j) as f32; } } }`), "ops per chunk");
{
  const { error, transform } = await compile(rt(`  sample(): void { while (true) { } for (;;) { } }`));
  check(transform.problems.filter((p) => p.severity === "error").length >= 2, "all breaches are reported, not just the first", String(transform.problems.length));
}
{
  const { transform } = await compile(rt(`  sample(): void { for (let i = 0; i < 10; i++) { for (let j = 0; j < 10; j++) { this.v += Math.sin(<f64>j) as f32; } } }`));
  check(transform.problems.some((p) => p.severity === "warning" && /ops per chunk/.test(p.message)), "a heavy module compiles with a warning", transform.problems.map((p) => p.message).join(" | "));
}

// ---- 3. int and choice params, several modules in one file, run in the module host -----------------------------------------
{
  const source = `
@module({ name: "Pick", category: "Utility/Test" })
export class Pick {
  @input x: f32 = 0;
  @output out: f32 = 0;
  @param({ name: "Shape", choices: ["Low", "Mid", "High"] }) shape: i32 = 1;
  @param({ name: "Steps", min: 1, max: 8 }) steps: i32 = 4;
  @param({ min: -1, max: 1, decimals: 2, group: "Level" }) amount: f32 = 0.5;
  @param({ name: "Hold" }) hold: bool = true;
  private k: f32 = 0;
  constructor(sampleRate: f64) {}
  block(): void { this.k = <f32>((this.shape + 1) * this.steps) * this.amount * (this.hold ? 1.0 : 0.0); }
  sample(): void { this.out = this.x * this.k; }
}

@module("Second")
export class Second {
  @output out: f32 = 0;
  @probe seen: f32 = 7;
  constructor(sampleRate: f64) {}
  sample(): void { this.out = 0.25; }
}`;
  const { error, wasm, transform } = await compile(source);
  check(!error, "int, choice, bool, float params and two modules in one file compile", error && error.message);
  if (!error) {
    const specs = transform.specs;
    check(specs.length === 2 && specs[0].type === "pick" && specs[1].type === "second", "type ids come from the class names", specs.map((s) => s.type).join(","));
    const [shape, steps, amount, hold] = specs[0].params;
    check(shape.kind === "choice" && shape.steps === 3 && shape.default === 0.5 && shape.choices.join() === "Low,Mid,High", "choice description");
    check(steps.kind === "int" && steps.steps === 8 && Math.abs(steps.default - 3 / 7) < 1e-8, "int description", `default ${steps.default}`);
    check(amount.kind === "float" && amount.default === 0.75 && amount.group === "Level" && amount.decimals === 2, "float description with group and decimals");
    check(hold.kind === "bool" && hold.def === 1 && hold.default === 1, "bool defaults to its initialiser");
    check(specs[0].inputs[0].name === "X" && specs[0].outputs[0].type === "audio", "default names and types");

    const module = await compileModule(wasm);
    check(WebAssembly.Module.imports(module).length === 0, "still no imports");
    const m = new ModuleInstance(module, 48000, "pick");
    const run = (shapeN, stepsN, amountN, holdN) => {
      m.params.fill(shapeN, 0, CHUNK); m.params.fill(stepsN, CHUNK, 2 * CHUNK); m.params.fill(amountN, 2 * CHUNK, 3 * CHUNK); m.params.fill(holdN, 3 * CHUNK, 4 * CHUNK);
      m.inputs.fill(1, 0, CHUNK); m.process(CHUNK);
      return m.outputs[0];
    };
    // shape Mid (index 1, norm 0.5) -> 2; steps norm 3/7 -> 4; amount norm 0.75 -> 0.5; => 2 * 4 * 0.5 = 4
    check(Math.abs(run(0.5, 3 / 7, 0.75, 1) - 4) < 1e-4, "param values reach the module in units (choice index, integer, float)", String(m.outputs[0]));
    check(Math.abs(run(1, 1, 1, 1) - 24) < 1e-4, "the top of every range: 3 * 8 * 1 = 24");
    check(run(1, 1, 1, 0) === 0, "a bool at 0 is false");
    check(m.paramText(0, 0.5) === "Mid" && m.paramText(1, 3 / 7) === "4" && m.paramText(2, 0.75) === "0.50", "param text: choice name, integer, decimals",
      JSON.stringify([m.paramText(0, 0.5), m.paramText(1, 3 / 7), m.paramText(2, 0.75)]));
    const second = new ModuleInstance(module, 48000, "second");
    second.process(CHUNK);
    check(Math.abs(second.outputs[0] - 0.25) < 1e-6 && second.live().values.seen === 7, "the second module runs, with its probe");
  }
}

// ---- 4. events: notes jacks and @on handlers ---------------------------------------------------------------------------------------------
{
  const source = `
import { NoteEvent, NoteStream } from "./bleep/notes";

@module({ name: "Router", category: "Utility/Script" })
export class Router {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @input({ name: "CC", type: "control" }) cc1: f32 = 0;
  @output({ name: "Low", type: "notes" }) low!: NoteStream;
  @output({ name: "High", type: "notes" }) high!: NoteStream;
  @output({ name: "Gate", type: "gate" }) gate: f32 = 0;
  @probe count: f32 = 0;

  constructor(sampleRate: f64) {}

  @on("notes") route(n: NoteEvent): void {
    this.count += 1;
    if (n.pitch < 0) this.low.push(n);
    else { n.transpose(12); this.high.push(n); }
  }
  @on("cc1", { rising: 0.5 }) open(): void { this.gate = 1; }
  @on("cc1", { falling: 0.5 }) close(): void { this.gate = 0; }
}`;
  const { error, wasm, transform } = await compile(source, "router");
  check(!error, "a router with notes jacks and @on handlers compiles", error && error.message);
  if (!error) {
    const spec = transform.specs[0];
    check(spec.inputs.map((j) => j.type).join() === "notes,control" && spec.outputs.map((j) => j.type).join() === "notes,notes,gate", "notes jacks in the description");
    check(spec.cost.handlers > 0, "handlers count in the cost estimate", JSON.stringify(spec.cost));
    const module = await compileModule(wasm);
    check(WebAssembly.Module.imports(module).length === 0, "a router imports nothing");
    const m = new ModuleInstance(module, 48000);
    const NOTE_ON = 0;
    m.setNotesIn(0, [{ type: NOTE_ON, offset: 3, note: 60, pitch: 0, value: 0.8 }, { type: NOTE_ON, offset: 10, note: 48, pitch: -1, value: 0.5 }]);
    for (let i = 0; i < CHUNK; i++) m.inputs[1 * CHUNK + i] = i < 5 || i >= 20 ? 0 : 1;   // rises at sample 5, falls at sample 20
    m.process(CHUNK);
    const low = m.notesOut(0), high = m.notesOut(1);
    check(low.length === 1 && low[0].note === 48 && low[0].offset === 10 && Math.abs(low[0].pitch + 1) < 1e-6, "a low note goes out the Low jack, unchanged", JSON.stringify(low));
    check(high.length === 1 && high[0].note === 72 && high[0].offset === 3 && Math.abs(high[0].pitch - 1) < 1e-6 && Math.abs(high[0].value - 0.8) < 1e-6, "a high note goes out the High jack, an octave up, at its sample", JSON.stringify(high));
    const gate = (i) => m.outputs[2 * CHUNK + i];
    check(gate(4) === 0 && gate(5) === 1 && gate(19) === 1 && gate(20) === 0, "the rising edge at sample 5 and the falling edge at sample 20 are sample-accurate", [gate(4), gate(5), gate(19), gate(20)].join());
    check(m.live().values.count === 2, "the handler ran once per event", String(m.live().values.count));
    m.setNotesIn(0, []);
    m.process(CHUNK);
    check(m.notesOut(0).length === 0 && m.notesOut(1).length === 0, "outputs start every chunk empty");
    const many = Array.from({ length: 64 }, (_, k) => ({ type: NOTE_ON, offset: Math.min(31, k >> 1), note: 36 + (k % 12), pitch: 1, value: 0.5 }));
    m.setNotesIn(0, many);
    m.process(CHUNK);
    check(m.notesOut(1).length === 64, "64 events in, 64 events out", String(m.notesOut(1).length));
  }
}
// ---- 5. exponential and skewed parameters, as the engine maps them (engine/Spec.h) --------------------------------------------------------
{
  const source = `
@module({ name: "Maps" })
export class Maps {
  @output out: f32 = 0;
  @param({ name: "Time", min: 0.01, max: 4, init: 0.5, map: "exp", unit: "s", decimals: 2 }) time: f32 = 0.5;
  @param({ name: "Speed", min: 0, max: 8, centre: 1, init: 1, map: "skew", decimals: 2 }) speed: f32 = 1;
  @param({ name: "Level", min: 0, max: 1, init: 0.5 }) level: f32 = 0.5;
  @probe t: f32 = 0;
  @probe s: f32 = 0;
  constructor(sampleRate: f64) {}
  sample(): void { this.out = this.time; }
  block(): void { this.t = this.time; this.s = this.speed; }
}`;
  const { error, wasm, transform } = await compile(source, "maps");
  check(!error, "exp and skew params compile", error && error.message);
  if (!error) {
    const [time, speed] = transform.specs[0].params;
    const expDefault = Math.log(0.5 / 0.01) / Math.log(4 / 0.01);
    const skew = Math.log(0.5) / Math.log((1 - 0) / (8 - 0));
    check(time.map === "exp" && Math.abs(time.default - expDefault) < 1e-7, "an exponential default is normalised the way the engine does", `${time.default} vs ${expDefault}`);
    check(speed.map === "skew" && speed.centre === 1 && Math.abs(speed.default - Math.pow(1 / 8, skew)) < 1e-7 && Math.abs(speed.default - 0.5) < 1e-6, "a skewed param at its centre is the middle of the knob", String(speed.default));
    const m = new ModuleInstance(await compileModule(wasm), 48000);
    const set = (i, v) => m.params.fill(v, i * CHUNK, (i + 1) * CHUNK);
    const read = () => { m.process(CHUNK); const live = m.live().values; return live; };
    for (const x of [0, 0.25, 0.5, 0.9, 1]) {
      set(0, x); set(1, x); set(2, 0.5);
      const live = read();
      const wantT = 0.01 * Math.pow(4 / 0.01, x);
      const wantS = x <= 0 ? 0 : 0 + 8 * Math.exp(Math.log(x) / skew);
      check(Math.abs(live.t - wantT) < 1e-5 * Math.max(1, wantT) && Math.abs(live.s - wantS) < 1e-4 * Math.max(1, wantS), `knob ${x} maps to ${wantT.toFixed(4)} and ${wantS.toFixed(4)}`, `${live.t}, ${live.s}`);
    }
    check(m.paramText(0, 0.5) === "0.20 s", "param text follows the mapping", m.paramText(0, 0.5));
  }
}
await mustFail("an exponential param needs min above 0", rt(`  sample(): void { }`).replace("private v: f32 = 0;", `@param({ min: 0, max: 1, map: "exp" }) a: f32 = 0;`), "min above 0");
await mustFail("a skewed param needs a centre inside its range", rt(`  sample(): void { }`).replace("private v: f32 = 0;", `@param({ min: 0, max: 1, map: "skew", centre: 2 }) a: f32 = 0;`), "centre");
await mustFail("an unknown map", rt(`  sample(): void { }`).replace("private v: f32 = 0;", `@param({ min: 0, max: 1, map: "log" }) a: f32 = 0;`), "map must be");

// ---- 5b. TSDoc comments become descriptions ------------------------------------------------------------------------------------------------
{
  const source = `
/**
 * A tiny module.
 * It does two things at once.
 *
 * Second paragraph.
 */
@module({ name: "Doc" })
export class Doc {
  /** Where the signal comes in. */
  @input x: f32 = 0;
  @output out: f32 = 0;
  /** How loud, in
   * decibels. */
  @param({ min: -60, max: 6, init: 0 }) vol: f32 = 0;
  @probe plain: f32 = 0;
  /** Presses it. */
  @button go(): void { }
  constructor(sampleRate: f64) {}
}`;
  const { error, transform } = await compile(source, "doc");
  check(!error, "a module with doc comments compiles", error && error.message);
  if (!error) {
    const s = transform.specs[0];
    check(s.description === "A tiny module. It does two things at once.\n\nSecond paragraph.", "the class comment is the description", JSON.stringify(s.description));
    check(s.inputs[0].description === "Where the signal comes in." && s.outputs[0].description === undefined, "a jack's comment is its description");
    check(s.params[0].description === "How loud, in decibels.", "a parameter's comment, joined into one line", JSON.stringify(s.params[0].description));
    check(s.buttons[0].description === "Presses it." && s.probes[0].description === undefined, "a button's comment; no comment, no description");
  }
}

// ---- 5c. settings and counted jacks and params: a mixer with as many channels as you ask for ------------------------------------------------
{
  const source = `
@module({
  name: "Mixer",
  settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 16, init: 4 }],
})
export class Mixer {
  @input({ name: "Ch", type: "audio", count: CHANNELS }) ch!: StaticArray<f32>;
  @param({ name: "Gain", min: 0, max: 1, init: 1, count: CHANNELS, group: "Ch {n}" }) gain!: StaticArray<f32>;
  @param({ name: "Mute", count: CHANNELS, group: "Ch {n}" }) mute!: StaticArray<bool>;
  @output out: f32 = 0;
  @probe({ name: "Level", count: CHANNELS }) level!: StaticArray<f32>;
  constructor(sampleRate: f64) {}
  sample(): void {
    let sum: f32 = 0;
    for (let i = 0; i < CHANNELS; i++) {
      const y = this.mute[i] ? <f32>0 : this.ch[i] * this.gain[i];
      this.level[i] = abs(y);
      sum += y;
    }
    this.out = sum;
  }
}`;
  const lib2 = Object.assign({}, lib);
  const AscModule = (await import("assemblyscript/asc")).default;
  const four = await compileScript(AscModule, source, { lib: lib2 });
  check(!!four.wasm, "a module with settings and counted jacks compiles", four.problems.map((p) => p.message).join(" | "));
  if (four.wasm) {
    const s = four.specs[0];
    check(s.settings.length === 1 && s.settings[0].id === "CHANNELS" && s.settings[0].value === 4 && s.settings[0].init === 4, "its settings are in the description", JSON.stringify(s.settings));
    check(s.inputs.map((j) => j.id).join() === "ch1,ch2,ch3,ch4" && s.inputs[2].name === "Ch 3", "four numbered inputs", s.inputs.map((j) => j.id + ":" + j.name).join());
    check(s.params.map((p) => p.id).join() === "gain1,gain2,gain3,gain4,mute1,mute2,mute3,mute4" && s.params[1].group === "Ch 2" && s.params[5].group === "Ch 2" && s.params[6].kind === "bool", "numbered params with their group", s.params.map((p) => p.id + "/" + p.group).join());
    check(s.probes.map((p) => p.id).join() === "level1,level2,level3,level4", "numbered probes");
    const m = new ModuleInstance(await compileModule(four.wasm), 48000);
    for (let i = 0; i < 4; i++) { m.inputs.fill(0.1 * (i + 1), i * CHUNK, (i + 1) * CHUNK); m.params.fill(1, i * CHUNK, (i + 1) * CHUNK); m.params.fill(0, (4 + i) * CHUNK, (5 + i) * CHUNK); }
    m.process(CHUNK);
    check(Math.abs(m.outputs[0] - 1.0) < 1e-5, "the channels are summed", String(m.outputs[0]));
    m.params.fill(0.5, 1 * CHUNK, 2 * CHUNK); m.params.fill(1, 6 * CHUNK, 7 * CHUNK);   // gain 2 to 0.5, mute 3
    m.process(CHUNK);
    check(Math.abs(m.outputs[0] - (0.1 + 0.1 + 0.4)) < 1e-5, "gain and mute per channel", String(m.outputs[0]));
    const live = m.live().values;
    check(Math.abs(live.level2 - 0.1) < 1e-5 && live.level3 === 0 && Math.abs(live.level4 - 0.4) < 1e-5, "array probes", JSON.stringify(live));
  }
  const six = await compileScript(AscModule, source, { lib: lib2, constants: { CHANNELS: 6 } });
  check(!!six.wasm && six.specs[0].inputs.length === 6 && six.specs[0].params.length === 12 && six.specs[0].settings[0].value === 6, "the same source with CHANNELS = 6 has six channels", six.problems.map((p) => p.message).join(" | "));
  const many = await compileScript(AscModule, source, { lib: lib2, constants: { CHANNELS: 99 } });
  check(!!many.wasm && many.specs[0].inputs.length === 16, "a setting is held to its range (99 becomes 16)");
  const bad = await compileScript(AscModule, source.replace("count: CHANNELS }) ch!", "count: NOPE }) ch!"), { lib: lib2 });
  check(!bad.wasm && bad.problems.some((p) => /NOPE/.test(p.message)), "a count that is not a setting is an error", bad.problems.map((p) => p.message).join(" | "));
  const wrongType = await compileScript(AscModule, source.replace("ch!: StaticArray<f32>", "ch!: f32"), { lib: lib2 });
  check(!wrongType.wasm && wrongType.problems.some((p) => /StaticArray<f32>/.test(p.message)), "a counted field must be a StaticArray", wrongType.problems.map((p) => p.message).join(" | "));
  const tooMany = await compileScript(AscModule, source.replace("max: 16", "max: 100").replace("init: 4 }]", "init: 80 }]"), { lib: lib2 });
  check(!tooMany.wasm && tooMany.problems.some((p) => /from 1 to 64/.test(p.message)), "a count is at most 64", tooMany.problems.map((p) => p.message).join(" | "));
}

// ---- 5d. the configurable mixer example ---------------------------------------------------------------------------------------------------------
{
  const { EXAMPLES } = await import("../playground/examples.mjs");
  const AscModule = (await import("assemblyscript/asc")).default;
  const source = EXAMPLES.find((e) => e.id === "mixer").source;
  const r = await compileScript(AscModule, source, { lib });
  check(!!r.wasm, "the mixer example compiles", r.problems.map((p) => `${p.line}: ${p.message}`).join(" | "));
  if (r.wasm) {
    const s = r.specs[0];
    check(s.inputs.length === 4 && s.params.length === 4 * 7 + 1 && s.probes.length === 5, "four channels of seven controls, a master and five meters", `${s.inputs.length} ${s.params.length} ${s.probes.length}`);
    check(s.cost.ops < 200000, "within the cost limit", JSON.stringify(s.cost));
    const idx = (id) => s.params.findIndex((p) => p.id === id);
    const m = new ModuleInstance(await compileModule(r.wasm), 48000);
    const setP = (id, v) => m.params.fill(v, idx(id) * CHUNK, (idx(id) + 1) * CHUNK);
    for (const p of s.params) setP(p.id, p.default);
    const run = (chunks, gen) => { let last = []; for (let c = 0; c < chunks; c++) { for (let i = 0; i < 4; i++) for (let k = 0; k < CHUNK; k++) m.inputs[i * CHUNK + k] = gen(i, c * CHUNK + k); m.process(CHUNK); last = Array.from(m.outputs.slice(s.outputs.length ? 0 : 0, CHUNK)); } return last; };
    const tone = (i, n) => 0.1 * (i + 1) * Math.sin(2 * Math.PI * 440 * n / 48000);
    const out = run(200, tone);
    const want = Array.from({ length: CHUNK }, (_, k) => [0, 1, 2, 3].reduce((a, i) => a + tone(i, 199 * CHUNK + k), 0));
    const diff = Math.max(...out.map((v, k) => Math.abs(v - want[k])));
    check(diff < 1e-3, "with flat EQs and the faders at 0 dB the output is the sum of the channels", `max difference ${diff.toExponential(2)}`);
    setP("solo2", 1);
    const soloed = run(200, tone);
    const want2 = Array.from({ length: CHUNK }, (_, k) => tone(1, 199 * CHUNK + k));
    check(Math.max(...soloed.map((v, k) => Math.abs(v - want2[k]))) < 1e-3, "solo on channel 2 leaves only channel 2");
    setP("solo2", 0); setP("mute1", 1);
    const muted = run(200, tone);
    const want3 = Array.from({ length: CHUNK }, (_, k) => [1, 2, 3].reduce((a, i) => a + tone(i, 199 * CHUNK + k), 0));
    check(Math.max(...muted.map((v, k) => Math.abs(v - want3[k]))) < 1e-3, "mute on channel 1 takes it out");
    setP("mute1", 0); setP("low1", 1);   // low shelf +15 dB on channel 1 (normalised 1)
    const lowBoost = run(400, (i, n) => (i === 0 ? 0.1 * Math.sin(2 * Math.PI * 50 * n / 48000) : 0));
    const peak = Math.max(...lowBoost.map(Math.abs));
    check(peak > 0.1 * 4 && peak < 0.1 * 7, "a low shelf boost raises a 50 Hz tone about 15 dB (x5.6), allowing for the shelf shape", peak.toFixed(3));
    const live = m.live().values;
    check(Object.keys(live).length === 5 && live.level1 > 0, "the meters report", JSON.stringify(live));
  }
  const eight = await compileScript(AscModule, EXAMPLES.find((e) => e.id === "mixer").source, { lib, constants: { CHANNELS: 8 } });
  check(!!eight.wasm && eight.specs[0].inputs.length === 8 && eight.specs[0].cost.ops > 0, "eight channels", String(eight.specs[0] && eight.specs[0].cost.ops));
  const sixteen = await compileScript(AscModule, EXAMPLES.find((e) => e.id === "mixer").source, { lib, constants: { CHANNELS: 16 } });
  check(!!sixteen.wasm, "sixteen channels is within the cost limit", sixteen.problems.map((p) => p.message).join(" | ") + " " + (sixteen.specs[0] && sixteen.specs[0].cost.ops));
}

// ---- 5e. the widget layout ------------------------------------------------------------------------------------------------------------------
{
  const AscModule = (await import("assemblyscript/asc")).default;
  const source = (layout, extra = "") => `
@module({
  name: "Strips",
  settings: [{ id: "CHANNELS", name: "Channels", min: 1, max: 8, init: 3 }],
  layout: ${layout},
})
export class Strips {
  @input({ name: "Ch", type: "audio", count: CHANNELS }) ch!: StaticArray<f32>;
  @param({ name: "Vol", min: -60, max: 6, init: 0, unit: "dB", count: CHANNELS }) vol!: StaticArray<f32>;
  @param({ name: "Mute", count: CHANNELS }) mute!: StaticArray<bool>;
  @param({ name: "Shape", choices: ["A", "B"] }) shape: i32 = 0;
  @param({ name: "Master", min: 0, max: 1, init: 1 }) master: f32 = 1;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;
  @probe({ name: "Level", count: CHANNELS }) level!: StaticArray<f32>;
  @probe({ name: "Peak" }) peak: f32 = 0;
  constructor(sampleRate: f64) {}
  @button({ name: "Clear" }) clear(): void { this.peak = 0; }
  sample(): void { let s: f32 = 0; for (let i = 0; i < CHANNELS; i++) { s += this.ch[i] * this.vol[i]; this.level[i] = abs(s); } this.out = s; }
  ${extra}
}`;
  const good = source(`[
    { row: [{ repeat: CHANNELS, column: [{ fader: "vol{n}", meter: "level{n}" }, { toggle: "mute{n}" }], title: "Ch {n}" }] },
    { row: [{ select: "shape" }, { knob: "master" }, { meter: "peak" }, "clear", { value: "master" }, { label: "Hello" }, { spacer: 1 }] },
  ]`);
  const r = await compileScript(AscModule, good, { lib });
  check(!!r.wasm, "a module with a widget layout compiles", r.problems.map((p) => p.message).join(" | "));
  if (r.wasm) {
    const layout = r.specs[0].layout;
    check(layout.length === 2 && layout[0].type === "row" && layout[0].children.length === 3, "repeat is unrolled: one column per channel", JSON.stringify(layout[0]).slice(0, 200));
    const first = layout[0].children[0];
    check(first.title === "Ch 1" && first.children[0].type === "fader" && first.children[0].param === "vol1" && first.children[0].probe === "level1" && first.children[1].type === "toggle" && first.children[1].param === "mute1", "{n} becomes the channel number; a fader carries its meter");
    check(layout[0].children[2].title === "Ch 3", "all three channels");
    const second = layout[1].children;
    check(second.map((w) => w.type).join() === "select,knob,meter,button,value,label,spacer" && second[3].button === "clear", "bare ids and every widget kind", second.map((w) => w.type).join());
    const four = await compileScript(AscModule, good, { lib, constants: { CHANNELS: 5 } });
    check(four.specs[0].layout[0].children.length === 5, "the repeat follows the setting (5 channels)");
  }
  const bad = async (what, layout, pattern) => {
    const x = await compileScript(AscModule, source(layout), { lib });
    check(!x.wasm && x.problems.some((p) => pattern.test(p.message)), what, x.problems.map((p) => p.message).join(" | ").slice(0, 160));
  };
  await bad("a widget on a param that does not exist", `[{ knob: "nope" }]`, /not a param of this module/);
  await bad("a knob on a toggle", `[{ knob: "mute1" }]`, /use toggle/);
  await bad("a toggle on a knob", `[{ toggle: "master" }]`, /not a boolean/);
  await bad("a select on a knob", `[{ select: "master" }]`, /no choices/);
  await bad("a meter on something that is not a probe", `[{ meter: "master" }]`, /not a probe/);
  await bad("a button that does not exist", `[{ button: "zap" }]`, /not a @button/);
  await bad("a meter on a knob", `[{ knob: "master", meter: "peak" }]`, /only for a fader/);
  await bad("an object with no widget in it", `[{ colour: "red" }]`, /needs one of/);
  await bad("repeat of an unknown setting", `[{ repeat: NOPE, row: ["master"] }]`, /not a setting of this module/);
  await bad("layout that is not a list", `{ knob: "master" }`, /must be a list/);
  await bad("a bare id that is nothing", `["zzz"]`, /not a param, probe or button/);
}

// ---- 6. buttons ------------------------------------------------------------------------------------------------------------------------------
{
  const source = `
@module({ name: "Counter" })
export class Counter {
  @output out: f32 = 0;
  @probe count: f32 = 0;
  @probe presses: f32 = 0;
  constructor(sampleRate: f64) {}
  @button({ name: "Add one" }) add(): void { this.count += 1; this.presses += 1; }
  @button resetCount(): void { this.count = 0; }
  sample(): void { this.out = this.count; }
}`;
  const { error, wasm, transform } = await compile(source, "counter");
  check(!error, "a module with @button methods compiles", error && error.message);
  if (!error) {
    check(JSON.stringify(transform.specs[0].buttons) === JSON.stringify([{ id: "add", name: "Add one", momentary: false }, { id: "resetCount", name: "Reset Count", momentary: false }]), "buttons in the description", JSON.stringify(transform.specs[0].buttons));
    const m = new ModuleInstance(await compileModule(wasm), 48000);
    m.command("add", 1); m.command("add", 1); m.command("add", 1);
    check(m.live().values.count === 3 && m.live().values.presses === 3, "a button press runs its method", JSON.stringify(m.live().values));
    m.command("resetCount", 1);
    check(m.live().values.count === 0 && m.live().values.presses === 3, "and only its own", JSON.stringify(m.live().values));
    m.command("ad", 1); m.command("addd", 1); m.command("", 1);
    check(m.live().values.count === 0, "a different id (a prefix, a longer one, none) does nothing");
    m.command("add", 1); m.process(CHUNK);
    check(m.outputs[0] === 1, "the module runs after a press");
  }
}
await mustFail("@button on a field", rt(`  sample(): void { }`).replace("private v: f32 = 0;", `@button a: f32 = 0;`), "goes on a method");

await mustFail("@on needs an input of that name", rt(`  @on("nope") f(): void { }\n  sample(): void { }`), "no @input field of that name");
await mustFail("@on on a control input needs rising or falling", rt(`  @on("x") f(): void { }`), "needs exactly one");
await mustFail("a notes jack must be a NoteStream", `@module({ name: "T" })\nexport class T {\n  @input({ type: "notes" }) n: f32 = 0;\n  constructor(sampleRate: f64) {}\n}`, "must be NoteStream");
await mustFail("a notes handler is real-time code: no allocation", `import { NoteEvent, NoteStream } from "./bleep/notes";\n@module({ name: "T" })\nexport class T {\n  @input({ type: "notes" }) n!: NoteStream;\n  constructor(sampleRate: f64) {}\n  @on("n") f(e: NoteEvent): void { const a = new NoteEvent(); }\n}`, "`new` allocates");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
