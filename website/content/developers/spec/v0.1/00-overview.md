---
title: Bleep Bus specification v0.1
description: The Bleep Bus specification, exact enough to implement without the SDK.
order: 0
---

# Bleep Bus specification, version 0.1 (experimental)

Bleep Bus lets audio plugins exchange per-sample control signals through
named operating-system shared memory. This document specifies the bus
exactly enough to implement it **without** the reference SDK. If you only
want to use the bus, read the [Quickstart](../../quickstart.md)
and the [API reference](../../api-reference/00-overview.md)
instead.

Status: **0.x is experimental.** Every minor version MAY change the layout;
implementations MUST refuse to share a segment with a different 0.x minor
version. From 1.0 on, compatibility is guaranteed within a major version.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be
interpreted as described in RFC 2119.

## Model

- A **bus** is one shared-memory segment, identified by a **namespace**.
- An **endpoint** is one plugin instance. It has a stable 64-bit **UID**.
- An endpoint owns **outputs** and **inputs** (together: ports), each with a
  name unique per endpoint and direction.
- A **connection** (cable) links an input to a source `(endpoint UID, output
  name)` with an **amount**. Connections are stored with the input, i.e. with
  the receiving endpoint.
- Audio threads exchange **blocks**: an output publishes one block of samples
  per processing cycle; an input reads, for each connection, the block the
  source wrote for the reader's *previous* block (one block of latency).

## Contents

1. Naming — segment names and namespaces
2. Layout — every byte of the segment
3. Memory ordering — atomics, seqlocks and the registry lock
4. Registry — endpoints, ports, reclamation of dead processes
5. Timing — block stamps and the block selection rules
6. Signals — value conventions ("virtual volts")
7. Connections and state — cables, amounts and the saved-state format
8. Versioning and extensions
