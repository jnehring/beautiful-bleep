// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// Demo patches (board/ui/demo-patches.json, built from patch/presets/demos): the
// standalone app's preset browser loads these as whole boards. Each one must
//
//   - survive board::sanitise unchanged: no warnings, nothing dropped, every knob known and in range;
//   - make sound: the audio-out node is fed by a probe, and 12 s with the transport playing at the
//     patch's tempo must stay finite, below kPeakLimit and above kSilence (RMS);
//   - not be a CPU hog (reported, and a failure above kCpuLimit of real time).
//
//   bleep_demo_patches <demo-patches.json> [-v] [name-or-module ...]
#include "Board.h"
#include "Media.h"
#include "Program.h"
#include "Registry.h"

#include <algorithm>
#include <ctime>
#include <cmath>
#include <cstdio>
#include <functional>
#include <set>

using namespace bleep::engine;

namespace {

constexpr float kPeakLimit = 1.0f;    // a patch must not clip
constexpr double kSilence = 0.008;    // RMS below this (about −42 dB) over the last 8 s counts as silent
constexpr double kCpuLimit = 0.6;     // seconds of CPU per second of audio
constexpr double kSampleRate = 48000.0;
constexpr double kSeconds = 12.0;
int g_failures = 0;

/// Stands in for the audio-out port: measures what reaches Out 1/2.
struct Probe {
    double sumSq = 0.0;
    int64_t count = 0;
    float peak = 0.0f;
    bool finite = true;
    static Probe*& current() {
        static Probe* p = nullptr;
        return p;
    }
};

class SinkModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext& c) override {
        Probe* probe = Probe::current();
        if (!probe) return;
        for (int s = 0; s < c.numSamples; ++s)
            for (int ch = 0; ch < 2; ++ch) {
                const float v = c.inputs[ch][s];
                if (!std::isfinite(v)) probe->finite = false;
                probe->peak = std::max(probe->peak, std::fabs(v));
                if (counting) probe->sumSq += (double)v * v;
            }
        if (counting) probe->count += c.numSamples * 2;
    }
    static inline bool counting = false;
};

ModuleSpec sinkSpec() {
    ModuleSpec s;
    s.type = "demo-sink";
    s.name = "Demo Sink";
    s.category = "Test";
    s.inputs = {{"l", "L", Signal::Audio, true}, {"r", "R", Signal::Audio, true}};
    return s;
}
void registerSink(Registry& r) {
    r.add(sinkSpec(), [](const ModuleSpec& s) { return std::make_unique<SinkModule>(s); });
}
BLEEP_REGISTER_MODULE(registerSink);

void fail(const juce::String& patch, const juce::String& what) {
    std::printf("demo patch '%s': %s\n", patch.toRawUTF8(), what.toRawUTF8());
    ++g_failures;
}

/// The board with port nodes the harness can't serve swapped: Out 1/2 becomes the probe, MIDI inputs go.
juce::var forRender(const juce::var& board) {
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("format", 1);
    out->setProperty("id", "demo");
    juce::Array<juce::var> nodes, cables;
    std::set<juce::String> dropped;
    for (const auto& n : *board["nodes"].getArray()) {
        const juce::String type = n["type"].toString();
        if (type == "midi-in") {
            dropped.insert(n["id"].toString());
            continue;
        }
        if (type == "audio-out") {
            auto* o = new juce::DynamicObject();
            o->setProperty("id", n["id"]);
            o->setProperty("type", "demo-sink");
            nodes.add(juce::var(o));
            continue;
        }
        nodes.add(n);
    }
    for (const auto& c : *board["cables"].getArray())
        if (!dropped.count(c["from"]["node"].toString())) cables.add(c);
    out->setProperty("nodes", nodes);
    out->setProperty("cables", cables);
    return result;
}

struct Result {
    double rms = 0.0, cpu = 0.0;
    float peak = 0.0f;
};

