---
title: Plugin developers
description: Two kinds of plugin work: Bleep Bus plugins in any DAW, and the Bleep plugins in Ableton Live.
order: 10
---

# Plugin developers

"Plugin" means two different things here.

## Your own plugin, using Bleep Bus

You have a plugin (any format, any DAW) and want it to send or receive per-sample control signals to other plugins. That is **Bleep Bus**, an open protocol over named shared memory with a small C SDK and C++/JUCE helpers.

| Step | Page |
|---|---|
| Send and receive a signal in 15 minutes | [Quickstart](../bleep-bus/quickstart.md) |
| Every function, type and error | [API reference](../api-reference/00-overview.md) |
| Implement the protocol without the SDK | [Specification v0.1](../spec/v0.1/00-overview.md) |
| Prove your implementation is correct | [Conformance](../bleep-bus/conformance.md) |
| Propose a change to the protocol | [RFC process](../bleep-bus/rfc-process.md) |

## The Bleep plugins in Live

You want to change or extend the plugins that connect Ableton Live to the board. [Bleep plugins](bleep-plugins.md) covers how they share one engine, how to build and reload them, and how they are released.

If you want to add a new *sound* rather than a new plugin, write a [module](../modules/overview.md) instead: it works in the plugins, the app and the browser.
