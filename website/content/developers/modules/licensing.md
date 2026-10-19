---
title: Licensing
description: Which licence applies to what, in plain terms: you can publish closed-source and paid modules, and forks of Bleep itself stay free.
order: 5
---

# Licensing

The short version:

- **Bleep itself is free software** under the GPL (version 3 or later).
- **Your module is yours.** Write it against the module API and you can
  license it as you like: open source, free, closed source or paid.
- **Forks of Bleep stay free.** If you change Bleep itself and give it to
  others, your version stays under the GPL.

This page is a plain-language summary, not legal advice. The licence texts
decide: [`LICENSE`](https://github.com/jnehring/beautiful-bleep/blob/main/LICENSE)
and [`LICENSE-EXCEPTION.md`](https://github.com/jnehring/beautiful-bleep/blob/main/LICENSE-EXCEPTION.md).

## Which part has which licence

| Part | Licence | Why |
|---|---|---|
| The engine, board, apps and hub (`patch/`) | **GPL-3.0-or-later with the Bleep Module Exception** | Keeps Bleep and everything built from it free, while letting modules be anything |
| The built-in modules (`patch/modules/`) | **GPL-3.0-or-later**, unless a module's `module.json` says otherwise (the three ported ones keep their original licence) | Free to copy as a starting point for your own, under the GPL |
| [Bleep Bus](../bleep-bus/quickstart.md) (`bus/`) | **MIT** | An open protocol: anyone can implement it in any product |
| Scripts and the website (`scripts/`, `website/`) | **MIT** | Tools, not the product |
| Factory presets (`patch/presets/`) | **MIT** | Shared patches |
| Presets shared in the Library | **CC BY 4.0** | See [the library](library.md) |

Every source file has an `SPDX-License-Identifier` line that states its
licence, and CI checks it.

## The module exception

The GPL says that a program combined with GPL code must be GPL too. A module
runs inside Bleep, so without a special rule every module would have to be
open source. The **Bleep Module Exception** removes that for modules.

**You may license your module however you like** (open, closed, free or paid)
when it meets two conditions:

1. It talks to Bleep **only through the module API**:
   - the [Module ABI](module-abi.md), the contract of the `.wasm` file, and
   - the module SDK: `Module.h`, `Spec.h`, `Registry.h`, `DrumModule.h` and
     `Media.h` in `patch/engine/`, and the headers in `patch/common/dsp/`.
2. It does not copy or derive from any other **GPL-licensed** part of Bleep.
   Code that is under another licence, like the MIT-licensed
   Bleep Bus, can be reused under that licence.

### Examples

| You do this | Result |
|---|---|
| Write a module with the SDK headers and ship it as a closed-source `.wasm` | Fine. You need not publish the source |
| Sell that module, on your own site or elsewhere | Fine. The exception says nothing about price |
| Start from a built-in module (MIT) and keep your changes private | Fine. Keep the MIT notice of the original code |
| Port an open-source plugin under the MIT licence | Fine. Keep its notice, see [ported code](writing-a-module.md#ported-code-and-licences) |
| Port a GPL plugin or firmware | Your module must then be GPL too. That comes from the original code, not from Bleep |
| Paste code from the engine or board into your module | The module becomes a derivative of Bleep and must be GPL |
| Change the engine, then give the modified Bleep to others | That version is GPL. Share its source under the same terms |
| Fork Bleep and remove the exception | Allowed (the exception says so). Your fork is then plain GPL |

### Things the exception does not do

- It does not cover **changes to Bleep itself**, only modules that plug in.
- It does not give you the **name or logo**. You may say your module is
  "for Beautiful Bleep", but not use the name or logo as your own.
- It does not make a module **safe or trusted**. To run in the apps, a module
  must still be [signed](signing.md) and meet the ABI.

## Selling a module

Nothing in the licence stops you from charging for a module, and you pick the
terms your buyers get (a licence key, a EULA, a subscription). **The Bleep
Library is free today**: there is no payment or licence-key support in it
yet, so paid modules are distributed by you for now. Paid listings in the
library are planned; this page will say when they are available.

If your module is GPL (for instance because it is a port of GPL code), a buyer
may pass it on under the GPL. That is how the GPL works for everyone.

## Binaries and other licences

The source licence is not the only one that affects a build:

- Binaries built with **JUCE** also fall under JUCE's licence (AGPLv3 or a
  commercial JUCE licence). Check that before you distribute a build.
- App builds with **Ableton Link** are distributed under the GPL with their
  source. Because Bleep is now GPL, this no longer affects how Bleep itself
  is licensed; closed-source builds still need a Link licence from Ableton.

## Contributing to Bleep

To contribute code to Bleep, read the [contributing guide](https://github.com/jnehring/beautiful-bleep/blob/main/CONTRIBUTING.md).
You agree to a [contributor licence agreement](https://github.com/jnehring/beautiful-bleep/blob/main/CLA.md)
once. You keep your copyright. The agreement lets the project change the
licence or its exceptions later, always staying open source.

## Questions

Ask before you ship if you are unsure whether your module is covered. Write to
beautifulbleep@gmail.com.
