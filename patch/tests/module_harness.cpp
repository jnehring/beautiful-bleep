// SPDX-License-Identifier: MIT
//
// Module harness: every module type, on a real compiled board. Each input jack
// is fed by a test source of its signal type (noise, slow control, gates,
// triggers, a pitch walk, notes), a few knobs are modulated, and the module
// runs for a few seconds at several knob settings, sample rates and block
// sizes, with the transport starting, stopping and jumping. Checks:
//
//   - every output stays finite and within ±kLimit;
//   - node data: sanitiseData("") is valid and stable, broken JSON loads;
//   - a module survives recompiles and setData while running.
//
//   bleep_module_harness              all modules
//   bleep_module_harness <type>...    only these (prints CPU per module)
#include "Board.h"
#include "Program.h"
#include "Registry.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <random>
#include <set>

using namespace bleep::engine;

namespace {

constexpr float kLimit = 64.0f;
int g_failures = 0;

#define CHECK(cond, ...)                                    \
    do {                                                    \
        if (!(cond)) {                                      \
            std::printf("  FAIL %s:%d: ", __FILE__, __LINE__); \
            std::printf(__VA_ARGS__);                       \
            std::printf("\n");                              \
            ++g_failures;                                   \
        }                                                   \
    } while (0)

// ---- the test source: one output per signal type ---------------------------
class SourceModule final : public Module {
public:
    using Module::Module;
    void process(const ProcessContext& c) override {
        const double sr = sampleRate_;
        for (int s = 0; s < c.numSamples; ++s, ++t_) {
            const double sec = (double)t_ / sr;
            c.outputs[0][s] = noise_(rng_);                                         // audio
            c.outputs[1][s] = (float)std::sin(2.0 * 3.14159265 * 0.7 * sec);       // control
            c.outputs[2][s] = std::fmod(sec * 4.0, 1.0) < 0.5 ? 1.0f : 0.0f;       // gate
            c.outputs[3][s] = (t_ % (int64_t)(sr / 8.0)) == 0 ? 1.0f : 0.0f;       // trigger
            if (t_ % (int64_t)(sr / 5.0) == 0) pitch_ = std::uniform_int_distribution<int>(-24, 24)(rng_) / 12.0f;
            c.outputs[4][s] = pitch_;                                               // pitch
            c.outputs[5][s] = 0.5f + 0.5f * (float)std::sin(2.0 * 3.14159265 * 3.1 * sec);  // unipolar control
            const int64_t period = (int64_t)(sr / 4.0);
            if (t_ % period == 0) {
                note_ = 48 + (int)(rng_() % 24);
                c.notesOut[6]->push({NoteEvent::On, 0, (int16_t)s, note_, (note_ - 60) / 12.0f, 0.8f});
            } else if (t_ % period == period / 2) {
                c.notesOut[6]->push({NoteEvent::Off, 0, (int16_t)s, note_, (note_ - 60) / 12.0f, 0.0f});
            }
        }
    }

private:
    int64_t t_ = 0;
    std::mt19937 rng_{1234};
    std::uniform_real_distribution<float> noise_{-1.0f, 1.0f};
    float pitch_ = 0.0f;
    int note_ = 60;
};

ModuleSpec sourceSpec() {
    ModuleSpec s;
    s.type = "harness-source";
    s.name = "Harness Source";
    s.category = "Test";
    s.outputs = {{"audio", "Audio", Signal::Audio, true},     {"control", "Control", Signal::Control, true},
                 {"gate", "Gate", Signal::Gate, false},       {"trigger", "Trigger", Signal::Trigger, false},
                 {"pitch", "Pitch", Signal::Pitch, true},     {"uni", "Uni", Signal::Control, false},
                 {"notes", "Notes", Signal::Notes, false}};
    return s;
}
void registerSource(Registry& r) {
    r.add(sourceSpec(), [](const ModuleSpec& s) { return std::make_unique<SourceModule>(s); });
}
BLEEP_REGISTER_MODULE(registerSource);

const char* sourceJack(Signal t) {
    switch (t) {
        case Signal::Audio: return "audio";
        case Signal::Gate: return "gate";
        case Signal::Trigger: return "trigger";
        case Signal::Pitch: return "pitch";
        case Signal::Notes: return "notes";
        case Signal::Control: break;
    }
    return "control";
}

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

juce::var cable(const juce::String& id, const juce::String& fn, const juce::String& fj, const juce::String& tn,
                const juce::String& tj, double amount) {
    return obj({{"id", id},
                {"from", obj({{"node", fn}, {"jack", fj}})},
                {"to", obj({{"node", tn}, {"jack", tj}})},
                {"amount", amount}});
}

/// A board with the source and one node of `spec`; every input fed, the first
/// three modulatable knobs modulated. `knob` picks the knob values.
juce::var makeBoard(const ModuleSpec& spec, std::mt19937& rng, int trial) {
    auto* params = new juce::DynamicObject();
    std::uniform_real_distribution<float> u(0.0f, 1.0f);
    for (const auto& p : spec.params) {
        float v = p.defaultNormalised();
        if (trial == 1) v = 0.0f;
        else if (trial == 2) v = 1.0f;
        else if (trial >= 3) v = u(rng);
        params->setProperty(juce::Identifier(p.id), v);
    }
    juce::Array<juce::var> nodes, cables;
    nodes.add(obj({{"id", "src"}, {"type", "harness-source"}}));
    juce::var n = obj({{"id", "dut"}, {"type", juce::String(spec.type)}, {"params", juce::var(params)}});
    if (spec.sanitiseData) n.getDynamicObject()->setProperty("data", board::fromJson(spec.sanitiseData({})));
    nodes.add(n);
    int k = 0;
    for (const auto& j : spec.inputs)
        cables.add(cable("c" + juce::String(k++), "src", sourceJack(j.type), "dut", juce::String(j.id), 1.0));
    int modded = 0;
    for (const auto& p : spec.params)
        if (p.modulatable && modded < 3 && trial != 0) {
            cables.add(cable("c" + juce::String(k++), "src", modded == 0 ? "control" : "uni", "dut",
                             juce::String(p.id), 0.5));
            ++modded;
        }
    return board::sanitise(obj({{"format", 1}, {"id", "harness"}, {"nodes", nodes}, {"cables", cables}}));
}

struct Result {
    double seconds = 0.0, cpu = 0.0;
};

/// Runs `seconds` of audio; checks every output of the DUT.
void run(Program& p, const ModuleSpec& spec, double sampleRate, double seconds, std::mt19937& rng, Result& r,
         const char* what) {
    Transport t;
    t.sampleRate = sampleRate;
    t.bpm = 120.0 + (double)(rng() % 60);
    t.ppqValid = true;
    t.playing = true;
    const Program::Step* dut = nullptr;
    for (const auto& st : p.steps())
        if (st.nodeId == "dut") dut = &st;
    if (!dut) {
        CHECK(false, "%s: no DUT step", spec.type.c_str());
        return;
    }
    const int64_t total = (int64_t)(seconds * sampleRate);
    int64_t done = 0;
    bool reported = false;
    const auto t0 = std::chrono::steady_clock::now();
    while (done < total) {
        const int block = 16 + (int)(rng() % 1000);
        // Transport: stops for a while at ~40 %, jumps back at ~70 %.
        const double frac = (double)done / (double)total;
        const bool wasPlaying = t.playing;
        t.playing = !(frac > 0.4 && frac < 0.5);
        if (frac > 0.7 && frac < 0.71) t.ppq = 0.0;
        const bool started = (t.playing && !wasPlaying) || done == 0;
        const double ppqPerSample = t.bpm / 60.0 / sampleRate;
        for (int off = 0; off < block; off += kChunk) {  // as Program::run, checking every chunk
            ProcessContext ctx;
            ctx.numSamples = std::min(kChunk, block - off);
            ctx.offset = off;
            ctx.transport = &t;
            ctx.transportStarted = started && off == 0;
            ctx.ppqStart = t.ppq + ppqPerSample * off;
            ctx.ppqPerSample = ppqPerSample;
            p.runChunk(ctx);
            for (size_t o = 0; o < dut->outputBuffers.size(); ++o) {
                const float* b = dut->outputBuffers[o].get();
                if (!b) continue;
                for (int s = 0; s < ctx.numSamples && !reported; ++s)
                    if (!std::isfinite(b[s]) || std::fabs(b[s]) > kLimit) {
                        CHECK(false, "%s (%s, %.0f Hz): output '%s' = %g", spec.type.c_str(), what, sampleRate,
                              spec.outputs[o].id.c_str(), (double)b[s]);
                        reported = true;
                    }
            }
        }
        if (t.playing) t.ppq += ppqPerSample * block;
        t.samplePos += block;
        done += block;
    }
    r.cpu += std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    r.seconds += seconds;
}

void testData(const ModuleSpec& spec) {
    if (!spec.sanitiseData) return;
    const std::string a = spec.sanitiseData("");
    CHECK(!a.empty(), "%s: sanitiseData(\"\") is empty", spec.type.c_str());
    juce::var parsed;
    CHECK(juce::JSON::parse(juce::String(a), parsed).wasOk(), "%s: default data is not JSON", spec.type.c_str());
    CHECK(spec.sanitiseData(a) == a, "%s: sanitiseData is not stable", spec.type.c_str());
    for (const char* bad : {"{", "[1,2", "null", "42", "{\"steps\": 7}", "\"x\""}) {
        const std::string b = spec.sanitiseData(bad);
        CHECK(juce::JSON::parse(juce::String(b), parsed).wasOk(), "%s: data from '%s' is not JSON",
              spec.type.c_str(), bad);
    }
}

void testModule(const ModuleSpec& spec, bool verbose) {
    std::mt19937 rng(std::hash<std::string>{}(spec.type) & 0xffffffu);
    testData(spec);
    Result r;
    for (double sr : {48000.0, 44100.0, 96000.0}) {
        for (int trial = 0; trial < 5; ++trial) {
            std::map<std::string, std::shared_ptr<Module>> modules;
            const juce::var doc = makeBoard(spec, rng, trial);
            auto program = Program::compile(board::parse(doc), modules, {}, sr);
            const char* names[] = {"defaults", "all 0", "all 1", "random", "random"};
            run(*program, spec, sr, sr == 48000.0 ? 2.0 : 0.5, rng, r, names[trial]);
            // Recompile with the same modules (state kept), then data again.
            auto again = Program::compile(board::parse(doc), modules, {}, sr);
            if (spec.sanitiseData)
                if (auto m = modules.find("dut"); m != modules.end()) m->second->setData(spec.sanitiseData(""));
            run(*again, spec, sr, 0.25, rng, r, names[trial]);
        }
    }
    if (verbose)
        std::printf("  %-22s %5.2f %% CPU (one instance, 48 kHz-equivalent)\n", spec.type.c_str(),
                    100.0 * r.cpu / std::max(r.seconds, 1e-9));
}

}  // namespace

int main(int argc, char** argv) {
    std::set<std::string> only;
    for (int i = 1; i < argc; ++i) only.insert(argv[i]);
    int count = 0;
    for (const ModuleSpec* spec : Registry::get().all()) {
        if (spec->port != PortKind::None || !spec->userCreatable || spec->type == "harness-source") continue;
        // Cells and their boundary nodes compile to no step of their own.
        if (spec->type == kCell || spec->type == kVoiceCell || spec->type == kCellIn || spec->type == kCellOut)
            continue;
        if (!only.empty() && !only.count(spec->type)) continue;
        testModule(*spec, !only.empty());
        ++count;
    }
    std::printf("module harness: %d module types, %d failures\n", count, g_failures);
    return g_failures == 0 ? 0 : 1;
}
