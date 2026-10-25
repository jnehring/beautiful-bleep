---
title: Bleep Library
description: Plugins, modules and presets in one library: packages, releases, bundles and how the apps load them.
order: 20
---

# Bleep Library and release system

Plugins, modules and presets are managed in one place, the **Bleep Library**. Everything that installs, updates or loads one of them (the standalone app, Bleep Play, the release pipeline) talks to the library and nothing else.

| Kind | What it is | Who loads it | Form |
|---|---|---|---|
| **Plugin** | Something you load in Ableton: Bleep Board, the ports, later Bus receivers | Live, the app's Library section installs it | Installer per platform and format (VST3, AU, CLAP) |
| **Module** | A node type on the board: its DSP, view and docs | The engine in the plugins, the app and the browser | `.bleepmod` package |
| **Preset** | A patch (a whole board) or a cell (a subgraph, with its panel) | The board | `.bleeppreset` file (JSON) |

*Naming:* the library was first called the registry, and its technical names keep that word: the URL path `/registry/v1/`, `BLEEP_REGISTRY_URL`, `/api/registry`, the `bleep-registry` bucket. In prose it is the Bleep Library, "the library" after the first mention.

Plugins and modules are **code**, immutable once published. Plugins and first-party modules are released by a developer with a release token; a module anyone shares through their account is checked by the library on upload (a *community* module). Presets are **data**: published by anyone with an account. Nothing in the library is signed: what protects the user is the sandbox the modules run in and the checks the library makes on upload. What a module is to the engine is in [`module-abi.md`](module-abi.md).

## Decisions

- **Modules are WebAssembly everywhere** (web and native), hosted by an embedded wasm runtime in the engine. See 4.2.
- **The library is part of the website stack** (Caddy, the FastAPI `website/api` and its Postgres), hosted locally for now and moved with the stack later. No separate infrastructure.
- **Modules are sandboxed, and nothing is signed.** A module is WebAssembly that can only do what the host's imports allow, so the sandbox is the defence, not knowing the author. A release is authorised by the API token that uploads it (bound to a publisher, the namespace of its ids); a community module by the account that uploads it, after the library has checked the package (files, the `.wasm`'s imports and exports, node types, licence). Closed-source community modules are allowed. The apps load every module that passes the same checks on their side (file list, imports, ABI version), with no setting to switch. A community module's id is `<handle>/<name>`.
- **Modules and plugins reach the user three ways:** from the library on demand, through two **bundles** the setup offers (*default modules*, *default plugins*), or by copying files into a folder (section 5a).
- **Everything is free.** There is no licence-key or entitlement logic anywhere.
- **Downloading needs no login**: browsing, installing plugins, modules and presets, and update checks are anonymous. **Sharing a preset needs an account** (the existing `website/api` accounts).

## 1. Where this stands today

- Modules are folders in `patch/modules/<slug>/` with a `module.json`; native builds compile them **into** the plugins through `BLEEP_REGISTER_MODULE` (static).
- The browser build already produces **one standalone `.wasm` per module** and a `manifest.json` (`patch/web/build_modules.py`), loaded on demand. But `website/Dockerfile` runs it (emscripten, a JUCE clone) on every site build.
- Presets are `presets/*.bleepboard` plus `patch/board/ui/factory-presets.json`, built into the UI.

The wasm-per-module work is the seed of the system: the module package is that file plus its metadata.

## 2. Common to every artifact