Result render(const juce::var& board, double tempo) {
    std::map<std::string, std::shared_ptr<Module>> modules;
    auto program = Program::compile(board::parse(forRender(board)), modules, {}, kSampleRate);
    Transport t;
    t.sampleRate = kSampleRate;
    t.bpm = tempo;
    t.ppqValid = true;
    t.playing = true;
    Probe probe;
    Probe::current() = &probe;
    const int64_t total = (int64_t)(kSeconds * kSampleRate);
    const int64_t block = 256;
    const double ppqPerSample = tempo / 60.0 / kSampleRate;
    const std::clock_t t0 = std::clock();   // CPU time of this process, not the wall clock: shards running side by side must not slow each other's verdict
    for (int64_t done = 0; done < total; done += block) {
        SinkModule::counting = (double)done / kSampleRate >= 4.0;  // the first 4 s are warm-up
        for (int off = 0; off < block; off += kChunk) {
            ProcessContext ctx;
            ctx.numSamples = (int)std::min<int64_t>(kChunk, block - off);
            ctx.offset = off;
            ctx.transport = &t;
            ctx.transportStarted = done == 0 && off == 0;
            ctx.ppqStart = t.ppq + ppqPerSample * off;
            ctx.ppqPerSample = ppqPerSample;
            program->runChunk(ctx);
        }
        t.ppq += ppqPerSample * block;
        t.samplePos += block;
    }
    Probe::current() = nullptr;
    Result r;
    r.cpu = (double)(std::clock() - t0) / CLOCKS_PER_SEC / kSeconds;
    r.peak = probe.peak;
    r.rms = probe.count ? std::sqrt(probe.sumSq / (double)probe.count) : 0.0;
    if (!probe.finite) r.peak = INFINITY;
    return r;
}

/// The audio a patch carries (its `media` map): imported into a temporary media folder, each file must get the id it is
/// filed under (the id is a hash of the engine's own form of the audio), and every id a node names must be among them.
void importMedia(const juce::String& name, const juce::var& preset) {
    static juce::TemporaryFile folderHolder;
    static bool folderSet = false;
    if (!folderSet) {
        folderHolder.getFile().createDirectory();
        media::setFolder(folderHolder.getFile().getFullPathName().toStdString());
        folderSet = true;
    }
    std::set<juce::String> have;
    if (auto* obj = preset["media"].getDynamicObject())
        for (const auto& prop : obj->getProperties()) {
            juce::MemoryBlock bytes;
            juce::MemoryOutputStream out(bytes, false);
            if (!juce::Base64::convertFromBase64(out, prop.value["data"].toString())) {
                fail(name, "media " + prop.name.toString() + ": not base64");
                continue;
            }
            std::string err;
            const auto clip = media::import((const uint8_t*)bytes.getData(), bytes.getSize(), prop.value["name"].toString().toStdString(), &err);
            if (!clip) fail(name, "media " + prop.name.toString() + ": " + juce::String(err));
            else if (juce::String(clip->id) != prop.name.toString())
                fail(name, "media filed under " + prop.name.toString() + " is stored as " + juce::String(clip->id));
            have.insert(prop.name.toString());
        }
    // Every media id in a node's data.
    std::function<void(const juce::var&)> walk = [&](const juce::var& v) {
        if (v.isString()) {
            const juce::String t = v.toString();
            if (media::validId(t.toStdString()) && !have.count(t)) fail(name, "uses " + t + " but does not carry it");
        } else if (const auto* a = v.getArray()) {
            for (const auto& x : *a) walk(x);
        } else if (auto* o = v.getDynamicObject()) {
            for (const auto& p : o->getProperties()) walk(p.value);
        }
    };
    if (const auto* nodes = preset["nodes"].getArray())
        for (const auto& n : *nodes) walk(n["data"]);
}

