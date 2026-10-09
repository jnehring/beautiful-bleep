// SPDX-License-Identifier: MIT
//
// worklet.js — the real-time side of the browser build: an AudioWorklet that
// runs the graph (graph.js) and the module wasm files it is sent. All board
// edits arrive as messages from bleep-web.js on the main thread.
import { Engine } from "./graph.js";

class BleepProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate);
    this.engine.onError = (message) => this.port.postMessage({ cmd: "error", message });
    this.frames = 0;
    this.board = null;
    this.port.onmessage = (e) => this.#message(e.data);
    this.port.onmessageerror = () => this.port.postMessage({ cmd: "error", message: "a message could not be deserialised" });
  }

  #message(m) {
    const e = this.engine;
    try {
      switch (m.cmd) {
        case "types": e.setTypes(m.types); break;
        case "module": e.addModule(m.slug, new WebAssembly.Module(m.bytes), m.types); if (this.board) e.setBoard(this.board); break;
        case "board": this.board = m.board; e.setBoard(m.board); break;
        case "knob": e.setKnob(m.node, m.param, m.value); break;
        case "amount": e.setAmount(m.cable, m.value); break;
        case "perform": e.perform(m.node, m.action, m.args); break;
        case "command": e.command(m.node, m.id, m.value); break;
        case "data": e.setData(m.node, m.data); break;
        case "watch": e.watched = new Set(m.nodes); break;
        case "noteOn": e.midi.noteOn(m.note, m.velocity, m.channel); break;
        case "noteOff": e.midi.noteOff(m.note, m.channel); break;
        case "allOff": e.midi.allOff(); break;
        case "cc": e.midi.cc[m.number] = m.value; break;
        case "bend": e.midi.bend = m.value; break;
        case "tempo": e.bpm = m.bpm; break;
      }
    } catch (err) {
      this.port.postMessage({ cmd: "error", message: String(err && err.stack || err) });
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    try {
      this.engine.render(out[0], out[1] || out[0], out[0].length);
    } catch (err) {
      this.port.postMessage({ cmd: "error", message: String(err && err.stack || err) });
      this.engine.steps = [];  // stop running the broken graph
    }
    this.frames += out[0].length;
    if (this.frames >= sampleRate / 30) {
      this.frames = 0;
      this.port.postMessage({ cmd: "state", state: this.engine.snapshot() });
    }
    return true;
  }
}

registerProcessor("bleep-processor", BleepProcessor);
