---
title: Limits and safety
description: What the checker refuses in a module script, how the cost bound works, the patch-script sandbox, and what to know before running someone else's script.
order: 60
---

# Limits and safety

A script is code that runs while you play, so Bleep Script is strict about what it accepts.

## Module scripts: the checker

Before a module script compiles, a checker walks the code that runs on the audio thread (`block()`, `sample()`, `reset()`, `@on` handlers and everything they call). It refuses:

- recursion, closures, class expressions, exceptions and regular expressions;
- anything that may allocate or copy at run time: `push`, `map`, `concat`, `slice`, `split`, string building and similar. Allocate in the constructor;
- calls to anything but your own functions, `Math` and the `bleep/` libraries;
- `declare` (host imports), `load`, `store`, `memory`, `changetype`, `unchecked`, `unreachable`, `abort` and names starting with `__`;
- imports from anywhere but `bleep/`;
- loops with no bound the checker can see, and loops longer than 4096 iterations.

Each message names the line and says what to do instead.

### Cost bound

The checker also adds up the work of one chunk of audio (32 samples): every operation, with each loop counted at its bound. It is a bound, not a time, and one op is about a nanosecond.

- Over **60,000** ops: a warning.
- Over **400,000** ops: the module is refused.

A module that is too costly would make the audio glitch, so refusing it at compile time is the safe choice.

## Patch scripts

A patch script runs in a QuickJS sandbox inside a worker, with no access to the page, the network or storage. Its only output is the patch it returns. It is held to:

| Limit | Value |
| --- | --- |
| Time | 3 seconds, then it is stopped |
| Memory | 64 MB |
| Source | 200,000 characters |
| Result | 4 MB |

The result is checked against the module types on your board before anything is created: unknown knobs, jacks or modules are errors with the line.

## Custom UIs

A self-made UI (see [Custom UIs and widgets](../custom-ui.md)) is JavaScript from the script's author. It runs in a worker inside a sandboxed frame with no network, storage, cookies or access to the page, so it needs no approval. The frame watches the worker: a UI that stops answering for 1.5 seconds, does not start within 3 seconds or floods the board with messages is terminated and shows an error, and the board keeps running. The UI can still use your processor until then, and draw anything inside its own box.

## Scripts from other people

Read a script before you run it, as with any code. The sandboxes keep a script away from your files, other patches and accounts, and the checker keeps a module script from using more time than its budget. They do not make a script good, only contained.
