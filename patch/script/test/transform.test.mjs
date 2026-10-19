// SPDX-License-Identifier: GPL-3.0-or-later
// The Bleep Script transform: the spec it generates, the errors it reports, and the parameter kinds (int, choice), with the
// result run in the Bleep module host.   node test/transform.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import asc from "assemblyscript/asc";
import { BleepTransform } from "../transform/bleep.mjs";
import { compileModule, ModuleInstance, CHUNK } from "../../web/js/module-host.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const lib = Object.fromEntries(["abi", "dsp", "format"].map((n) => [`src/bleep/${n}.ts`, readFileSync(`${root}src/bleep/${n}.ts`, "utf8")]));
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
      { id: "vol", name: "Volume", kind: "float", default: 0.909090909, steps: 0, modulatable: true, min: -60, max: 6, def: 0, format: "number", decimals: 1, label: "dB" },
      { id: "mute", name: "Mute", kind: "bool", default: 0, steps: 2, modulatable: false, min: 0, max: 1, def: 0, format: "toggle", decimals: 0 },
      { id: "solo", name: "Solo", kind: "bool", default: 0, steps: 2, modulatable: false, min: 0, max: 1, def: 0, format: "toggle", decimals: 0 },
    ],
    inputs: [{ id: "x", name: "In", type: "audio", bipolar: true }, { id: "othersSolo", name: "Others Solo", type: "gate", bipolar: false }],
    outputs: [{ id: "out", name: "Out", type: "audio", bipolar: true }, { id: "soloOut", name: "Solo Out", type: "gate", bipolar: false }],
  }];
  check(!error, "Gains compiles with the transform", error && error.message);
  check(JSON.stringify(transform.specs) === JSON.stringify(byHand), "the generated description equals the hand-written one",
    JSON.stringify(transform.specs) === JSON.stringify(byHand) ? "" : JSON.stringify(transform.specs));
}

// ---- 2. errors come with the file and the line ---------------------------------------------------------------------------------
const wrap = (body) => `@module({ name: "T" })\nexport class T {\n${body}\n  constructor(sampleRate: f64) {}\n}\n`;
const mustFail = async (what, body, expect) => {
  const { error } = await compile(typeof body === "string" && body.startsWith("@module") ? body : wrap(body));
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
await mustFail("map is not supported yet", `  @param({ min: 1, max: 100, map: "exp" }) a: f32 = 0;`, "not supported yet");
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

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
