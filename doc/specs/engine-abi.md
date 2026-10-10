# The engine ABI: how Bleep plugins share one engine

Every Bleep plugin is its own compiled file, but a set has one engine (`specs.md` §5.3). The first plugin loaded creates it and publishes it in the process; the others find it and call it through `IEngine` (`patch/engine/EngineApi.h`).

**ABI** (application binary interface) is the contract about how two compiled pieces talk: the order of the methods in the interface (a plugin calls "the 14th method", not a name), the layout of the data they pass in memory (`BlockIO`, `PortFrame`, `NoteEvent`) and the types used (plain integers, pointers and char arrays: no `std::string` or JUCE class crosses a binary). If both sides agree, any two builds can share an engine. If not, the result is wrong sound or a crash.

## Versions

| | Changes when | Builds that differ |
|---|---|---|
| **Major** (`kAbiTag`, `bleep-engine-abi-N`, plus the sizes of `BlockIO`, `MidiEvent`, `Transport` and a pointer) | A method is inserted or removed, a shared struct changes, a type changes | Refuse to share. The plugin shows "Another version of Bleep Patch is loaded." |
| **Minor** (`kAbiMinor`, `IEngine::abiMinor()`) | A method is **added at the end** of `IEngine` | Share. Old plugin on a new engine: fine. New plugin on an old engine: it asks `engine.supports(minor)` before it calls the new method, and does without it. |

The minor is the first method of `IEngine` and never moves, so a plugin can always read it. A minor starts at 0 with every major.

## Rules for changing `IEngine`

1. **Add a method:** put it below the destructor, after a `public:`, with `[minor N]` in its comment; raise `kAbiMinor` to `N`; guard every call in the plugins with `supports(N)`; add it to `MismatchEngine`.
2. **Anything else** (insert, remove, reorder, change a signature, change a shared struct): raise the major (`kAbiTag`). Reset `kAbiMinor` to 0 and drop the guards of the old major.
3. A change in what an existing method *does* (not its shape) is not an ABI change, but if a plugin relies on the new behaviour it needs a minor that says so.

## Where the engine lives

The engine's code is in the **first Bleep plugin loaded** in the process; it pins itself so it stays until Live quits. So the engine is as old as that plugin: with a mix of builds, the oldest plugin loaded first decides what the engine can do, which is why plugins check `supports` rather than assume. After updating plugins, restart Live.

## Two contracts, two numbers

```
plugin  ──(IEngine: this document)──▶  engine  ──(module ABI: module-abi.md)──▶  module
```

A plugin never talks to a module. It talks to the engine, and the engine runs the modules. So there are two contracts, each with its own version:

| Contract | Between | Form | Version |
|---|---|---|---|
| **Engine ABI** (this document) | Bleep plugins and the one engine in the process | C++ virtual interface, in-process | `kAbiTag` (major) and `kAbiMinor` |
| **Module ABI** ([`module-abi.md`](module-abi.md)) | The engine and a `.bleepmod` (WebAssembly) | C functions exported by the `.wasm` file | `engineAbi`, one integer in the module's `requires` |

- **First-party modules compiled into the plugins** are not a cross-binary case: the engine creates them from the registry of *its own* binary, so the engine and the module are always the same build.
- **Store modules (wasm)** are where the module ABI matters: the engine checks `requires.engineAbi` against the range it supports, and refuses a module outside it with a message that says which. The module host that does this is part of the engine, so it is as new as the plugin that created the engine.
- The two numbers move independently. A new `IEngine` method (engine minor) says nothing about modules; a changed module export (module ABI) does not touch the plugins' interface. The module ABI could take the same major and minor scheme (compatible additions keep the number, today they are listed as "stay version 1"); that is for `module-abi.md` to decide, not this document.

## Not the Bleep Bus

The Bleep Bus is a protocol between external plugins (Grit, Cinch …) and the board, with its own version. The engine ABI is the contract among the Bleep plugins themselves; the two are numbered separately.
