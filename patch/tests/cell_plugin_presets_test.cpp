// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
//
// The cell presets Bleep Instrument and Bleep FX load (doc/specs/cell-plugins.md): every preset in
// board/ui/factory-presets.json with a `plays` entry is played the way its plugin plays it.
//
//   instrument  a note (MIDI note 60, then off) goes to the cell the way `plays.instrument.notes`
//               says; the sound must be finite, below kPeakLimit, audible, and (Voice Cells and
//               triggered cells) silent again after the note. A cell that plays by itself
//               (`notes: {}`) runs 12 s with the transport and must stay audible.
//   effect      noise goes in for one second, then silence: the output must be finite, below
//               kPeakLimit, and silent after `tail` seconds (plus a little).
//
//   bleep_cell_plugin_presets <presets.json> [<more.json> ...] [-v] [name ...]
#include "Board.h"
#include "Media.h"
#include "Program.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <functional>
#include <set>

using namespace bleep::engine;

namespace {

constexpr float kPeakLimit = 1.5f;
constexpr double kAudible = 0.003;     // peak of a played note, about −50 dB
constexpr double kSilent = 0.002;      // peak once it should have died away
constexpr double kSampleRate = 48000.0;
constexpr double kNoteOn = 0.2, kNoteOff = 2.2, kRelease = 12.0;  // seconds
int g_failures = 0;

/// Measures what the cell sends to the host.
struct Probe {
    std::vector<float> peakPerBlock;  // per 256-sample block
    float blockPeak = 0.0f;
    int blockCount = 0;
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
                probe->blockPeak = std::max(probe->blockPeak, std::fabs(v));
            }
        probe->blockCount += c.numSamples;
        if (probe->blockCount >= 256) {
            probe->peakPerBlock.push_back(probe->blockPeak);
            probe->blockPeak = 0.0f;
            probe->blockCount = 0;
        }
    }
};

/// Stands in for the plugin's host side: one note and white noise, in absolute time.
class SourceModule final : public Module {
public:
    enum { Notes, Pitch, Gate, Velocity, Trigger };
    enum { L, R };
    using Module::Module;
    void reset() override {
        pos_ = 0;
        seed_ = 12345;
    }
    void process(const ProcessContext& c) override {
        NoteBuffer& notes = *c.notesOut[Notes];
        notes.clear();
        const int64_t on = (int64_t)(kNoteOn * kSampleRate), off = (int64_t)(kNoteOff * kSampleRate);
        const int64_t noiseEnd = (int64_t)(1.0 * kSampleRate);
        for (int i = 0; i < c.numSamples; ++i) {
            const int64_t t = pos_ + i;
            c.outputs[Pitch][i] = 0.0f;
            c.outputs[Velocity][i] = 0.8f;
            c.outputs[Gate][i] = t >= on && t < off ? 1.0f : 0.0f;
            c.outputs[Trigger][i] = t == on ? 1.0f : 0.0f;
            seed_ = seed_ * 1664525u + 1013904223u;
            const float n = t < noiseEnd ? ((float)(seed_ >> 8) / 8388608.0f - 1.0f) * 0.25f : 0.0f;
            c.outputs[4 + 1 + L][i] = n;
            c.outputs[4 + 1 + R][i] = -n;
            if (t == on || t == off) {
                NoteEvent e;
                e.type = t == on ? NoteEvent::On : NoteEvent::Off;
                e.offset = (int16_t)i;
                e.note = 60;
                e.pitch = 0.0f;
                e.value = 0.8f;
                notes.push(e);
            }
        }
        pos_ += c.numSamples;
    }

private:
    int64_t pos_ = 0;
    uint32_t seed_ = 12345;
};

void registerTestModules(Registry& r) {
    ModuleSpec sink;
    sink.type = "cp-sink";
    sink.name = "Sink";
    sink.category = "Test";
    sink.inputs = {{"l", "L", Signal::Audio, true}, {"r", "R", Signal::Audio, true}};
    r.add(sink, [](const ModuleSpec& s) { return std::make_unique<SinkModule>(s); });

    ModuleSpec src;
    src.type = "cp-source";
    src.name = "Source";
    src.category = "Test";
    src.outputs = {{"notes", "Notes", Signal::Notes, false}, {"pitch", "Pitch", Signal::Pitch, true},
                   {"gate", "Gate", Signal::Gate, false},    {"velocity", "Velocity", Signal::Control, false},
                   {"trigger", "Trigger", Signal::Trigger, false}, {"l", "L", Signal::Audio, true},
                   {"r", "R", Signal::Audio, true}};
    r.add(src, [](const ModuleSpec& s) { return std::make_unique<SourceModule>(s); });
}
BLEEP_REGISTER_MODULE(registerTestModules);

void fail(const juce::String& preset, const juce::String& what) {
    std::printf("cell plugin preset '%s': %s\n", preset.toRawUTF8(), what.toRawUTF8());
    ++g_failures;
}

