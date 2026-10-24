// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
// The Audio Console's recorder on the real module: Record from the message thread while another thread runs the
// audio, one file per armed track, manual and follow-transport takes, the tap choice (doc/specs/modules/audio-console.md §8).
#include "Module.h"
#include "Recording.h"
#include "Registry.h"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <thread>
#include <vector>

using namespace bleep::engine;
namespace fs = std::filesystem;

static int failures = 0;
#define CHECK(cond, ...)                                              \
    do {                                                              \
        if (!(cond)) {                                                \
            ++failures;                                               \
            std::printf("  FAIL line %d: ", __LINE__);                \
            std::printf(__VA_ARGS__);                                 \
            std::printf("\n");                                        \
        }                                                             \
    } while (0)

/// The module with its buffers, and a thread that runs it the way the engine does: chunks of 32 samples.
struct Rig {
    const ModuleSpec* spec = nullptr;
    std::unique_ptr<Module> mod;
    std::vector<std::vector<float>> paramBuf, inBuf, outBuf;
    std::vector<const float*> params, inputs;
    std::vector<float*> outputs;
    std::vector<char> connected, outConnected;
    std::atomic<bool> run{false}, playing{true};
    std::thread audio;
    Transport transport;
    uint64_t pos = 0;

    Rig() {
        spec = Registry::get().find("audio-console");
        mod = Registry::get().create("audio-console");
        mod->prepare(48000.0);
        paramBuf.assign(spec->params.size(), std::vector<float>(kChunk, 0.0f));
        for (size_t i = 0; i < spec->params.size(); ++i) set(spec->params[i].id, spec->params[i].def);
        inBuf.assign(spec->inputs.size(), std::vector<float>(kChunk, 0.0f));
        outBuf.assign(spec->outputs.size(), std::vector<float>(kChunk, 0.0f));
        for (auto& b : paramBuf) params.push_back(b.data());
        for (auto& b : inBuf) inputs.push_back(b.data());
        for (auto& b : outBuf) outputs.push_back(b.data());
        connected.assign(spec->inputs.size(), 0);
        outConnected.assign(spec->outputs.size(), 1);
        connected[0] = 1;
    }
    ~Rig() { stop(); }

    void set(const std::string& id, float units) {
        const int i = spec->paramIndex(id);
        const float n = spec->params[(size_t)i].toNormalised(units);
        mod->setKnob(i, n);
        std::fill(paramBuf[(size_t)i].begin(), paramBuf[(size_t)i].end(), n);
    }

    void start() {
        run = true;
        audio = std::thread([this] {
            while (run) {
                for (int i = 0; i < kChunk; ++i) inBuf[0][(size_t)i] = 0.5f * (float)std::sin(2.0 * 3.14159265358979 * 440.0 * (double)(pos + (uint64_t)i) / 48000.0);
                transport.playing = playing.load();
                ProcessContext c;
                c.numSamples = kChunk;
                c.transport = &transport;
                c.params = params.data();
                c.inputs = inputs.data();
                c.inputConnected = reinterpret_cast<const bool*>(connected.data());
                c.outputs = outputs.data();
                c.outputConnected = reinterpret_cast<const bool*>(outConnected.data());
                if (mod->tryEnter()) {
                    mod->process(c);
                    mod->leave();
                }
                pos += kChunk;
                std::this_thread::sleep_for(std::chrono::microseconds(200));  // faster than real time, slow enough to be gentle
            }
        });
    }
    void stop() {
        run = false;
        if (audio.joinable()) audio.join();
    }
};

