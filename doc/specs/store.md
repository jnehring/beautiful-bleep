# Bleep Store and release system

Plugins, modules and presets are managed in one place, the **Bleep Store**. Everything that installs, updates or loads one of them (the standalone app, Bleep Play, the release pipeline) talks to the store and nothing else.

| Kind | What it is | Who loads it | Form |
|---|---|---|---|
| **Plugin** | Something you load in Ableton: Bleep Board, the ports, later Bus receivers | Live, the app's Store section installs it | Installer per platform and format (VST3, AU, CLAP) |
| **Module** | A node type on the board: its DSP, view and docs | The engine in the plugins, the app and the browser | `.bleepmod` package |
| **Preset** | A patch (a whole board) or a cell (a subgraph, with its panel) | The board | `.bleeppreset` file (JSON) |

*Naming:* the store was first called the registry, and its technical names keep that word: the URL path `/registry/v1/`, `BLEEP_REGISTRY_URL`, `/api/registry`, the `bleep-registry` bucket. In prose it is the Bleep Store, "the store" after the first mention.

Plugins and modules are **code**: signed by their developer, immutable. Presets are **data**: published by anyone with an account. How code is signed and checked is in [`signing.md`](signing.md); what a module is to the engine, in [`module-abi.md`](module-abi.md).

## Decisions

- **Modules are WebAssembly everywhere** (web and native), hosted by an embedded wasm runtime in the engine. See 4.2.
- **The store is part of the website stack** (Caddy, the FastAPI `website/api` and its Postgres), hosted locally for now and moved with the stack later. No separate infrastructure.
- **Everything the shop distributes as code is signed**, by its developer's own key under our root (see [`signing.md`](signing.md)). Apps refuse unsigned modules and plugins unless the user switches on *Allow unsigned modules* or *Allow unsigned plugins* in the settings.
- **Modules and plugins reach the user three ways:** from the store on demand, through two **bundles** the setup offers (*default modules*, *default plugins*), or by copying files into a folder (section 5a).
- **Everything is free.** There is no licence-key or entitlement logic anywhere.
- **Downloading needs no login**: browsing, installing plugins, modules and presets, and update checks are anonymous. **Sharing a preset needs an account** (the existing `website/api` accounts).

## 1. Where this stands today

- Modules are folders in `patch/modules/<slug>/` with a `module.json`; native builds compile them **into** the plugins through `BLEEP_REGISTER_MODULE` (static).
- The browser build already produces **one standalone `.wasm` per module** and a `manifest.json` (`patch/web/build_modules.py`), loaded on demand. But `website/Dockerfile` runs it (emscripten, a JUCE clone) on every site build.
- Presets are `presets/*.bleepboard` plus `patch/board/ui/factory-presets.json`, built into the UI.

The wasm-per-module work is the seed of the system: the module package is that file plus its metadata.

## 2. Common to every artifact

Every entry in the store has the same envelope:

```json
{
  "kind": "module",                    // plugin | module | preset
  "id": "dual-filter",                 // slug; presets: "<author>/<slug>"
  "version": "1.2.0",                  // semver, immutable once published
  "channel": "stable",                 // stable | beta
  "title": "Dual Filter",
  "author": "brilliant-bleep",
  "license": "MIT",
  "requires": { "engineAbi": 3, "bus": ">=0.1", "modules": { "lfo": ">=1.0" } },
  "files": [ { "path": "dual-filter.bleepmod", "sha256": "…", "bytes": 48213, "platform": "any",
               "signature": { "keyId": "…", "chain": [ … ], "signature": "…" } } ],
  "published": "2026-10-09T10:00:00Z"
}
```

- **Immutable and content-addressed.** A published `id@version` never changes; a fix is a new version. Files are named by sha256 in storage, so caches never go stale.
- **`engineAbi`** is an integer bumped when the module ABI (specified in [`module-abi.md`](module-abi.md); the C interface in `patch/web/src/WebShim.cpp`) changes incompatibly. Hosts refuse modules they cannot run and the Store section explains why.
- **Signing.** Every file of a plugin or module entry has a developer signature (`files[].signature`: a chain root > store issuer > developer, over the content hash, kind, id, version and platform), checked by the store on upload and by every host before it loads or installs. `index.json` and the revocation list carry the store issuer's signature, a rising `serial` and an expiry. Details, the settings and a test vector in [`signing.md`](signing.md).

