// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// The recorder service (engine/Recording.h): files per track, takes, the three sample formats, safe names,
// a take that ends where the audio thread ended it, and a session that fails instead of blocking.
#include "Recording.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <chrono>
#include <thread>
#include <tuple>
#include <vector>

using namespace bleep;
namespace rec = bleep::engine::recording;
namespace fs = std::filesystem;

struct Wav {
    bool ok = false;
    int channels = 0, bits = 0, tag = 0;
    uint32_t rate = 0, dataBytes = 0;
    std::vector<uint8_t> data;
    size_t frames() const { return channels && bits ? data.size() / (size_t)(channels * bits / 8) : 0; }
    double sample(size_t frame, int ch) const {
        const size_t at = (frame * (size_t)channels + (size_t)ch) * (size_t)(bits / 8);
        if (bits == 16) return (int16_t)(data[at] | data[at + 1] << 8) / 32767.0;
        if (bits == 24) {
            int32_t v = data[at] | data[at + 1] << 8 | data[at + 2] << 16;
            if (v & 0x800000) v |= ~0xFFFFFF;
            return v / 8388607.0;
        }
        float f;
        std::memcpy(&f, &data[at], 4);
        return f;
    }
};

static Wav readWav(const fs::path& p) {
    Wav w;
    std::ifstream in(p, std::ios::binary);
    std::vector<uint8_t> b((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (b.size() < 44 || std::memcmp(b.data(), "RIFF", 4) || std::memcmp(&b[8], "WAVEfmt ", 8)) return w;
    auto u16 = [&](size_t o) { return (uint32_t)(b[o] | b[o + 1] << 8); };
    auto u32 = [&](size_t o) { return u16(o) | u16(o + 2) << 16; };
    w.tag = (int)u16(20);
    w.channels = (int)u16(22);
    w.rate = u32(24);
    w.bits = (int)u16(34);
    w.dataBytes = u32(40);
    w.data.assign(b.begin() + 44, b.end());
    w.ok = std::memcmp(&b[36], "data", 4) == 0 && w.dataBytes == w.data.size() && u32(4) == 36 + w.dataBytes;
    return w;
}

static fs::path sessionDir(const fs::path& root) {
    for (const auto& e : fs::directory_iterator(root))
        if (e.is_directory()) return e.path();
    return {};
}

static fs::path freshRoot(const char* name) {
    const fs::path root = fs::temp_directory_path() / (std::string("bleep-recording-test-") + name);
    fs::remove_all(root);
    rec::setFolder(root.string());
    return root;
}

static void writeRamp(rec::Session& s, int track, int channels, int frames, float scale) {
    std::vector<float> l((size_t)frames), r((size_t)frames);
    for (int i = 0; i < frames; ++i) l[(size_t)i] = scale * (float)i / (float)frames, r[(size_t)i] = -l[(size_t)i];
    const float* ch[2] = {l.data(), r.data()};
    (void)channels;
    s.write(track, ch, frames);
}

static void waitDone(rec::Session& s) {
    for (int i = 0; i < 500 && s.status().takeOpen; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(2));
}

static void formats() {
    TEST("one file per track in every format, with the right header and the samples that were written");
    rec::ensureDiskService();
    for (auto [format, bits, tag, tol] : {std::tuple{rec::Format::Pcm16, 16, 1, 1e-4}, {rec::Format::Pcm24, 24, 1, 1e-6}, {rec::Format::Float32, 32, 3, 0.0}}) {
        const fs::path root = freshRoot("formats");
        std::string error;
        auto s = rec::service()->open("Test", {{"Kick", 1}, {"Keys/Pad: 1", 2}}, 48000.0, format, &error);
        EXPECT(s != nullptr);
        s->beginTake();
        writeRamp(*s, 0, 1, 1000, 0.5f);
        writeRamp(*s, 1, 2, 1000, 0.5f);
        writeRamp(*s, 0, 1, 500, 0.5f);
        writeRamp(*s, 1, 2, 500, 0.5f);
        s->endTake();
        s.reset();
        const fs::path dir = sessionDir(root);
        const Wav kick = readWav(dir / "Kick.wav"), keys = readWav(dir / "Keys-Pad- 1.wav");
        EXPECT(kick.ok && keys.ok);
        EXPECT(kick.channels == 1 && keys.channels == 2 && kick.bits == bits && kick.tag == tag && kick.rate == 48000);
        EXPECT(kick.frames() == 1500 && keys.frames() == 1500);
        EXPECT_NEAR(kick.sample(500, 0), 0.25, tol + 1e-4);
        EXPECT_NEAR(keys.sample(500, 1), -0.25, tol + 1e-4);
    }
}

static void takes() {
    TEST("each take is its own set of files; the second one is numbered");
    const fs::path root = freshRoot("takes");
    auto s = rec::service()->open("Takes", {{"A", 1}}, 48000.0, rec::Format::Pcm16, nullptr);
    s->beginTake();
    writeRamp(*s, 0, 1, 800, 0.4f);
    s->endTake();
    s->beginTake();
    writeRamp(*s, 0, 1, 300, 0.4f);
    s->endTake();
    s.reset();
    const fs::path dir = sessionDir(root);
    const Wav a = readWav(dir / "A.wav"), b = readWav(dir / "A (take 2).wav");
    EXPECT(a.ok && b.ok && a.frames() == 800 && b.frames() == 300);
}

static void takeEndsWhereTheAudioThreadEnded() {
    TEST("a quick stop-start does not mix the takes, however far behind the writer is");
    const fs::path root = freshRoot("quick");
    auto s = rec::service()->open("Quick", {{"A", 1}}, 48000.0, rec::Format::Float32, nullptr);
    for (int take = 0; take < 5; ++take) {
        s->beginTake();
        writeRamp(*s, 0, 1, 100 + take, 1.0f);
        s->endTake();
    }
    s.reset();
    const fs::path dir = sessionDir(root);
    bool ok = true;
    for (int take = 0; take < 5; ++take) {
        const Wav w = readWav(dir / (take == 0 ? std::string("A.wav") : "A (take " + std::to_string(take + 1) + ").wav"));
        ok = ok && w.ok && w.frames() == (size_t)(100 + take);
    }
    EXPECT(ok);
}

static void unfinishedTakeIsFinishedOnClose() {
    TEST("closing a session in the middle of a take still leaves valid files");
    const fs::path root = freshRoot("close");
    auto s = rec::service()->open("Close", {{"A", 2}}, 44100.0, rec::Format::Pcm24, nullptr);
    s->beginTake();
    writeRamp(*s, 0, 2, 2000, 0.3f);
    s.reset();
    const Wav w = readWav(sessionDir(root) / "A.wav");
    EXPECT(w.ok && w.frames() == 2000 && w.rate == 44100);
}

static void tooSlowFails() {
    TEST("a writer that falls behind marks the session failed instead of blocking");
    const fs::path root = freshRoot("slow");
    auto s = rec::service()->open("Slow", {{"A", 1}}, 48000.0, rec::Format::Pcm16, nullptr);
    s->beginTake();
    std::vector<float> block(4096, 0.1f);
    const float* ch[1] = {block.data()};
    bool refused = false;
    for (int i = 0; i < 100000 && !refused; ++i) refused = !s->write(0, ch, 4096);  // far faster than any disk
    EXPECT(refused);
    EXPECT(s->status().failed);
    EXPECT(!s->status().message.empty());
}

static void refusals() {
    TEST("no tracks and too many tracks are refused with a reason");
    std::string error;
    EXPECT(rec::service()->open("x", {}, 48000.0, rec::Format::Pcm16, &error) == nullptr && !error.empty());
    std::vector<rec::TrackSpec> many((size_t)rec::kMaxTracks + 1, rec::TrackSpec{"t", 1});
    error.clear();
    EXPECT(rec::service()->open("x", many, 48000.0, rec::Format::Pcm16, &error) == nullptr && !error.empty());
    EXPECT(rec::service()->freeBytes() > 0.0);
}

static void mp3() {
    TEST("MP3: a take is a valid .mp3 file of the right size that decodes to what was recorded, or the build says it cannot");
    std::string error;
    if (!rec::mp3Available()) {
        const fs::path root = freshRoot("mp3-none");
        EXPECT(rec::service()->open("x", {{"A", 1}}, 48000.0, rec::Format::Mp3_192, &error) == nullptr && error.find("MP3") != std::string::npos);
        return;
    }
    const fs::path root = freshRoot("mp3");
    auto s = rec::service()->open("Mp3", {{"A", 1}, {"B", 2}}, 48000.0, rec::Format::Mp3_192, &error);
    EXPECT(s != nullptr);
    if (!s) return;
    const int seconds = 3, total = seconds * 48000;
    s->beginTake();
    for (int at = 0; at < total; at += 1024) {
        const int n = std::min(1024, total - at);
        std::vector<float> l((size_t)n), r((size_t)n);
        for (int i = 0; i < n; ++i) l[(size_t)i] = 0.5f * (float)std::sin(2.0 * 3.14159265358979 * 1000.0 * (at + i) / 48000.0), r[(size_t)i] = -l[(size_t)i];
        const float* ch[2] = {l.data(), r.data()};
        EXPECT(s->write(0, ch, n) && s->write(1, ch, n));
        std::this_thread::sleep_for(std::chrono::milliseconds(4));   // a full buffer would fail the session (by design): stay ahead of the writer
    }
    s->endTake();
    s.reset();
    const fs::path dir = sessionDir(root);
    const fs::path a = dir / "A.mp3", b = dir / "B.mp3";
    EXPECT(fs::exists(a) && fs::exists(b) && !fs::exists(dir / "A.wav"));
    const double expected = seconds * 24000.0;   // 192 kbps, a track of one or two channels
    EXPECT(std::fabs((double)fs::file_size(a) - expected) < expected * 0.1);
    EXPECT(std::fabs((double)fs::file_size(b) - expected) < expected * 0.1);
    {
        std::ifstream in(a, std::ios::binary);
        unsigned char h[2] = {};
        in.read(reinterpret_cast<char*>(h), 2);
        EXPECT(h[0] == 0xFF && (h[1] & 0xE0) == 0xE0);   // a frame sync
    }
    if (std::system("which lame > /dev/null 2>&1") == 0) {   // the lame tool can decode what the library encoded
        const fs::path wav = dir / "decoded.wav";
        EXPECT(std::system(("lame --decode --silent \"" + b.string() + "\" \"" + wav.string() + "\"").c_str()) == 0);
        const Wav d = readWav(wav);
        EXPECT(d.ok && d.channels == 2 && d.rate == 48000);
        EXPECT(d.frames() > (size_t)(seconds * 48000 - 4000) && d.frames() < (size_t)(seconds * 48000 + 4000));
        double peakL = 0.0, peakR = 0.0;
        for (size_t i = 24000; i < d.frames(); ++i) peakL = std::max(peakL, std::fabs(d.sample(i, 0))), peakR = std::max(peakR, std::fabs(d.sample(i, 1)));
        EXPECT(std::fabs(peakL - 0.5) < 0.06 && std::fabs(peakR - 0.5) < 0.06);   // MP3 is lossy, not that lossy
    }
}

static void settingsChoice() {
    TEST("the Recordings folder chosen in Settings is checked, applied and kept for the next start");
    std::string error;
    EXPECT(!rec::saveFolder("relative/folder", &error) && error.find("full path") != std::string::npos);
    const fs::path chosen = fs::temp_directory_path() / "bleep-recording-test-chosen" / "my takes";
    fs::remove_all(chosen.parent_path());
    EXPECT(rec::saveFolder(chosen.string(), &error));
    EXPECT(rec::folder() == chosen.string());
    EXPECT(fs::is_directory(chosen));
    EXPECT(!fs::exists(chosen / ".bleep-write-test"));
    EXPECT(fs::exists(rec::settingsFile()));
    rec::setFolder("");                         // a new start forgets the run's value ...
    EXPECT(rec::folder() == rec::defaultFolder());
    rec::reloadSettings();                      // ... and reads the saved one
    EXPECT(rec::folder() == chosen.string());
    // a path with characters JSON must escape survives the trip
    const fs::path odd = fs::temp_directory_path() / "bleep-recording-test-chosen" / "a \"quoted\" folder";
    EXPECT(rec::saveFolder(odd.string(), &error));
    rec::setFolder("");
    rec::reloadSettings();
    EXPECT(rec::folder() == odd.string());
    // a file is not a folder
    const fs::path file = chosen.parent_path() / "afile";
    { std::ofstream(file) << "x"; }
    EXPECT(!rec::saveFolder(file.string(), &error) && !error.empty());
    EXPECT(rec::folder() == odd.string());      // a refused choice changes nothing
    // sessions go to the chosen folder
    auto s = rec::service()->open("Chosen", {{"A", 1}}, 48000.0, rec::Format::Pcm16, nullptr);
    s->beginTake();
    writeRamp(*s, 0, 1, 100, 0.2f);
    s->endTake();
    s.reset();
    EXPECT(!sessionDir(odd).empty());
    // an empty path is the default again, and the saved choice is gone
    EXPECT(rec::saveFolder("", &error));
    EXPECT(rec::folder() == rec::defaultFolder() && !fs::exists(rec::settingsFile()));
    fs::remove_all(chosen.parent_path());
}

int main() {
    const fs::path dataDir = fs::temp_directory_path() / "bleep-recording-test-data";
    fs::remove_all(dataDir);
#ifdef _WIN32
    _putenv_s("BLEEP_DATA_DIR", dataDir.string().c_str());
#else
    setenv("BLEEP_DATA_DIR", dataDir.string().c_str(), 1);
#endif
    rec::ensureDiskService();
    formats();
    takes();
    takeEndsWhereTheAudioThreadEnded();
    unfinishedTakeIsFinishedOnClose();
    tooSlowFails();
    refusals();
    mp3();
    settingsChoice();
    fs::remove_all(dataDir);
    return test::finish("recording");
}