Every entry in the library has the same envelope:

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
  "files": [ { "path": "dual-filter.bleepmod", "sha256": "…", "bytes": 48213, "platform": "any" } ],
  "published": "2026-10-09T10:00:00Z"
}
```

- **Immutable and content-addressed.** A published `id@version` never changes; a fix is a new version. Files are named by sha256 in storage, so caches never go stale.
- **`engineAbi`** is an integer bumped when the module ABI (specified in [`module-abi.md`](module-abi.md); the C interface in `patch/web/src/WebShim.cpp`) changes incompatibly. Hosts refuse modules they cannot run and the Library section explains why.
- **Download check.** Every file of an entry has a `sha256`, the checksum of the download; hosts compare it after fetching. There are no signatures, certificates or revocation list: taking a release down removes it from `index.json`.

## 3. The library

It lives in the website stack. Published files are objects in a **SeaweedFS** bucket (`storage` service, data on the `registry-data` volume; S3 API, so moving to AWS S3, R2 or similar later is a change of endpoint; MinIO was considered but no longer publishes images). The bucket is public-read and Caddy proxies `/registry/*` to it, so downloads are cacheable and run no app code; the API owns what is dynamic.

```
S3 bucket `bleep-registry` (SeaweedFS)  →  Caddy proxies it read-only at /registry/v1/…
/registry/v1/
├── index.json                 plugins and modules per channel
├── plugins/<id>/<version>/    installers + entry.json
├── modules/<id>/<version>/    <id>.bleepmod + entry.json (+ doc, screenshot)
└── presets/<author>/<slug>/<version>.bleeppreset

/api/…  (FastAPI + Postgres, existing accounts and sessions)
├── GET  /api/presets?q=&type=&tag=&sort=     search (anonymous)
├── GET  /api/presets/<author>/<slug>         metadata, versions, download counts (anonymous)
├── GET  /api/presets/<author>/<slug>/used-in listed presets that name this one in their `credits` (anonymous)
├── POST /api/presets                         publish a version (login)
├── DELETE/PATCH /api/presets/<id>            own presets (login); admin may unlist any
├── POST /api/presets/<id>/report             report (anonymous or login)
├── GET/POST/DELETE /api/tokens               personal access tokens of the user (cookie login)
├── POST /api/auth/device                     app starts a sign-in: device_code (secret), user_code, interval
├── POST /api/auth/device/token               app polls; the personal token comes once, when approved
├── GET  /api/auth/device/<code>, POST /api/auth/device/approve   the site's /device/ page (cookie login)
├── GET  /api/presets/<author>/<slug>/file    the .bleeppreset (anonymous, counts the download)
├── GET/POST /api/social/<kind>/<slug>/comments    list (public), comment (login); slug of a preset is author/slug
├── GET/PUT/DELETE /api/social/<kind>/<slug>/rating   average and count (public); 1-5 stars, one per user (login)
├── DELETE /api/social/comments/<id>          the author or an admin; POST …/<id>/report reports it
└── GET /api/admin/reports, POST …/<id>/resolve   reports of presets and comments (admin)
```

**Who may do what.** Reading (browsing, downloading, comments, ratings) is anonymous. Sharing, commenting and rating need a login: the website's session cookie, or `Authorization: Bearer blu_…`, the personal token of the app. Such a token works only on these library endpoints, never on the account, profile or admin endpoints. A cookie-authenticated write whose `Origin` is another site is refused (`BLEEP_ALLOWED_ORIGINS` lists extra hosts for a dev server). Comments and ratings belong to the entry (plugin, module or preset), not to one version; nobody rates their own preset; a comment is up to 2000 characters, at most 5 a minute per user.


| Part | Where | Written by |
|---|---|---|
| Plugins and modules (files, `index.json`) | S3 bucket | Only the release pipeline: `scripts/release/release.py` uploads over the S3 API (port 8333, bound to localhost; credentials `S3_ACCESS_KEY`/`S3_SECRET_KEY` in `website/.env`) |
| Preset files | Same bucket under `presets/` | The API after validation |
| Preset metadata (title, tags, author, versions, downloads, reports, state) | Postgres, new Alembic migration | The API |

**What a tile shows.** Every plugin, module and preset has a title, a `summary` (up to 280 characters), a `category` and an optional screenshot, as metadata of its release: `entry.json` carries `summary`, `category` and `image` (the file name next to it, `image.png`, `.jpg` or `.webp`). `release.py` takes them from the module package (its `module.json` and `doc/<slug>.png`) and, for plugins, from `PLUGIN_TILES` and `doc/library/<slug>.png`, and uploads the image with `PUT /api/registry/<kind>/<id>/releases/<version>/image` (PNG, JPEG or WebP up to 1 MB; display data, replaceable by the token that made the release). Without a screenshot the library draws a placeholder in the colour of the kind. `GET /api/library` returns them with `image_url` and the `categories` of the matching entries, and filters by `category`.

`GET /registry/v1/index.json` is the one call a client needs at start. It lists, per id, the newest version per channel, so an update check is one small request with an `ETag`. The API only ever sees preset search and publishing, so a stopped API doesn't stop installs of plugins and modules.

**Login in the app.** The app has no browser cookie. *Sign in* opens the website's login page for a one-time device code (like `gh auth login`): the app shows a code, the user types it on the site (the page never takes the code from the address, so a link someone sends cannot fill it in) and sees the name the app gave itself, which is not verified, and the address and program that started the sign-in before choosing *Refuse* or *Allow*, and the app stores a personal access token in the OS keychain. The token only allows publishing and managing the user's own presets. Not signed in, the app works fully except *Share…*. **How it is built.** `patch/library/Account.{h,cpp}` does the device flow and the authenticated calls on a worker thread; the page reaches it through the native function `account` (`patch/board/ui/account.js`, used by the Library section's *Account* tab, *Share…* on the Presets tab and in the patch browser). The token is kept per library address: macOS Keychain (service `Bleep Library`), Windows Credential Manager, elsewhere a file in the data folder readable by the user only (`account.json`); with `BLEEP_DATA_DIR` set (tests, development) always that file, so a test never touches the real login. The app and the plugins share it, so one sign-in covers both; macOS asks once when a DAW first reads an item the app created (*Always Allow*). The page can only call `/api/…` of the configured library. A token the site revoked (account page) is dropped at the next check, and *Sign out* revokes it at the library (`DELETE /api/tokens/self`; `GET /api/tokens/self` says whose it is). Bleep Play has no token: it is a page of the site and uses the session cookie, so it only asks `/api/auth/me` and sends people to `/login/`. `scripts/check/account-live.py` runs the real HTTP stack against a local API.

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

`summary` (one or two sentences, from the module's `tagline`, else its first node type's description) and `category` ("Sources", "Modulation", …, from the module's node types) are filled in by the package step. The library shows them, with the screenshot, on the module's tile.

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

**Decision: wasm everywhere.** The engine gets a `WasmModuleHost` (embedded WAMR or wasmtime, AOT-compiled at install time and cached per machine) that implements the same `Module` interface the static modules do. **The apps and plugins ship without modules** (decided): every module, first-party or not, is installed from the library, so there is one path and one set of rules. Offline, the installer carries the default module bundle. The native sources stay in the repository: the tests run them as the reference the wasm builds are compared with, and a module that turns out too heavy as wasm may later get a native package for its platform.

**Gate, first answer (Verb, Apple M-series, Live 12; `patch/wasm-host/`).** Wasmtime (Cranelift JIT) costs about 1.2× the native module in a standalone benchmark and 1.5 to 1.7× through the plugin, copies around each 32-sample chunk included (3.2 % of a core against 1.9 %), and loads in 44 ms; the output matches the native build to about 1e-6. The wasm3 interpreter costs ten times Wasmtime (32.5 % of a core), so it is only a fallback for very light modules. Both run in Live, which allows the executable memory Wasmtime needs. Consequences: **Wasmtime is the runtime**; wasm3 stays an option for trusted, cheap modules; a host without executable memory runs only what wasm3 can carry (cheap modules; the rest show as unavailable: **open**, section 12) (a plugin cannot "try and fall back": Wasmtime is killed, not refused, so the runtime is chosen from the host's entitlements or a setting before any code is compiled). Still to run: the heaviest modules (Grains, Delay Network, Modal Voice). If one costs more than about 2× native, it stays static-only and is also offered as a native package (the `platform` field in `files` already allows per-platform files). Not yet tested: other DAWs, Windows, Linux.

### 4.3 Resolution on the board

A board file lists the node types it uses. On load, a host resolves each type: bundled → installed → library (browser: fetch; app: offer to install; plugin in Live: use the installed set and show a placeholder node for a missing type, never download inside an audio host).

## 5. Plugins

Plugins are installed from the Library section of the app, not hot-loaded:

- Artifacts: an installer per OS (`.pkg`, `.msi`, `.zip` for Linux) containing all formats of one plugin, or the whole bundle.
- Install paths are the system's (`/Library/Audio/Plug-Ins/VST3`, …). **Live must not be running** while a loaded plugin is replaced (the README warns of crashes); the app checks for Live and asks the user to quit it first.
- The library entry says which formats and OS versions each file supports. Third-party Bus receiver plugins can be listed with a download link (not hosted by us) so the Library section is one place for everything that works with the Bus.
- A plugin states the module `engineAbi` range it can host, so the app can warn when a module needs a newer plugin.

## 5a. Bundles, first run, and manual installs

**Bundles.** A bundle is an entry of `kind: "bundle"`: no files, a list of members with their versions. Two exist, both published by `bleep`:

| Bundle | Members | Why |
|---|---|---|
| `default-modules` | Every first-party module (80 today, about 25 MB of wasm) | What the board offers out of the box, one tick instead of 80 installs |
| `default-plugins` | Every Bleep VST3: Bleep Board, the port plugins (MIDI In, MIDI Out, Audio In, Audio Out), Bleep Instrument and Audio Insert | The plugins Live needs; they must all be the same version, because they share one engine |

Installing a bundle installs its members, each on its own. A bundle update is a new bundle version; the Library section shows "Update all" and installs only the members that changed.

**First run.** When the app is installed (the installer's last page, or the first launch for a download without an installer), a setup assistant asks, with sizes and both pre-ticked:

1. **Download the default module bundle** (the modules from the library, into the library folder below).
2. **Install the default plugin bundle** (all VST3 bridges into the system plugin folder). If Live is running it asks to quit it first, as in section 5.

Declining either is fine: the app works, a missing module is a placeholder node with an *Install* button, and the Library section keeps a "Default modules are not installed" banner until it is done. **Offline:** an offline installer carries both bundles. The apps ship without modules (4.2), so until the module bundle is installed a board shows placeholder nodes. A plugin in Live never downloads anything on its own: modules are installed from the Library section of the app or of the plugin window, on a non-audio thread.

**Manual installs.** Everything can also be copied by hand:

| What | Folder | Notes |
|---|---|---|
| Modules from the library | `<data>/modules/registry/<id>/<version>/` | Written by the Library section; do not edit |
| Modules by hand | `<data>/modules/local/` | A `.bleepmod`, or `<name>.wasm` with a `<name>.json` (the `module.json`) beside it. Read at start and when the folder changes. |
| Plugins | The system VST3 folders | Copied by hand as usual; the Library section lists them with their status |

`<data>` is `~/Library/Application Support/Bleep` (macOS), `%APPDATA%\Bleep` (Windows), `~/.local/share/Bleep` (Linux); the settings can point at another folder. Every file in these folders goes through the same check as a download (file list, imports, ABI version); there is no setting to allow anything. When several copies provide the same node type, the choice is: highest compatible version, then the manual folder over the library.


**Build options and the library configuration.** `config/library.json` is the one place that says where the library is (`libraryUrl`, the website's address; the library lives under `/registry/v1/`). The apps' and plugins' build bakes it in (`BLEEP_LIBRARY_CONFIG` names another file, `BLEEP_LIBRARY_URL` overrides it for one build) and `scripts/release/release.py` uses `libraryUrl` when no `--registry` or `$BLEEP_REGISTRY_URL` is given; the user can still change the address in `settings.json`. With `-DBLEEP_WASMTIME_DIR=<Wasmtime C API>` the apps and plugins are built **without modules** (`BLEEP_BUNDLE_MODULES=ON` puts them back). `BLEEP_DATA_DIR` moves the data folder (tests, development). The first-run assistant answers once (`firstRunDone` in `settings.json`). **The plugin download:** the app reads the plugin entries of the index, takes the build for its platform (`macos-arm64`, ...), checks the sha256 and unpacks the `.vst3` bundles into the user's VST3 folder, with Live closed; an offline installer's `Plugins` folder (macOS: `Contents/Resources/Plugins` in the app) is copied instead. The pretend Library for working on the UI is the board dev server with `?library` in the address.

## 6. Presets

Two kinds, one file format (`.bleeppreset`, JSON, same schema as board persistence plus the envelope in section 2):

| `preset.type` | Contains | Loaded as |
|---|---|---|
| `patch` | A whole board: nodes, cables, panels, settings. In the apps it is a *project* shared in the Library | Opens as a project, or merges into the current board |
| `cell` | One cell: its inner graph, jack names, its panel | Dropped onto the board as a cell |

- **Dependencies.** A preset, cell or patch, may carry `needs`: the modules it requires, by module slug, each with an optional inclusive `min` and `max` version:

  ```json
  "needs": { "lfo": { "min": "1.2.0" }, "reverb": { "min": "2.0.0", "max": "2.9.9" } }
  ```

  Saving a preset from the board writes `needs` for every module its node types come from, with `min` set to the version installed at that moment; an author adds `max` by hand. Before a preset or project is loaded or placed (the project browser, *Add → Cell*), the board checks `needs` and, without a version, every module that provides one of its node types. If something is missing or too old, a dialog lists it and offers **Download n from the Bleep Library**, then loads; *Load anyway* keeps placeholder nodes, *Cancel* loads nothing. Versions the library cannot supply are listed with the reason and cannot be fixed by the dialog: a `max` below the installed version (the library's index offers only the newest version of a module; older ones are fetched by number, see *Versions on the board* below), a local copy of a module, or a module the library does not have can only be loaded anyway. Factory presets carry no `needs` (the default module bundle covers them). The check runs in the app and in plugin windows (installing happens off the audio thread); Bleep Play installs the types a board uses by itself (section 8). **Placing a preset works offline and without a library.** An app built without the module library (modules compiled in; the native side's `init` has no `library`) does not check at all. With a library, the check looks only at the modules installed here and at the library index if it is already loaded: it never waits for the network, and if the local status does not answer within 5 seconds the preset is placed anyway, with a notice. The index is **cached on disk** (`<data folder>/cache/index.json`, with the library address, the channel and the time it was fetched): every successful fetch saves it, the first look at the library reads it, and when the library cannot be reached the saved copy is used and the Library section says so. A copy saved for another address or channel is ignored.
- **Versions on the board.** A node does not state its module's version, but a copy of it can say which version it was made with, and a node can be pinned to one.
  - **What says which version.** `needs.<slug>.version` is the version the nodes were made with: written by *Save as preset*, *Save to My Projects*, *Share…* and by ⌘C (the clipboard carries `needs` too, from the app's library or from the web board's loaded modules). A node may carry `version` (`"version": "0.1.2"`): it is **pinned**, and runs exactly that version of its module, next to the newest. A node without `version` runs the newest installed.
  - **The question.** When a preset, project or paste comes with a version that is not the one installed (newer or older, also when the modules are all there), the dialog asks: *Use the latest versions* (the nodes are not pinned; the settings may sound or look different if the module changed) or *Use the versions it was made with* (the nodes get `version`; each missing version is fetched from the library by number). A module whose version matches asks nothing. The app compares versions in `board/ui/library.js` (`ensureNeeds`); the same question runs when a project is opened and its pinned nodes are missing or its modules differ.
  - **In the engine.** `Registry::find(type, version)` finds a version; the newest of a type is what `find(type)` returns, older ones are registered with `addOlder` and listed by `describeTypes` as `{type, version, older: true}` (the board page keys them `type@version`). A pinned node whose version is not installed is a placeholder with everything it was saved with, and an Install button for that version. An older version has no custom view: it gets the plain knob view, because the view script that is loaded belongs to the newest version.
  - **On this machine.** The library keeps every version it published (`modules/<slug>/<version>/entry.json`, section 3); its index lists only the newest. `Client::installVersion(slug, version)` fetches one by number, checks it like any install and puts it next to the newest (`<data>/modules/registry/<slug>/<version>/`). Old versions are not kept for their own sake: installing a newer version removes the older ones (the board asks again when a pinned node needs one). The native function `libraryInstallVersion(slug, version)` starts it; `libraryStatus` lists these as `versions` and says `pinning: true`.
  - **Bleep Play** has no dialog: it runs the version a project, cell or paste names (the nodes are pinned on the way in, `BoardEdit.pinToMade`) and loads that module by number (`BleepLibrary.fetchModule(slug, version)`), so a project opens the way it was made.
- Publishing: from the board, *Share…* (needs an account; browsing and downloading never do), a title, tags, optional audio preview. **Every preset is CC BY 4.0**: there is no licence choice and no remix switch (a preset shared as CC0 before this keeps that licence, also in its new versions). The API validates the schema, checks all referenced types exist in the library, enforces a size limit and per-user rate limit, and rejects anything that is not pure data.
- **Presets are copied, never referenced.** A downloaded or placed preset is a full copy; a preset built from another holds its own copy of it, so an author editing or deleting the original breaks nothing, and nothing asks to update. A copy keeps a list of `credits` (the presets it was made from, see `doc/specs/preset-system-plan.md`); the user can edit it. On publish the API cleans the list (at most 50 `{name, author, address?, license}`; `address` is `author/slug` and only a key to find the preset again, never fetched) and indexes the entries that have an address, so the source's author sees **Used in N presets** (only listed ones; the rows of the newest version, replaced on each publish; a deleted or unlisted preset drops out). Deleting a preset (`DELETE /api/presets/<id>`) removes it from the library only.
- **Audio in presets.** A node stores only a media id (`<16 hex>.wav`, `engine/Media.h`); the WAV lives in the computer's media folder. A preset takes the audio its modules use along, as an optional `media` map `{ "<id>.wav": { name, data: <base64 of the file> } }` next to `nodes`: *Save as preset*, *Save to My Projects* and *Share…* attach the files their nodes use (every string in a node's `data` that is a media id), and loading or placing a preset imports the files it does not have yet (importing a file again stores it once, as the id is the hash of the audio). The audio is inline, not a shared store: ids are a 64-bit FNV hash, not collision-resistant, so a store shared by all authors would let one file stand in for another. A shared preset may carry up to 8 files and 5 MB of audio together, WAV only; the API checks the header, answers 422 or 413, and the 512 KB limit is for the patch alone (`POST /api/presets` bodies may be 8 MiB). A file that cannot be read when saving, or imported when loading, is left out and the node shows as missing, as for any board whose media folder lacks a file. Not yet: Bleep Play (no media folder in the browser), and the Instrument and FX plugins' cell presets, which are loaded natively. Credits for samples are not part of this; the licence of a preset, CC BY 4.0, covers its audio, and the terms say that publishers must have the right to share it.
- Versions: re-publishing creates a new version, kept as the author's history; the newest is the one served by default and older ones stay downloadable by number. An installed copy is not tied to it.
- Moderation: report button, takedown by an admin (the existing `admin` role) sets the preset's state to unlisted; the file stays but is no longer served in search.
- The factory presets move out of `factory-presets.json` into the library's `bleep` author, so the app, the website and the plugins all show the same library. A small set stays bundled for offline.

- **My projects on the website.** The board in the browser has no folder to keep a user's own projects in, so they live in the account: `GET /api/projects` (the user's list: id, name, description, tags), `GET /api/projects/{id}` (the project, the same JSON as a Library `preset`), `POST /api/projects` (`{name, preset}`, a project of that name is replaced) and `DELETE /api/projects/{id}`. They are private to the account (a login by cookie or token), limited to 200 per user and 2 MB each; publishing one for others is *Share…* (a `patch` preset). The apps keep them as `.bleepboard` files in `<app data>/Projects/`.

## 7. Release process

Single source: the repository. CI builds and publishes; nobody uploads by hand.

1. **Version.** Every plugin and module has its own version, counted by the library: `scripts/release/release.py --level x|1.x|1.1.x|major|minor|patch` takes the newest published version and counts up at that level (built for plugins; see `doc/release.md`). A module's `module.json` carries the version once modules are released.
2. **Detect what changed.** Hash the module's folder plus the `patch/common/dsp/` headers it includes (and `engine/` ABI). If the hash differs from the last release, the module needs a new version, and CI fails if its `version` was not bumped.
3. **Build and test** (existing CI): the DSP tests, the module harness, the wasm build, then the harness against the wasm. Plugins: the macOS/Windows/Linux matrix and notarisation.
4. **Package** (`scripts/package-module.py`, `scripts/package-plugin.sh`): produce the artifacts and the `entry.json` files.
5. **Stage.** Upload to `…/staging/<release-id>/`. A smoke job loads every staged module in the node host test and in a headless browser.
6. **Publish.** Copy staged files into the immutable paths, then write `index.json` last, in one atomic replace. A release is visible only when the index changes; rollback is putting the previous index back.
7. **Channels.** `beta` index first for testers; promoting to `stable` is a new index, not a rebuild.

`scripts/release/release.py` is built for plugins (steps 4 to 6 in a simpler form: a draft release, size- and hash-checked uploads, publish, index regenerated). It authenticates with an **admin-created release token** (`python -m app.cli token-create`), not with the storage credentials, so the machine that releases never holds S3 keys. Built since: adding the build of another platform to a published release (`--add-platform`), and **publishers**: the library binds a token to a publisher (the namespace of its ids) and records who uploaded. Not built yet: change detection, staging.

## 8. Website

- **Docker no longer builds wasm.** The `web` stage of `website/Dockerfile` is removed. The site image contains only the Next.js static export and the board UI.
- **Modules load from the registry.** `bleep-web.js` fetches `index.json` (cached) and then `modules/<id>/<version>/<id>.bleepmod` on demand, from the CDN, exactly as it loads `.wasm` today.
- **Pinned for reproducibility.** The site build commits a `web-lock.json` (module id → version → sha256) so a given site release always runs the module set it was tested with; updating it is a normal commit (`scripts/release/release.py --update-web-lock`). A newer module reaches the website when the lock is bumped, never silently.
- The board UI and `patch/web/js/` (graph runner, worklet) are versioned with the site and declare the `engineAbi` they implement. The site's module catalog and docs pages read the library entries at build time instead of `patch/modules/*/module.json` from the repo, with the repo as a fallback in development.
- Preset browser on the site: read-only listing from `presets/index.json`, *Open in Bleep Play* and *Open in the app* (`bleep://preset/<author>/<slug>`).

