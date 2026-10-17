// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// worklet.js — the real-time side of the browser build: an AudioWorklet that
// runs the graph (graph.js) and the module wasm files it is sent. All board
// edits arrive as messages from bleep-web.js on the main thread.
import { Engine } from "./graph.js";
import { bridgeEndpoint } from "./bridge-worklet.js";  // [bridge] the web link to the app, see README

class BleepProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Engine(sampleRate);
    this.engine.onError = (message) => this.port.postMessage({ cmd: "error", message });
    // [bridge] remote nodes (graph.js) read and write the endpoint; MIDI delays count in engine samples
    this.engine.bridge = bridgeEndpoint();
    this.engine.bridge.now = () => this.engine.samplePos;
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
        case "play": e.playing = !!m.on; break;
        case "bridge-port": e.bridge.connect(m.port); break;  // [bridge] the Worker's MessagePort
        case "bridge": e.bridge.message(m, (x) => this.port.postMessage(x)); break;  // [bridge]
        case "bridge-debug": {  // [bridge] what the endpoint and the bound nodes hold, for finding out why a channel is silent
          const b = e.bridge, side = (map) => [...map.entries()].map(([k, v]) => ({ key: k, ch: v.ch, online: v.online, mode: v.mode, owner: v.owner !== undefined ? v.owner !== null : undefined }));
          this.port.postMessage({ cmd: "bridge-debug", ins: side(b.ins), outs: side(b.outs), stats: b.stats,
            bound: e.steps.filter((st) => st.host && st.host.remote).map((st) => ({ id: st.id, key: st.host.remote.key, kind: st.host.remote.kind, peakIn: st.host.remote.peakIn })) });
          break;
        }
      }
    } catch (err) {
      this.port.postMessage({ cmd: "error", message: String(err && err.stack || err) });
    }
  }

  process(inputs, outputs) {
    const out = outputs[0], input = inputs[0];   // the input is empty while nothing is connected (no microphone, no file)
    try {
      this.engine.render(out[0], out[1] || out[0], out[0].length, input && input[0], input && (input[1] || input[0]));
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
