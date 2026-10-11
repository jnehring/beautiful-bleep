---
title: API reference
description: The complete SDK reference for plugin developers, and how to read it.
order: 0
---

# Bleep Bus API reference (spec v0.1)

The complete reference for plugin developers using the SDK: concepts,
lifecycle, every function, type and error code, the C++ and JUCE helpers,
host notes, pitfalls and the conformance checklist. The source of truth is
the commented header `bus/include/bleep_bus.h`; CI checks that every
function in it is documented here.

- **Language:** plain C99 API, usable from C, C++, Rust, Zig, Swift …
- **Linking:** one static library (`bleep_bus`), no dependencies.
- **License:** MIT. Link it into closed-source plugins freely.

Thread markers used below:

- **[RT]** real-time safe: no locks, no allocation, no system calls. Call it from the audio thread.
- **[non-RT]** may lock or allocate. Never call it from the audio thread.
