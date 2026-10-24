# Installation

Status: a proposal, nothing built except the developer path (`./bleep build plugins`, which copies the plugins and the Bleep Live Link
device). This page is the plan for how a musician gets everything onto their machine, and where it is still open.

**The idea.** The standalone app is the installer. It carries the plugins and the Live Link device inside it, downloads the modules, and
shows what is installed and what is not. Nothing is decided at "first start": the app looks at the machine on every start and offers what
is missing or out of date.

**Constraint for now: nothing we ship is code-signed.** The consequences are in section 5.

## 1. Components

| Component | Source | Goes to | Needs |
|---|---|---|---|
| **Plugins** (Bleep Board, Audio Out, Audio Insert, Instrument, MIDI In/Out, …) as VST3 | bundled inside the app | the user's VST3 folder (section 4) | Live not running |
| **Modules** (`.bleepmod`) | downloaded by the app from the module catalog | `<app data>/modules/` | network, once; the plugins find them there |
| **Bleep Live Link** device (`.amxd`, frozen, with its script embedded) | bundled inside the app | Live's User Library, `Presets/Audio Effects/Max Audio Effect/bleep-live-link/` | a Live installation with Max for Live (Suite); Live not running is not required but the device may be loaded in a set |

The plugins must match the app's version (the engine ABI), so they are never downloaded on their own: they come from the app that
installs them.

## 2. States

Every component is in one state, found by looking at the machine:

| State | Meaning |
|---|---|
| **current** | installed, and the same version as the one bundled in the app (modules: as the catalog) |
| **outdated** | installed, but older |
| **missing** | not installed |
| **not applicable** | cannot be installed here (no Live found for the device; not a platform with the plugin) |

How each is found, without the network:

- **Plugins:** the version stamp inside the installed bundle against the one in the app.
- **Device:** a hash of the installed `.amxd` against the bundled one.
- **Modules:** the installed list against the last catalog the app downloaded. The catalog is refreshed on request and every so often,
  never required to start the app.

## 3. When the app speaks

- **The first launch** opens the *Setup* panel on its own, with every component that is missing ticked.
- **Later launches:** if something is missing or outdated, a quiet banner says so ("2 things to install"). It never blocks.
- **Skipping is remembered per component, per app version.** A component that was skipped is not offered again until the next version of
  the app.
- **Settings has a permanent *Setup* page** with each component's state and an *Install*, *Update* or *Repair* button. Declining a
  component once is never final.
- **Live is running:** installing plugins waits with "Quit Live, then Install" (overwriting a loaded plugin can crash it). The module
  download and the device copy do not wait.
- **Failure leaves the old state:** a download that stops halfway is resumed next time; a file is installed by copying to a temporary
  name and renaming.

## 4. Where things go

| | macOS | Windows | Linux |
|---|---|---|---|
| VST3 plugins | `~/Library/Audio/Plug-Ins/VST3` (no admin) | `C:\Program Files\Common Files\VST3` (admin), or a user folder that the user adds in Live's plug-in settings | `~/.vst3` |
| Modules | `<app data>/modules/` | the same, in the app data folder | the same |
| Live Link device | Live's User Library | Live's User Library | not applicable |

**Finding Live's User Library.** The default is `~/Music/Ableton/User Library` (macOS) or `~/Documents/Ableton/User Library`
(Windows). The user can move it in Live's settings, and several Live versions can be installed. Open: whether Live's preferences file
records the library path in a way we can read. If it cannot be found, ask for the folder, or *Reveal in Finder* with the device ready to
drag. The developer path accepts `BLEEP_LIVE_USER_LIBRARY`.

## 5. Without signing

- **The app is the only thing downloaded in a browser.** The download page tells the user to open it once with right-click, *Open* on
  macOS and *More info*, *Run anyway* on Windows.
- **What the app copies itself carries no quarantine flag**, so Live loads the plugins. A plugin downloaded separately in a browser
  would be blocked. This is why the plugins ship inside the app.
- **The plugins are ad-hoc signed at build time.** Apple Silicon will not load unsigned native code; an ad-hoc signature is enough.
- **Modules are wasm data**, not native code. The app downloads them itself over HTTPS and checks each against a hash in the
  catalog (or with the module signing kit, which is separate from code signing).
- **Windows:** an unsigned admin prompt shows "unknown publisher". The alternative is a user folder for the plugins and a one-line
  instruction to add it in Live.
- **Not possible without signing:** the Mac App Store, and a prompt-free first launch.

## 6. The device

- **Freeze it.** A frozen `.amxd` embeds `live-link.js`, so there is one file, nothing to keep in step, and the symlink workaround
  goes away. The development copy stays unfrozen next to the script.
- **Suite only.** The app cannot tell whether the user has Max for Live. The Setup page says so next to the device and lets it be skipped.

## 7. One implementation

The copy logic lives in one place. The app gets a headless mode (for example `Bleep --install`) that reads a **manifest** (component,
file, destination per platform), and `./bleep build plugins`, CI and the Setup panel all use it. The manifest is also written to the
machine at install time, so *Repair* and *Uninstall* know exactly what was put where.

## 8. Not covered here

- The plugin without the app: it should say "open the Bleep app to download modules" instead of showing an empty board.
- Updating the app itself.
- The module catalog's format, hosting and the licence text shown per module.
- Uninstalling by hand.
