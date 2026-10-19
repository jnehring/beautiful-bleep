// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// bleep/abi — the part of the Bleep module ABI (website/content/developers/modules/module-abi.md) that does not depend on
// the module. A module class extends `Module`; its entry file exports the `bleep_*` functions. Today that entry file is
// written by hand (see gains.entry.ts); the Bleep Script transform will generate it from the decorators.

export const CHUNK: i32 = 32;
export const NOTE_BUFFER_BYTES: i32 = 64 * 16 + 4;

/// What every module has: three float buffers laid out jack-major, 32 samples per row (ABI section 5).
export abstract class Module {
  readonly params: StaticArray<f32>;
  readonly inputs: StaticArray<f32>;
  readonly outputs: StaticArray<f32>;
  readonly inConnected: StaticArray<u8>;
  readonly outConnected: StaticArray<u8>;

  constructor(numParams: i32, numInputs: i32, numOutputs: i32) {
    this.params = new StaticArray<f32>(max(numParams, 1) * CHUNK);
    this.inputs = new StaticArray<f32>(max(numInputs, 1) * CHUNK);
    this.outputs = new StaticArray<f32>(max(numOutputs, 1) * CHUNK);
    this.inConnected = new StaticArray<u8>(numInputs + 1);
    this.outConnected = new StaticArray<u8>(numOutputs + 1);
  }

  /// The knob without modulation (bleep_set_knob). Most modules read `params` and need not override it.
  setKnob(index: i32, normalised: f32): void {}
  reset(): void {}
  /// Runs `n` (1 to 32) samples.
  abstract process(n: i32): void;
  /// The text of a knob at a value ("2.5 dB"); empty: the host formats it.
  paramText(index: i32, normalised: f32): string { return ""; }
  /// {"values":{name:number}} for the module's view, polled about ten times a second (the `@probe` channel).
  live(): string { return '{"values":{},"arrays":{}}'; }
  outputDisplay(index: i32): f32 { return 0; }
}

export function asModule(h: usize): Module { return changetype<Module>(h); }
export function handleOf(m: Module): usize { return changetype<usize>(m); }
export function addressOf<T>(a: StaticArray<T>): usize { return changetype<usize>(a); }

// ---- strings handed to the host: valid until the next call that produces one ----
let textBuffer: ArrayBuffer = new ArrayBuffer(0);
let scratchBuffer: ArrayBuffer = new ArrayBuffer(0);
export const emptyNotes: ArrayBuffer = new ArrayBuffer(NOTE_BUFFER_BYTES);

/// Keeps `s` as the last text and returns its length in bytes.
export function setText(s: string): i32 {
  textBuffer = String.UTF8.encode(s, false);
  return textBuffer.byteLength;
}
export function textAddress(): usize { return changetype<usize>(textBuffer); }
export function scratch(size: i32): usize {
  if (scratchBuffer.byteLength < size) scratchBuffer = new ArrayBuffer(size);
  return changetype<usize>(scratchBuffer);
}
