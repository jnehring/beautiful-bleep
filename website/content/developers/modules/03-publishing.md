---
title: Publishing a module
description: Package a built module, sign it with your developer key and release it to the Bleep Store.
order: 30
---

# Publishing a module

Modules are **code**, so the apps only run them if they are signed. The full rules are in [Signing](../reference/signing.md) and the store's layout in [Bleep Store](../reference/store.md); this page is the practical path.

## 1. Build the `.wasm` files

```bash
scripts/build/build-web.sh --docker --modules-only
```

This compiles every module with Emscripten (in Docker, so no local SDK is needed). Later builds recompile only the modules whose files changed. `BLEEP_WEB_ONLY=oscillator,filter` builds just those.

## 2. Package

```bash
scripts/release/package-module.py
```

One reproducible `.bleepmod` per module, in `build/store/modules`. The packager checks each `.wasm` against the [Module ABI](../reference/module-abi.md) and adds your licence and provenance information.

## 3. Get a developer key and a token

A publisher needs two things from the store's admin: a **signing kit** (your private key and a certificate issued under the store's root) and a **release token** for your publisher name. Module ids outside the store's own team carry your publisher namespace. Keep both private; the token is never a command-line argument.

## 4. Release

```bash
scripts/release/release.py --modules --level patch \
    --registry https://<store address> \
    --token-file ~/.bleep-release-token --kit ~/.bleep-signing-kit.json
```

`--modules` releases only the modules whose package content changed since their newest published version. `--dry-run` checks everything, including your kit, without publishing. Versions are immutable: a fix is a new version.

## Compatibility

Your package states the module ABI it was built for (`requires.engineAbi` in `module.json`). A host that does not support it refuses the module with a message instead of crashing, and the store tells the user which app version is needed.
