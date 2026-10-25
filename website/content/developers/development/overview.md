---
title: Development
description: Work on Bleep itself: the plugins in Live, the standalone app, Bleep Play in the browser, modules, and the engine ABI that ties them together.
order: -10
---

# Development

These pages are for working on Beautiful Bleep itself and the things that run on its board. To connect your own plugin to others, use [Bleep Bus](../bleep-bus/overview.md). To write code that runs on the board, see [Bleep Script](../bleep-script/overview.md). To install tools and build, see [Developer setup](../setup/overview.md).

| I want to… | Read |
|---|---|
| See how board, engine, modules and hosts fit together | [Architecture overview](architecture.md) |
| Add a sound, effect or utility to the board | [Modules](../modules/overview.md), [Writing a module](../modules/writing-a-module.md) |
| Publish a module in the library | [Publishing](../modules/publishing.md), [Library](../modules/library.md) |
| Know what a `.wasm` module must export | [Module ABI](../modules/module-abi.md) |
| Change the Bleep plugins in Live | [Plugins](../plugins/overview.md), [Bleep plugins](../plugins/bleep-plugins.md) |
| Change the standalone app | [Standalone app](../app/standalone-app.md) |
| Change Bleep Play, the board in the browser | [Web](../web/bleep-play.md) |
| Know what the plugins and the engine promise each other | [Engine ABI](engine-abi.md) |

## One engine, four hosts

The same engine and board run in every host. A **module** is one `.wasm` file that all of them load, so modules need no per-platform code. The **plugins** share one engine per Live set, the **app** runs it without a DAW, and **Bleep Play** runs it in the browser. The sidebar of this section has one group per host, plus modules and the engine ABI.
