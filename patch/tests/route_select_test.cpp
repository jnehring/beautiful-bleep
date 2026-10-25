// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Route and Select on a real compiled board: an LFO through Route reaches the selected output (and only that one),
// and through Select reaches Out.
#include "Board.h"
#include "Program.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace bleep::engine;

namespace {

int g_failures = 0;
#define CHECK(cond, ...)                                       \
    do {                                                       \
        if (!(cond)) {                                         \
            std::printf("  FAIL %s:%d: ", __FILE__, __LINE__); \
            std::printf(__VA_ARGS__);                          \
            std::printf("\n");                                 \
            ++g_failures;                                      \
        }                                                      \
    } while (0)

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}
juce::var cable(const char* id, const char* fn, const char* fj, const char* tn, const char* tj) {
    return obj({{"id", id}, {"from", obj({{"node", fn}, {"jack", fj}})}, {"to", obj({{"node", tn}, {"jack", tj}})}, {"amount", 1.0}});
}

/// Peak of |x| and of |x - lfo| over a few blocks, for output `jack` of node `id` against the LFO.
struct Probe {
    double peak = 0.0, diff = 0.0, lfoPeak = 0.0;
};

Probe run(const char* type, const char* outJack, const char* inJack, juce::var params) {
    juce::Array<juce::var> nodes, cables;
    nodes.add(obj({{"id", "lfo"}, {"type", "lfo"}}));
    nodes.add(obj({{"id", "dut"}, {"type", type}, {"params", params}}));
    cables.add(cable("c0", "lfo", "out", "dut", inJack));
    const auto doc = board::sanitise(obj({{"format", 1}, {"id", "t"}, {"nodes", nodes}, {"cables", cables}}));
    std::map<std::string, std::shared_ptr<Module>> modules;
    auto p = Program::compile(board::parse(doc), modules, {}, 48000.0);
    const ModuleSpec* spec = Registry::get().find(type);
    size_t jack = 0;
    for (size_t k = 0; k < spec->outputs.size(); ++k)
        if (spec->outputs[k].id == outJack) jack = k;
    Transport t;
    t.sampleRate = 48000.0;
    t.bpm = 120.0;
    t.ppqValid = true;
    t.playing = true;
    Probe r;
    for (int b = 0; b < 400; ++b) {
        ProcessContext ctx;
        ctx.numSamples = kChunk;
        ctx.transport = &t;
        ctx.ppqStart = t.ppq;
        ctx.ppqPerSample = t.bpm / 60.0 / t.sampleRate;
        p->runChunk(ctx);
        t.ppq += ctx.ppqPerSample * kChunk;
        const float *lfo = nullptr, *out = nullptr;
        for (const auto& st : p->steps()) {
            if (st.nodeId == "lfo") lfo = st.outputBuffers[0].get();
            if (st.nodeId == "dut") out = st.outputBuffers[jack].get();
        }
        if (!lfo || !out) {
            CHECK(false, "%s: no step or no output buffer", type);
            return r;
        }
        for (int s = 0; s < kChunk; ++s) {
            r.peak = std::max(r.peak, (double)std::fabs(out[s]));
            r.diff = std::max(r.diff, (double)std::fabs(out[s] - lfo[s]));
            r.lfoPeak = std::max(r.lfoPeak, (double)std::fabs(lfo[s]));
        }
    }
    return r;
}

juce::var defaults(const char* type) {
    auto* params = new juce::DynamicObject();
    for (const auto& p : Registry::get().find(type)->params) params->setProperty(juce::Identifier(p.id), p.defaultNormalised());
    return juce::var(params);
}


