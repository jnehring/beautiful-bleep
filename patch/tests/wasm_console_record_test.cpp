// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// The Audio Console as a real .wasm file, recording through the host's bleep_record_* imports and the disk service. In the wasm
// host the whole module, button presses and status polls included, runs on the audio thread: this drives it that way.
//
//   bleep_wasm_console_record_test <audio-console.wasm>      (scripts/build/build-web.sh --modules-only)
#include "wasm/SpecJson.h"
#include "wasm/WasmModule.h"
#include "Recording.h"

#include <juce_core/juce_core.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <thread>

using namespace bleep::engine;
namespace fs = std::filesystem;

static int failures = 0;
#define CHECK(cond, ...)                                       \
    do {                                                       \
        if (!(cond)) {                                         \
            ++failures;                                        \
            std::printf("  FAIL line %d: ", __LINE__);         \
            std::printf(__VA_ARGS__);                          \
            std::printf("\n");                                 \
        }                                                      \
    } while (0)

struct Rig {
    const ModuleSpec& spec;
    std::unique_ptr<WasmModule> module;
    std::vector<std::vector<float>> params, inputs, outputs;
    std::vector<const float*> paramPtrs, inputPtrs;
    std::vector<float*> outputPtrs;
    std::vector<NoteBuffer> notesIn, notesOut;
    std::vector<const NoteBuffer*> notesInPtrs;
    std::vector<NoteBuffer*> notesOutPtrs;
    std::unique_ptr<bool[]> inConnected, outConnected;
    Transport transport;
    uint64_t pos = 0;

    Rig(const ModuleSpec& s, std::shared_ptr<WasmPackage> package) : spec(s), module(std::make_unique<WasmModule>(s, std::move(package))) {
        const size_t np = s.params.size(), ni = s.inputs.size(), no = s.outputs.size();
        params.assign(np, std::vector<float>(kChunk));
        inputs.assign(ni, std::vector<float>(kChunk, 0.0f));
        outputs.assign(no, std::vector<float>(kChunk, 0.0f));
        notesIn.resize(ni);
        notesOut.resize(no);
        inConnected.reset(new bool[ni + 1]());
        outConnected.reset(new bool[no + 1]());
        for (size_t i = 0; i < np; ++i) paramPtrs.push_back(params[i].data());
        for (size_t i = 0; i < np; ++i) set(s.params[i].id, s.params[i].def);
        for (size_t i = 0; i < ni; ++i) {
            inputPtrs.push_back(inputs[i].data());
            notesInPtrs.push_back(nullptr);
        }
        for (size_t j = 0; j < no; ++j) {
            outputPtrs.push_back(outputs[j].data());
            notesOutPtrs.push_back(nullptr);
            outConnected[j] = true;
        }
        inConnected[0] = true;
        transport.sampleRate = 48000.0;
        transport.ppqValid = true;
        transport.playing = true;
        module->prepare(48000.0);
        module->reset();
    }
    void set(const std::string& id, float value) {
        const int i = spec.paramIndex(id);
        const float n = spec.params[(size_t)i].toNormalised(value);
        module->setKnob(i, n);
        std::fill(params[(size_t)i].begin(), params[(size_t)i].end(), n);
    }
    void run(int chunks) {
        for (int k = 0; k < chunks; ++k) {
            for (int i = 0; i < kChunk; ++i) inputs[0][(size_t)i] = 0.5f * (float)std::sin(2.0 * 3.14159265358979 * 440.0 * (double)(pos + (uint64_t)i) / 48000.0);
            pos += kChunk;
            ProcessContext c;
            c.numSamples = kChunk;
            c.transport = &transport;
            c.params = paramPtrs.data();
            c.inputs = inputPtrs.data();
            c.inputConnected = inConnected.get();
            c.notesIn = notesInPtrs.data();
            c.outputs = outputPtrs.data();
            c.notesOut = notesOutPtrs.data();
            c.outputConnected = outConnected.get();
            module->process(c);
        }
    }
    /// What the engine and the view do: poll for live values and node data while the audio runs.
    void poll() {
        std::vector<std::pair<std::string, double>> v;
        module->liveValues(v);
        std::string d;
        module->takeData(d);
    }
    double live(const char* key) {
        std::vector<std::pair<std::string, double>> v;
        module->liveValues(v);
        for (auto& p : v) if (p.first == key) return p.second;
        return -1.0;
    }
};

