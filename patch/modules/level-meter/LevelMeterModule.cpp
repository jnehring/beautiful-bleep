// SPDX-License-Identifier: MIT
// Level Meter node (doc/specs/modules/level-meter.md): stereo peak and RMS
// meters with clip lights; the audio passes through, and the level comes out
// as a control signal.
#include "LevelMeterDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::kLevelMeterFloors;

/// Raises a to v if v is larger (audio thread; the UI resets it on read).
void raise(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v > prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}

class LevelMeterModule final : public Module {
public:
    enum { Response, Floor, Detector, Hold };
    enum { InL, InR };
    enum { OutL, OutR, Level, Clip };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    /// Peaks and clips since the view last read them, so no short peak is missed.
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"peakL", (double)peakL_.exchange(0.0f)});
        out.push_back({"peakR", (double)peakR_.exchange(0.0f)});
        out.push_back({"rmsL", (double)rmsL_.load()});
        out.push_back({"rmsR", (double)rmsR_.load()});
        out.push_back({"clipL", clipL_.exchange(false) ? 1.0 : 0.0});
        out.push_back({"clipR", clipR_.exchange(false) ? 1.0 : 0.0});
        out.push_back({"stereo", stereo_.load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        patch::LevelMeterParams p;
        p.floorDb = kLevelMeterFloors[std::clamp((int)setting(Floor), 0, 5)];
        p.peakMode = (int)setting(Detector) == 1;
        const bool stereo = c.inputConnected[InR];
        const float* inR = stereo ? c.inputs[InR] : c.inputs[InL];
        patch::LevelMeterFrame f;
        float peakL = 0.0f, peakR = 0.0f;
        bool clipL = false, clipR = false;
        for (int i = 0; i < c.numSamples; ++i) {
            p.response = value(c, Response, i);
            const float l = c.inputs[InL][i], r = inR[i];
            dsp_.tick(l, r, p, f);
            c.outputs[OutL][i] = l;
            c.outputs[OutR][i] = r;
            c.outputs[Level][i] = f.level;
            c.outputs[Clip][i] = f.clip;
            peakL = std::max(peakL, f.peakL);
            peakR = std::max(peakR, f.peakR);
            clipL = clipL || f.peakL > 1.0f;
            clipR = clipR || f.peakR > 1.0f;
        }
        raise(peakL_, peakL);
        raise(peakR_, peakR);
        rmsL_.store(f.rmsL);
        rmsR_.store(f.rmsR);
        if (clipL) clipL_.store(true);
        if (clipR) clipR_.store(true);
        stereo_.store(stereo);
    }

private:
    patch::LevelMeterDsp dsp_;
    mutable std::atomic<float> peakL_{0.0f}, peakR_{0.0f};
    mutable std::atomic<bool> clipL_{false}, clipR_{false};
    std::atomic<float> rmsL_{0.0f}, rmsR_{0.0f};
    std::atomic<bool> stereo_{false};
};

}  // namespace

void registerLevelMeterModule(Registry& r) {
    ModuleSpec s;
    s.type = "level-meter";
    s.name = "Level Meter";
    s.category = "Utility/Metering";
    s.colour = "#c4b5fd";
    s.description = "Stereo peak and RMS meters with clip lights. The audio passes through; Level puts the loudness on a cable.";
    s.params = {ParamSpec::seconds("response", "Response", 0.01f, 2.0f, 0.3f, 0.3f),
                ParamSpec::choice("floor", "Floor", {"-24 dB", "-36 dB", "-48 dB", "-60 dB", "-72 dB", "-96 dB"},
                                  patch::kLevelMeterDefaultFloor),
                ParamSpec::choice("detector", "Level Follows", {"RMS", "Peak"}, 0),
                ParamSpec::choice("hold", "Peak Hold", {"Off", "1 s", "3 s", "Until Reset"}, 2)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"level", "Level", Signal::Control, false},
                 {"clip", "Clip", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<LevelMeterModule>(spec); });
}

}  // namespace bleep::engine
