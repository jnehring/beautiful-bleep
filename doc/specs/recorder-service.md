# Recorder service

Status: built for the apps and the plugins (native engine, with a Recordings folder chosen in Settings) and for wasm modules: the Audio Console built as a real
`.wasm` records through the host's imports (`tests/wasm_console_record_test.cpp`). The browser has a memory recorder
(`web/js/web-recorder.js`, `web-recordings.js`) that keeps takes under a fixed budget and offers them as a zip; it is tested
under node with the real console and has not been run in a browser yet.

## 1. What it is

A module that wants to write audio to a file while it runs cannot: a module is sandboxed and has no disk, no
paths and no threads (`developers/modules/module-abi.md`). The **recorder service** is what stands in for the
disk. A module opens a *session* with a list of tracks, pushes blocks of samples into it from its audio code and
marks where takes begin and end; the host writes the files.

The first user is the [Audio Console](modules/audio-console.md), which records dozens of channels at once. The
service knows nothing about mixers: it takes tracks, takes and samples.

Three rules shape it:

1. **The module never sees a path.** It names tracks; the host decides where files go, what they are called on
   disk and whether it can write at all. A module cannot write anywhere else, however it is written.
2. **The audio thread never waits.** Writing a block is a copy into a ring buffer; a failure is a flag, not a
   stall. Everything slow (files, folders, flushing) happens on the service's own thread.
3. **The service says how much room is left.** The module shows "time left" from it; it never guesses.

## 2. The interface (`engine/Recording.h`)

```
Service::open(name, tracks, sampleRate, format) → Session          [message thread; null + reason on failure]
Service::freeBytes()  Service::where()                             [any thread]

Session::beginTake()                                               [audio thread]
Session::write(track, channels, frames)                            [audio thread]
Session::endTake()                                                 [audio thread]
Session::status() → { takeOpen, take, frames, failed, message, folder }   [any thread]
~Session()                                                         finishes every file
```

- **Tracks.** A track is `{name, channels}` with one or two channels; one track is one file. A session has at most
  `kMaxTracks` (40) tracks, fixed when it opens.
- **Formats.** WAV, 16-bit or 24-bit integer, or 32-bit float.
- **Takes.** `beginTake()` and `endTake()` mark a take on every track at once. A session has any number of takes,
  recorded one after the other into new files. Within a take every track must receive the same number of frames.
- **`write()`** copies into the track's ring buffer and returns at once. It returns false when the ring is full
  (the writer fell behind): the session is marked failed, the take ends where the data ends, and nothing more is
  accepted. The ring holds about 1.4 s of every channel.
- **Order is kept.** A take boundary is stored as an exact frame position per track, so a take ends exactly where
  the audio thread ended it, however far behind the writer is. Stopping and starting again within a few
  milliseconds does not mix the takes.

## 3. The disk service (`engine/Recording.cpp`)

The apps and the plugins install it (`recording::ensureDiskService()`, called by the module's `prepare`).

**Where files go.** The **Recordings folder**: `~/Music/Beautiful Bleep/Recordings` on macOS and Linux,
`%USERPROFILE%\Music\Beautiful Bleep\Recordings` on Windows, next to the media folder (`engine/Media.h`). The
**Settings → Recordings** overrides it for sessions opened afterwards (`recording::saveFolder`, `board/RecordingsSettings.cpp`): a full
path that exists or can be made and that Bleep can write to (it is checked by writing and removing a file), or an empty path for
the default. A refused path changes nothing and the page shows the reason. The choice is kept in `recordings.json` in the data folder
the library's settings use (`~/Library/Application Support/Bleep`, `%APPDATA%\Bleep`, `~/.local/share/Bleep`; `BLEEP_DATA_DIR`
overrides it), so the app and every plugin share it, and is read once when the service is installed. A module can name a folder of its own (the Audio Console keeps it in its node data, `folder`): `open(..., folder)` then records there instead, after the same checks, and refuses the session with the reason when the folder cannot be used. An empty folder means the Settings one. A running session keeps its
folder. `recording::setFolder` sets it for one run only (tests). The page can also open a folder chooser and show the folder in the
file manager.

**What is written.**

```
<Recordings folder>/<yyyy-mm-dd hh.mm.ss> <session name>/<track>.wav
                                                         <track> (take 2).wav
```

- The folder and the files are made when the first take begins, not when the session opens, so a session that
  waits for the transport leaves nothing behind. The first take of a track is `<track>.wav`, later ones
  `<track> (take N).wav`.
- Track names are made safe (no separators or reserved characters, no leading dots or spaces, at most 60
  characters) and made unique within the session ("Kick", "Kick 2").
- Files are classic WAV with a 44-byte header. The header is written with a size of 0 at the start and patched when
  the take ends, so a file left by a crash is still readable by most editors (they use the file length).
- A file holds at most 4 GB: the service ends the take, sets *failed* and says so.

**Threads.** Each session has one writer thread. It wakes every 5 ms, drains every ring up to the next take
boundary and writes. Destroying the session finishes the open take and joins the thread.

**Room.** `freeBytes()` is the free space of the volume minus a reserve of 1 GB. The module divides it by the data
rate of its armed tracks (tracks × channels × sample rate × bytes per sample) for the *time left* display.

**Failure.** A full disk, a missing permission or a writer that falls behind sets *failed* with a message the
module shows ("The disk could not keep up. The take was cut short."). The files written so far stay valid.

## 4. How a wasm module reaches it