juce::var cable(const juce::String& id, const juce::String& fn, const juce::String& fj, const juce::String& tn,
                const juce::String& tj) {
    auto* c = new juce::DynamicObject();
    auto* from = new juce::DynamicObject();
    auto* to = new juce::DynamicObject();
    from->setProperty("node", fn);
    from->setProperty("jack", fj);
    to->setProperty("node", tn);
    to->setProperty("jack", tj);
    c->setProperty("id", id);
    c->setProperty("from", juce::var(from));
    c->setProperty("to", juce::var(to));
    c->setProperty("amount", 1.0);
    return juce::var(c);
}

juce::var node(const juce::String& id, const juce::String& type) {
    auto* n = new juce::DynamicObject();
    n->setProperty("id", id);
    n->setProperty("type", type);
    n->setProperty("parent", "");
    return juce::var(n);
}

/// Jack ids of a kind of the root cell ("inputs" / "outputs"), audio only.
juce::StringArray audioJacks(const juce::var& root, const char* which) {
    juce::StringArray ids;
    if (const auto* list = root[which].getArray())
        for (const auto& j : *list)
            if (j["type"].toString() == "audio") ids.add(j["id"].toString());
    return ids;
}

/// The preset as a board with the host's side attached the way the plugin does it.
juce::var withHost(const juce::var& preset, const juce::var& root, bool effect, juce::String& problem) {
    juce::Array<juce::var> nodes = *preset["nodes"].getArray(), cables = *preset["cables"].getArray();
    nodes.add(node("hostsrc", "cp-source"));
    nodes.add(node("hostsink", "cp-sink"));
    const juce::String cell = root["id"].toString();
    int k = 0;
    auto wire = [&](const juce::String& fj, const juce::String& tj) { cables.add(cable("h" + juce::String(++k), "hostsrc", fj, cell, tj)); };

    const auto& plays = preset["plays"];
    juce::StringArray outs;
    if (effect) {
        const auto& e = plays["effect"];
        for (int i = 0; i < e["in"].size(); ++i) wire(i == 0 ? "l" : "r", e["in"][i].toString());
        for (int i = 0; i < e["out"].size(); ++i) outs.add(e["out"][i].toString());
    } else {
        const auto& notes = plays["instrument"]["notes"];
        if (notes.toString() == "voice") {
            wire("notes", "notes");
            outs = {"l", "r"};
        } else {
            if (const auto& t = notes["trigger"]; t.isString()) wire("trigger", t.toString());
            else if (auto* o = t.getDynamicObject())
                for (const auto& p : o->getProperties()) wire("trigger", p.value.toString());
            if (notes["velocity"].isString()) wire("velocity", notes["velocity"].toString());
            if (notes["pitch"].isString()) wire("pitch", notes["pitch"].toString());
            if (notes["gate"].isString()) wire("gate", notes["gate"].toString());
            if (notes["notes"].isString()) wire("notes", notes["notes"].toString());  // the note stream itself
            outs = audioJacks(root, "outputs");
        }
    }
    if (outs.isEmpty()) problem = "has no audio out";
    for (int i = 0; i < outs.size() && i < 2; ++i)
        cables.add(cable("o" + juce::String(i), cell, outs[i], "hostsink", i == 0 ? "l" : "r"));
    if (outs.size() == 1) cables.add(cable("o1", cell, outs[0], "hostsink", "r"));

    auto* board = new juce::DynamicObject();
    board->setProperty("format", 1);
    board->setProperty("id", "cp");
    board->setProperty("nodes", nodes);
    board->setProperty("cables", cables);
    return juce::var(board);
}