/// Zero crossings of an oscillator's output per window while an LFO drives its pitch, directly or through `via`.
std::vector<int> pitchMotion(const char* via, const char* viaOut, const char* viaIn) {
    juce::Array<juce::var> nodes, cables;
    auto* lp = new juce::DynamicObject();
    lp->setProperty("rate", 0.62);  // a fast LFO, so a few cycles fit into the test
    nodes.add(obj({{"id", "lfo"}, {"type", "lfo"}, {"params", juce::var(lp)}}));
    nodes.add(obj({{"id", "osc"}, {"type", "oscillator"}}));
    if (via) {
        nodes.add(obj({{"id", "via"}, {"type", via}}));
        cables.add(cable("c0", "lfo", "out", "via", viaIn));
        cables.add(cable("c1", "via", viaOut, "osc", "pitch"));
    } else {
        cables.add(cable("c0", "lfo", "out", "osc", "pitch"));
    }
    const auto doc = board::sanitise(obj({{"format", 1}, {"id", "t"}, {"nodes", nodes}, {"cables", cables}}));
    std::map<std::string, std::shared_ptr<Module>> modules;
    auto p = Program::compile(board::parse(doc), modules, {}, 48000.0);
    Transport t;
    t.sampleRate = 48000.0;
    t.bpm = 120.0;
    t.ppqValid = true;
    t.playing = true;
    std::vector<int> windows;
    int crossings = 0, inWindow = 0;
    float last = 0.0f;
    for (int b = 0; b < 48000 * 2 / kChunk; ++b) {
        ProcessContext ctx;
        ctx.numSamples = kChunk;
        ctx.transport = &t;
        ctx.ppqStart = t.ppq;
        ctx.ppqPerSample = t.bpm / 60.0 / t.sampleRate;
        p->runChunk(ctx);
        t.ppq += ctx.ppqPerSample * kChunk;
        for (const auto& st : p->steps())
            if (st.nodeId == "osc") {
                const float* o = st.outputBuffers[0].get();
                for (int s = 0; s < kChunk; ++s, ++inWindow) {
                    if (last < 0.0f && o[s] >= 0.0f) ++crossings;
                    last = o[s];
                    if (inWindow == 4800) { windows.push_back(crossings); crossings = inWindow = 0; }
                }
            }
    }
    return windows;
}

}  // namespace

int main() {
    // Route: the LFO reaches Out 1 (slot 0) unchanged, and nothing reaches Out 2.
    {
        const auto r = run("route", "out1", "in", defaults("route"));
        CHECK(r.lfoPeak > 0.5, "the LFO is silent (%g)", r.lfoPeak);
        CHECK(r.peak > 0.5, "Route Out 1 is silent (peak %g, LFO %g)", r.peak, r.lfoPeak);
        CHECK(r.diff < 1e-4, "Route Out 1 differs from the LFO by %g", r.diff);
        const auto r2 = run("route", "out2", "in", defaults("route"));
        CHECK(r2.peak == 0.0, "Route Out 2 should be silent (peak %g)", r2.peak);
    }
    // Select: In 1 reaches Out.
    {
        const auto r = run("select", "out", "in1", defaults("select"));
        CHECK(r.peak > 0.5 && r.diff < 1e-4, "Select Out: peak %g, difference %g", r.peak, r.diff);
    }
    // The pitch of an oscillator follows an LFO through Route as it does directly.
    {
        const auto direct = pitchMotion(nullptr, nullptr, nullptr), routed = pitchMotion("route", "out1", "in");
        const auto spread = [](const std::vector<int>& w) { return *std::max_element(w.begin(), w.end()) - *std::min_element(w.begin(), w.end()); };
        std::printf("  crossings per 0.1 s, direct:");
        for (int c : direct) std::printf(" %d", c);
        std::printf("\n  through Route:");
        for (int c : routed) std::printf(" %d", c);
        std::printf("\n");
        CHECK(spread(direct) > 20, "the LFO does not move the pitch directly (spread %d)", spread(direct));
        CHECK(spread(routed) > 20, "the LFO does not move the pitch through Route (spread %d)", spread(routed));
    }
    std::printf("route-select: %d failures\n", g_failures);
    return g_failures ? 1 : 0;
}
