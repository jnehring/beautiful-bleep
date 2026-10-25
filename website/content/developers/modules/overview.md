---
title: Module developers
description: What a module is, how it differs from a plugin, and the path from source folder to the Bleep Library.
order: 10
---

# Module developers

A **module** is a node on the board: a folder in `patch/modules/<type>/` with a `module.json`, a C++ node that declares its knobs and jacks and processes audio in `process()`, DSP without JUCE, an optional custom view in JavaScript, tests, and a user manual.

The same source is built for every host. The result is **one standalone `.wasm` file** that the engine in the plugins, the Bleep App and the browser all run, so a module you write works everywhere without per-platform code.

## The path

1. **Write it.** [Writing a module](writing-a-module.md): the folder layout, `BLEEP_REGISTER_MODULE`, shared DSP in `patch/common/dsp/`, engine features (stepped knobs, groups, buttons, node data, media, voices, custom views).
2. **Test it.** DSP tests per module, plus `bleep_module_harness`, which runs every module with every input fed at several sample rates and checks that outputs stay finite and bounded.
3. **Document it.** A manual in `doc/<type>.md` with a screenshot. The board shows it behind the view's `?` button and this website shows it under Modules.
4. **Package it.** [Publishing a module](publishing.md): a `.bleepmod` package.
5. **Release it.** To the [Bleep Library](library.md), where users and the apps install it.

## What a module must satisfy

- [Module ABI](module-abi.md): the exports, memory limits, determinism rules and versioning a host expects of the `.wasm` file.
- [Recorder service](recorder-service.md): how a module writes audio to files without a disk: sessions, takes, the Recordings folder and the imports that reach it.
- [Licensing](licensing.md): modules may be open source, closed source or paid; the module exception explains what that needs.
- Licences of ported code: a module ported from other code keeps the original's licence and says so in `module.json`; copyleft ports ship only through the library, never inside the apps. [Writing a module](writing-a-module.md) has the rules.

## Modules and the Bleep Bus

Modules talk to each other with cables on the board. They do not use [Bleep Bus](../bleep-bus/quickstart.md), which connects separate plugins in a DAW.
