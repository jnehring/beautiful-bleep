// SPDX-License-Identifier: GPL-3.0-only
// Strange Osc node (doc/specs/modules/strange-osc.md): a chaotic attractor as an
// oscillator, at audio or control rate.
#include "Registry.h"
#include "StrangeDsp.h"

#include "dsp/OscCore.h"

#include <atomic>

namespace bleep::engine {
namespace {

using patch::StrangeDsp;

class StrangeOscModule final : public Module {
public:
    enum { Coarse, Fine, Tame, Mix, Force, Tone, Level, Attractor, Range, Seed };
    enum { Pitch, ResetIn, ForceIn };
    enum { Out, X, Y, Z, Flip };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        started_ = false;
    }
    void reset() override { started_ = false; }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"x", view_[0].load(std::memory_order_relaxed)});
        out.push_back({"y", view_[1].load(std::memory_order_relaxed)});
        out.push_back({"z", view_[2].load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> a(kTrail), b(kTrail);
        const int w = trailPos_.load(std::memory_order_relaxed);
        for (int i = 0; i < kTrail; ++i) {
            a[(size_t)i] = trailX_[(w + i) % kTrail].load(std::memory_order_relaxed);
            b[(size_t)i] = trailY_[(w + i) % kTrail].load(std::memory_order_relaxed);
        }
        out.push_back({"trailx", std::move(a)});
        out.push_back({"traily", std::move(b)});
    }

    void process(const ProcessContext& c) override {
        const int type = (int)setting(Attractor);
        const uint64_t seed = (uint64_t)std::lround(setting(Seed));
        if (!started_ || type != lastType_ || seed != lastSeed_) {
            dsp_.reset(type, seed);
            lastType_ = type, lastSeed_ = seed;
            started_ = true;
        }
        const double rangeScale = setting(Range) < 0.5f ? 1.0 : setting(Range) < 1.5f ? 1.0 / 64.0 : 1.0 / 4096.0;
        float lastX = 0.0f, lastY = 0.0f, lastZ = 0.0f;
        for (int i = 0; i < c.numSamples; ++i) {
            const bool r = c.inputs[ResetIn][i] > 0.5f;
            if (r && !resetPrev_) dsp_.reset(type, seed);
            resetPrev_ = r;
            const double oct = (double)c.inputs[Pitch][i] + value(c, Coarse, i) / 12.0 + value(c, Fine, i) / 1200.0;
            const double hz = dsp::osc::kC4Hz * std::exp2(std::clamp(oct, -12.0, 8.0)) * rangeScale;
            const double force = (double)value(c, Force, i) * (double)c.inputs[ForceIn][i];
            const auto f = dsp_.tick(hz, value(c, Tame, i), force);
            const float m = value(c, Mix, i) * 2.0f;
            const float blend = m < 1.0f ? f.x + (f.y - f.x) * m : f.y + (f.z - f.y) * (m - 1.0f);
            // One-pole tone: Tone 20 kHz is open.
            const float tone = value(c, Tone, i);
            const float a = tone >= 19000.0f ? 1.0f : 1.0f - std::exp(-6.283185307f * tone / (float)sampleRate_);
            lp_ += a * (blend - lp_);
            c.outputs[Out][i] = std::clamp(lp_, -1.0f, 1.0f) * value(c, Level, i);
            c.outputs[X][i] = f.x;
            c.outputs[Y][i] = f.y;
            c.outputs[Z][i] = f.z;
            if (f.x > 0.1f) flip_ = true;
            else if (f.x < -0.1f) flip_ = false;
            c.outputs[Flip][i] = flip_ ? 1.0f : 0.0f;
            lastX = f.x, lastY = f.y, lastZ = f.z;
        }
        view_[0].store(lastX, std::memory_order_relaxed);
        view_[1].store(lastY, std::memory_order_relaxed);
        view_[2].store(lastZ, std::memory_order_relaxed);
        // A trail for the view: one point per millisecond of the control rate, whatever the block size.
        trailAcc_ += c.numSamples;
        const int every = std::max(1, (int)(sampleRate_ * 0.004));
        while (trailAcc_ >= every) {
            trailAcc_ -= every;
            const int w = trailPos_.load(std::memory_order_relaxed);
            trailX_[w].store(lastX, std::memory_order_relaxed);
            trailY_[w].store(lastY, std::memory_order_relaxed);
            trailPos_.store((w + 1) % kTrail, std::memory_order_relaxed);
        }
    }

private:
    static constexpr int kTrail = 256;
    StrangeDsp dsp_;
    bool started_ = false, resetPrev_ = false, flip_ = false;
    int lastType_ = -1;
    uint64_t lastSeed_ = 0;
    float lp_ = 0.0f;
    int trailAcc_ = 0;
    std::atomic<float> view_[3] = {};
    std::atomic<float> trailX_[kTrail] = {}, trailY_[kTrail] = {};
    std::atomic<int> trailPos_{0};
};

}  // namespace

static void registerStrangeOscModule(Registry& r) {
    ModuleSpec s;
    s.type = "strange-osc";
    s.name = "Strange Osc";
    s.category = "Sources/Oscillators";
    s.colour = "#f472b6";
    s.description = "An oscillator that is a chaotic system: four attractors at audio or control rate, a Tame knob toward "
                    "periodic order, X/Y/Z outputs and a seeded start.";
    s.params = {ParamSpec::number("coarse", "Coarse", -36.0f, 36.0f, 0.0f, "st", 1),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0),
                ParamSpec::percent("tame", "Tame", 0.0f, 1.0f, 0.3f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("force", "Force", 0.0f, 1.0f, 0.0f),
                ParamSpec::hertz("tone", "Tone", 20.0f, 20000.0f, 20000.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.8f),
                ParamSpec::choice("attractor", "Attractor", {"Lorenz", "Rossler", "Thomas", "Halvorsen"}, 1),
                ParamSpec::choice("range", "Range", {"Audio", "Low", "Slow"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"reset", "Reset", Signal::Trigger}, {"forcein", "Force In", Signal::Audio}};
    s.outputs = {{"out", "Out", Signal::Audio, true},  {"x", "X", Signal::Control, true}, {"y", "Y", Signal::Control, true},
                 {"z", "Z", Signal::Control, true},    {"flip", "Flip", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<StrangeOscModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerStrangeOscModule);

}  // namespace bleep::engine
