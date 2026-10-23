---
title: Architecture and signal flow
description: Diagrams of how Bleep Bus plugins share one memory segment, how a signal travels from an output to a parameter, and how a reader picks the block to read.
order: 5
---

# Architecture and signal flow

Three pictures explain the whole bus. The [specification](../spec/v0.1/00-overview.md) has the exact rules behind each one.

## Architecture

![Plugin instances in different tracks, processes or threads each register an endpoint in one shared-memory segment. The segment holds a header and tables of endpoints, inputs and outputs. There is no server process.](/img/bus-architecture.svg)

- All plugins that use the same **namespace** (default: `default`) open the same named shared-memory segment. The first one creates it; it is never unlinked while plugins run.
- Each plugin instance registers an **endpoint** with a stable 64-bit UID, then adds named **outputs** and **inputs**.
- The segment is the only shared state. There is no server, no socket and no thread that must stay alive. A tool or a patchbay in another plugin can edit cables by taking the registry lock.
- Peers are same-user processes (mode `0600`). The library validates everything it reads from the segment; see [Hostile peers](../spec/v0.1/08-versioning.md).

Related: [Naming](../spec/v0.1/01-naming.md), [Layout](../spec/v0.1/02-layout.md), [Registry](../spec/v0.1/04-registry.md).

## Signal flow

![A sender writes a block into an output slot. Cables multiply it by an amount and sum them into an input. The receiver reads it one block later and applies the sum to a parameter.](/img/bus-signal-flow.svg)

1. Per block, the sender calls `bb_begin_block`, writes samples with `bb_write_output` and calls `bb_end_block`. The samples go into one of four slots of the output.
2. A cable is stored with the **receiving** input as `(source UID, output name, amount)`. An input holds up to 8 cables.
3. The receiver calls `bb_read_input`, which sums `sample × amount` over the cables whose source exists. A missing source reads as silence.
4. The plugin adds the sum to a parameter in normalised range, inside its own DSP. The host never sees a parameter change.

Related: [Signals](../spec/v0.1/06-signals.md), [Connections and state](../spec/v0.1/07-connections.md).

## Why one block of latency, and how a block is chosen

![Each output keeps four block slots. A reader considers the three newest finished blocks and picks one by the position rule, then the time rule, otherwise it holds its last sample.](/img/bus-block-selection.svg)

Hosts such as Ableton Live process tracks on parallel threads in no guaranteed order. If a reader took "whatever the sender wrote last", the result would depend on which thread ran first. Instead a reader always takes the block the sender produced for the reader's *previous* block. That is a fixed latency of one block (5.3 ms at 256 samples and 48 kHz), and a set renders identically every time, including offline export.

The three rules in the picture are checked in order. The position rule is exact while the transport plays. The time rule covers a stopped transport and peers that just appeared. The hold rule keeps the signal steady if no block qualifies.

Related: [Timing](../spec/v0.1/05-timing.md), [Memory ordering](../spec/v0.1/03-memory-ordering.md).
