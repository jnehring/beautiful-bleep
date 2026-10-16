# Settings

Status: built for the web and the plugin; the app gains one switch (§4.1). The C++ compiles and `bleep_library_test` passes; the plugin's Settings has not been opened inside Live. One **Settings** section for the three places the board runs: the standalone Bleep App, the Bleep plugins in Live, and Bleep Play in the browser. Extends `specs.md` §11 and `system-audio.md` §4.1; the web link tab is `bridges.md` §4.

## 1. What it is

The Settings section is one page of the board UI (`patch/board/ui/settings.js`). It is shown as a modal like the Library and Help (`modal.js`), opened by **File → Settings…** (⌘,) and by the audio button in the header. Changes apply as they are made; there is no Save button.

What differs between hosts is **which tabs exist and what is behind them**, not the page. The host says what it is in the first answer of `native("settings", "get")`:

```
{ host: "app" | "plugin" | "web", ... one object per tab the host has ... }
```

A tab is shown when its object is present. The page has no host checks of its own beyond this, so a new host or tab needs no change to the page's structure.

## 2. Who owns what

Settings live where the thing they control lives. A setting is never offered in a place that cannot honour it.

| Concern | App | Plugin (Live) | Web (Bleep Play) |
|---|---|---|---|
| Audio device, sample rate, buffer | **app** (JUCE device manager) | Live | **browser**: output device and latency mode only (§4.2) |
| MIDI inputs and outputs | **app** | Live | **browser**: which inputs play (§4.3) |
| Tempo, Link, transport | **app** | Live | the page's own transport (side menu) |
| Web link (hub) | **app**: on/off, port, allowed pages | none: the plugin reaches the hub through the app (`bridges.md` §2). A port's *Board*, *Latency* and *Lookahead* are settings of the port node | **page**: connect, status |
| Library channel, address | **app** | **plugin** | **page**: channel only (the address is the site it is served from) |
| Unsigned code (Security) | **app** | **plugin** | **page**: modules only (there are no plugins in a browser) |
| Local data | app data folder | plugin data folder (shared with the app) | the browser's storage |

## 3. Tabs by host

| Tab | App | Plugin | Web |
|---|---|---|---|
| Audio | yes (device, rate, buffer, channels, System audio) | | **new** (§4.2) |
| MIDI and sync | yes | | **new**, named *MIDI* (§4.3) |
| Web | yes (hub) | | **new**, named *App* (§4.4) |
| Library | yes, plus *Check for module updates at start* (§4.1) | **moved here** (§5) | **new** (§4.5) |
| Security | yes | **moved here** (§5) | **new** (§4.5), modules only |
| Data | | | **new** (§4.6) |

## 4. The new tabs

### 4.1 App: update check at start

- **Check for module updates at start** (default on), in the Library tab. Today the app asks the library at every start (`library.js`, `updatesPrompt`); with the switch off nothing is asked until *Check for updates* is pressed. It is a field of the library's settings (`updateCheck` in `settings.json`, `library::Settings`), so it is stored with the channel and the unsigned switches and travels through `librarySettings`, not through a settings call of the app. Only the standalone app shows it: the plugins never ask at start.
- *Later (not built):* open the last project at start; autosave and recovery; where projects and media are kept; a test tone for the output; Link quantum; a channel filter for MIDI inputs; *Reset settings*. Each needs native work in `AppController`.

### 4.2 Web: Audio

- **Output** (`AudioContext.setSinkId`). Shown when the browser supports it (Chrome, Edge; not Safari or Firefox). The list is `enumerateDevices()` outputs; the first entry is *Default*. A device that disappears falls back to *Default*.
- **Latency** *Interactive* (default) / *Balanced* / *Playback*, the `latencyHint` of the `AudioContext`. It applies when audio starts. Changing it while the sound runs shows a *Restart audio* button that reloads the page (the board is kept; Start audio is pressed again, as the browser requires a click); it never reloads by itself.
- **Right now**: sample rate, base latency, output latency (what the browser reports).
- Remembered in `localStorage` under `bleep.web.settings`.

### 4.3 Web: MIDI