## 9. The two sections: Library and Board

The board is always on screen. The Library, Settings and Help topics open as dialogs over it, from the *Library*, *File* and *Help* menus of the top bar (the Library menu offers *Open Library…* and *Upload Project to Library…*):

| Section | For | What is in it |
|---|---|---|
| **Board** | Creating patches | The board (nodes, cables, cells, panels, module views, undo), loading and saving projects and presets, the transport. What the app and the plugin show today |
| **Library** | Managing what is on this machine | **Modules**, **Plugins** and **Presets** tabs: installed, available and updates; Install, Update, Remove; the two default bundles; the release channel; disk use. In the app also **Devices** (audio device, MIDI ports, Link, connected plugins), and the account for sharing presets and the library URL (for self-hosting) |

- **A missing module** on the board is a placeholder node with an *Install* button that opens the Library section at that module.
- **In a plugin window**, the Library installs modules and presets (outside the audio thread); *Plugins* only lists what is installed and what is newer, and says "close Live, then update with the Bleep App", because replacing a plugin Live has loaded can crash it.
- **Bleep Play** has no Library section: it installs the modules a board needs by itself, checks them, and keeps them in the browser's cache. It has no plugins to manage and presets come from the site.
- **Docs:** module manuals are read from the installed packages (each carries its docs) and open from a module's node or from its card in the Library.

