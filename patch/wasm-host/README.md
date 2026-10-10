# Wasm host spike

Question: can a plugin run a Bleep module from its standalone `.wasm` (the files `scripts/build-web.sh`
builds for the browser, ABI in `patch/web/src/WebShim.cpp`), fast enough and where executable memory is limited?

```
scripts/build-web.sh --docker --modules-only      # build/web/modules/modules/reverb.wasm
scripts/wasm-spike.sh 10                          # 10 s of audio through Verb: native, Wasmtime, wasm3
scripts/wasm-spike.sh 10 wasmtime --serialized    # Wasmtime with ahead-of-time compiled code
```

`spike.cpp` feeds the same noise bursts to each runtime in 32-sample chunks (the ABI's chunk) and compares the output.

## Results (Apple M-series, Verb, 48 kHz, one core)

| runtime | ns / sample | CPU | vs native | output vs native |
|---|---|---|---|---|
| native (clang -O2) | 500 | 2.4 % | 1.0× | – |
| Wasmtime (Cranelift) | 577 | 2.8 % | 1.16× | bit-identical* |
| wasm3 (interpreter) | 7050 | 34 % | 14× | bit-identical* |

\* when the native build uses `-ffp-contract=off`. With the default the native code fuses multiply-adds and a
reverb tail drifts by about 4e-3 (peak 0.5): wasm is the reproducible one. Same bytes in Wasmtime and wasm3.

Executable memory (macOS hardened runtime, what a plugin inherits from its host):

| host process | Wasmtime | wasm3 |
|---|---|---|
| no entitlements | killed (SIGKILL) | runs |
| Ableton Live 12's entitlements (`allow-unsigned-executable-memory`, `disable-library-validation`) | runs, also ahead-of-time | runs |

Verb imports nothing but `env.emscripten_notify_memory_growth`: no WASI, no files, no clock. 105 KB.

## Reading

- Wasmtime is close enough to native to carry any module; the 32-sample call boundary is included in the figure.
- An interpreter is not: reverbs and oscillator banks would not fit, simple modules might.
- Live allows what Wasmtime needs. Hosts without that entitlement need the interpreter fallback (or ship the
  module native). Windows and Linux have no such restriction.

## Not done

Other modules (this spike hardcodes Verb's jacks), a module inside the real plugin in Live, Windows/Linux runs,
modules that use `juce_core` (they are built with wasm exceptions, which wasm3 does not support), per-block time limits
(Wasmtime epochs / fuel), and a versioned ABI document.
