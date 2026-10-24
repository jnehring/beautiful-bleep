---
title: Architecture overview
description: Diagrams of how Bleep Bus plugins share one memory segment, how a signal travels from an output to a parameter, and how a reader picks the block to read.
order: 5
---

# Architecture overview

Audio plugins in a DAW are isolated from each other: each one has its own audio thread, and the host decides in which order the tracks run. Bleep Bus gives them a way to exchange per-sample control signals anyway, for example an LFO in one plugin that moves the filter cutoff of another plugin on a different track. It does this without a server and without any help from the host, using one block of named shared memory that every plugin opens.

This page explains the bus in three steps. The first picture shows who takes part and where the state lives. The second follows one signal from the sender's output to a parameter of the receiver. The third explains the one rule that makes the result identical on every run, even though the host runs the tracks in no fixed order: the receiver always reads the block the sender produced for the receiver's previous block. If you only want to use the bus, the [Quickstart](quickstart.md) is faster. If you want to implement it yourself, the [specification](../spec/v0.1/00-overview.md) has the exact rules behind each picture, and each section below links to the relevant chapters.

## Architecture

![Plugin instances in different tracks, processes or threads each register an endpoint in one shared-memory segment. The segment holds a header and tables of endpoints, inputs and outputs. There is no server process.](/img/bus-architecture.svg)

The whole bus is one block of operating-system shared memory, called the **segment**. Its name is built from the major version of the protocol and a **namespace**: by default `/bleepbus-v0-default` on macOS and Linux, and `Local\bleepbus-v0-default` on Windows. Every plugin that uses the same namespace opens the same segment. The first plugin to open it creates and initialises it, later ones just map it. Nobody removes the segment while plugins come and go, so a plugin that is loaded later finds everything its predecessors left. Users and test setups can run separate buses side by side, for example two DAWs at once, by setting the `BLEEP_BUS_NAMESPACE` environment variable.

Inside the segment there are four parts, shown at the bottom of the picture:

- The **header** holds the protocol version, the sizes of the tables and a few counters. The counters are generations that change whenever the registry or a cable changes, so a plugin can cheaply notice that something happened.
- The **endpoint table** has room for 64 endpoints. An **endpoint** is one plugin instance. It has a stable 64-bit UID, a display name and the process it belongs to. The UID is what other plugins use to refer to it, and it survives saving and loading a project.
- The **input table** has room for 512 inputs. An input has a name that is unique within its endpoint, and it holds up to 8 cables.
- The **output table** has room for 256 outputs. An output has a name and a type, and it keeps four slots with the most recent blocks of samples.

Each plugin instance registers one endpoint and then adds the **outputs** and **inputs** it wants to offer. Names are short and stable (`"LFO"`, `"Env"`, `"Cutoff"`), because a cable refers to its source by endpoint UID and output name, and saved projects store cables in that form.

There is no server, no socket and no thread that has to stay alive. Everything a plugin needs to know is in the segment, and the audio threads only read and write memory. Changes to the structure, such as registering an endpoint or adding a cable, are done under a lock inside the segment and never on the audio thread. That is also how the third box in the picture works: a patchbay in one plugin window, or a tool such as `bb_conformance inspect`, can list every endpoint and edit the cables into any input, and the plugin that owns the input notices through the counters in the header and tells its host that its state has changed.

The segment is created with permissions for the current user only, so the peers on a bus are processes of the same user. They are not necessarily trustworthy: a plugin can have bugs. The library therefore validates everything it reads from the segment and a writer re-checks that it still owns its output before every write. The remaining known limits are listed under [Hostile peers](../spec/v0.1/08-versioning.md).

Related: [Naming](../spec/v0.1/01-naming.md), [Layout](../spec/v0.1/02-layout.md), [Registry](../spec/v0.1/04-registry.md).

### What is not part of the bus

The wasm modules are not part of this architecture. Bleep Bus is a separate protocol: it works between any plugins in any DAW and does not need Beautiful Bleep. The Bleep plugins, the Bleep App and Bleep Play each run their own engine and board, and the cables on the board connect [modules](../modules/overview.md) inside that one engine. Those cables never touch the shared-memory segment. A plugin takes part in the bus only if it calls the Bleep Bus SDK (or implements the [specification](../spec/v0.1/00-overview.md) itself), whatever it is made of inside. See the [developer overview](../overview.md) for how the two fit side by side.