Not planned: a built-in shop, a patch library with payments.

Local state in `~/Library/Application Support/Bleep/` (and equivalents), read by the app and by every plugin: `settings.json` (channel, library URL), `installed.json` (id, version, sha256, channel, source), `modules/<source>/<id>/<version>/`, `presets/`, a cache of `index.json`. Remove deletes the version folder; the board's nodes of a removed type show as missing, a board is never changed by it.

## 10. Repository layout

```
registry/
├── schema/                    JSON Schemas: entry, index, module.json, preset
└── README.md
scripts/
├── package-module.py          folder → .bleepmod
├── package-plugin.sh          built plugin → installer
├── release.py                 detect, package, stage, publish (dry run by default)
└── registry-client.py         fetch, used by the website build and tests
patch/engine/WasmModuleHost.*  native host for .bleepmod
patch/app/SoftwareCenter.*     the installer logic (UI is board-style web UI like the rest)
```

`check-repo.py` gets rules: `registry/` depends on nothing else; the schemas are the contract the others validate against.

## 11. Order of work

1. **Schemas and package format.** `module.json` gets `version`, `requires`, `types`. `package-module.py` produces `.bleepmod` from the existing wasm output. Validate all current modules.
2. **Library v0.** The SeaweedFS service and the Caddy route (done in the compose file); `release.py` publishes into the bucket. The website reads from it; remove the `web` stage from the Dockerfile; add `web-lock.json`.
3. **Wasm host in the engine** and the CPU gate from 4.2. Decide per module: static-only or installable.
4. **The Library section** in the app and the plugin window, with Modules, Plugins and Presets; the update check at start (13 has the steps).
5. **Plugin release pipeline**: notarisation, installers.
6. **Presets**: the schema with `needs`, local Library, then the `/api/presets` endpoints, the Postgres migration, device-code login and *Share…*.

