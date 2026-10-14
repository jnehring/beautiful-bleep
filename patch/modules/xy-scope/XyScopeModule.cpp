// SPDX-License-Identifier: MIT
// XY Scope node (doc/specs/modules/xy-scope.md): an oscilloscope for X against Y
// (or Y over time) whose measurements come out as signals: Phase,
// Correlation, Ratio and a Still gate.
//
// The beam's points go to the view through a wait-free ring (XyPointRing):
// the audio thread pushes every D-th sample, liveArrays drains what is new.
// The readout (frequencies, figure ratio, φ, ρ, Still) comes as live values.
// Inside a Voice Cell every voice measures its own pair; the view shows the
// voice the board shows.
#include "Registry.h"
#include "XyScopeDsp.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::XyScopeDsp;

class XyScopeModule final : public Module {
public:
    enum { XGain, YGain, Timebase, Persistence, Focus, Intensity, Mode, Trigger, Phosphor, Character, Tolerance };
    enum { X, Y, Z };
    enum { OutX, OutY, Phase, Correlation, Ratio, Still };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        decimation_ = patch::xyDecimation(sampleRate);
        count_ = 0;
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"fx", (double)fx_.load(std::memory_order_relaxed)});
        out.push_back({"fy", (double)fy_.load(std::memory_order_relaxed)});
        out.push_back({"p", (double)p_.load(std::memory_order_relaxed)});
        out.push_back({"q", (double)q_.load(std::memory_order_relaxed)});
        out.push_back({"phase", (double)phase_.load(std::memory_order_relaxed)});
        out.push_back({"rho", (double)rho_.load(std::memory_order_relaxed)});
        out.push_back({"still", still_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
    }

    /// "pts": the points since the last read as x, y, z, s quadruples (before
    /// gain; s = sweep position in Y-T mode, −1 = beam off). "meta": [point
    /// rate in Hz, hum phase of the first point (turns of 50 Hz), dropped].
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> pts;
        uint32_t dropped = 0;
        const uint32_t first = ring_.drain(pts, dropped);
        const double rate = sampleRate_ / decimation_;
        const double hum = std::fmod((double)first * 50.0 / rate, 1.0);
        out.push_back({"pts", std::move(pts)});
        out.push_back({"meta", {(float)rate, (float)hum, (float)dropped}});
    }

    void process(const ProcessContext& c) override {
        patch::XyScopeParams p;
        p.mode = (int)setting(Mode);
        p.trigger = (int)setting(Trigger);
        p.tolerance = (int)setting(Tolerance);
        patch::XyScopeInput in;
        in.xPatched = c.inputConnected[X];
        in.yPatched = c.inputConnected[Y];
        in.playing = c.transport->playing && c.transport->ppqValid;
        patch::XyScopeFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            if (p.mode == 1) p.timebase = cachedValue(c, Timebase, i);
            in.x = c.inputs[X][i];
            in.y = c.inputs[Y][i];
            in.ppq = c.ppqAt(i);
            dsp_.tick(p, in, f);
            c.outputs[OutX][i] = in.x;
            c.outputs[OutY][i] = in.y;
            c.outputs[Phase][i] = f.phase;
            c.outputs[Correlation][i] = f.corr;
            c.outputs[Ratio][i] = f.ratio;
            c.outputs[Still][i] = f.still;
            if (++count_ >= decimation_) {
                count_ = 0;
                ring_.push(in.x, in.y, c.inputs[Z][i], f.sweep);
            }
        }
        fx_.store(dsp_.validX(in.xPatched) ? (float)dsp_.fx() : 0.0f, std::memory_order_relaxed);
        fy_.store(dsp_.validY(in.yPatched) ? (float)dsp_.fy() : 0.0f, std::memory_order_relaxed);
        p_.store(dsp_.fraction().p, std::memory_order_relaxed);
        q_.store(dsp_.fraction().q, std::memory_order_relaxed);
        phase_.store(f.phase, std::memory_order_relaxed);
        rho_.store(f.corr, std::memory_order_relaxed);
        still_.store(f.still > 0.5f, std::memory_order_relaxed);
    }

private:
    /// value(), recomputed only when the knob moves (fromNormalised may cost a pow).
    float cachedValue(const ProcessContext& c, int k, int s) noexcept {
        const float n = c.params[k][s];
        if (n < knobNorm_[(size_t)k] || n > knobNorm_[(size_t)k]) {
            knobNorm_[(size_t)k] = n;
            knobUnits_[(size_t)k] = value(c, k, s);
        }
        return knobUnits_[(size_t)k];
    }

    XyScopeDsp dsp_;
    mutable patch::XyPointRing ring_;
    int decimation_ = 1, count_ = 0;
    std::atomic<float> fx_{0.0f}, fy_{0.0f}, phase_{0.0f}, rho_{0.0f};
    std::atomic<int> p_{1}, q_{1};
    std::atomic<bool> still_{false};
    std::array<float, 16> knobNorm_ = [] {
        std::array<float, 16> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 16> knobUnits_{};
};

}  // namespace

static void registerXyScopeModule(Registry& r) {
    ModuleSpec s;
    s.type = "xy-scope";
    s.name = "XY Scope";
    s.category = "Utility/Metering";
    s.colour = "#4ade80";
    s.description = "An oscilloscope for X against Y: Lissajous figures that stand still when two oscillators lock, "
                    "with Phase, Correlation, Ratio and a Still gate as outputs.";
    auto gain = [](const char* id, const char* name) {
        auto g = ParamSpec::exponential(id, name, 0.1f, 10.0f, 1.0f, "×");
        g.decimals = 2;
        return g;
    };
    auto seconds = [](const char* id, const char* name, float min, float max, float def) {
        auto t = ParamSpec::exponential(id, name, min, max, def);
        t.format = ParamSpec::Format::Seconds;
        return t;
    };
    s.params = {gain("xgain", "X Gain"),
                gain("ygain", "Y Gain"),
                seconds("timebase", "Timebase", 0.001f, 2.0f, 0.02f).when("mode", 1, 1),
                seconds("persistence", "Persistence", 0.01f, 5.0f, 0.15f),
                ParamSpec::percent("focus", "Focus", 0.0f, 1.0f, 0.8f),
                ParamSpec::percent("intensity", "Intensity", 0.0f, 1.0f, 0.6f),
                ParamSpec::choice("mode", "Mode", {"X-Y", "Y-T"}, 0),
                ParamSpec::choice("trigger", "Trigger", {"Y Rising", "Auto", "Beat"}, 0).when("mode", 1, 1),
                ParamSpec::choice("phosphor", "Phosphor", {"Green", "Amber", "Blue-White"}, 0),
                ParamSpec::choice("character", "Character", {"Clean", "Vintage"}, 1),
                ParamSpec::choice("tolerance", "Still Tolerance", {"Tight", "Normal", "Loose"}, 1)};
    s.inputs = {{"x", "X", Signal::Audio}, {"y", "Y", Signal::Audio}, {"z", "Z", Signal::Control}};
    s.outputs = {{"outx", "Out X", Signal::Audio, true},        {"outy", "Out Y", Signal::Audio, true},
                 {"phase", "Phase", Signal::Control, true},     {"corr", "Correlation", Signal::Control, true},
                 {"ratio", "Ratio", Signal::Pitch, true},       {"still", "Still", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<XyScopeModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerXyScopeModule);

}  // namespace bleep::engine
