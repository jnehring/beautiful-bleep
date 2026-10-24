// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// bleep/notes — the `notes` signal for Bleep Script: a stream of note events (module-abi.md section 5, "Notes"). A NoteStream is a window
// on the ABI's note buffer: 64 events of 16 bytes and then an i32 count. This is library code and trusted, so it may read and write the
// module's memory; user code only sees the methods.

export const NOTE_ON: u8 = 0;
export const NOTE_OFF: u8 = 1;
export const NOTE_PRESSURE: u8 = 2;
export const NOTE_CC: u8 = 3;
export const NOTE_PROGRAM: u8 = 4;
export const NOTE_BEND: u8 = 5;
export const NOTE_CHANNEL_PRESSURE: u8 = 6;
export const NOTE_SYSTEM: u8 = 7;

const MAX_EVENTS: i32 = 64;
const EVENT_BYTES: i32 = 16;

/// One event. Pitch is in virtual volts (1.0 = one octave, 0 = C4); `note` is the MIDI note number; `value` is velocity or pressure (0 to 1),
/// for a control change the data divided by 127, for a bend -1 to +1. A module handles the types it knows and ignores the others.
export class NoteEvent {
  type: u8 = 0;
  channel: u8 = 0;
  offset: i16 = 0;      // the sample inside the chunk
  note: i32 = 60;
  pitch: f32 = 0;
  value: f32 = 0;

  get isOn(): bool { return this.type == NOTE_ON; }
  get isOff(): bool { return this.type == NOTE_OFF; }
  get isCc(): bool { return this.type == NOTE_CC; }
  /// Shifts the event by whole semitones, in place.
  transpose(semitones: i32): void {
    this.note += semitones;
    this.pitch += <f32>semitones / 12.0;
  }
}

/// The events of a notes input for this chunk, or the events a notes output will send.
export class NoteStream {
  constructor(private base: usize) {}

  /// How many events there are (0 to 64).
  get length(): i32 { return load<i32>(this.base + <usize>(MAX_EVENTS * EVENT_BYTES)); }
  /// The sample offset of event `i`.
  offsetAt(i: i32): i32 { return <i32>load<i16>(this.base + <usize>(i * EVENT_BYTES) + 2); }
  /// Copies event `i` into `into`.
  read(i: i32, into: NoteEvent): void {
    const at = this.base + <usize>(i * EVENT_BYTES);
    into.type = load<u8>(at);
    into.channel = load<u8>(at, 1);
    into.offset = load<i16>(at, 2);
    into.note = load<i32>(at, 4);
    into.pitch = load<f32>(at, 8);
    into.value = load<f32>(at, 12);
  }
  /// Sends an event (dropped when 64 are already waiting).
  push(e: NoteEvent): void {
    const n = this.length;
    if (n >= MAX_EVENTS) return;
    const at = this.base + <usize>(n * EVENT_BYTES);
    store<u8>(at, e.type);
    store<u8>(at, e.channel, 1);
    store<i16>(at, e.offset, 2);
    store<i32>(at, e.note, 4);
    store<f32>(at, e.pitch, 8);
    store<f32>(at, e.value, 12);
    store<i32>(this.base + <usize>(MAX_EVENTS * EVENT_BYTES), n + 1);
  }
  /// Forgets the events (an output starts every chunk empty).
  clear(): void { store<i32>(this.base + <usize>(MAX_EVENTS * EVENT_BYTES), 0); }
}
