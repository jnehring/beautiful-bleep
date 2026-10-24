---
title: Recorder service
description: How a module records audio to files without a disk: the service, its imports, the Recordings folder and what the browser does.
order: 15
---

# Recorder service

A module is sandboxed: it has no disk, no paths and no threads, and that is what makes it safe to run code that
somebody else wrote. A module that records audio (the Audio Console writes every armed channel to its own file)
therefore cannot write the files itself. It hands the audio to the **recorder service**, which belongs to the host
and does the writing.

Three rules shape it:

1. **The module never sees a path.** It names tracks; the host decides where files go, what they are called on disk
   and whether it can write at all.
2. **The audio thread never waits.** Writing a block is a copy into a ring buffer, and a failure is a flag, not a
   stall. Files, folders and flushing happen on the service's own thread.
3. **The service says how much room is left**, so a module can show how long it can record instead of guessing.

## Sessions, tracks and takes

| Term | What it is |
|---|---|
| **Session** | What a module opens when it starts recording: a list of tracks, fixed until the session ends. |
| **Track** | One file. One or two channels (mono or stereo); at most 40 per session. |
| **Take** | The audio between a start and a stop. A session has any number of takes, recorded one after the other into new files. |

A module opens a session on its message side, pushes blocks of samples from its audio code, and marks where each
take begins and ends:

```
open(name, tracks, sampleRate, format)    → session           once, when recording is armed
beginTake()                                                   at a start
write(track, left, right, frames)         → ok                every block, for every track
endTake()                                                     at a stop
close()                                                       the session ends; every file is finished
```

Every track must receive the same number of frames between `beginTake()` and `endTake()`. A take boundary is stored
as an exact frame position per track, so a take ends where the audio thread ended it, however far behind the
writer is, and stopping and starting again within a few milliseconds does not mix two takes.

In C++ (`patch/engine/Recording.h`, header only) it looks like this:

```cpp
#include "Recording.h"
using namespace bleep::engine;

recording::Service* svc = recording::service();            // null: this host cannot record
if (!svc) return;
std::string why;
auto session = svc->open("My module", {{"Left", 1}, {"Room", 2}}, sampleRate, recording::Format::Pcm24, &why);

// audio thread, every block
session->beginTake();
const float* room[2] = {roomL, roomR};
session->write(0, &left, frames);                           // mono track: one channel
session->write(1, room, frames);                            // stereo track: two
session->endTake();

session.reset();                                            // finishes the files
```

`write()` returns false when the host fell behind and dropped the session. The module should stop writing and
show `session->status().message`.

## The formats

WAV, as 16-bit or 24-bit integer or 32-bit float. Other formats (MP3, FLAC) are not offered: an MP3 encoder (LAME, LGPL) would be a
dependency a release has to bring and a licence it has to carry, and the WAV files are easy to convert afterwards.

## What the apps and the plugins do

They install a **disk service** (`patch/engine/Recording.cpp`). It writes to the **Recordings folder**, next to the
media folder:

| System | Default folder |
|---|---|
| macOS, Linux | `~/Music/Beautiful Bleep/Recordings` |
| Windows | `%USERPROFILE%\Music\Beautiful Bleep\Recordings` |

```
<Recordings folder>/2026-10-24 14.32.07 Audio Console/Kick.wav
                                                      Kick (take 2).wav
                                                      Aux 1.wav
                                                      Master.wav
```

- Each session gets its own folder, named after the time it started and the module. The folder and the files are
  made when the first take begins, so a session that waits for the transport leaves nothing behind.
- Track names are made safe (no separators or reserved characters, at most 60 characters) and made unique within
  the session ("Kick", "Kick 2").
- The files are classic WAV with a 44-byte header. The header is written empty and patched when the take ends, so
  a file left by a crash is still readable by editors that go by the file length.
- A file stops at 4 GB, the limit of a WAV file: the take ends and the service says so.
- **Time left.** `freeBytes()` is the free space of the volume minus a reserve of 1 GB. Divide it by tracks ×
  channels × sample rate × bytes per sample.
- A full disk, a missing permission or a writer that falls behind ends the take and sets a message. What was
  written stays valid.

The folder is chosen in **Settings → Recordings** (the app and the plugins): a full path that Bleep can write to, or the default.
`recording::saveFolder(path, &error)` checks it (by making the folder and writing a file) and keeps it in `recordings.json` in the data
folder the library's settings use, which the app and every plugin share (`BLEEP_DATA_DIR` moves it); `recording::setFolder` changes it
for one run only. A session keeps the folder it started in.

## Reaching the service from a wasm module

Shipped modules are WebAssembly files and cannot call the C++ service. In a wasm build the same `recording::service()`
is a small client whose calls become **seven imports** the host provides (`bleep_record_open`, `bleep_record_take`,
`bleep_record_write`, `bleep_record_status`, `bleep_record_text`, `bleep_record_free`, `bleep_record_close`). They
are specified in the [Module ABI](module-abi.md), section 5b. They only hand audio to the host and read its
status back: there is no way to name a path or read a file through them, so the sandbox is as tight as before.

A module runs on one thread, so even the calls a button causes arrive on the audio thread. The imports never block:
`open` allocates the buffers and starts the writer (about a millisecond for a typical session), `close` hands the
session to a background thread to finish, and `write` is a copy. A host without a recorder answers 0 to `open`, and
the module says that recording is not available there.

## The browser

Bleep Play has no disk and no Recordings folder. Its recorder is the simplest one that cannot take a tab down. It is built
(`patch/web/js/web-recorder.js` in the audio worklet, `web-recordings.js` on the page) and tested under node with the real
Audio Console; it has not been run in a browser yet:

- **In memory, then download.** A memory service answers the same imports and keeps the samples in chunks. When the session
  ends, the takes are handed to the page without copying, and the Audio Console's view lists them with *Download .zip* and
  *Discard*. The zip holds a WAV file for every track of every take, built from the recorded chunks themselves, so the
  memory is not doubled. What the page still holds counts against the budget until you discard it.
- **A budget, not "all free memory".** A browser cannot say how much memory is free. The service uses a fixed
  budget (about a quarter of `navigator.deviceMemory` where that exists, between 256 MB and 1 GB, 256 MB where it
  does not) and reports what is left of it through `freeBytes()`, so the Audio Console shows the time left exactly
  as it does with a disk: at 1 GB, 16 bit and 48 kHz, about three hours for one track, 23 minutes for eight and
  under six for 32.
- **It stops before it fails.** The take ends when the budget is used up, keeps what it has and says why; a warning
  comes at 90 %. Memory is allocated in small blocks inside a try/catch, so an allocation the browser refuses ends
  the take and not the tab.

Planned next: recording into the browser's Origin Private File System from a worker (no budget; a take
survives a reload), streaming downloads through a service worker, and MP3 conversion after the take.

## Tests

`patch/tests/recording_test.cpp` is pure C++: files per track in every format with the right header and the samples
that were written, safe and unique names, numbered takes, five takes within moments with their exact lengths, a
session closed in the middle of a take, a writer that falls behind, and refused sessions.
`patch/tests/audio_console_record_test.cpp` drives the real Audio Console against it with the audio on its own
thread. The full specification is `doc/specs/recorder-service.md`.