Shipped modules are WebAssembly (`developers/modules/library.md`): in the apps, the plugins and the browser alike
the module is one `.wasm` file that cannot call the C++ service. So the interface has a second form: imports the
host provides (`developers/modules/module-abi.md`, section 5b). In a wasm build, `recording::service()` is a client
whose calls become these imports; on the host, `WasmModule` answers them with the same disk service.

```
bleep_record_open(spec, specLength, sampleRate, format) → handle    spec: JSON {"name", "folder"?, "tracks": [{"name", "channels"}]}; format 0 = 16-bit, 1 = 24-bit, 2 = 32-bit float
bleep_record_take(handle, begin) → ok
bleep_record_write(handle, track, left, right, frames) → ok
bleep_record_status(handle, frames*, take*) → flags
bleep_record_text(handle, what, dst, capacity) → length             what: 0 folder, 1 message, 2 this session's folder
bleep_record_free() → bytes
bleep_record_room(folder, folderLength) → bytes                     the same for a module's own folder
bleep_record_close(handle)
```

Because a wasm module runs on one thread, its message-thread calls (a button, a status poll) are delivered on the
audio thread. So the imports are written to never block: `open` allocates the rings and starts the thread
(about a millisecond for a typical session; it happens once, when *Record* is pressed), `close` hands the session to
a background thread to finish, and `write` is a copy. A module that is destroyed with a session open gets it
finished by the host.

## 5. The browser

Bleep Play has no disk either, and the browser has no equivalent of a Recordings folder. The first version is
the simplest one that cannot take the tab down. It is built in two halves:

- **The worklet** (`web/js/web-recorder.js`, `MemoryRecorder`) answers the imports from `module-host.js`, one handle table per
  module instance. Samples are kept in chunks of 16384 frames per track (16-bit, packed 24-bit or 32-bit float).
  When a session ends its takes are *transferred* (not copied) to the page, and what the page holds still counts against the
  budget until it is discarded.
- **The page** (`web/js/web-recordings.js`) keeps the finished sessions and builds the download: the files of every take as WAV,
  named like the disk service names them (`<time> <name>/<track>.wav`, `<track> (take 2).wav`), in one stored zip made from the
  recorded chunks themselves. The console's view lists the recordings with *Download .zip* and *Discard* (`api.recordings`,
  `downloadRecording`, `discardRecording` in `board-views.js`; they are null or absent where the host writes files itself).

It holds to these rules:

- **In memory, then download.** A memory service answers the same imports. It keeps chunks of samples (16 or 24 bit)
  and, when the take ends, builds the WAV files and offers them as one **zip** (store only), one file at a time so
  the memory is not doubled.
- **A budget, not "all free memory".** Browsers cannot say how much memory is free. The service uses a fixed
  budget: about a quarter of `navigator.deviceMemory` where it exists, between 256 MB and 1 GB, and 256 MB where it
  does not. `freeBytes()` is what is left of it, so the console shows the *time left* exactly as it does with a
  disk (at 1 GB, 16 bit and 48 kHz: about 3 hours for one track, 23 minutes for eight, under 6 for 32).
- **It stops before it fails.** The take ends when the budget is used up, keeps what it has and says why (the view shows it;
  the browser build has no text channel from the module yet, so the view words it itself); the recorder notes a warning at 90 %. Chunks are allocated in small blocks inside a try/catch, so an allocation the browser refuses
  ends the take instead of the tab.
- **Transport.** Bleep Play has its own transport (the side menu), and modules see its `playing` flag like in
  every host, so *Follow Transport* works there too.

## 6. Tests

`tests/recording_test.cpp` (pure C++): one file per track in all three formats with the right header and the
samples that were written; a stereo track; safe names ("Keys/Pad: 1" → "Keys-Pad- 1"); numbered takes; five takes
within moments keep their exact lengths; closing in the middle of a take leaves valid files; a writer that falls
behind marks the session failed instead of blocking `write()`; no tracks and too many tracks are refused with a
reason; `freeBytes()` is positive.

`tests/audio_console_record_test.cpp` drives the real Audio Console against the service with the audio on its own
thread. `tests/wasm_record_test.cpp` checks every argument of the eight imports with a hand-assembled module, and
`web/test/web-recorder-test.mjs` (node) covers the browser side: the budget and the memory it reports, chunks across a boundary,
takes, a session that runs out of budget keeping what it has, an instance destroyed with a session open, a zip that `unzip -t`
accepts with WAV files holding the samples that were written, and the real Audio Console `.wasm` recording through
`module-host.js` into a zip. `tests/wasm_console_record_test.cpp` runs the Audio Console's `.wasm` (built with
`BLEEP_WEB_ONLY=audio-console scripts/build/build-web.sh --modules-only`) through the wasm host: a manual session and a
follow-transport session with two takes.

## 7. Later

- **Browser: the Origin Private File System.** Record into OPFS from a worker (synchronous access handles, seekable
  so the header can be patched) instead of memory: no budget, and a take survives a reload; export as a zip or, in
  browsers that have the File System Access API, into a folder the user picks.
- **Browser: streaming downloads.** A service worker that streams a zip to the download manager while the take
  is recorded.
- **MP3** (and FLAC). LAME (LGPL) is the usual encoder: one per track on the writer's thread, constant bit rate, and a gapless header; the
  browser could convert after a take with an encoder compiled to wasm. Left out for now: an encoder is a dependency that a release has to
  bring and a licence it has to carry.
- **A sandbox-aware Recordings folder** for hosts that restrict the folders a plugin may write to.
- **Pre-roll** for takes that start on a transport start, and **punch in/out** from a gate.
- Writing 64-bit WAV (RF64) so a take can pass 4 GB.
