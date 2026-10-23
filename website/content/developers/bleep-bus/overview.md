---
title: Bleep Bus
description: What Bleep Bus is, who it is for, and a map of the quickstart, API reference, specification, conformance suite and RFC process.
order: -10
---

# Bleep Bus

**Bleep Bus** is an open protocol (MIT) and a small C SDK for sending per-sample control signals between audio plugins through named shared memory. It works between any plugins in any DAW; it does not need Beautiful Bleep. It is separate from the cables on the Bleep board, which connect [modules](../modules/overview.md) inside one engine.

## The pages

| Step | Page |
|---|---|
| See how it fits together | [Architecture and signal flow](architecture.md) |
| Send and receive a signal in 15 minutes | [Quickstart](quickstart.md) |
| Every function, type and error | [API reference](../api-reference/00-overview.md) |
| Implement the protocol without the SDK | [Specification v0.1](../spec/v0.1/00-overview.md) |
| Prove your implementation is correct | [Conformance](conformance.md) |
| Propose a change to the protocol | [RFC process](rfc-process.md) |

## What is in the repository

The code is in `bus/`: the C API (`include/bleep_bus.h`), the shared-memory layout for reimplementations, a reference implementation for POSIX and Windows, a header-only C++17 wrapper, JUCE helpers, examples and the conformance test host. `bus/README.md` lists every folder and the build command.

The sidebar of this section holds three groups: the guides (this group), the API reference and the specification.