## 3. The store

It lives in the website stack. Published files are objects in a **SeaweedFS** bucket (`storage` service, data on the `registry-data` volume; S3 API, so moving to AWS S3, R2 or similar later is a change of endpoint; MinIO was considered but no longer publishes images). The bucket is public-read and Caddy proxies `/registry/*` to it, so downloads are cacheable and run no app code; the API owns what is dynamic.

```
S3 bucket `bleep-registry` (SeaweedFS)  →  Caddy proxies it read-only at /registry/v1/…
/registry/v1/
├── index.json                 plugins and modules per channel, signed
├── plugins/<id>/<version>/    installers + entry.json
├── modules/<id>/<version>/    <id>.bleepmod + entry.json (+ doc, screenshot)
└── presets/<author>/<slug>/<version>.bleeppreset

/api/…  (FastAPI + Postgres, existing accounts and sessions)
├── GET  /api/presets?q=&type=&tag=&sort=     search (anonymous)
├── GET  /api/presets/<author>/<slug>         metadata, versions, download counts (anonymous)
├── POST /api/presets                         publish a version (login)
├── DELETE/PATCH /api/presets/<id>            own presets (login); admin may unlist any
├── POST /api/presets/<id>/report             report (anonymous or login)
└── POST /api/tokens, GET /api/tokens         personal access tokens for the app (login)
```

| Part | Where | Written by |
|---|---|---|
| Plugins and modules (files, `index.json`) | S3 bucket | Only the release pipeline: `scripts/release/release.py` uploads over the S3 API (port 8333, bound to localhost; credentials `S3_ACCESS_KEY`/`S3_SECRET_KEY` in `website/.env`) |
| Preset files | Same bucket under `presets/` | The API after validation |
| Preset metadata (title, tags, author, versions, downloads, reports, state) | Postgres, new Alembic migration | The API |

**What a tile shows.** Every plugin, module and preset has a title, a `summary` (up to 280 characters), a `category` and an optional screenshot, as metadata of its release: `entry.json` carries `summary`, `category` and `image` (the file name next to it, `image.png`, `.jpg` or `.webp`). `release.py` takes them from the module package (its `module.json` and `doc/<slug>.png`) and, for plugins, from `PLUGIN_TILES` and `doc/store/<slug>.png`, and uploads the image with `PUT /api/registry/<kind>/<id>/releases/<version>/image` (PNG, JPEG or WebP up to 1 MB; display data, so not signed, and replaceable by the token that made the release). Without a screenshot the store draws a placeholder in the colour of the kind. `GET /api/store` returns them with `image_url` and the `categories` of the matching entries, and filters by `category`.

`GET /registry/v1/index.json` is the one call a client needs at start. It lists, per id, the newest version per channel, so an update check is one small request with an `ETag`. The API only ever sees preset search and publishing, so a stopped API doesn't stop installs of plugins and modules.

**Login in the app.** The app has no browser cookie. *Sign in* opens the website's login page for a one-time device code (like `gh auth login`): the app shows a code, the user confirms it on the site, and the app stores a personal access token in the OS keychain. The token only allows publishing and managing the user's own presets. Not signed in, the app works fully except *Share…*.

**Moving later.** Everything is addressed by one base URL (`registry` in the app's settings and the site's config), so moving the stack into the Brilliant Bleep Compose stack or behind a CDN changes configuration, not code.

## 4. Modules

### 4.1 Package

A `.bleepmod` is a zip:

```
module.json          existing fields (name, slug, tagline, colour, category, doc) + version, requires, types[]
module.wasm          the DSP, standalone, C ABI (no JUCE, no JS glue)
ui/<type>.js         the module's custom view (optional)
doc/<type>.md, .png  user documentation and screenshot
```