## Signal flow

![A sender writes a block into an output slot. Cables multiply it by an amount and sum them into an input. The receiver reads it one block later and applies the sum to a parameter.](/img/bus-signal-flow.svg)

The picture follows one control signal from a sender to a parameter of a receiver, for example an LFO that modulates a filter cutoff.

1. **The sender writes a block.** Once per processing block, the sender calls `bb_begin_block` to announce the block (its length, the transport position, whether the transport is playing and a timestamp). Then it writes the samples of each of its outputs with `bb_write_output` and finishes with `bb_end_block`. The samples go into one of the four slots of the output, together with the stamps of the block. A slot is written under a sequence counter (a seqlock), so a reader can tell whether it saw a complete block. An output that was not written during a block publishes silence at the end of that block.
2. **Cables select the sources.** A cable belongs to the **receiving** input. It stores the UID of the source endpoint, the name of the source output and an **amount**. An input holds up to 8 cables, and any process can add, change or remove one. A source that does not exist, for example because that plugin is not loaded, simply reads as silence until it comes back.
3. **The input sums the cables.** When the receiver calls `bb_read_input`, the bus takes the block of each connected output (see the next section for which block), multiplies it by the cable's amount and adds the results. Samples and amounts that are not finite numbers count as 0, and amounts are limited to the range of ±1000.
4. **The receiver applies the sum.** Signals are 32-bit floats, one per sample, in *virtual volts*: a control signal is nominally between -1 and +1, a gate is high from 0.5, and a pitch signal has 1.0 per octave. A receiving plugin should apply the sum as an offset in the normalised 0..1 range of the parameter, inside its own DSP: `effective = clamp(knob + Σ source × amount, 0, 1)`. It must not move the host-visible parameter, so the modulation causes no automation writes and no undo entries, and a parameter with an exponential mapping such as a cutoff is modulated in octaves.

Types and ranges are advisory: any output can be connected to any input, and values outside the nominal range are allowed, for example when several cables add up. Receivers clamp where it matters.

Related: [Signals](../spec/v0.1/06-signals.md), [Connections and state](../spec/v0.1/07-connections.md), [API reference](../api-reference/00-overview.md).

## Why one block of latency, and how a block is chosen

![Each output keeps four block slots. A reader considers the three newest finished blocks and picks one by the position rule, then the time rule, otherwise it holds its last sample.](/img/bus-block-selection.svg)

Hosts such as Ableton Live process tracks on parallel threads, and nothing guarantees the order. If a reader took whatever the sender wrote last, the result would depend on which thread happened to run first: sometimes the modulation would arrive in the same block and sometimes one block late, and two renders of the same set would differ. That is unacceptable for an offline export, and it makes a live set hard to reproduce.

The bus therefore fixes the latency at **exactly one block**. A reader always takes the block that the sender produced for the reader's *previous* block, no matter which side ran first. At 256 samples and 48 kHz that is 5.3 ms, which is inaudible for modulation but too much for phase-critical audio. Keep in mind that Live's delay compensation does not know about the bus, and that an endpoint that is patched into itself works but also has one block of latency.

To make this possible each output keeps the last four blocks in its four slots, as shown at the top of the picture. The block that is currently being written is never read. The reader considers the three finished blocks before it, newest first, and applies three rules in order:

1. **Position rule.** If the reader's previous and current block were both playing, it takes the newest candidate whose transport position is the same as the position of its own previous block. This is exact: it also works when a loop repeats positions and when an export runs faster than real time.
2. **Time rule.** Otherwise, or if the first rule finds nothing, it takes the newest candidate that was written at least half a block earlier than the start of the current block, judged by a monotonic system clock. This covers a stopped transport and peers that have only just appeared.
3. **Hold.** If neither rule finds a block, the reader repeats the last sample it read from that cable, or 0 if there is none yet.

A candidate only counts if its sequence counter reads consistently and its block number matches, so a half-written block is never used. The audio thread never waits or spins for a block: it skips a candidate that is not ready and uses another one, or holds. If the chosen block is shorter than the reader's block, the rest of the block holds the last sample of the chosen one.

Related: [Timing](../spec/v0.1/05-timing.md), [Memory ordering](../spec/v0.1/03-memory-ordering.md), [Host notes](../api-reference/12-host-notes.md).
