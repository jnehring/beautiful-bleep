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

## Security notes

The segment is created with mode 0600, so peers are same-user processes that
may be buggy or hostile. The library validates what it reads from shared
memory (header values once at open, indices, strings, floats) and a writer
re-checks that it still owns its output record before every write.

Known limits:

- **Truncation (SIGBUS).** A peer that `ftruncate()`s the segment smaller
  while it is mapped makes later accesses to the removed pages raise SIGBUS in
  every process that maps it. The audio thread cannot re-validate the size
  without a system call, and POSIX named shared memory (`shm_open`) cannot be
  sealed (`F_SEAL_SHRINK` needs a Linux `memfd`, which has no name to share
  and does not exist on macOS). Only same-user processes can do this.
- **Liveness and PID namespaces.** Dead endpoints are reaped with `kill(pid, 0)`.
  Processes in separate PID namespaces (containers) sharing one segment can
  look dead to each other; supporting that needs an ABI change (for example a
  heartbeat). Run all peers of a bus in one PID namespace. PIDs that are 0 or
  above INT32_MAX are treated as invalid and never probed.
- **Port lifetime.** Adding ports while audio runs is safe; removing them is
  not: `bb_unregister_instance` must not overlap `bb_begin_block`,
  `bb_write_output`, `bb_read_input` or `bb_end_block` on that endpoint.
