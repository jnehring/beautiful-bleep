---
title: Publishing a module
description: Share a module with the community, or package, sign and release it as a developer.
order: 30
---

# Publishing a module

Modules are **code**, so the apps only run them if they are signed. The full rules are in [Signing](signing.md) and the library's layout in [Bleep Library](library.md); this page is the practical path. There are two:

| | Share with the community | Release as a developer |
|---|---|---|
| For | Any module you made, closed source included | Plugins, Bleep's own modules, modules with their own JavaScript |
| Needs | An account on the library's site | A signing kit and a release token from the admin |
| Who signs | The library, after its checks | You, with your key |
| Section | [Share a module with the community](#share-a-module-with-the-community) | [1 to 4](#1-build-the-wasm-files) |

## Share a module with the community

You need no key. You upload the module unsigned; the library checks it, signs it and publishes it as `<your name>/<module name>`. Your name is the handle of your account (the one in the address of your presets, set when you first publish).

**From a Code node,** the **Share…** button does steps 2 and 3 for you in the browser while you are logged in to the library: it asks for the metadata and help text, builds the package and uploads it (see [The Code node](../bleep-script/code-node.md#share)). The rest of this section is the same thing from the command line.

**1. Make a token.** Log in to the library's site, open *Account > Apps* (`/account/apps/`) and create an access token. Save it in a file only you can read, for example `~/.bleep-token`. It is shown once.

**2. Prepare the package.** A folder (or an unsigned `.bleepmod`) with:

| File | |
|---|---|
| `module.json` | Required. `types`: the node types it provides, **all starting with `<your name>/`**; `requires.engineAbi`: `1`; optionally `title`, `summary`, `category`, `license` (SPDX, default MIT) and `origin` for ported code |
| `module.wasm` | Required. Imports only what the [Module ABI](module-abi.md) allows and exports the whole ABI |
| `spec.json` | Required. The node types' descriptions |
| `view.sandbox.js` | Optional. The module's own picture, written as a Code node's UI: it runs only in the sandboxed worker frame (no network, no storage, no DOM, stopped if it hangs), never in the page |
| `source.dsp.ts` | Optional. The module's Bleep Script source, so that everyone can open it in a Code node (*Convert to code*) and change it. The module's licence applies to it |
| `image.png`, `image.jpg` or `image.webp` | Optional. The picture on the module's tile in the library, up to 1 MB: a screenshot of the module |
| `LICENSE`, `doc/*.md`, `doc/*.png` | Optional |

Nothing else is allowed. In particular there is **no `ui/*.js`**: a module's page scripts run in the page, which only first-party modules may do. Its picture is `view.sandbox.js` instead, which is safe because it never runs in the page. Limits: 12 MB per package, 8 MB for the `.wasm`, 24 files.

**3. Check and publish.**

```bash
scripts/release/community-publish.py my-module/ --name wobble --version 1.0.0 --check
scripts/release/community-publish.py my-module/ --name wobble --version 1.0.0 \
    --registry https://<library address> --token-file ~/.bleep-token
```

`--check` runs the library's own checks locally and sends nothing. The id of this module is `<your name>/wobble`. Each upload needs a higher version than the one before, and a version you withdrew stays used. You can publish up to 100 modules and 10 uploads an hour.

**4. After publishing.** The module appears in the library marked *community*. Users need no setting to run it; it runs in the same sandbox as every module. To withdraw a release, call `POST /api/registry/community/modules/<your-name>.<name>/<version>/takedown` while logged in (or ask the admin); apps that already have it stop loading it once they fetch the next revocation list. If the library refuses your upload, the message names the rule and the file.

## Release as a developer

The steps 1 to 4 below are for publishers with a developer key. Sharing a module with the community does not need them.

## 1. Build the `.wasm` files

```bash
scripts/build/build-web.sh --docker --modules-only
```

This compiles every module with Emscripten (in Docker, so no local SDK is needed). Later builds recompile only the modules whose files changed. `BLEEP_WEB_ONLY=oscillator,filter` builds just those.

## 2. Package

```bash
scripts/release/package-module.py
```

One reproducible `.bleepmod` per module, in `build/library/modules`. The packager checks each `.wasm` against the [Module ABI](module-abi.md) and adds your licence and provenance information.

## 3. Get a developer key and a token

A publisher needs two things from the library's admin: a **signing kit** (your private key and a certificate issued under the library's root) and a **release token** for your publisher name. Module ids outside the library's own team carry your publisher namespace. Keep both private; the token is never a command-line argument.

## 4. Release

```bash
scripts/release/release.py --modules --level patch \
    --registry https://<library address> \
    --token-file ~/.bleep-release-token --kit ~/.bleep-signing-kit.json
```

`--modules` releases only the modules whose package content changed since their newest published version. `--dry-run` checks everything, including your kit, without publishing. Versions are immutable: a fix is a new version.

## Compatibility

Your package states the module ABI it was built for (`requires.engineAbi` in `module.json`). A host that does not support it refuses the module with a message instead of crashing, and the library tells the user which app version is needed.