Probe render(const juce::var& board, double seconds, double tempo = 120.0) {
    std::map<std::string, std::shared_ptr<Module>> modules;
    auto program = Program::compile(board::parse(board), modules, {}, kSampleRate);
    Transport t;
    t.sampleRate = kSampleRate;
    t.bpm = tempo;
    t.ppqValid = true;
    t.playing = true;
    Probe probe;
    Probe::current() = &probe;
    const int64_t total = (int64_t)(seconds * kSampleRate), block = 256;
    const double ppqPerSample = tempo / 60.0 / kSampleRate;
    for (int64_t done = 0; done < total; done += block) {
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
    return probe;
}

/// Largest block peak between two times.
float peakBetween(const Probe& p, double from, double to) {
    float peak = 0.0f;
    const size_t a = (size_t)(from * kSampleRate / 256), b = std::min(p.peakPerBlock.size(), (size_t)(to * kSampleRate / 256));
    for (size_t i = a; i < b; ++i) peak = std::max(peak, p.peakPerBlock[i]);
    return peak;
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
    importMedia(name, preset);
    const juce::var plays = preset["plays"];
    juce::StringArray warnings;
    const juce::var clean = board::sanitise(preset, &warnings);
    for (const auto& w : warnings) fail(name, w);

    juce::var root;
    for (const auto& n : *clean["nodes"].getArray())
        if (n["id"] == preset["root"]) root = n;
    const bool both = plays.hasProperty("instrument") && plays.hasProperty("effect");
    for (const bool effect : {false, true}) {
        if (!plays.hasProperty(effect ? "effect" : "instrument")) continue;
        juce::String problem;
        juce::var withPlays = clean;
        withPlays.getDynamicObject()->setProperty("plays", plays);
        const juce::var board = withHost(withPlays, root, effect, problem);
        if (problem.isNotEmpty()) {
            fail(name, problem);
            continue;
        }
        const juce::String as = both ? (effect ? " (as effect)" : " (as instrument)") : "";
        if (effect) {
            const double tail = (double)plays["effect"]["tail"];
            const Probe p = render(board, 1.0 + tail + 2.0);
            if (!p.finite) fail(name + as, "output is not finite");
            const float peak = peakBetween(p, 0.0, 1.0 + tail + 2.0);
            if (peak > kPeakLimit) fail(name + as, "peak " + juce::String(peak, 2) + " with noise in");
            const float after = peakBetween(p, 1.0 + tail + 1.0, 1.0 + tail + 2.0);
            if (after > kSilent) fail(name + as, "still sounds " + juce::String(after, 4) + " after its tail of " + juce::String(tail, 1) + " s: raise plays.effect.tail");
            if (verbose) std::printf("  %-34s effect  peak %5.2f  after tail %.4f\n", (name + as).toRawUTF8(), (double)peak, (double)after);
        } else {
            const auto& notes = plays["instrument"]["notes"];
            const bool selfPlaying = notes.getDynamicObject() != nullptr && notes.getDynamicObject()->getProperties().size() == 0;
            // A note stream into a cell with a Voice Cell or a Notes to CV inside is played by notes (a drum machine's stream is not).
            bool takesNotes = false;
            if (const auto* ns = preset["nodes"].getArray())
                for (const auto& n : *ns) takesNotes |= n["type"].toString() == "voice-cell" || n["type"].toString() == "notes-to-cv";
            const bool noteStream = notes.hasProperty("notes") && takesNotes;
            const bool pitchOnly = !selfPlaying && notes.getDynamicObject() != nullptr && !notes.hasProperty("trigger") && !noteStream;
            const double seconds = selfPlaying || pitchOnly ? 12.0 : kNoteOff + kRelease;
            const Probe p = render(board, seconds);
            if (!p.finite) fail(name + as, "output is not finite");
            const float peak = peakBetween(p, 0.0, seconds);
            if (peak > kPeakLimit) fail(name + as, "peak " + juce::String(peak, 2));
            const float played = selfPlaying || pitchOnly ? peakBetween(p, 4.0, 12.0) : peakBetween(p, kNoteOn, kNoteOff + 0.5);
            const bool starter = [&] {
                if (const auto* tags = preset["tags"].getArray())
                    for (const auto& t : *tags) if (t.toString() == "empty") return true;
                return false;
            }();
            if (!starter && played < kAudible) fail(name + as, "is silent when played (peak " + juce::String(played, 4) + ")");
            float after = 0.0f;
            if (!selfPlaying && !pitchOnly) {
                after = peakBetween(p, seconds - 1.0, seconds);
                if (after > kSilent) fail(name + as, "still sounds " + juce::String(after, 4) + " " + juce::String(kRelease, 0) + " s after the note");
            }
            if (verbose) std::printf("  %-34s instr   played %5.2f  after %.4f\n", (name + as).toRawUTF8(), (double)played, (double)after);
        }
    }
}

}  // namespace

int main(int argc, char** argv) {
    bool verbose = false;
    std::vector<juce::String> files;
    std::set<juce::String> only;
    int shard = 0, shards = 1;   // --shard K/N: every N-th preset from K, so ctest -j renders them side by side
    for (int i = 1; i < argc; ++i) {
        const juce::String a(argv[i]);
        if (a == "-v") verbose = true;
        else if (a == "--shard" && i + 1 < argc) {
            const juce::String spec(argv[++i]);
            shard = spec.upToFirstOccurrenceOf("/", false, false).getIntValue();
            shards = std::max(1, spec.fromFirstOccurrenceOf("/", false, false).getIntValue());
        }
        else if (a.endsWithIgnoreCase(".json")) files.push_back(a);
        else only.insert(a);
    }
    int count = 0, withPlays = 0;
    std::set<juce::String> names;
    for (const auto& file : files) {
        const juce::var doc =
            juce::JSON::parse(juce::File::getCurrentWorkingDirectory().getChildFile(file).loadFileAsString());
        const auto* presets = doc["presets"].getArray();
        if (presets == nullptr || presets->isEmpty()) {
            std::printf("%s: no presets\n", file.toRawUTF8());
            return 1;
        }
        for (const auto& entry : *presets) {
            ++count;
            if (!names.insert(entry["name"].toString()).second) fail(entry["name"].toString(), "name used twice");
            if (!entry["preset"].hasProperty("plays")) continue;
            if (withPlays++ % shards != shard) continue;
            if (!only.empty() && !only.count(entry["name"].toString())) continue;
            check(entry, verbose);
        }
    }
    std::printf("%d of %d presets load as a plugin, %d problems\n", withPlays, count, g_failures);
    return g_failures == 0 && withPlays > 0 ? 0 : 1;
}
