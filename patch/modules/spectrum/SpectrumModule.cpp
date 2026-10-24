// SPDX-License-Identifier: GPL-3.0-only
// Spectrum node (doc/specs/modules/spectrum.md): an analyser for the view and three
// signals taken from the same spectrum: Dominant (the strongest partial), Centroid
// (the centre of gravity) and Flux (a trigger when new energy arrives).
//
// The audio thread publishes the display under a sequence counter (as the Scope does);
// the audio passes through unchanged.
#include "Registry.h"
#include "SpectrumDsp.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using namespace patch;

class SpectrumModule final : public Module {
public:
    enum { Size, Average, Tilt, Peak, Sensitivity, Floor };
    enum { InL, InR };
    enum { OutL, OutR, Dominant, Centroid, Flux, FluxAmount };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        seen_ = 0;
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"dominant", (double)dominant_.load(std::memory_order_relaxed)});
        out.push_back({"centroid", (double)centroid_.load(std::memory_order_relaxed)});
        out.push_back({"valid", valid_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"top", (double)top_.load(std::memory_order_relaxed)});
    }

    /// "spec" and "peak": dB per display column (kSpectrumBins), 20 Hz upwards, tilt included; empty when unchanged.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> spec, peak;
        const uint32_t s1 = seq_.load(std::memory_order_acquire);
        if (s1 != lastSent_ && (s1 & 1u) == 0) {
            spec.resize(kSpectrumBins);
            peak.resize(kSpectrumBins);
            for (size_t i = 0; i < kSpectrumBins; ++i) {
                spec[i] = spec_[i].load(std::memory_order_relaxed);
                peak[i] = peak_[i].load(std::memory_order_relaxed);
            }
            std::atomic_thread_fence(std::memory_order_acquire);
            if (seq_.load(std::memory_order_relaxed) != s1) spec.clear(), peak.clear();
            else lastSent_ = s1;
        }
        out.push_back({"spec", std::move(spec)});
        out.push_back({"peak", std::move(peak)});
    }

    void process(const ProcessContext& c) override {
        pollCommands([&](const Command&) { dsp_.resetPeaks(); });
        SpectrumParams p;
        p.size = (int)setting(Size);
        p.average = value(c, Average, 0);
        p.tilt = value(c, Tilt, 0);
        p.peak = (int)setting(Peak);
        p.sensitivity = value(c, Sensitivity, 0);
        const bool stereo = c.inputConnected[InR];
        for (int i = 0; i < c.numSamples; ++i) {
            const float l = c.inputs[InL][i], r = c.inputs[InR][i];
            const SpectrumOutputs& o = dsp_.tick(p, stereo ? 0.5f * (l + r) : l);
            c.outputs[OutL][i] = l;
            c.outputs[OutR][i] = r;
            c.outputs[Dominant][i] = o.dominant;
            c.outputs[Centroid][i] = o.centroid;
            c.outputs[Flux][i] = o.trigger;
            c.outputs[FluxAmount][i] = o.flux;
            last_ = o;
        }
        if (dsp_.hops() != seen_) {
            seen_ = dsp_.hops();
            seq_.fetch_add(1, std::memory_order_release);
            for (size_t i = 0; i < kSpectrumBins; ++i) {
                spec_[i].store(dsp_.display()[i], std::memory_order_relaxed);
                peak_[i].store(dsp_.peaks()[i], std::memory_order_relaxed);
            }
            seq_.fetch_add(1, std::memory_order_release);
        }
        dominant_.store(last_.dominant, std::memory_order_relaxed);
        centroid_.store(last_.centroid, std::memory_order_relaxed);
        valid_.store(dsp_.valid(), std::memory_order_relaxed);
        top_.store(dsp_.topHz(), std::memory_order_relaxed);
    }

private:
    SpectrumDsp dsp_;
    SpectrumOutputs last_;
    uint32_t seen_ = 0;
    mutable uint32_t lastSent_ = 0;
    std::atomic<uint32_t> seq_{0};
    std::array<std::atomic<float>, kSpectrumBins> spec_{}, peak_{};
    std::atomic<float> dominant_{-4.0f}, centroid_{-4.0f}, top_{20000.0f};
    std::atomic<bool> valid_{false};
};

}  // namespace

static void registerSpectrumModule(Registry& r) {
    ModuleSpec s;
    s.type = "spectrum";
    s.name = "Spectrum";
    s.category = "Utility/Metering";
    s.colour = "#f0abfc";
    s.description = "A live spectrum on a logarithmic axis with averaging, tilt and a peak line. The strongest partial, the "
                    "centroid and the flux (a trigger for new energy) come out as signals.";
    auto tilt = ParamSpec::number("tilt", "Tilt", -6.0f, 9.0f, 0.0f, "dB/oct", 1);
    auto floor = ParamSpec::number("floor", "Floor", -120.0f, -30.0f, -90.0f, "dB", 0);
    s.params = {ParamSpec::choice("size", "Resolution", {"1024", "2048", "4096", "8192"}, 2),
                ParamSpec::seconds("average", "Average", 0.0f, 3.0f, 0.3f, 0.15f),
                tilt,
                ParamSpec::choice("peak", "Peak Line", {"Off", "Falling", "Hold"}, 1),
                ParamSpec::percent("sensitivity", "Flux Sensitivity", 0.0f, 1.0f, 0.5f),
                floor};
    s.buttons = {{"reset", "Reset Peaks"}};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"dominant", "Dominant", Signal::Pitch, true},
                 {"centroid", "Centroid", Signal::Pitch, true},
                 {"flux", "Flux", Signal::Trigger, false},
                 {"fluxamount", "Flux Amount", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SpectrumModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSpectrumModule);

}  // namespace bleep::engine