`summary` (one or two sentences, from the module's `tagline`, else its first node type's description) and `category` ("Sources", "Modulation", …, from the module's node types) are filled in by the package step. The store shows them, with the screenshot, on the module's tile.

`types[]` replaces the generated `manifest.json` "types → module" map: one package can provide several node types (the drum modules do).

The source layout in `patch/modules/<slug>/` does not change; a package step (`scripts/package-module.py`, built on `build_modules.py`) turns a folder into a package. Adding a module still touches no shared file.

### 4.2 Native modules: wasm everywhere (decided)

Modules are statically linked into the plugins today. For the app to install, update and uninstall modules, the plugins need to load them at run time. Options:

| | Native shared library per OS/arch | **WebAssembly everywhere** | Keep static, ship everything with the plugin |
|---|---|---|---|
| One artifact for web, macOS, Windows, Linux | no (6 builds each, code signing and notarisation per file) | **yes** | n/a |
| Speed | best | AOT-compiled wasm: close to native; interpreted: too slow | best |
| Sandbox: safe to run modules from other people | no | **yes** (no syscalls, own memory) | n/a |
| Updating a module without updating the plugin | yes | **yes** | no |

**Decision: wasm everywhere.** The engine gets a `WasmModuleHost` (embedded WAMR or wasmtime, AOT-compiled at install time and cached per machine) that implements the same `Module` interface the static modules do. **The apps and plugins ship without modules** (decided): every module, first-party or not, is installed from the store, so there is one path and one set of rules. Offline, the installer carries the default module bundle. The native sources stay in the repository: the tests run them as the reference the wasm builds are compared with, and a module that turns out too heavy as wasm may later get a native package for its platform.

**Gate, first answer (Verb, Apple M-series, Live 12; `patch/wasm-host/`).** Wasmtime (Cranelift JIT) costs about 1.2× the native module in a standalone benchmark and 1.5 to 1.7× through the plugin, copies around each 32-sample chunk included (3.2 % of a core against 1.9 %), and loads in 44 ms; the output matches the native build to about 1e-6. The wasm3 interpreter costs ten times Wasmtime (32.5 % of a core), so it is only a fallback for very light modules. Both run in Live, which allows the executable memory Wasmtime needs. Consequences: **Wasmtime is the runtime**; wasm3 stays an option for trusted, cheap modules; a host without executable memory runs only what wasm3 can carry (cheap modules; the rest show as unavailable: **open**, section 12) (a plugin cannot "try and fall back": Wasmtime is killed, not refused, so the runtime is chosen from the host's entitlements or a setting before any code is compiled). Still to run: the heaviest modules (Grains, Delay Network, Modal Voice). If one costs more than about 2× native, it stays static-only and is also offered as a native package (the `platform` field in `files` already allows per-platform files). Not yet tested: other DAWs, Windows, Linux.

### 4.3 Resolution on the board

A board file lists the node types it uses. On load, a host resolves each type: bundled → installed → store (browser: fetch; app: offer to install; plugin in Live: use the installed set and show a placeholder node for a missing type, never download inside an audio host).

## 5. Plugins

Plugins are installed from the Store section of the app, not hot-loaded:

- Artifacts: a signed and notarised installer per OS (`.pkg`, `.msi`, `.zip` for Linux) containing all formats of one plugin, or the whole bundle.
- Install paths are the system's (`/Library/Audio/Plug-Ins/VST3`, …). **Live must not be running** while a loaded plugin is replaced (the README warns of crashes); the app checks for Live and asks the user to quit it first.
- The store entry says which formats and OS versions each file supports. Third-party Bus receiver plugins can be listed with a download link (not hosted by us) so the Store section is one place for everything that works with the Bus.
- A plugin states the module `engineAbi` range it can host, so the app can warn when a module needs a newer plugin.

## 5a. Bundles, first run, and manual installs

**Bundles.** A bundle is an entry of `kind: "bundle"`: no files, a signed list of members with their versions and content hashes (`signing.md`, section 12). Two exist, both published by `bleep`:

| Bundle | Members | Why |
|---|---|---|
| `default-modules` | Every first-party module (80 today, about 25 MB of wasm) | What the board offers out of the box, one tick instead of 80 installs |
| `default-plugins` | Every Bleep VST3: Bleep Board, the port plugins (MIDI In, MIDI Out, Audio In, Audio Out), Bleep Instrument and Audio Insert | The plugins Live needs; they must all be the same version, because they share one engine |

Installing a bundle installs its members, each verified on its own. A bundle update is a new bundle version; the Store section shows "Update all" and installs only the members that changed.

**First run.** When the app is installed (the installer's last page, or the first launch for a download without an installer), a setup assistant asks, with sizes and both pre-ticked:

1. **Download the default module bundle** (the modules from the store, into the store folder below).
2. **Install the default plugin bundle** (all VST3 bridges into the system plugin folder). If Live is running it asks to quit it first, as in section 5.

Declining either is fine: the app works, a missing module is a placeholder node with an *Install* button, and the Store section keeps a "Default modules are not installed" banner until it is done. **Offline:** an offline installer carries both bundles. The apps ship without modules (4.2), so until the module bundle is installed a board shows placeholder nodes. A plugin in Live never downloads anything on its own: modules are installed from the Store section of the app or of the plugin window, on a non-audio thread.

**Manual installs.** Everything can also be copied by hand:

| What | Folder | Notes |
|---|---|---|
| Modules from the store | `<data>/modules/registry/<id>/<version>/` | Written by the Store section; do not edit |
| Modules by hand | `<data>/modules/local/` | A `.bleepmod`, or `<name>.wasm` with a `<name>.json` (the `module.json`) beside it. Read at start and when the folder changes. |
| Plugins | The system VST3 folders | Copied by hand as usual; the Store section lists them with their status |

`<data>` is `~/Library/Application Support/Bleep` (macOS), `%APPDATA%\Bleep` (Windows), `~/.local/share/Bleep` (Linux); the settings can point at another folder. Every file in these folders goes through the same check as a download (signature, imports, ABI version); unsigned ones need *Allow unsigned modules* (or plugins) in **Settings → Security**, and the app, the plugins and the Store section all read that setting from the one settings file. When several copies provide the same node type, the choice is: highest compatible version, then signed over unsigned, then the manual folder over the store (`signing.md`, section 11).


**Build options and the store configuration.** `config/store.json` is the one place that says where the store is (`storeUrl`, the website's address; the store lives under `/registry/v1/`) and whom it trusts (`rootKeys`, hex root public keys). The apps' and plugins' build bakes it in (`BLEEP_STORE_CONFIG` names another file, `BLEEP_STORE_URL` and `BLEEP_STORE_ROOTS` override it for one build) and `scripts/release/release.py` uses `storeUrl` when no `--registry` or `$BLEEP_REGISTRY_URL` is given; the user can still change the address in `settings.json`. With `-DBLEEP_WASMTIME_DIR=<Wasmtime C API>` the apps and plugins are built **without modules** (`BLEEP_BUNDLE_MODULES=ON` puts them back). `BLEEP_DATA_DIR` moves the data folder (tests, development); a developer's own root goes into `settings.json` as `extraRoots`. The first-run assistant answers once (`firstRunDone` in `settings.json`). **The plugin download:** the app reads the plugin entries of the index, takes the build for its platform (`macos-arm64`, ...), checks the sha256 and the signature (kind `plugin`, the file as a one-file package) and the *Allow unsigned plugins* setting, and unpacks the `.vst3` bundles into the user's VST3 folder, with Live closed; an offline installer's `Plugins` folder (macOS: `Contents/Resources/Plugins` in the app) is copied instead. The pretend Store for working on the UI is the board dev server with `?store` in the address.

## 6. Presets

Two kinds, one file format (`.bleeppreset`, JSON, same schema as board persistence plus the envelope in section 2):

| `preset.type` | Contains | Loaded as |
|---|---|---|
| `patch` | A whole board: nodes, cables, panels, settings | Opens as a project, or merges into the current board |
| `cell` | One cell: its inner graph, jack names, its panel | Dropped onto the board as a cell |

- **Dependencies.** A preset, cell or patch, may carry `needs`: the modules it requires, by module slug, each with an optional inclusive `min` and `max` version:

  ```json
  "needs": { "lfo": { "min": "1.2.0" }, "reverb": { "min": "2.0.0", "max": "2.9.9" } }
  ```

  Saving a preset from the board writes `needs` for every module its node types come from, with `min` set to the version installed at that moment; an author adds `max` by hand. Before a preset is loaded or placed (the preset browser, *Add → Cell*), the board checks `needs` and, without a version, every module that provides one of its node types. If something is missing or too old, a dialog lists it and offers **Download n from the Bleep Store**, then loads; *Load anyway* keeps placeholder nodes, *Cancel* loads nothing. Versions the store cannot supply are listed with the reason and cannot be fixed by the dialog: the store offers only the newest version of a module, so a `max` below it, a local copy of a module, or a module the store does not have can only be loaded anyway. Factory presets carry no `needs` (the default module bundle covers them). The check runs in the app and in plugin windows (installing happens off the audio thread); Bleep Play installs the types a board uses by itself (section 8).
- Publishing: from the board, *Share…* (needs an account; browsing and downloading never do), a title, tags, a licence (default CC-BY, CC0 allowed), optional audio preview. The API validates the schema, checks all referenced types exist in the store, enforces a size limit and per-user rate limit, and rejects anything that is not pure data.
- Versions: re-publishing creates a new version; installed copies show "update available". Local edits to an installed preset are kept as a fork.
- Moderation: report button, takedown by an admin (the existing `admin` role) sets the preset's state to unlisted; the file stays but is no longer served in search.
- The factory presets move out of `factory-presets.json` into the store's `bleep` author, so the app, the website and the plugins all show the same library. A small set stays bundled for offline.

## 7. Release process

Single source: the repository. CI builds and publishes; nobody uploads by hand.

1. **Version.** Every plugin and module has its own version, counted by the store: `scripts/release/release.py --level x|1.x|1.1.x|major|minor|patch` takes the newest published version and counts up at that level (built for plugins; see `doc/release.md`). A module's `module.json` carries the version once modules are released.
2. **Detect what changed.** Hash the module's folder plus the `patch/common/dsp/` headers it includes (and `engine/` ABI). If the hash differs from the last release, the module needs a new version, and CI fails if its `version` was not bumped.
3. **Build and test** (existing CI): the DSP tests, the module harness, the wasm build, then the harness against the wasm. Plugins: the macOS/Windows/Linux matrix, signing and notarisation.
4. **Package and sign** (`scripts/package-module.py`, `scripts/package-plugin.sh`, `scripts/release/signing.py sign`): produce the artifacts and the `entry.json` files, each file signed with the publisher's key.
5. **Stage.** Upload to `…/staging/<release-id>/`. A smoke job loads every staged module in the node host test and in a headless browser.
6. **Publish.** Copy staged files into the immutable paths, then write `index.json` last, signed, in one atomic replace. A release is visible only when the index changes; rollback is putting the previous index back.
7. **Channels.** `beta` index first for testers; promoting to `stable` is a new index, not a rebuild.

`scripts/release/release.py` is built for plugins (steps 4 to 6 in a simpler form: a draft release, size- and hash-checked uploads, publish, index regenerated). It authenticates with an **admin-created release token** (`python -m app.cli token-create`), not with the storage credentials, so the machine that releases never holds S3 keys. Built since: adding the build of another platform to a published release (`--add-platform`), and **signing**: `release.py` signs every file with the developer's kit and checks it against the store's root keys before uploading; the store verifies every signature, binds a token to a publisher, records who uploaded and refuses a release without a valid key (`signing.md`, section 10). Not built yet: change detection, staging, a signed index and revocation list, modules.

## 8. Website

- **Docker no longer builds wasm.** The `web` stage of `website/Dockerfile` is removed. The site image contains only the Next.js static export and the board UI.
- **Modules load from the registry.** `bleep-web.js` fetches `index.json` (cached) and then `modules/<id>/<version>/<id>.bleepmod` on demand, from the CDN, exactly as it loads `.wasm` today.
- **Pinned for reproducibility.** The site build commits a `web-lock.json` (module id → version → sha256) so a given site release always runs the module set it was tested with; updating it is a normal commit (`scripts/release/release.py --update-web-lock`). A newer module reaches the website when the lock is bumped, never silently.
- The board UI and `patch/web/js/` (graph runner, worklet) are versioned with the site and declare the `engineAbi` they implement. The site's module catalog and docs pages read the store entries at build time instead of `patch/modules/*/module.json` from the repo, with the repo as a fallback in development.
- Preset browser on the site: read-only listing from `presets/index.json`, *Open in Bleep Play* and *Open in the app* (`bleep://preset/<author>/<slug>`).

## 9. The two sections: Store and Board

The standalone app and the window of every Bleep plugin have the same two sections, switched at the top:

| Section | For | What is in it |
|---|---|---|
| **Board** | Creating patches | The board (nodes, cables, cells, panels, module views, undo), loading and saving projects and presets, the transport. What the app and the plugin show today |
| **Store** | Managing what is on this machine | **Modules**, **Plugins** and **Presets** tabs: installed, available and updates; Install, Update, Remove; the two default bundles; the release channel; disk use. **Security**: *Allow unsigned modules*, *Allow unsigned plugins*, trusted developers. In the app also **Devices** (audio device, MIDI ports, Link, connected plugins), and the account for sharing presets and the store URL (for self-hosting) |

- **A missing module** on the board is a placeholder node with an *Install* button that opens the Store section at that module.
- **In a plugin window**, the Store installs modules and presets (outside the audio thread); *Plugins* only lists what is installed and what is newer, and says "close Live, then update with the Bleep App", because replacing a plugin Live has loaded can crash it.
- **Bleep Play** has no Store section: it installs the modules a board needs by itself, checks them, and keeps them in the browser's cache. It has no plugins to manage and presets come from the site.
- **Docs:** module manuals are read from the installed packages (each carries its docs) and open from a module's node or from its card in the Store.

Not planned: a built-in shop, a patch store with payments.

Local state in `~/Library/Application Support/Bleep/` (and equivalents), read by the app and by every plugin: `settings.json` (the Security settings, channel, store URL), `installed.json` (id, version, sha256, channel, source, signer), `modules/<source>/<id>/<version>/`, `presets/`, a cache of `index.json`. Remove deletes the version folder; the board's nodes of a removed type show as missing, a board is never changed by it.

## 10. Repository layout

```
registry/
├── schema/                    JSON Schemas: entry, index, module.json, preset
└── README.md
scripts/
├── package-module.py          folder → .bleepmod
├── package-plugin.sh          built plugin → installer
├── release.py                 detect, package, stage, publish (dry run by default)
└── registry-client.py         fetch/verify, used by the website build and tests
patch/engine/WasmModuleHost.*  native host for .bleepmod
patch/app/SoftwareCenter.*     the installer logic (UI is board-style web UI like the rest)
```

`check-repo.py` gets rules: `registry/` depends on nothing else; the schemas are the contract the others validate against.

## 11. Order of work

1. **Schemas and package format.** `module.json` gets `version`, `requires`, `types`. `package-module.py` produces `.bleepmod` from the existing wasm output. Validate all current modules.
2. **Store v0.** The SeaweedFS service and the Caddy route (done in the compose file); `release.py` publishes into the bucket. The website reads from it; remove the `web` stage from the Dockerfile; add `web-lock.json`.
3. **Wasm host in the engine** and the CPU gate from 4.2. Decide per module: static-only or installable.
4. **The Store section** in the app and the plugin window, with Modules, Plugins and Presets; the update check at start (13 has the steps).
5. **Plugin release pipeline**: signing, notarisation, installers.
6. **Presets**: the schema with `needs`, local Library, then the `/api/presets` endpoints, the Postgres migration, device-code login and *Share…*.

## 12. Open questions

- **Hosts that forbid executable memory** (4.2, 13): with every module a wasm package, such a DAW can only run what wasm3 carries. Options: accept it (a message that names the DAW and the missing entitlement), keep a native build of the cheap-to-port modules as packages for that platform, or ship a second plugin build with the modules compiled in. Needs a decision before M6.
- **Release credentials.** `release.py` uses a release token (revocable, expiring, listed with last use), so S3 credentials stay on the server.
- **Third-party modules.** Opened by the signing design: any developer with an account can get a key and publish modules under their own namespace (`acme/fuzz`); modules are sandboxed, plugins are reviewed before the plugin scope is granted. Open: whether signed third-party modules sit in a separate `community` channel or in one list with the publisher shown.
- **Signing keys.** The chain, key custody for the offline root and the online issuer, and the settings are in [`signing.md`](signing.md) (sections 2, 10 and 16). The root key ceremony is still to be decided.
- **Naming:** the product name, package extensions and the `bleep://` scheme are placeholders like the rest of the project's names.

## 13. Moving the apps and plugins to store modules: work plan

Done: the module packages (`package-module.py`), their release and signing, the store reading each module's node types, and the **Bleep Play**, which installs and verifies its modules from the store (`patch/web/js/store-client.js`, tested against the Python tools). Left: the standalone app and the plugins, which today compile the modules in.

What is known about the 80 modules, from their sources and the browser build: all 80 build to standalone wasm and pass the ABI check. **26** use `juce_core` and wasm exceptions (Wasmtime only; wasm3 cannot run them). **4** read the harmony bus (chord-quantizer, harmony-master, quantizer-suite, step-sequencer), **6** use the per-voice index (beat-oscillator, chart-recorder, macro-osc, pulse-generator, test-oscillator, wave-analyzer), **4** load sample files (grains, sampler, splice, wavetable-osc). Those 14 need an ABI addition before they can leave the apps (`module-abi.md`, section 9). Cells, Voice Cells and the port nodes stay in the engine: only the DSP nodes become wasm.

| Step | What | Done when |
|---|---|---|
| **M1 The gate** | A `WasmModuleHost` (Wasmtime) in the engine, used first by `bleep_module_harness`: every module runs natively and as wasm on the same inputs and knob changes. ABI additions for harmony bus, voice index and media | Per module: maximum difference within rounding and CPU relative to native. All 80 pass, or the list of those that do not and why. The heaviest (Grains, Delay Network, Modal Voice; a 16-voice Voice Cell) are within about 2× native |
| **M2 Store client in C++** | HTTP with `juce::URL`, Ed25519 and SHA-256 (Monocypher, vendored), the same checks as `signing.py` and `store-client.js`, the install folders and `installed.json`, the shared `settings.json` | The test vector and a package signed by the Python tools give the same verdicts; an install from a store on another port works end to end |
| **M3 Dynamic registry** | `Registry` becomes append-only and thread-safe (modules keep references to their specs, so a spec never moves or goes away); the type list the UI shows refreshes after an install; installed modules load at start | Installing a module while a board is open adds its node type without a restart |
| **M4 Store and Board** | The two sections in the board UI, shared by the app and the plugins, with native functions for install, update, remove, progress and the Security settings | Section 9 works in the app and in a plugin window in Live |
| **M5 First run** | The setup assistant with the two default bundles, the installers, the plugin bundle install (app only, Live closed) | A clean machine reaches a working board with one click per bundle |
| **M6 Remove the modules from the apps** | The CMake option that compiles modules in is off for shipped builds; the plugins lose the module code; the tests keep it as the reference | The plugins are small, load no module code, and the same boards sound the same |

Risks, in the order they bite: a **wasm instance per voice** (a 16-voice cell with five modules is 80 instances of 1 to 2 MB each); **hosts that forbid executable memory** (Wasmtime would be killed; the choice of runtime must be made before any code is compiled); the **26 exception-using modules** cannot fall back to wasm3; **start-up time** (compile lazily on first use, cache compiled code per machine, keyed by the package hash); **first run offline**. M1 decides most of these, which is why nothing is removed from the apps before it passes.
