// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// Synth Voice: a monophonic supersaw voice with a ladder filter, an ADSR and a chorus, written in Bleep Script. A tour of the library:
// osc (Supersaw), filters (LadderFilter), env (Adsr), fx (Chorus), util (midiToHz, fastExp2) and dsp (Smoother).
// The developer docs have a tutorial that builds it step by step ("Tutorial: a synth voice").

import { Supersaw } from "./bleep/osc";
import { LadderFilter } from "./bleep/filters";
import { Adsr } from "./bleep/env";
import { Chorus } from "./bleep/fx";
import { Smoother } from "./bleep/dsp";
import { midiToHz, fastExp2 } from "./bleep/util";
import { NoteEvent, NoteStream } from "./bleep/notes";

@module({
  name: "Synth Voice",
  category: "Utility/Script",
  colour: "#f97316",
  description: "A monophonic supersaw voice: ladder filter with an envelope, ADSR and chorus. Written in Bleep Script.",
})
export class SynthVoice {
  @input({ name: "Notes", type: "notes" }) notes!: NoteStream;
  @output({ name: "Out", type: "audio" }) out: f32 = 0;

  @param({ name: "Detune", min: 0, max: 60, init: 20, unit: "cents", decimals: 0, group: "Oscillator" }) detune: f32 = 20;
  @param({ name: "Cutoff", min: 80, max: 12000, init: 900, map: "exp", unit: "Hz", decimals: 0, group: "Filter" }) cutoff: f32 = 900;
  @param({ name: "Resonance", min: 0, max: 1, init: 0.3, decimals: 2, group: "Filter" }) resonance: f32 = 0.3;
  @param({ name: "Env Amount", min: 0, max: 1, init: 0.6, decimals: 2, group: "Filter" }) envAmount: f32 = 0.6;
  @param({ name: "Attack", min: 0.001, max: 2, init: 0.005, map: "exp", unit: "s", decimals: 3, group: "Envelope" }) attack: f32 = 0.005;
  @param({ name: "Decay", min: 0.001, max: 4, init: 0.4, map: "exp", unit: "s", decimals: 3, group: "Envelope" }) decay: f32 = 0.4;
  @param({ name: "Sustain", min: 0, max: 1, init: 0.6, decimals: 2, group: "Envelope" }) sustain: f32 = 0.6;
  @param({ name: "Release", min: 0.001, max: 4, init: 0.3, map: "exp", unit: "s", decimals: 3, group: "Envelope" }) release: f32 = 0.3;
  @param({ name: "Chorus", min: 0, max: 1, init: 0.3, decimals: 2 }) chorus: f32 = 0.3;

  /** The envelope level, for a meter. */
  @probe level: f32 = 0;

  private saw: Supersaw;
  private filter: LadderFilter = new LadderFilter();
  private env: Adsr;
  private fx: Chorus;
  private pitch: Smoother;
  private sampleRate: f64;
  private note: i32 = -1;
  private gate: f32 = 0;

  constructor(sampleRate: f64) {
    this.sampleRate = sampleRate;
    this.saw = new Supersaw(sampleRate, 7, 20.0);
    this.env = new Adsr(sampleRate);
    this.fx = new Chorus(sampleRate, 2);
    this.pitch = new Smoother(sampleRate, 0.01);   // a little glide between notes
    this.pitch.target = 220.0;
    this.pitch.snap();
  }

  reset(): void { this.env.reset(); this.filter.reset(); this.fx.reset(); this.gate = 0; this.note = -1; }

  // block rate: once per chunk. Anything that costs a pow or an exp belongs here.
  block(): void {
    this.saw.setDetune(<f64>this.detune);
    this.env.set(<f64>this.attack, <f64>this.decay, <f64>this.sustain, <f64>this.release);
    // the filter follows the envelope in steps of one chunk (0.7 ms): fast enough to sound smooth, and the exp stays out of sample()
    const cutoff = <f64>this.cutoff * <f64>fastExp2(this.envAmount * 5.0 * this.env.value);
    this.filter.set(this.sampleRate, cutoff, <f64>this.resonance);
    this.fx.mix = this.chorus;
    this.level = this.env.value;
  }

  // a note handler runs once per event, in the chunk it arrives in
  @on("notes") play(n: NoteEvent): void {
    if (n.isOn) {
      this.note = n.note;
      this.pitch.target = <f32>midiToHz(<f64>n.note);
      this.gate = 1.0;
    } else if (n.isOff && n.note == this.note) {
      this.gate = 0.0;
    }
  }

  // sample rate
  sample(): void {
    const e = this.env.next(this.gate);
    const tone = this.saw.next(<f64>this.pitch.next());
    const filtered = this.filter.next(tone);
    this.out = this.fx.next(filtered * e * 0.6);
  }
}
