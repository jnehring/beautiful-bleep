# Bleep Bus

The open protocol and reference SDK for sending per-sample control signals
between audio plugins through shared memory. MIT-licensed. Builds on its own.

```bash
scripts/build/build-bus.sh                               # build + conformance suite (--debug, --clean, --no-test)
# or by hand: cmake -S bus -B build/bus && cmake --build build/bus && ctest --test-dir build/bus
./build/bus/minimal_sender & ./build/bus/minimal_receiver
./build/bus/bb_conformance inspect         # look at a live bus
```

| Path | Content |
|---|---|
| `include/bleep_bus.h` | the C API (start reading here) |
| `include/bleep_bus_layout.h` | the shared-memory layout, for reimplementations |
| `src/` | reference implementation (POSIX + Windows) |
| `wrappers/cpp/bleep_bus.hpp` | header-only C++17 wrapper |
| `wrappers/juce/bleep_bus_juce.h` | JUCE play-head and block-splitting helpers |
| `examples/` | minimal sender, minimal receiver, attenuverter |
| `conformance/` | test host and validator |

Docs: [quickstart](../website/content/developers/bleep-bus/quickstart.md),
[API reference](../website/content/developers/api-reference/00-overview.md),
[specification](../website/content/developers/spec/v0.1/00-overview.md).
