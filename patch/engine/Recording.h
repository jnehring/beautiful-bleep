// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Recording.h — the recorder service (doc/specs/recorder-service.md). A module that wants to write audio
// to a file while it runs (the Audio Console's multitrack recording) never touches the disk or a path:
// it opens a Session with the service the host installed and pushes blocks of samples into it.
//
//   message thread   session = recording::service()->open("Session name", tracks, sampleRate, format)
//   audio thread     session->beginTake(); session->write(track, channels, frames); ... session->endTake();
//   message thread   session.reset()                       (drains and finishes every file)
//
// The interface is all a module sees, and it is header-only, so a module that uses it still builds as a
// standalone .wasm for the browser. What stands behind it is the host's business: the app and the plugins
// install a disk service (Recording.cpp: a writer thread, one WAV file per track, in the Recordings
// folder); the browser will install a memory service. With none installed, service() is null and the
// module records nothing. No JUCE here.
#pragma once

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace bleep::engine::recording {

enum class Format { Pcm16, Pcm24, Float32 };  ///< WAV files

constexpr int kMaxTracks = 40;  ///< one file per track: 32 channels, 4 aux buses and the master, with room to spare

/// One file of a take. A stereo track has two channels.
struct TrackSpec {
    std::string name;  ///< becomes the file name (made safe by the service)
    int channels = 1;  ///< 1 or 2
};

/// What the service can say about a session at any moment (any thread).
struct Status {
    bool takeOpen = false;          ///< a take is being written
    int take = 0;                   ///< number of the current (or last) take, from 1
    uint64_t frames = 0;            ///< frames written to the current (or last) take
    bool failed = false;            ///< the writer gave up: the disk is full, too slow or the file is too big
    std::string message;            ///< why, for the view
    std::string folder;             ///< where this session's files are (empty until the first take starts)
};

/// One recording session: a fixed list of tracks, any number of takes. Takes are recorded back to back
/// into new files; the tracks do not change inside a session.
class Session {
public:
    virtual ~Session() = default;

    /// [audio thread] Marks the start of a take at the current position of every track. Cheap and lock-free.
    /// False when the marker queue is full (a take was begun and ended many times within a few milliseconds).
    virtual bool beginTake() noexcept = 0;
    /// [audio thread] Marks the end of the take; everything written before it belongs to it.
    virtual bool endTake() noexcept = 0;
    /// [audio thread] Appends `frames` samples to track `track`: ch[0], and ch[1] for a stereo track. Every track
    /// must receive the same number of frames between beginTake() and endTake(). Lock-free; false when the
    /// writer fell behind and the buffer is full (the session is marked failed and nothing more is accepted).
    virtual bool write(int track, const float* const* ch, int frames) noexcept = 0;

    /// [any thread]
    virtual Status status() const = 0;
};

/// What the host provides. One per process.
class Service {
public:
    virtual ~Service() = default;

    /// [message thread] A new session. Files are made when the first take begins, not here. Null with `error`
    /// set when the service cannot record (no folder, too many tracks). `folder` is the module's own Recordings folder
    /// (a full path); empty means the one chosen in Settings. A disk service refuses a folder it cannot write to.
    virtual std::unique_ptr<Session> open(const std::string& name, const std::vector<TrackSpec>& tracks, double sampleRate,
                                          Format format, std::string* error, const std::string& folder = {}) = 0;
    /// [any thread] How many bytes the service can still take (free disk space minus a reserve; the browser: what is left
    /// of its memory budget). For the "time left" display: bytes per second is tracks x channels x rate x bytes per sample.
    /// `folder`: the module's own folder, as for open(); empty means the Settings one.
    virtual double freeBytes(const std::string& folder = {}) const = 0;
    /// [any thread] Where files go, for the view ("Recordings folder: ..."). `folder` as above.
    virtual std::string where(const std::string& folder = {}) const = 0;
};

#ifdef __wasm__
/// Recording.cpp: the client that turns the Service calls into the bleep_record_* imports (module-abi.md, section 5b).
Service* wasmService();
#endif

/// The installed service, or null. Native: set once by the host before any module runs. In a wasm module it is the client of
/// the host's recorder (which answers "none" where the host has no recorder: open() then fails with a reason).
inline Service*& service() noexcept {
#ifdef __wasm__
    static Service* s = wasmService();
#else
    static Service* s = nullptr;
#endif
    return s;
}

inline int bytesPerSample(Format f) noexcept { return f == Format::Pcm16 ? 2 : f == Format::Pcm24 ? 3 : 4; }

#ifndef __wasm__
/// Installs the disk service if no service is installed yet (the native engine: Recording.cpp). Safe to call from
/// any module's prepare(), any number of times.
void ensureDiskService();
/// The folder recordings go to: ~/Music/Beautiful Bleep/Recordings unless the settings changed it.
std::string folder();
/// Sets the folder for this run only; an empty string goes back to the default. Affects sessions opened afterwards.
void setFolder(const std::string& path);

/// The folder recordings go to when nothing is set.
std::string defaultFolder();
/// Where the choice is kept: <data folder>/recordings.json. The data folder is the library's (so the app and every plugin share it):
/// ~/Library/Application Support/Bleep, %APPDATA%\Bleep, ~/.local/share/Bleep; BLEEP_DATA_DIR overrides it (tests, development).
std::string settingsFile();
/// The Settings page's choice: makes `path` the Recordings folder and keeps it for the next start. An empty path goes back to the
/// default. False, with `error` (worded for the page), when the path cannot be used: it is not a full path, the folder cannot be made
/// or it cannot be written to. The folder is applied when the choice could not be saved, and `error` says so.
bool saveFolder(const std::string& path, std::string* error = nullptr);
/// Reads the saved choice again (done once by ensureDiskService()).
void reloadSettings();
#endif

}  // namespace bleep::engine::recording
