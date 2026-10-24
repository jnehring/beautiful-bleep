// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Recording.cpp — the disk side of the recorder service (Recording.h, doc/specs/recorder-service.md).
//
// The audio thread never sees a file. Each track has a ring of samples; the audio thread appends to it and the
// session's writer thread drains it into a WAV file. Take boundaries travel in a second queue as absolute frame
// positions per track, so a take ends exactly where the audio thread ended it, however far behind the writer is.
#include "Recording.h"

#ifndef __wasm__

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <mutex>
#include <thread>

namespace fs = std::filesystem;

namespace bleep::engine::recording {
namespace {

constexpr uint32_t kRingFrames = 1u << 17;  // about 2.7 s per track at 48 kHz
constexpr uint32_t kRingMask = kRingFrames - 1;
constexpr uint32_t kMarkers = 64;
constexpr uint64_t kMaxDataBytes = 0xF0000000ull;  // a classic WAV file ends at 4 GiB
constexpr double kReserveBytes = 1.0e9;            // never fill the disk to the last byte
constexpr int kChunkFrames = 4096;

std::mutex g_lock;
std::string g_folder;
bool g_chosen = false;   // the folder was set in this run: the saved choice does not override it at start

std::string defaultFolder_() {
#ifdef _WIN32
    const char* home = std::getenv("USERPROFILE");
#else
    const char* home = std::getenv("HOME");
#endif
    fs::path p = home ? home : ".";
    return (p / "Music" / "Beautiful Bleep" / "Recordings").string();
}

/// A file name that is safe on every system: no separators or reserved characters, no leading dots or spaces.
std::string safeName(const std::string& in) {
    std::string s;
    for (unsigned char c : in) s += (c < 32 || std::strchr("/\\:*?\"<>|", c)) ? '-' : (char)c;
    while (!s.empty() && (s.back() == ' ' || s.back() == '.')) s.pop_back();
    size_t a = 0;
    while (a < s.size() && (s[a] == ' ' || s[a] == '.')) ++a;
    s = s.substr(a, 60);
    return s.empty() ? "Track" : s;
}

std::string stamp() {
    const std::time_t t = std::time(nullptr);
    std::tm tm{};
#ifdef _WIN32
    localtime_s(&tm, &t);
#else
    localtime_r(&t, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%d %H.%M.%S", &tm);
    return buf;
}

void put16(uint8_t* p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
void put32(uint8_t* p, uint32_t v) { put16(p, v); put16(p + 2, v >> 16); }

/// The 44-byte header of a WAV file with `dataBytes` of audio.
void wavHeader(uint8_t h[44], int channels, double sampleRate, Format f, uint64_t dataBytes) {
    const int bps = bytesPerSample(f);
    std::memcpy(h, "RIFF", 4);
    put32(h + 4, (uint32_t)(36 + dataBytes));
    std::memcpy(h + 8, "WAVEfmt ", 8);
    put32(h + 16, 16);
    put16(h + 20, f == Format::Float32 ? 3 : 1);
    put16(h + 22, (uint32_t)channels);
    put32(h + 24, (uint32_t)std::lround(sampleRate));
    put32(h + 28, (uint32_t)(std::lround(sampleRate) * channels * bps));
    put16(h + 32, (uint32_t)(channels * bps));
    put16(h + 34, (uint32_t)(bps * 8));
    std::memcpy(h + 36, "data", 4);
    put32(h + 40, (uint32_t)dataBytes);
}

struct Ring {
    int channels = 1;
    std::vector<float> data[2];
    std::atomic<uint64_t> w{0}, r{0};  // frames, counted from the session's start
};

struct Marker {
    bool begin = false;
    uint64_t pos[kMaxTracks] = {};
};

enum FailCode { Ok = 0, Overrun, TooBig, CannotWrite };

class DiskSession final : public Session {
public:
    DiskSession(fs::path root, const std::vector<TrackSpec>& tracks, double sampleRate, Format format)
        : root_(std::move(root)), sr_(sampleRate), fmt_(format), n_((int)tracks.size()) {
        rings_ = std::make_unique<Ring[]>(tracks.size());
        for (size_t t = 0; t < tracks.size(); ++t) {
            rings_[t].channels = tracks[t].channels;
            for (int c = 0; c < tracks[t].channels; ++c) rings_[t].data[c].assign(kRingFrames, 0.0f);
            std::string base = safeName(tracks[t].name);
            std::string unique = base;
            for (int k = 2; std::find(names_.begin(), names_.end(), unique) != names_.end(); ++k) unique = base + " " + std::to_string(k);
            names_.push_back(unique);
        }
        files_.assign(tracks.size(), nullptr);
        dataBytes_.assign(tracks.size(), 0);
        writer_ = std::thread([this] { run(); });
    }
    ~DiskSession() override {
        stop_.store(true);
        if (writer_.joinable()) writer_.join();
    }

    bool beginTake() noexcept override { return push(true); }
    bool endTake() noexcept override { return push(false); }

    bool write(int t, const float* const* ch, int frames) noexcept override {
        if (failed_.load(std::memory_order_relaxed) != Ok || t < 0 || t >= n_ || frames <= 0) return false;
        Ring& r = rings_[t];
        const uint64_t w = r.w.load(std::memory_order_relaxed), rd = r.r.load(std::memory_order_acquire);
        if (w + (uint64_t)frames - rd > kRingFrames) {
            failed_.store(Overrun);
            return false;
        }
        for (int c = 0; c < r.channels; ++c) {
            const uint32_t at = (uint32_t)(w & kRingMask), first = std::min<uint32_t>((uint32_t)frames, kRingFrames - at);
            std::memcpy(&r.data[c][at], ch[c], first * sizeof(float));
            if ((uint32_t)frames > first) std::memcpy(&r.data[c][0], ch[c] + first, ((uint32_t)frames - first) * sizeof(float));
        }
        r.w.store(w + (uint64_t)frames, std::memory_order_release);
        return true;
    }

    Status status() const override {
        Status s;
        s.takeOpen = takeOpen_.load();
        s.take = take_.load();
        s.frames = frames_.load();
        const int code = failed_.load();
        s.failed = code != Ok;
        if (code == Overrun) s.message = "The disk could not keep up. The take was cut short.";
        else if (code == TooBig) s.message = "A file reached 4 GB, the limit of a WAV file. The take ended.";
        else if (code == CannotWrite) s.message = "Could not write to the Recordings folder.";
        std::lock_guard<std::mutex> l(textLock_);
        s.folder = folder_;
        return s;
    }

private:
    bool push(bool begin) noexcept {
        const uint32_t head = mHead_.load(std::memory_order_relaxed);
        if (head - mTail_.load(std::memory_order_acquire) >= kMarkers) return false;
        Marker& m = markers_[head % kMarkers];
        m.begin = begin;
        for (int t = 0; t < n_; ++t) m.pos[t] = rings_[t].w.load(std::memory_order_relaxed);
        mHead_.store(head + 1, std::memory_order_release);
        return true;
    }

    void run() {
        while (!stop_.load()) {
            pump();
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        pump();
        finishTake();
    }

    void pump() {
        for (;;) {
            const uint32_t tail = mTail_.load(std::memory_order_relaxed);
            if (tail == mHead_.load(std::memory_order_acquire)) break;
            const Marker& m = markers_[tail % kMarkers];
            if (m.begin) {
                if (takeOpen_.load()) {
                    for (int t = 0; t < n_; ++t) drainTo(t, m.pos[t]);
                    finishTake();
                }
                for (int t = 0; t < n_; ++t) rings_[t].r.store(m.pos[t], std::memory_order_release);  // nothing before a begin is audio
                if (failed_.load() == Ok) beginFiles(m);
            } else if (takeOpen_.load()) {
                for (int t = 0; t < n_; ++t) drainTo(t, m.pos[t]);
                finishTake();
            }
            mTail_.store(tail + 1, std::memory_order_release);
        }
        if (takeOpen_.load()) {
            for (int t = 0; t < n_; ++t) drainTo(t, rings_[t].w.load(std::memory_order_acquire));
            if (failed_.load() != Ok) finishTake();
        } else if (failed_.load() != Ok) {
            for (int t = 0; t < n_; ++t) rings_[t].r.store(rings_[t].w.load(std::memory_order_acquire), std::memory_order_release);
        }
    }

    void beginFiles(const Marker& m) {
        std::error_code ec;
        fs::create_directories(root_, ec);
        if (ec) {
            failed_.store(CannotWrite);
            return;
        }
        {
            std::lock_guard<std::mutex> l(textLock_);
            folder_ = root_.string();
        }
        const int take = take_.load() + 1;
        for (int t = 0; t < n_; ++t) {
            const std::string file = names_[(size_t)t] + (take > 1 ? " (take " + std::to_string(take) + ")" : std::string()) + ".wav";
            FILE* f = std::fopen((root_ / file).string().c_str(), "wb");
            if (!f) {
                failed_.store(CannotWrite);
                break;
            }
            std::setvbuf(f, nullptr, _IOFBF, 1 << 18);
            uint8_t h[44];
            wavHeader(h, rings_[t].channels, sr_, fmt_, 0);
            std::fwrite(h, 1, 44, f);
            files_[(size_t)t] = f;
            dataBytes_[(size_t)t] = 0;
        }
        takeStart_ = m.pos[0];
        frames_.store(0);
        take_.store(take);
        takeOpen_.store(true);
        if (failed_.load() != Ok) finishTake();
    }

    /// Writes the frames of track `t` up to absolute frame `pos` to its file.
    void drainTo(int t, uint64_t pos) {
        Ring& r = rings_[t];
        uint64_t rd = r.r.load(std::memory_order_relaxed);
        std::vector<uint8_t>& out = scratch_;
        const int bps = bytesPerSample(fmt_);
        while (rd < pos) {
            const int n = (int)std::min<uint64_t>(kChunkFrames, pos - rd);
            FILE* f = files_[(size_t)t];
            if (f && failed_.load() == Ok) {
                out.resize((size_t)n * (size_t)r.channels * (size_t)bps);
                uint8_t* p = out.data();
                for (int i = 0; i < n; ++i)
                    for (int c = 0; c < r.channels; ++c) {
                        const float x = std::clamp(r.data[c][(uint32_t)((rd + (uint64_t)i) & kRingMask)], -1.0f, 1.0f);
                        if (fmt_ == Format::Float32) {
                            std::memcpy(p, &x, 4);
                        } else if (fmt_ == Format::Pcm16) {
                            put16(p, (uint32_t)(uint16_t)(int16_t)std::lround(x * 32767.0f));
                        } else {
                            const int32_t v = (int32_t)std::lround(x * 8388607.0f);
                            p[0] = (uint8_t)v, p[1] = (uint8_t)(v >> 8), p[2] = (uint8_t)(v >> 16);
                        }
                        p += bps;
                    }
                if (std::fwrite(out.data(), 1, out.size(), f) != out.size()) failed_.store(CannotWrite);
                dataBytes_[(size_t)t] += out.size();
                if (dataBytes_[(size_t)t] > kMaxDataBytes) failed_.store(TooBig);
            }
            rd += (uint64_t)n;
            r.r.store(rd, std::memory_order_release);
            if (t == 0) frames_.store(rd - takeStart_);
        }
    }

    void finishTake() {
        for (int t = 0; t < n_; ++t) {
            FILE*& f = files_[(size_t)t];
            if (!f) continue;
            uint8_t h[44];
            wavHeader(h, rings_[t].channels, sr_, fmt_, dataBytes_[(size_t)t]);
            std::fseek(f, 0, SEEK_SET);
            std::fwrite(h, 1, 44, f);
            std::fclose(f);
            f = nullptr;
        }
        takeOpen_.store(false);
    }

    fs::path root_;
    double sr_;
    Format fmt_;
    int n_;
    std::unique_ptr<Ring[]> rings_;
    std::vector<std::string> names_;
    std::vector<FILE*> files_;            // writer thread
    std::vector<uint64_t> dataBytes_;     // writer thread
    std::vector<uint8_t> scratch_;        // writer thread
    uint64_t takeStart_ = 0;              // writer thread
    Marker markers_[kMarkers];
    std::atomic<uint32_t> mHead_{0}, mTail_{0};
    std::atomic<bool> stop_{false}, takeOpen_{false};
    std::atomic<int> failed_{Ok}, take_{0};
    std::atomic<uint64_t> frames_{0};
    mutable std::mutex textLock_;
    std::string folder_;
    std::thread writer_;
};

class DiskService final : public Service {
public:
    std::unique_ptr<Session> open(const std::string& name, const std::vector<TrackSpec>& tracks, double sampleRate, Format format,
                                  std::string* error) override {
        auto fail = [&](const char* why) -> std::unique_ptr<Session> {
            if (error) *error = why;
            return nullptr;
        };
        if (tracks.empty()) return fail("No track is armed.");
        if ((int)tracks.size() > kMaxTracks) return fail("Too many tracks.");
        for (const auto& t : tracks)
            if (t.channels < 1 || t.channels > 2) return fail("A track has one or two channels.");
        const std::string title = safeName(name.empty() ? std::string("Recording") : name);
        const fs::path root = fs::path(recording::folder()) / (stamp() + " " + title);
        return std::make_unique<DiskSession>(root, tracks, sampleRate, format);
    }
    double freeBytes() const override {
        std::error_code ec;
        fs::path p = recording::folder();
        while (!p.empty() && !fs::exists(p, ec)) {
            const fs::path up = p.parent_path();
            if (up == p) break;
            p = up;
        }
        const auto info = fs::space(p, ec);
        return ec ? 0.0 : std::max(0.0, (double)info.available - kReserveBytes);
    }
    std::string where() const override { return recording::folder(); }
};

}  // namespace

std::string folder() {
    std::lock_guard<std::mutex> l(g_lock);
    return g_folder.empty() ? defaultFolder() : g_folder;
}

void setFolder(const std::string& path) {
    std::lock_guard<std::mutex> l(g_lock);
    g_folder = path;
    g_chosen = true;
}

std::string defaultFolder() { return bleep::engine::recording::defaultFolder_(); }

// ---- the saved choice (Settings → Recordings) -----------------------------------------------------------------------------------

namespace {

fs::path dataDir() {
    if (const char* d = std::getenv("BLEEP_DATA_DIR"); d && *d) return fs::path(d);
#ifdef _WIN32
    const char* a = std::getenv("APPDATA");
    return (a ? fs::path(a) : fs::path(".")) / "Bleep";
#else
    const char* home = std::getenv("HOME");
    const fs::path h = home ? fs::path(home) : fs::path(".");
#ifdef __APPLE__
    return h / "Library" / "Application Support" / "Bleep";
#else
    return h / ".local" / "share" / "Bleep";
#endif
#endif
}

/// {"folder": "..."}: escapes only what JSON needs for a path.
std::string jsonOfFolder(const std::string& path) {
    std::string out = "{\"folder\":\"";
    for (unsigned char c : path) {
        if (c == '"' || c == '\\') out += std::string("\\") + (char)c;
        else if (c < 32) {
            static const char hex[] = "0123456789abcdef";
            out += std::string("\\u00") + hex[c >> 4] + hex[c & 15];
        } else out += (char)c;
    }
    return out + "\"}";
}

/// The "folder" of such a file; empty for anything else.
std::string folderOfJson(const std::string& text) {
    const size_t key = text.find("\"folder\"");
    if (key == std::string::npos) return {};
    size_t i = text.find('"', text.find(':', key));
    if (i == std::string::npos) return {};
    std::string out;
    for (++i; i < text.size() && text[i] != '"'; ++i) {
        if (text[i] != '\\') { out += text[i]; continue; }
        if (++i >= text.size()) break;
        if (text[i] == 'u' && i + 4 < text.size()) {
            out += (char)std::strtol(text.substr(i + 1, 4).c_str(), nullptr, 16);
            i += 4;
        } else out += text[i];
    }
    return out;
}

}  // namespace

std::string settingsFile() { return (dataDir() / "recordings.json").string(); }

void reloadSettings() {
    std::string saved;
    {
        std::ifstream in(settingsFile(), std::ios::binary);
        if (in) saved.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
    }
    const std::string path = folderOfJson(saved);
    setFolder(!path.empty() && fs::path(path).is_absolute() ? path : std::string());
}

bool saveFolder(const std::string& pathIn, std::string* error) {
    auto fail = [&](const std::string& why) {
        if (error) *error = why;
        return false;
    };
    std::string path = pathIn;
    while (!path.empty() && (path.back() == ' ' || path.back() == '\n')) path.pop_back();
    while (!path.empty() && (path.front() == ' ' || path.front() == '\n')) path.erase(path.begin());
    std::error_code ec;
    if (path.empty()) {
        setFolder({});
        fs::remove(settingsFile(), ec);
        return true;
    }
    const fs::path p(path);
    if (!p.is_absolute()) return fail("Enter the full path of a folder: it starts with / (or with a drive letter on Windows).");
    fs::create_directories(p, ec);
    if (ec || !fs::is_directory(p, ec)) return fail("That folder does not exist and could not be made: " + (ec ? ec.message() : std::string("it is a file")) + ".");
    const fs::path probe = p / ".bleep-write-test";
    {
        std::ofstream out(probe, std::ios::binary);
        if (!out || !(out << "x")) return fail("Bleep cannot write to that folder. Choose another one.");
    }
    fs::remove(probe, ec);
    setFolder(p.string());
    fs::create_directories(dataDir(), ec);
    std::ofstream out(settingsFile(), std::ios::binary);
    if (!out || !(out << jsonOfFolder(p.string()))) return fail("The folder is used now, but the choice could not be saved: it will be forgotten at the next start.");
    return true;
}

void ensureDiskService() {
    static DiskService disk;
    static std::once_flag once;
    std::call_once(once, [] {
        bool chosen;
        {
            std::lock_guard<std::mutex> l(g_lock);
            chosen = g_chosen;
        }
        if (!chosen) reloadSettings();   // what Settings → Recordings kept, unless this run already chose a folder
        if (!service()) service() = &disk;
    });
}

}  // namespace bleep::engine::recording

#else  // __wasm__

// ---- the client inside a wasm module: the Service calls become the bleep_record_* imports of the host (module-abi.md 5b) ----

extern "C" {
__attribute__((import_module("env"), import_name("bleep_record_open")))
int32_t bleep_record_open(const char* spec, int32_t length, double sampleRate, int32_t format);
__attribute__((import_module("env"), import_name("bleep_record_take")))
int32_t bleep_record_take(int32_t handle, int32_t begin);
__attribute__((import_module("env"), import_name("bleep_record_write")))
int32_t bleep_record_write(int32_t handle, int32_t track, const float* left, const float* right, int32_t frames);
__attribute__((import_module("env"), import_name("bleep_record_status")))
int32_t bleep_record_status(int32_t handle, int64_t* frames, int32_t* take);
__attribute__((import_module("env"), import_name("bleep_record_text")))
int32_t bleep_record_text(int32_t handle, int32_t what, char* dst, int32_t capacity);
__attribute__((import_module("env"), import_name("bleep_record_free")))
double bleep_record_free();
__attribute__((import_module("env"), import_name("bleep_record_close")))
void bleep_record_close(int32_t handle);
}

namespace bleep::engine::recording {
namespace {

std::string hostText(int32_t handle, int32_t what) {
    char buf[512];
    const int32_t n = bleep_record_text(handle, what, buf, (int32_t)sizeof buf);
    return n > 0 ? std::string(buf, (size_t)std::min<int32_t>(n, (int32_t)sizeof buf)) : std::string();
}

std::string jsonString(const std::string& in) {
    std::string out = "\"";
    for (unsigned char c : in) {
        if (c == '"' || c == '\\') out += std::string("\\") + (char)c;
        else if (c < 32) {
            static const char hex[] = "0123456789abcdef";
            out += std::string("\\u00") + hex[c >> 4] + hex[c & 15];
        } else out += (char)c;
    }
    return out + "\"";
}

class WasmSession final : public Session {
public:
    WasmSession(int32_t handle, std::vector<int> channels) : handle_(handle), channels_(std::move(channels)) {}
    ~WasmSession() override { bleep_record_close(handle_); }

    bool beginTake() noexcept override { return bleep_record_take(handle_, 1) != 0; }
    bool endTake() noexcept override { return bleep_record_take(handle_, 0) != 0; }
    bool write(int track, const float* const* ch, int frames) noexcept override {
        if (track < 0 || track >= (int)channels_.size()) return false;
        return bleep_record_write(handle_, track, ch[0], channels_[(size_t)track] == 2 ? ch[1] : ch[0], frames) != 0;
    }
    Status status() const override {
        Status s;
        int64_t frames = 0;
        int32_t take = 0;
        const int32_t flags = bleep_record_status(handle_, &frames, &take);
        s.takeOpen = (flags & 1) != 0;
        s.failed = (flags & 2) != 0;
        s.frames = (uint64_t)std::max<int64_t>(frames, 0);
        s.take = take;
        if (s.failed) s.message = hostText(handle_, 1);
        s.folder = hostText(handle_, 2);
        return s;
    }

private:
    int32_t handle_;
    std::vector<int> channels_;
};

class WasmService final : public Service {
public:
    std::unique_ptr<Session> open(const std::string& name, const std::vector<TrackSpec>& tracks, double sampleRate, Format format,
                                  std::string* error) override {
        std::string spec = "{\"name\":" + jsonString(name) + ",\"tracks\":[";
        std::vector<int> channels;
        for (size_t i = 0; i < tracks.size(); ++i) {
            spec += (i ? "," : "") + std::string("{\"name\":") + jsonString(tracks[i].name) + ",\"channels\":" + std::to_string(tracks[i].channels) + "}";
            channels.push_back(tracks[i].channels);
        }
        spec += "]}";
        const int32_t h = bleep_record_open(spec.data(), (int32_t)spec.size(), sampleRate, format == Format::Pcm16 ? 0 : format == Format::Pcm24 ? 1 : 2);
        if (h <= 0) {
            if (error) *error = h == 0 ? "Recording is not available here." : hostText(0, 1);
            if (error && error->empty()) *error = "Recording could not start.";
            return nullptr;
        }
        return std::make_unique<WasmSession>(h, std::move(channels));
    }
    double freeBytes() const override { return bleep_record_free(); }
    std::string where() const override { return hostText(0, 0); }
};

}  // namespace

Service* wasmService() {
    static WasmService service;
    return &service;
}

}  // namespace bleep::engine::recording

#endif  // __wasm__