## 12. Open questions

- **Hosts that forbid executable memory** (4.2, 13): with every module a wasm package, such a DAW can only run what wasm3 carries. Options: accept it (a message that names the DAW and the missing entitlement), keep a native build of the cheap-to-port modules as packages for that platform, or ship a second plugin build with the modules compiled in. Needs a decision before M6.
- **Release credentials.** `release.py` uses a release token (revocable, expiring, listed with last use), so S3 credentials stay on the server.
- **Third-party modules.** Any account can publish modules under its own handle (`acme/fuzz`); modules are sandboxed, plugins are reviewed before a token gets the plugin scope. Open: whether third-party modules sit in a separate `community` channel or in one list with the publisher shown.
- **Naming:** the product name, package extensions and the `bleep://` scheme are placeholders like the rest of the project's names.

## 13. Moving the apps and plugins to library modules: work plan

Done: the module packages (`package-module.py`), their release, the library reading each module's node types, and the **Bleep Play**, which installs its modules from the library (`patch/web/js/library-client.js`, tested against the Python tools). Left: the standalone app and the plugins, which today compile the modules in.

What is known about the 80 modules, from their sources and the browser build: all 80 build to standalone wasm and pass the ABI check. **26** use `juce_core` and wasm exceptions (Wasmtime only; wasm3 cannot run them). **4** read the harmony bus (chord-quantizer, harmony-master, quantizer-suite, step-sequencer), **6** use the per-voice index (beat-oscillator, chart-recorder, macro-osc, pulse-generator, test-oscillator, wave-analyzer), **4** load sample files (grains, sampler, splice, wavetable-osc). Those 14 need an ABI addition before they can leave the apps (`module-abi.md`, section 9). Cells, Voice Cells and the port nodes stay in the engine: only the DSP nodes become wasm.