struct Wav {
    bool ok = false;
    int channels = 0, bits = 0;
    size_t frames = 0;
    std::vector<uint8_t> data;
    double sample(size_t f, int ch) const {
        float x;
        std::memcpy(&x, &data[(f * (size_t)channels + (size_t)ch) * 4], 4);
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
    w.ok = w.bits == 32;
    return w;
}
static fs::path freshRoot(const char* name) {
    const fs::path root = fs::temp_directory_path() / (std::string("bleep-wasm-console-") + name);
    fs::remove_all(root);
    recording::setFolder(root.string());
    return root;
}
/// The session's folder, once close() has finished its files on the background thread (a file of `file` exists with a patched header).
static fs::path finishedDir(const fs::path& root, const char* file) {
    for (int i = 0; i < 500; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        if (!fs::exists(root)) continue;
        for (const auto& e : fs::directory_iterator(root)) {
            const fs::path f = e.path() / file;
            if (!fs::exists(f)) continue;
            std::ifstream in(f, std::ios::binary);
            uint8_t h[44] = {};
            in.read(reinterpret_cast<char*>(h), 44);
            const uint32_t size = h[40] | h[41] << 8 | h[42] << 16 | (uint32_t)h[43] << 24;
            if (size > 0 && size == fs::file_size(f) - 44) return e.path();
        }
    }
    return {};
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::fprintf(stderr, "usage: bleep_wasm_console_record_test audio-console.wasm\n");
        return 2;
    }
    juce::MemoryBlock block;
    if (!juce::File::getCurrentWorkingDirectory().getChildFile(argv[1]).loadFileAsData(block)) {
        std::fprintf(stderr, "cannot read %s\n", argv[1]);
        return 2;
    }
    std::string error;
    auto package = WasmPackage::load((const uint8_t*)block.getData(), block.getSize(), error);
    if (!package) {
        std::fprintf(stderr, "cannot load: %s\n", error.c_str());
        return 2;
    }
    ModuleSpec spec;
    const juce::var all = juce::JSON::parse(juce::String(package->specJson));
    if (!specFromJson(all[0], spec, error)) {
        std::fprintf(stderr, "cannot read the spec: %s\n", error.c_str());
        return 2;
    }

    std::printf("manual: pressing Record in the wasm module writes one file per armed track\n");
    {
        const fs::path root = freshRoot("manual");
        Rig r(spec, package);
        CHECK(r.module->ok(), "the module did not start: %s", r.module->error().c_str());
        r.set("ch1_arm", 1.0f);
        r.set("ch2_arm", 1.0f);
        r.set("ch2_stereo", 1.0f);
        r.set("master_arm", 1.0f);
        r.set("recformat", 2.0f);
        r.run(70);
        r.poll();
        r.run(70);
        CHECK(r.live("recAvailable") == 1.0, "recording should be available (recAvailable %f)", r.live("recAvailable"));
        r.module->command("record", 1.0f);
        r.run(5);  // the command is delivered on the audio thread
        r.run(300);
        r.poll();
        r.run(70);
        CHECK(r.live("recState") == 2.0, "recState while recording: %f", r.live("recState"));
        r.module->command("record", 1.0f);
        for (int i = 0; i < 4; ++i) { r.run(70); r.poll(); }
        CHECK(r.live("recState") == 0.0, "recState after stop: %f", r.live("recState"));
        const fs::path dir = finishedDir(root, "Master.wav");
        CHECK(!dir.empty(), "the files were not finished");
        if (!dir.empty()) {
            const Wav ch1 = readWav(dir / "Ch 1.wav"), ch2 = readWav(dir / "Ch 2.wav"), master = readWav(dir / "Master.wav");
            CHECK(ch1.ok && ch2.ok && master.ok, "a file is missing");
            CHECK(ch1.channels == 1 && ch2.channels == 2 && master.channels == 2, "channels %d %d %d", ch1.channels, ch2.channels, master.channels);
            CHECK(ch1.frames >= 9600 && ch1.frames == ch2.frames && ch1.frames == master.frames, "frames %zu %zu %zu", ch1.frames, ch2.frames, master.frames);
            double peak = 0.0, rms = 0.0;
            for (size_t i = 0; i < ch1.frames; ++i) peak = std::max(peak, std::fabs(ch1.sample(i, 0)));
            for (size_t i = 0; i < master.frames; ++i) rms += master.sample(i, 0) * master.sample(i, 0);
            rms = std::sqrt(rms / (double)std::max<size_t>(1, master.frames));
            CHECK(std::fabs(peak - 0.5) < 0.01, "channel 1 peak %f", peak);
            CHECK(rms > 0.2, "master rms %f", rms);
        }
    }

