---
title: Patch script runner
description: How a patch script runs in a QuickJS sandbox and how the description it returns becomes nodes and cables.
order: 20
---

# Patch script runner

A patch script never touches the audio thread. It runs once, and what it returns is a description that the board checks and builds. The code is in `patch/script/patch/`.

| File | Role |
|---|---|
| `run.mjs` | Strips the TypeScript types (with Sucrase, keeping line numbers) and runs the script in **QuickJS compiled to WebAssembly**: no network, no files, no clock, no DOM, a 64 MiB memory limit and a 3 second time limit. The only thing that leaves the sandbox is the data the script returns. |
| `prelude.mjs` | The code that runs inside the sandbox before yours. It defines `cell()` and the builder, and records what you ask for as plain data. |
| `materialize.mjs` | Back in the host: checks the description against the board's module types and turns it into nodes and cables. |

`materialize.mjs` checks that every module exists and can be added, that the knobs exist and the values fit, and that the jacks exist and the signal types match. Units are converted to the knob's 0 to 1 range with the same rules as the engine's `ParamSpec::toNormalised`, and the checks are those of the factory preset kit (`patch/presets/kit.mjs`), which builds the factory cells the same way.

A mistake in a patch script can only produce a description that `materialize.mjs` then refuses. See [Limits and safety](limits.md#the-patch-script-sandbox) for the sandbox limits.