| Step | What | Done when |
|---|---|---|
| **M1 The gate** | A `WasmModuleHost` (Wasmtime) in the engine, used first by `bleep_module_harness`: every module runs natively and as wasm on the same inputs and knob changes. ABI additions for harmony bus, voice index and media | Per module: maximum difference within rounding and CPU relative to native. All 80 pass, or the list of those that do not and why. The heaviest (Grains, Delay Network, Modal Voice; a 16-voice Voice Cell) are within about 2× native |
| **M2 Library client in C++** | HTTP with `juce::URL` and SHA-256, the same checks as `library-client.js`, the install folders and `installed.json`, the shared `settings.json` | The packages in `patch/tests/library-fixtures` give the same verdicts in C++ and JavaScript; an install from a library on another port works end to end |
| **M3 Dynamic registry** | `Registry` becomes append-only and thread-safe (modules keep references to their specs, so a spec never moves or goes away); the type list the UI shows refreshes after an install; installed modules load at start | Installing a module while a board is open adds its node type without a restart |
| **M4 Library and Board** | The two sections in the board UI, shared by the app and the plugins, with native functions for install, update, remove, progress and the Security settings | Section 9 works in the app and in a plugin window in Live |
| **M5 First run** | The setup assistant with the two default bundles, the installers, the plugin bundle install (app only, Live closed) | A clean machine reaches a working board with one click per bundle |
| **M6 Remove the modules from the apps** | The CMake option that compiles modules in is off for shipped builds; the plugins lose the module code; the tests keep it as the reference | The plugins are small, load no module code, and the same boards sound the same |

Risks, in the order they bite: a **wasm instance per voice** (a 16-voice cell with five modules is 80 instances of 1 to 2 MB each); **hosts that forbid executable memory** (Wasmtime would be killed; the choice of runtime must be made before any code is compiled); the **26 exception-using modules** cannot fall back to wasm3; **start-up time** (compile lazily on first use, cache compiled code per machine, keyed by the package hash); **first run offline**. M1 decides most of these, which is why nothing is removed from the apps before it passes.
