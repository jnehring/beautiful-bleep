// SPDX-License-Identifier: GPL-3.0-only
// The audio side of the playground: runs one compiled module (through the Bleep module host, as the browser engine does)
// on a test signal and plays the module's first audio output.
import { ModuleInstance, CHUNK } from "/web/js/module-host.js";

class Playground extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inst = null;
    this.knobs = [];        // normalised, by param index
    this.signal = "sine";
    this.volume = 0.3;
    this.phase = 0;
    this.seed = 1;
    this.frames = 0;
    this.input = -1;        // the module's first audio input, the one the test signal feeds
    this.output = -1;       // the first audio output, the one we play
    this.port.onmessage = (e) => this.#message(e.data);
  }

  #message(m) {
    try {
      if (m.cmd === "module") {
        const old = this.inst;
        const inst = new ModuleInstance(new WebAssembly.Module(m.bytes), sampleRate, m.type);
        this.knobs = inst.spec.params.map((p, i) => (m.knobs && m.knobs[p.id] !== undefined ? m.knobs[p.id] : p.default));
        this.input = inst.spec.inputs.findIndex((j) => j.type === "audio");
        this.output = inst.spec.outputs.findIndex((j) => j.type === "audio");
        this.inst = inst;
        if (old) old.destroy();
        this.port.postMessage({ cmd: "installed" });
      } else if (m.cmd === "knob") this.knobs[m.index] = m.value;
      else if (m.cmd === "signal") this.signal = m.value;
      else if (m.cmd === "volume") this.volume = m.value;
      else if (m.cmd === "stop") this.inst = null;
    } catch (err) {
      this.inst = null;
      this.port.postMessage({ cmd: "error", message: String(err && err.message || err) });
    }
  }

  #test(i) {
    switch (this.signal) {
      case "sine": this.phase += 220 / sampleRate; this.phase -= Math.floor(this.phase); return 0.5 * Math.sin(2 * Math.PI * this.phase);
      case "saw": this.phase += 110 / sampleRate; this.phase -= Math.floor(this.phase); return 0.5 * (2 * this.phase - 1);
      case "noise": this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return 0.5 * (this.seed / 2 ** 31 - 1);
      default: return 0;
    }
  }

  process(inputs, outputs) {
    const left = outputs[0][0], right = outputs[0][1] || left;
    const inst = this.inst;
    if (!inst) return true;
    try {
      for (let at = 0; at < left.length; at += CHUNK) {
        const n = Math.min(CHUNK, left.length - at);
        for (let p = 0; p < this.knobs.length; p++) inst.params.fill(this.knobs[p], p * CHUNK, (p + 1) * CHUNK);
        if (this.input >= 0) for (let i = 0; i < CHUNK; i++) inst.inputs[this.input * CHUNK + i] = this.#test(i);
        inst.process(n);
        for (let i = 0; i < n; i++) {
          const y = this.output >= 0 ? inst.outputs[this.output * CHUNK + i] * this.volume : 0;
          left[at + i] = y; right[at + i] = y;
        }
      }
      this.frames += left.length;
      if (this.frames >= sampleRate / 12) {
        this.frames = 0;
        this.port.postMessage({ cmd: "live", live: inst.live() });
      }
    } catch (err) {
      this.inst = null;
      this.port.postMessage({ cmd: "error", message: String(err && err.message || err) });
    }
    return true;
  }
}
registerProcessor("bleep-playground", Playground);
