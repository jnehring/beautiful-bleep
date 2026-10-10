# Registry and release system

Plugins, modules and presets are managed in one place, the **registry**. Everything that installs, updates or loads one of them (the standalone app, the website's Bleep Board, the release pipeline) talks to the registry and nothing else.

| Kind | What it is | Who loads it | Form |
|---|---|---|---|
| **Plugin** | Something you load in Ableton: Bleep Patch, the ports, the Audio Bridge, later Bus receivers | Live, the app's Software Center installs it | Installer per platform and format (VST3, AU, CLAP) |
| **Module** | A node type on the board: its DSP, view and docs | The engine in the plugins, the app and the browser | `.bleepmod` package |
| **Preset** | A patch (a whole board) or a cell (a subgraph, with its panel) | The board | `.bleeppreset` file (JSON) |

Plugins and modules are **code**: signed by their developer, immutable. Presets are **data**: published by anyone with an account. How code is signed and checked is in [`signing.md`](signing.md); what a module is to the engine, in [`module-abi.md`](module-abi.md).

## Decisions

- **Modules are WebAssembly everywhere** (web and native), hosted by an embedded wasm runtime in the engine. See 4.2.
- **The registry is part of the website stack** (Caddy, the FastAPI `website/api` and its Postgres), hosted locally for now and moved with the stack later. No separate infrastructure.
- **Everything the shop distributes as code is signed**, by its developer's own key under our root (see [`signing.md`](signing.md)). Apps refuse unsigned modules and plugins unless the user switches on *Allow unsigned modules* or *Allow unsigned plugins* in the settings.
- **Modules and plugins reach the user three ways:** from the registry on demand, through two **bundles** the setup offers (*default modules*, *default plugins*), or by copying files into a folder (section 5a).
- **Everything is free.** There is no licence-key or entitlement logic anywhere.
- **Downloading needs no login**: browsing, installing plugins, modules and presets, and update checks are anonymous. **Sharing a preset needs an account** (the existing `website/api` accounts).

## 1. Where this stands today

- Modules are folders in `patch/modules/<slug>/` with a `module.json`; native builds compile them **into** the plugins through `BLEEP_REGISTER_MODULE` (static).
- The browser build already produces **one standalone `.wasm` per module** and a `manifest.json` (`patch/web/build_modules.py`), loaded on demand. But `website/Dockerfile` runs it (emscripten, a JUCE clone) on every site build.
- Presets are `presets/*.bleepboard` plus `patch/board/ui/factory-presets.json`, built into the UI.

The wasm-per-module work is the seed of the system: the module package is that file plus its metadata.

## 2. Common to every artifact

Every entry in the registry has the same envelope:

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
- **`engineAbi`** is an integer bumped when the module ABI (specified in [`module-abi.md`](module-abi.md); the C interface in `patch/web/src/WebShim.cpp`) changes incompatibly. Hosts refuse modules they cannot run and the Software Center explains why.
- **Signing.** Every file of a plugin or module entry has a developer signature (`files[].signature`: a chain root > registry issuer > developer, over the content hash, kind, id, version and platform), checked by the registry on upload and by every host before it loads or installs. `index.json` and the revocation list carry the registry issuer's signature, a rising `serial` and an expiry. Details, the settings and a test vector in [`signing.md`](signing.md).

## 3. The registry

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
| Plugins and modules (files, `index.json`) | S3 bucket | Only the release pipeline: `scripts/release.py` uploads over the S3 API (port 8333, bound to localhost; credentials `S3_ACCESS_KEY`/`S3_SECRET_KEY` in `website/.env`) |
| Preset files | Same bucket under `presets/` | The API after validation |
| Preset metadata (title, tags, author, versions, downloads, reports, state) | Postgres, new Alembic migration | The API |

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

**Decision: wasm everywhere.** The engine gets a `WasmModuleHost` (embedded WAMR or wasmtime, AOT-compiled at install time and cached per machine) that implements the same `Module` interface the static modules do. First-party modules are *also* kept statically linked in the plugin as the offline default, so a fresh install works with no network and the registry copy only overrides when newer. Third-party modules are wasm-only.

**Gate, first answer (Verb, Apple M-series, Live 12; `patch/wasm-host/`).** Wasmtime (Cranelift JIT) costs about 1.2× the native module in a standalone benchmark and 1.5 to 1.7× through the plugin, copies around each 32-sample chunk included (3.2 % of a core against 1.9 %), and loads in 44 ms; the output matches the native build to about 1e-6. The wasm3 interpreter costs ten times Wasmtime (32.5 % of a core), so it is only a fallback for very light modules. Both run in Live, which allows the executable memory Wasmtime needs. Consequences: **Wasmtime is the runtime**; wasm3 stays an option for trusted, cheap modules; a host without executable memory gets the native copy (a plugin cannot "try and fall back": Wasmtime is killed, not refused, so the runtime is chosen from the host's entitlements or a setting before any code is compiled). Still to run: the heaviest modules (Grains, Delay Network, Modal Voice). If one costs more than about 2× native, it stays static-only and is also offered as a native package (the `platform` field in `files` already allows per-platform files). Not yet tested: other DAWs, Windows, Linux.

### 4.3 Resolution on the board

A board file lists the node types it uses. On load, a host resolves each type: bundled → installed → registry (browser: fetch; app: offer to install; plugin in Live: use the installed set and show a placeholder node for a missing type, never download inside an audio host).

## 5. Plugins

Plugins are installed by the Software Center, not hot-loaded:

- Artifacts: a signed and notarised installer per OS (`.pkg`, `.msi`, `.zip` for Linux) containing all formats of one plugin, or the whole bundle.
- Install paths are the system's (`/Library/Audio/Plug-Ins/VST3`, …). **Live must not be running** while a loaded plugin is replaced (the README warns of crashes); the app checks for Live and asks the user to quit it first.
- The registry entry says which formats and OS versions each file supports. Third-party Bus receiver plugins can be listed with a download link (not hosted by us) so the Software Center is one place for everything that works with the Bus.
- A plugin states the module `engineAbi` range it can host, so the app can warn when a module needs a newer plugin.

## 5a. Bundles, first run, and manual installs

**Bundles.** A bundle is an entry of `kind: "bundle"`: no files, a signed list of members with their versions and content hashes (`signing.md`, section 12). Two exist, both published by `bleep`:

| Bundle | Members | Why |
|---|---|---|
| `default-modules` | Every first-party module (80 today, about 25 MB of wasm) | What the board offers out of the box, one tick instead of 80 installs |
| `default-plugins` | Every Bleep VST3: Bleep Patch, the port plugins (MIDI In, MIDI Out, Audio In, Audio Out), Bleep Instrument, Audio Insert and the Audio Bridge | The plugins Live needs; they must all be the same version, because they share one engine |

Installing a bundle installs its members, each verified on its own. A bundle update is a new bundle version; the Software Center shows "Update all" and installs only the members that changed.

**First run.** When the app is installed (the installer's last page, or the first launch for a download without an installer), a setup assistant asks, with sizes and both pre-ticked:

1. **Download the default module bundle** (the modules from the registry, into the registry folder below).
2. **Install the default plugin bundle** (all VST3 bridges into the system plugin folder). If Live is running it asks to quit it first, as in section 5.

Declining either is fine: the app works, a missing module is a placeholder node with an *Install* button, and the Software Center keeps a "Default modules are not installed" banner until it is done. **Offline:** an offline installer carries both bundles. First-party modules also stay statically linked in the plugins (4.2), so a plugin in Live works even before the module bundle is installed and never downloads anything itself.

**Manual installs.** Everything can also be copied by hand:

| What | Folder | Notes |
|---|---|---|
| Modules from the registry | `<data>/modules/registry/<id>/<version>/` | Written by the Software Center; do not edit |
| Modules by hand | `<data>/modules/local/` | A `.bleepmod`, or `<name>.wasm` with a `<name>.json` (the `module.json`) beside it. Read at start and when the folder changes. |
| Plugins | The system VST3 folders | Copied by hand as usual; the Software Center lists them with their status |

`<data>` is `~/Library/Application Support/Bleep` (macOS), `%APPDATA%\Bleep` (Windows), `~/.local/share/Bleep` (Linux); the settings can point at another folder. Every file in these folders goes through the same check as a download (signature, imports, ABI version); unsigned ones need *Allow unsigned modules* (or plugins) in **Settings → Security**, and the app, the plugins and the Software Center all read that setting from the one settings file. When several copies provide the same node type, the choice is: highest compatible version, then signed over unsigned, then the manual folder over the registry (`signing.md`, section 11).

## 6. Presets

Two kinds, one file format (`.bleeppreset`, JSON, same schema as board persistence plus the envelope in section 2):

| `preset.type` | Contains | Loaded as |
|---|---|---|
| `patch` | A whole board: nodes, cables, panels, settings | Opens as a project, or merges into the current board |
| `cell` | One cell: its inner graph, jack names, its panel | Dropped onto the board as a cell |

- Each preset lists the module types and versions it **needs**. Opening one with a missing module offers "Install 2 modules, then open" instead of loading a broken board.
- Publishing: from the board, *Share…* (needs an account; browsing and downloading never do), a title, tags, a licence (default CC-BY, CC0 allowed), optional audio preview. The API validates the schema, checks all referenced types exist in the registry, enforces a size limit and per-user rate limit, and rejects anything that is not pure data.
- Versions: re-publishing creates a new version; installed copies show "update available". Local edits to an installed preset are kept as a fork.
- Moderation: report button, takedown by an admin (the existing `admin` role) sets the preset's state to unlisted; the file stays but is no longer served in search.
- The factory presets move out of `factory-presets.json` into the registry's `bleep` author, so the app, the website and the plugins all show the same library. A small set stays bundled for offline.

## 7. Release process

Single source: the repository. CI builds and publishes; nobody uploads by hand.

1. **Version.** Every plugin and module has its own version, counted by the registry: `scripts/release.py --level x|1.x|1.1.x|major|minor|patch` takes the newest published version and counts up at that level (built for plugins; see `doc/release.md`). A module's `module.json` carries the version once modules are released.
2. **Detect what changed.** Hash the module's folder plus the `patch/common/dsp/` headers it includes (and `engine/` ABI). If the hash differs from the last release, the module needs a new version, and CI fails if its `version` was not bumped.
3. **Build and test** (existing CI): the DSP tests, the module harness, the wasm build, then the harness against the wasm. Plugins: the macOS/Windows/Linux matrix, signing and notarisation.
4. **Package and sign** (`scripts/package-module.py`, `scripts/package-plugin.sh`, `scripts/signing.py sign`): produce the artifacts and the `entry.json` files, each file signed with the publisher's key.
5. **Stage.** Upload to `…/staging/<release-id>/`. A smoke job loads every staged module in the node host test and in a headless browser.
6. **Publish.** Copy staged files into the immutable paths, then write `index.json` last, signed, in one atomic replace. A release is visible only when the index changes; rollback is putting the previous index back.
7. **Channels.** `beta` index first for testers; promoting to `stable` is a new index, not a rebuild.

`scripts/release.py` is built for plugins (steps 4 to 6 in a simpler form: a draft release, size- and hash-checked uploads, publish, index regenerated). It authenticates with an **admin-created release token** (`python -m app.cli token-create`), not with the storage credentials, so the machine that releases never holds S3 keys. Built since: adding the build of another platform to a published release (`--add-platform`, one signed file per platform). Not built yet: change detection, staging, signing in `release.py` and the registry's check of signatures, a signed index, modules.

## 8. Website

- **Docker no longer builds wasm.** The `web` stage of `website/Dockerfile` is removed. The site image contains only the Next.js static export and the board UI.
- **Modules load from the registry.** `bleep-web.js` fetches `index.json` (cached) and then `modules/<id>/<version>/<id>.bleepmod` on demand, from the CDN, exactly as it loads `.wasm` today.
- **Pinned for reproducibility.** The site build commits a `web-lock.json` (module id → version → sha256) so a given site release always runs the module set it was tested with; updating it is a normal commit (`scripts/release.py --update-web-lock`). A newer module reaches the website when the lock is bumped, never silently.
- The board UI and `patch/web/js/` (graph runner, worklet) are versioned with the site and declare the `engineAbi` they implement. The site's module catalog and docs pages read the registry entries at build time instead of `patch/modules/*/module.json` from the repo, with the repo as a fallback in development.
- Preset browser on the site: read-only listing from `presets/index.json`, *Open in Bleep Board* and *Open in the app* (`bleep://preset/<author>/<slug>`).

## 9. Standalone app sections

The app gets a left rail with:

| Section | What it does |
|---|---|
| **Home** | Recent projects, new project, what's new, updates available (one badge across the app), the audio and bridge status in one line |
| **Bleep Patch** | The board, as today |
| **Library** | Your presets and projects on disk, the community presets (browse, search, preview, install, rate), *Share…* for your own, updates for installed ones |
| **Software Center** | Plugins, Modules, Presets tabs: installed / available / updates; Install, Update, Uninstall; dependency prompts ("this preset needs …"); release channel switch; disk use |
| **Devices** | Audio device, MIDI ports, Link, connected Audio Bridges and which Live instances are seen (today under File → Settings; it deserves a page because it is the first thing that goes wrong) |
| **Docs** | Module manuals and the guide, offline from installed packages (each package carries its docs), with search |

Settings (account, channel, registry URL for self-hosting, install locations) is a dialog, not a section. Not planned: a built-in shop, a patch store with payments.

Software Center and Library overlap on presets. The split: *Software Center* is about things you install and keep updated (it lists presets you installed); *Library* is where you find, rate and publish them.

Local state in `~/Library/Application Support/Bleep/` (and equivalents): `installed.json` (id, version, sha256, channel, source), `modules/<id>/<version>/`, `presets/`, a cache of `index.json`. Uninstall removes the version directory; the board's nodes of an uninstalled type show as missing, never delete the board.

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
2. **Registry v0.** The SeaweedFS service and the Caddy route (done in the compose file); `release.py` publishes into the bucket. The website reads from it; remove the `web` stage from the Dockerfile; add `web-lock.json`.
3. **Wasm host in the engine** and the CPU gate from 4.2. Decide per module: static-only or installable.
4. **Software Center** in the app with Modules and Plugins; update check at start.
5. **Plugin release pipeline**: signing, notarisation, installers.
6. **Presets**: the schema with `needs`, local Library, then the `/api/presets` endpoints, the Postgres migration, device-code login and *Share…*.

## 12. Open questions

- **Wasm for native modules** (4.2): confirm the direction after the CPU numbers.
- **Release credentials.** `release.py` uses a release token (revocable, expiring, listed with last use), so S3 credentials stay on the server.
- **Third-party modules.** Opened by the signing design: any developer with an account can get a key and publish modules under their own namespace (`acme/fuzz`); modules are sandboxed, plugins are reviewed before the plugin scope is granted. Open: whether signed third-party modules sit in a separate `community` channel or in one list with the publisher shown.
- **Signing keys.** The chain, key custody for the offline root and the online issuer, and the settings are in [`signing.md`](signing.md) (sections 2, 10 and 16). The root key ceremony is still to be decided.
- **Naming:** the product name, package extensions and the `bleep://` scheme are placeholders like the rest of the project's names.
