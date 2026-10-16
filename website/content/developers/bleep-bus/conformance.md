---
title: Conformance
description: The open test host and validator for checking a Bleep Bus implementation.
order: 20
---

# Conformance suite

`bb_conformance` is the open test host and validator.

```bash
cmake -S bus -B build/bus && cmake --build build/bus
./build/bus/bb_conformance run               # all checks, TAP output, private namespace
./build/bus/bb_conformance inspect           # print + validate the live "default" bus
./build/bus/bb_conformance peer-send <ns> <uid> <seconds>   # interop peer
```

`run` checks:

| Area | What |
|---|---|
| Layout | struct sizes and offsets match the spec; a fresh segment's header |
| Versioning | wrong requested version, foreign segment versions, corrupt magic |
| Registry | ports, names, listings, generations, UID collisions, dead-process reclamation, lock recovery |
| Timing | one block of latency in random thread order, offline export, loops, stopped transport, real threads |
| Signals | summing and amounts, ghost sources, unwritten/short/oversized blocks |
| State | save/load round trip, locale-independent amounts, malformed input |
| IPC | a second process publishes, this one reads |

To test **another implementation** of the C API, build the sources in
`bus/conformance/` (`bb_conformance.c` and the files it lists in
`bus/CMakeLists.txt`) against it instead of `bleep_bus`. To test **interop** between your
implementation and the reference, run `peer-send` from one and a reader from
the other.

## "Bleep Bus compatible"

Plugins that pass the suite and the
[checklist](../api-reference/13-conformance-checklist.md) may use the "Bleep Bus
compatible" badge. The protocol is free to use; the names and logo are
trademarks of Brilliant Bleep.