- The **inputs** the browser sees, each with a switch (*plays* / *ignored*). With a *MIDI Device* node on the board the node's choice wins, as today (`bleep-web.js`, `listens`); the switch is the base for boards without one.
- Until the page has asked, the tab shows *Allow MIDI access* (the browser's own prompt appears then, not when Settings opens). A line says when the browser has no Web MIDI or the user declined.
- Remembered by input name.

### 4.4 Web: App

- The state of the link to Bleep App as the side menu's *Connect to app* shows it (`bridge-ui.js`), with the same button. *Connected / not connected*, mode (low latency or safe), the explanation when it failed.
- No port field. The page served by the app talks to its own host; any other page talks to the default port (`bridges.md` §4.1). The port is a setting of the app.

### 4.5 Web: Library and Security

- **Channel** *stable* / *beta*: `BleepLibrary.configure({ channel })`, applied at the next page load (the index is read once).
- **Allow unsigned modules**: off by default. Turning it on asks first with the same warning as the app, because a module runs in the browser's wasm sandbox with the page's CPU. A broken or revoked signature is never loaded, whatever this says.
- No unsigned *plugins* switch: Bleep Play does not install plugins.
- Remembered in `localStorage`. A page that cannot store (private window) keeps the choice for the visit and says so.

### 4.6 Web: Data

- What Bleep Play keeps in this browser: the board, saved presets, these settings. **Clear** deletes one kind or all of it after a confirmation; the page reloads with the default board.
- *Download Project* stays in the File menu.

## 5. Plugin: one Settings, no Audio

A plugin has no audio, MIDI or sync settings of its own: Live owns them. What it has is the library. Today the plugin's Library window carries a Security tab; the app keeps Security in Settings and removes it from the Library window (`library.js`, `host.settings`). The plugin does the same:

- File → Settings… exists in the plugin with the **Library** and **Security** tabs, the same two as the app's, over the same data: both use `ModuleLibrary`, so a channel or a switch set in a plugin is the app's too (one data folder).
- The plugin has no `settings` object beyond `{ host: "plugin" }`, so the other tabs are absent.
- The Library window loses its Security tab, as in the app.

## 6. Native interface

`native("settings", fn, arg)` stays the single door. The page decides its tabs from `state.host` (missing = `"app"`, which is what the fake engine of `ui-server.py` answers).

| fn | Hosts | Does |
|---|---|---|
| `get` | all | Returns the state. The app adds `host: "app"`; the plugin answers `{ host: "plugin" }` and nothing else; the web answers `host: "web"` with one object per tab: `webAudio`, `webMidi`, `webApp`, `webLib` (channel, unsigned modules) and `webData`, and `stored` (false when the browser refuses storage). |
| `audio`, `midiInput`, … | app | Unchanged. |
| `webAudio` | web | `{ output, latency, reload }` |
| `webMidi` | web | `{ allow }` or `{ name, on }` |
| `webApp` | web | `{ connect }` |
| `webLibrary` | web | `{ channel, allowUnsigned: { module }, reload }` |
| `webClear` | web | `{ what: "board" \| "presets" \| "settings" \| "all" }` |

The library tabs of the app and the plugin use the existing `libraryStatus` and `librarySettings` (the new field is `updateCheck`). The plugin's BoardWindow offers Settings when the build has the library (`BLEEP_WASM_MODULES`); the Library window then drops its Security tab, as in the app.

## 7. Rules

- **Applied as changed**, with the answer carrying the new state and an `error` when refused (as `audio` today).
- **Nothing sensitive is stored in the clear that was not already.** The web settings hold device ids, a channel name and one switch.
- **Honest absence.** A tab for a feature the host does not have is not shown; a feature the host has but cannot use right now (no output selection in Safari, no Web MIDI) is shown with the reason.
- **No fake state in a real host.** The demo state in `board-demo.js` (`demoSettingsState`) is for the UI server only (`ui-server.py`); Bleep Play answers from the browser.

## 8. Tests

- `patch/web/test/web-settings-test.mjs` (13 cases, in CI): defaults, output routing and its refusal, a vanished device, latency and the reload flag, MIDI switches, library choices applied only at load, the app link, junk and blocked storage, `clear`.
- `bleep_library_test`: `updateCheck` defaults on and comes back from `settings.json`.
- Not covered by a test: the plugin's `get` answer and the Security tab leaving the plugin's Library window (needs the JUCE web view; checked by reading the code and, for the page, by the fake engine only), and Settings inside Live.

## 9. What was built

1. Page: host-aware tabs (`settings.js`), the update-check switch (`library.js`, `settings.js`), the audio indicator opening nothing in a plugin (`board.js`).
2. Web: `patch/web/js/web-settings.js`, wired in `bleep-web.js` (latency hint, output, MIDI base switch, library configuration at load) and `board-demo.js`; `scripts/build/build-web.sh` loads it.
3. Native: `library::Settings::updateCheck` (`Client.h/.cpp`, `ModuleLibrary.cpp`, `BoardWindow.cpp`), the plugin's Settings answer and flag (`BoardWindow.cpp`), `host: "app"` (`AppController.cpp`).
4. Docs: `website/content/musicians/use/settings.md` (all three places, one article), pointers in `musicians/use/standalone.md`, `musicians/overview.md`, `developers/app/standalone-app.md` and a Settings section in `developers/web/bleep-play.md`; the board's Help index is regenerated. Still to do: `patch/app/README.md`.