void check(const juce::var& entry, bool verbose) {
    const juce::String name = entry["name"].toString();
    const juce::var preset = entry["preset"];
    if (name.isEmpty() || entry["module"].toString().isEmpty() || preset["description"].toString().isEmpty())
        fail(name, "needs a name, a module and a description");
    const auto* nodes = preset["nodes"].getArray();
    const auto* cables = preset["cables"].getArray();
    if (nodes == nullptr || cables == nullptr) return fail(name, "has no nodes or cables");

    juce::StringArray warnings;
    const juce::var out = board::sanitise(preset, &warnings);
    for (const auto& w : warnings) fail(name, w);
    if (out["nodes"].size() != nodes->size())
        fail(name, juce::String(nodes->size()) + " nodes became " + juce::String(out["nodes"].size()));
    if (out["cables"].size() != cables->size())
        fail(name, juce::String(cables->size()) + " cables became " + juce::String(out["cables"].size()));
    bool usesModule = false;
    for (const auto& n : *nodes) {
        usesModule = usesModule || n["type"] == entry["module"];
        const ModuleSpec* spec = Registry::get().find(n["type"].toString().toStdString());
        if (spec == nullptr) continue;
        if (auto* params = n["params"].getDynamicObject())
            for (const auto& prop : params->getProperties()) {
                const double v = prop.value;
                if (spec->paramIndex(prop.name.toString().toStdString()) < 0)
                    fail(name, n["name"].toString() + ": unknown knob '" + prop.name.toString() + "'");
                else if (!(v >= 0.0 && v <= 1.0))
                    fail(name, n["name"].toString() + "." + prop.name.toString() + " is outside 0…1");
            }
    }
    if (!usesModule) fail(name, "doesn't use " + entry["module"].toString());

    importMedia(name, preset);
    const double tempo = preset["tempo"].isDouble() || preset["tempo"].isInt() ? (double)preset["tempo"] : 120.0;
    const Result r = render(out, tempo);
    const double db = 20.0 * std::log10(std::max(r.rms, 1e-9));
    if (verbose)
        std::printf("  %-40s rms %6.1f dB  peak %5.2f  cpu %5.1f %%\n", name.toRawUTF8(), db, (double)r.peak, 100.0 * r.cpu);
    if (!std::isfinite(r.peak)) fail(name, "output is not finite");
    else if (r.peak > kPeakLimit) fail(name, "peak " + juce::String(r.peak, 2) + " is far over full scale");
    if (r.rms < kSilence) fail(name, "is silent after 4 s (rms " + juce::String(db, 1) + " dB)");
    if (r.cpu > kCpuLimit) fail(name, "uses " + juce::String(100.0 * r.cpu, 0) + " % of real time");
}

}  // namespace

int main(int argc, char** argv) {
    bool verbose = false;
    juce::String file;
    std::set<juce::String> only;
    int shard = 0, shards = 1;   // --shard K/N: every N-th patch from K, so ctest -j renders them side by side
    for (int i = 1; i < argc; ++i) {
        const juce::String a(argv[i]);
        if (a == "-v") verbose = true;
        else if (a == "--shard" && i + 1 < argc) {
            const juce::String spec(argv[++i]);
            shard = spec.upToFirstOccurrenceOf("/", false, false).getIntValue();
            shards = std::max(1, spec.fromFirstOccurrenceOf("/", false, false).getIntValue());
        }
        else if (file.isEmpty()) file = a;
        else only.insert(a);
    }
    const juce::var doc =
        juce::JSON::parse(juce::File::getCurrentWorkingDirectory().getChildFile(file).loadFileAsString());
    const auto* patches = doc["patches"].getArray();
    if (patches == nullptr || patches->isEmpty()) {
        std::printf("%s: no demo patches\n", file.toRawUTF8());
        return 1;
    }
    std::set<juce::String> names;
    int count = 0, index = -1;
    for (const auto& entry : *patches) {
        ++index;
        if (!names.insert(entry["name"].toString()).second) fail(entry["name"].toString(), "name used twice");
        if (index % shards != shard) continue;
        if (!only.empty() && !only.count(entry["name"].toString()) && !only.count(entry["module"].toString())) continue;
        check(entry, verbose);
        ++count;
    }
    std::printf("%d demo patches checked, %d problems\n", count, g_failures);
    return g_failures == 0 ? 0 : 1;
}