struct Wav {
    bool ok = false;
    int channels = 0, bits = 0;
    size_t frames = 0;
    std::vector<uint8_t> data;
    double sample(size_t f, int ch) const {
        const size_t at = (f * (size_t)channels + (size_t)ch) * (size_t)(bits / 8);
        if (bits == 24) {
            int32_t v = data[at] | data[at + 1] << 8 | data[at + 2] << 16;
            if (v & 0x800000) v |= ~0xFFFFFF;
            return v / 8388607.0;
        }
        float x;
        std::memcpy(&x, &data[at], 4);
        return x;
    }
};
static Wav readWav(const fs::path& p) {
    Wav w;
    std::ifstream in(p, std::ios::binary);
    std::vector<uint8_t> b((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (b.size() < 44 || std::memcmp(b.data(), "RIFF", 4)) return w;
    w.channels = b[22] | b[23] << 8;
    w.bits = b[34] | b[35] << 8;
    w.data.assign(b.begin() + 44, b.end());
    w.frames = w.channels && w.bits ? w.data.size() / (size_t)(w.channels * w.bits / 8) : 0;
    w.ok = true;
    return w;
}
static fs::path freshRoot(const char* name) {
    const fs::path root = fs::temp_directory_path() / (std::string("bleep-console-test-") + name);
    fs::remove_all(root);
    recording::setFolder(root.string());
    return root;
}
static fs::path sessionDir(const fs::path& root) {
    for (const auto& e : fs::directory_iterator(root))
        if (e.is_directory()) return e.path();
    return {};
}
static void sleepMs(int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }

/// Stops a recording the way the view does: the button, then the engine's polling lets the stopped session finish.
static void stopRecording(Rig& r) {
    r.mod->command("record", 1.0f);
    sleepMs(100);  // the audio thread ends the take and lets go of the session at its next block
    std::string unused;
    r.mod->takeData(unused);  // finishes the files
}

static void manualRecording() {
    std::printf("manual: one file per armed track, named after the channel, holding what came in\n");
    const fs::path root = freshRoot("manual");
    Rig r;
    r.set("ch1_arm", 1.0f);
    r.set("ch2_arm", 1.0f);
    r.set("ch2_stereo", 1.0f);
    r.set("master_arm", 1.0f);
    r.set("recformat", 2.0f);  // 32-bit float
    r.start();
    sleepMs(50);
    r.mod->command("record", 1.0f);
    sleepMs(400);
    stopRecording(r);
    r.stop();
    const fs::path dir = sessionDir(root);
    CHECK(!dir.empty(), "no session folder was made");
    const Wav ch1 = readWav(dir / "Ch 1.wav"), ch2 = readWav(dir / "Ch 2.wav"), master = readWav(dir / "Master.wav");
    CHECK(ch1.ok && ch2.ok && master.ok, "a file is missing");
    CHECK(ch1.channels == 1 && ch2.channels == 2 && master.channels == 2, "channel counts %d %d %d", ch1.channels, ch2.channels, master.channels);
    CHECK(ch1.frames > 4800 && ch1.frames == ch2.frames && ch1.frames == master.frames, "frames %zu %zu %zu", ch1.frames, ch2.frames, master.frames);
    // The channel 1 tap is the input: a 440 Hz sine of 0.5 that starts at an unknown chunk. Check its shape instead of its phase.
    double peak = 0.0, rmsM = 0.0;
    for (size_t i = 0; i < ch1.frames; ++i) peak = std::max(peak, std::fabs(ch1.sample(i, 0)));
    for (size_t i = 0; i < master.frames; ++i) rmsM += master.sample(i, 0) * master.sample(i, 0);
    rmsM = std::sqrt(rmsM / (double)std::max<size_t>(1, master.frames));
    CHECK(std::fabs(peak - 0.5) < 0.01, "channel 1 peak %f, expected the input's 0.5", peak);
    CHECK(rmsM > 0.2, "the master file is silent (rms %f)", rmsM);
    CHECK(r.mod->takeRunaways() == 0, "runaway");
}

static void followTransport() {
    std::printf("follow transport: each play to stop is a take\n");
    const fs::path root = freshRoot("follow");
    Rig r;
    r.set("ch1_arm", 1.0f);
    r.set("master_arm", 0.0f);
    r.set("recmode", 1.0f);
    r.set("recformat", 2.0f);
    r.playing = false;
    r.start();
    sleepMs(30);
    r.mod->command("record", 1.0f);  // live, waiting for the transport
    sleepMs(100);
    r.playing = true;
    sleepMs(150);
    r.playing = false;
    sleepMs(100);
    r.playing = true;
    sleepMs(150);
    r.playing = false;
    sleepMs(50);
    stopRecording(r);
    r.stop();
    const fs::path dir = sessionDir(root);
    const Wav a = readWav(dir / "Ch 1.wav"), b = readWav(dir / "Ch 1 (take 2).wav");
    CHECK(a.ok && b.ok, "two takes expected");
    CHECK(a.frames > 1000 && b.frames > 1000, "take lengths %zu %zu", a.frames, b.frames);
    CHECK(a.frames % kChunk == 0 && b.frames % kChunk == 0, "takes should end on a chunk: %zu %zu", a.frames, b.frames);
    CHECK(!fs::exists(dir / "Ch 1 (take 3).wav"), "a third take appeared");
}

static void tapAfterFader() {
    std::printf("the post-fader tap records what the fader left\n");
    const fs::path root = freshRoot("tap");
    Rig r;
    r.set("ch1_arm", 1.0f);
    r.set("master_arm", 0.0f);
    r.set("rectap", 1.0f);
    r.set("recformat", 2.0f);
    r.set("ch1_level", -20.0f);
    r.start();
    sleepMs(100);  // let the fader settle
    r.mod->command("record", 1.0f);
    sleepMs(300);
    stopRecording(r);
    r.stop();
    const Wav w = readWav(sessionDir(root) / "Ch 1.wav");
    double peak = 0.0;
    for (size_t i = 0; i < w.frames; ++i) peak = std::max(peak, std::fabs(w.sample(i, 0)));
    CHECK(w.ok && std::fabs(peak - 0.05) < 0.005, "post-fader peak %f, expected 0.05", peak);
}

static void nothingArmedIsRefused() {
    std::printf("recording with nothing armed says so and does not start\n");
    const fs::path root = freshRoot("none");
    Rig r;
    r.set("master_arm", 0.0f);
    r.start();
    r.mod->command("record", 1.0f);
    sleepMs(50);
    std::vector<std::pair<std::string, double>> v;
    r.mod->liveValues(v);
    double state = -1;
    for (auto& p : v) if (p.first == "recState") state = p.second;
    r.stop();
    CHECK(state == 0.0, "recState %f", state);
    CHECK(!fs::exists(root) || sessionDir(root).empty(), "files were made");
}

int main() {
    manualRecording();
    followTransport();
    tapAfterFader();
    nothingArmedIsRefused();
    std::printf("audio console recording: %d failures\n", failures);
    return failures == 0 ? 0 : 1;
}
