# Module ABI (version 1)

The contract between a **host** (the engine in the plugins and the app, the browser's worklet, the tests) and a **module**, a standalone WebAssembly file. It is what `engineAbi` in the store's `requires` (see [`store.md`](store.md)) counts. This document describes the interface that exists today in [`patch/web/src/WebShim.cpp`](../../patch/web/src/WebShim.cpp), which every one of the 80 module files in the browser build already implements, plus what a host must do around it. Items marked **proposed** are not in the code yet.

Hosts that exist: the browser (`patch/web/js/module-host.js`). A native host for the plugins and the app is the next step. A spike that ran modules inside the plugins with Wasmtime and wasm3 (commit `70c3314`) was removed again; its measurements are in [`patch/wasm-host/README.md`](../../patch/wasm-host/README.md). The conformance test in section 10 is for every host.

## 1. Versioning

- `engineAbi` is one integer. **ABI 1 is everything in this document.**
- A change is *compatible* if a host that knows version N still runs every module of version N: new optional exports, new fields in the spec JSON that hosts may ignore. It is *incompatible* otherwise: a changed signature or layout, a changed meaning, a removed export. Incompatible changes bump the integer; compatible ones do not, and get a note under "History" below.
- A module states the version it was built for in `module.json` (`requires.engineAbi`). **Proposed:** the file also exports `bleep_abi_version() → i32`, so a host can check the file itself and a file cannot lie about its package. A module without that export is ABI 1.
- A host supports a **range** and refuses modules outside it with a message that says which (never a crash). The Software Center explains it ("this module needs Bleep Patch 1.3").

## 2. The file

One `module.wasm` holds the node types of one module folder (usually one, the drum modules have several). It is **standalone**: no JS glue, no JUCE, no shared memory with other modules, no table shared with the host.

| Requirement | Detail |
|---|---|
| Memory | One exported linear memory named `memory`, growable (1 to 2 MB at start, 64 to 256 KB of stack). A host **should cap it** (64 MB is a sensible limit; the largest module today starts at 2 MB) and must re-read the memory base after every call, because growing moves it. |
| Imports | Only these, and the host provides them as stubs (see section 8): `env.emscripten_notify_memory_growth(i32)`, and, for modules using `juce_core`, seven WASI preview 1 functions: `fd_close`, `fd_read`, `fd_seek`, `fd_write`, `environ_get`, `environ_sizes_get`, `clock_time_get`. Across the 80 current files these are all the imports that occur. A module importing anything else is refused. |
| Start | Exports `_initialize` (runs C++ static constructors); the host calls it once, first. No `_start`, no start section that does I/O. |
| Features | Whatever the pinned Emscripten (4.0.10) emits by default: no SIMD and no threads are requested, but the files do not record their feature set (the `target_features` section is stripped), so the exact list is **to be confirmed** by the package step. The modules built with `juce_core` (26 of the 80, the same 26 that import WASI) are built with `-fwasm-exceptions` and use wasm exception handling. Wasmtime runs them; **wasm3 does not support exception handling**, so as a fallback it only runs the modules without. **Proposed:** the package step reads the used features out of each file and writes them to `module.json` (`features`), and the host checks them at load, so a missing feature is a clear message. |
| Determinism | No clock, no randomness from the host: `clock_time_get` returns 0. Any random stream is seeded by the module. The same input and knob values produce the same output on every host (the spike matched the native build to about 1e-6 on a peak of 0.4; wasm does not fuse multiply-adds the way a native build may). |

## 3. Life of a module instance

```
compile + instantiate the file (once per process may be shared; one instance per node)
_initialize()                                       once per instance
bleep_spec_json()                                   the node types the file provides (JSON)
bleep_chunk()                                       must equal 32, otherwise refuse
h = bleep_create(typeIndex, sampleRate)             0: failed, the reason is in bleep_error()
ptrs = bleep_params_ptr(h), bleep_inputs_ptr(h), bleep_outputs_ptr(h), bleep_in_connected_ptr(h) …   once
repeat:  knobs, data, connections …  then, per 32-sample chunk: write buffers, bleep_set_transport, bleep_process
bleep_destroy(h)
```

**Threads.** An instance is **single-threaded**: a wasm runtime's store must not be entered by two threads at once, and native modules' atomics (knobs, command queues, live values) do not exist across the boundary. `bleep_process` and the buffer writes around it run on the audio thread. Every other call (`create`, `destroy`, `set_data`, `perform`, `command`, `live`, `param_text`, `take_data`, `sanitise_data`) must not overlap with `bleep_process` of the same instance, and must never make the audio thread wait. The host therefore **marshals them onto the audio thread through queues** (knobs: the host keeps the latest value and calls `bleep_set_knob` between chunks; buttons and gestures: a queue drained before the chunk; `live`, `take_data`: answered from a snapshot the audio thread refreshes), or it runs them only while the audio thread is not using the instance (creation, destruction, reconfiguration). The spike did the knob and button part this way. `bleep_spec_json`, `bleep_type_count`, `bleep_chunk` and `bleep_note_event_size` touch no instance and are safe at any time after `_initialize`.

**Real time.** `bleep_process` must not allocate, lock, or do I/O. Modules that allocate on `create`, `prepare` or `set_data` do it outside the audio thread, as in native.

## 4. Exports

`h` is the instance handle (an `i32` address; 0 means failure). All sizes and addresses are `i32`; `f32` and `f64` as named.

| Export | Signature | Meaning |
|---|---|---|
| `bleep_error` | `() → ptr` | NUL-terminated message of the last call that failed (empty: none). |
| `bleep_spec_json` / `bleep_spec_json_length` | `() → ptr` / `() → i32` | The node types as a UTF-8 JSON array (section 7). The pointer stays valid for the life of the file. |
| `bleep_type_count` | `() → i32` | Number of node types. |
| `bleep_chunk` | `() → i32` | The chunk size, 32. Buffers are sized by it. |
| `bleep_create` | `(typeIndex: i32, sampleRate: f64) → h` | A new instance; runs the module's `prepare` and `reset`. |
| `bleep_destroy` | `(h)` | |
| `bleep_reset` | `(h)` | Clears state (a transport jump, a cleared tail). |
| `bleep_params_ptr`, `bleep_inputs_ptr`, `bleep_outputs_ptr` | `(h) → ptr` | The three float buffers, fixed for the life of the instance (section 5). |
| `bleep_in_connected_ptr`, `bleep_out_connected_ptr` | `(h) → ptr` | One byte per input / output jack (`ni + 1`, `no + 1` bytes): 1 when patched. An output nobody reads may be skipped but must still hold valid numbers. |
| `bleep_set_knob` | `(h, index: i32, normalised: f32)` | The value a module reads with `setting()`: the knob without modulation. Call it when the knob changes, and once for every knob after `create`, so the module sees the saved state. |
| `bleep_set_transport` | `(h, bpm: f64, ppq: f64, playing: i32, samplePos: i64)` | Before each chunk. `ppq` is the position at the chunk start in quarter notes. |
| `bleep_process` | `(h, numSamples: i32) → i32` | Runs `numSamples` (1 to 32) samples. Returns 0, or non-zero when the call was refused or failed (the outputs are then unspecified and the host should bypass). |
| `bleep_notes_in_ptr`, `bleep_notes_out_ptr` | `(h, jack: i32) → ptr` | The note buffer of a `notes` jack (section 5). |
| `bleep_note_event_size` | `() → i32` | 16. The host checks it. |
| `bleep_scratch` | `(h, size: i32) → ptr` | A buffer of `size` bytes in the module's memory for strings going in. Valid until the next `bleep_scratch` call; any call that reads it says so. |
| `bleep_text`, `bleep_text_length` | `(h) → ptr`, `(h) → i32` | The last string the module handed out (UTF-8, not terminated), valid until the next call that produces one. |
| `bleep_set_data` | `(h, length)` | Node data (the board document's `data`, JSON) from the scratch buffer. |
| `bleep_sanitise_data` | `(h, typeIndex, length) → i32` | Makes node data valid, with defaults, from the scratch buffer; the result is in `bleep_text` (its length is returned), −1: the type has no node data. Any instance of the file will do as `h`. |
| `bleep_perform` | `(h, argOffset: i32, numArgs: i32)` | A performance gesture from the module's view (a key, a pad): the action name (NUL-terminated) in the scratch buffer, then `numArgs` doubles at `argOffset` (8-byte aligned). No undo, not saved. |
| `bleep_command` | `(h, value: f32)` | A view button: its id (NUL-terminated) in the scratch buffer. |
| `bleep_live` | `(h) → i32` | `{"values":{name:number},"arrays":{name:[number]}}` for the view, in `bleep_text`; its length is returned. Polled about ten times a second. |
| `bleep_param_text` | `(h, index, normalised: f32) → i32` | How the board shows a knob at that value ("2.5 s"), in `bleep_text`. |
| `bleep_output_display` | `(h, index) → f32` | The value of an output's meter. |
| `bleep_take_data` | `(h) → i32` | Node data the module changed itself (a captured loop): its JSON in `bleep_text`, −1 if none. Polled. |

A call that throws inside a module (only the modules built with exceptions) is caught inside the file: `bleep_create` returns 0 or the call returns its failure value, and `bleep_error` has the message. An exception never crosses the boundary.

## 5. Buffers

**Chunks.** The host cuts every block into chunks of at most 32 samples and calls `bleep_process` once per chunk. A block of 128 samples is four calls. (Native modules see whole blocks; modules must not depend on the block size, and the harness checks this.)

**Layout.** Jack-major, `float32`, little endian, one row of 32 per jack:

```
params   : [paramIndex  × 32]   the effective normalised value (0 … 1) at every sample, knob plus modulation
inputs   : [inputJack   × 32]   the summed signal; a notes jack's row is unused
outputs  : [outputJack  × 32]   written by the module
```

Rows have 32 floats even for the last, shorter chunk; the first `numSamples` are valid. A buffer for zero jacks still has one row. The pointers do not change for the life of the instance, so the host fetches them once; the base of the memory may change, so it adds them to the current base every call.

**Normalised values.** A param is always 0 … 1 on the boundary. Its units (Hz, seconds, choices) come from the spec JSON and the module's own mapping (`ParamSpec`). `bleep_set_knob` and `params` use the same scale.

**Signal types** (the `type` of a jack): `audio`, `control`, `pitch` (virtual volts, 1.0 = one octave, 0 = C4), `gate`, `trigger` (≥ 0.5 is high), `notes`. All but `notes` are floats in the rows above.

**Notes.** A `notes` jack is a `NoteBuffer` in the module's memory: 64 events of 16 bytes, then an `i32` count (1028 bytes). Per event: `u8 type` (0 on, 1 off, 2 pressure), `u8 channel` (0 to 15), `i16 offset` (sample inside the chunk), `i32 note` (MIDI number, identifies the note), `f32 pitch`, `f32 value` (velocity or pressure, 0 … 1). The host writes the events of an input jack and the count before each chunk; it reads an output jack's events and count after it. More than 64 per chunk are dropped.

**Strings** are UTF-8. Numbers crossing through the scratch buffer are little endian and aligned as stated.

## 6. Transport and time

`bleep_set_transport(bpm, ppq, playing, samplePos)` is called before every chunk; the module derives its tempo-synced timing from it (`ppq` and `bpm` give the position at every sample of the chunk). `sampleRate` is fixed at `create`; a different rate needs a new instance. The module sees no wall clock.

## 7. The spec JSON

`bleep_spec_json()` is the same description the board UI gets from the engine for native modules (`describeTypes()`): per node type, `type`, `name`, `category`, `colour`, `description`, `creatable`, `params[]` (`id`, `name`, `kind` float | int | bool | choice, `default` in 0 … 1, `steps`, `modulatable`, `choices`, `min`, `max`, `group`, conditional display `showIf`, `names`), `inputs[]` and `outputs[]` (`id`, `name`, `type`, `bipolar`, `normal`, …). Unknown fields are ignored by hosts, so adding one is compatible. The order of `params`, `inputs` and `outputs` **is** the index order of every call above and of the buffers.

## 8. What a host must do

1. **Provide the imports as stubs.** `emscripten_notify_memory_growth` does nothing; the WASI functions give no files, no environment, no clock: `fd_write` accepts and drops its bytes, `fd_read`, `fd_seek` and `fd_close` fail, `environ_*` report none, `clock_time_get` returns 0, and `proc_exit` is not imported by any current file; a host that is asked for it traps the instance. This makes the sandbox complete: a module can compute and nothing else.
2. **Own the memory.** Instantiate with the file's own memory, cap it (64 MB suggested), and never share it between instances.
3. **Bound time.** A `bleep_process` that runs longer than a few blocks of audio is stopped (Wasmtime: epoch interruption or fuel) and the instance is **bypassed** (silence out, an error in the log, a mark on the node), never allowed to stall the audio thread. wasm3 has no such interruption, so it is only for trusted (first-party, signed) modules. **Proposed**; the spike does not do it yet.
4. **Check the file before running it.** Its signature (see [`signing.md`](signing.md)), the imports, `bleep_chunk() == 32`, `bleep_note_event_size() == 16`, the ABI version.
5. **Choose the runtime deliberately.** Wasmtime needs executable memory. A host that forbids it (macOS hardened runtime without `allow-unsigned-executable-memory`, which Ableton Live 12 has) **kills the process** when it is asked for, so a plugin can't try and fall back: the choice is made from what the host process is entitled to, or by a setting, before any code is compiled. Measured for the Verb on an Apple M-series: about 1.2× the native cost in the standalone benchmark and 1.5 to 1.7× through the plugin (the copies around each 32-sample chunk included, Live 12: 3.2 % of a core against 1.9 % native); wasm3 ten times Wasmtime (32.5 %). See `patch/wasm-host/README.md`.
6. **Compile once.** One compiled module per file per process, one store and instance per node. Ahead-of-time compiled code may be cached per machine, keyed by the file's hash and the runtime version; the cache is never trusted over the signature.

## 9. Not in ABI 1

What a native module can do today and a wasm module cannot, yet: the board-wide harmony buses (Harmony Master and the quantizers that read them), Voice Cells and the per-voice index, the port nodes (audio and MIDI in and out), the Link tempo, and the media folder (samples). The 80 browser files omit those or build without them (`patch/web/README.md`, "Status"). They arrive as compatible additions, each a new optional export, or as a new ABI version when one changes what a module sees.

## 10. Conformance

A host passes when, for the same inputs and knob values, a module's output equals the native build's within rounding. The spike showed how: it ran the Verb as native, in Wasmtime and in wasm3 on the same noise with random knob changes mid-run and compared the outputs; the largest difference was 7e-7 on a peak of 0.43, and the tolerance was 1e-3 relative to the peak. Every module that ships as wasm gets the same check in the module harness (the native engine's tests keep the native modules for exactly this: the reference). A new host implementation runs the same cases against the browser host (`patch/web/test/`).

## History

- **1** (this document): the interface of the 80 browser files, written down. Proposed additions that keep it version 1: `bleep_abi_version`, a `features` list in `module.json`, per-block time limits in hosts.