    std::printf("follow transport: each play to stop is a take\n");
    {
        const fs::path root = freshRoot("follow");
        Rig r(spec, package);
        r.set("ch1_arm", 1.0f);
        r.set("master_arm", 0.0f);
        r.set("recmode", 1.0f);
        r.set("recformat", 2.0f);
        r.transport.playing = false;
        r.run(70);
        r.module->command("record", 1.0f);
        r.run(70);
        r.transport.playing = true;
        r.run(100);
        r.transport.playing = false;
        r.run(30);
        r.transport.playing = true;
        r.run(100);
        r.transport.playing = false;
        r.run(30);
        r.module->command("record", 1.0f);
        for (int i = 0; i < 4; ++i) { r.run(70); r.poll(); }
        const fs::path dir = finishedDir(root, "Ch 1 (take 2).wav");
        CHECK(!dir.empty(), "two takes expected");
        if (!dir.empty()) {
            const Wav a = readWav(dir / "Ch 1.wav"), b = readWav(dir / "Ch 1 (take 2).wav");
            CHECK(a.frames == 100 * kChunk && b.frames == 100 * kChunk, "take lengths %zu %zu (expected %d)", a.frames, b.frames, 100 * kChunk);
        }
    }
    std::printf("mp3: the format reaches the host's encoder, which writes .mp3 files\n");
    {
        const fs::path root = freshRoot("mp3");
        Rig r(spec, package);
        r.set("ch1_arm", 1.0f);
        r.set("master_arm", 1.0f);
        r.set("recformat", 3.0f);   // MP3 192 kbps
        r.run(70);
        r.module->command("record", 1.0f);
        r.run(5);
        r.run(1000);   // 0.67 s of audio
        r.module->command("record", 1.0f);
        for (int i = 0; i < 4; ++i) { r.run(70); r.poll(); }
        // the files are done when they stop growing (close() finishes them on another thread)
        std::uintmax_t last = 0, now = 0;
        fs::path found;
        for (int i = 0; i < 300; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            found.clear();
            if (fs::exists(root))
                for (const auto& e : fs::directory_iterator(root))
                    if (fs::exists(e.path() / "Ch 1.mp3") && fs::exists(e.path() / "Master.mp3")) found = e.path();
            if (found.empty()) continue;
            now = fs::file_size(found / "Master.mp3");
            if (now > 0 && now == last) break;
            last = now;
        }
        if (!recording::mp3Available()) {
            CHECK(found.empty(), "no MP3 without an encoder");
        } else {
            CHECK(!found.empty(), "the .mp3 files were not made");
            if (!found.empty()) {
                const double expected = 0.667 * 24000.0;   // 192 kbps, per track
                CHECK(std::fabs((double)fs::file_size(found / "Ch 1.mp3") - expected) < expected * 0.25, "Ch 1.mp3 is %ju bytes", (std::uintmax_t)fs::file_size(found / "Ch 1.mp3"));
                CHECK(std::fabs((double)fs::file_size(found / "Master.mp3") - expected) < expected * 0.25, "Master.mp3 is %ju bytes", (std::uintmax_t)fs::file_size(found / "Master.mp3"));
                CHECK(!fs::exists(found / "Ch 1.wav"), "no WAV next to it");
            }
        }
    }
    std::printf("wasm audio console record: %d failures\n", failures);
    return failures == 0 ? 0 : 1;
}
