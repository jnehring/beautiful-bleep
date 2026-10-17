// SPDX-License-Identifier: MIT
// EQ node (doc/eq.md): six bands (bell, shelves, cuts, notch, band-pass), stereo.
#include "EqDsp.h"
#include "Registry.h"
#include "dsp/SpectrumTap.h"

#include <algorithm>
#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::Biquad;
using patch::EqBand;
using patch::EqDsp;

constexpr int kFields = 6;                  // per band: On, Type, Hz, Gain, Q, Slope
constexpr int kSlopeOrders[] = {1, 2, 3, 4, 6, 8};  // 6, 12, 18, 24, 36, 48 dB/octave

class EqModule final : public Module {
public:
    enum Field { On, Type, Hz, Gain, Q, Slope };
    /// Param index: the selected band (a view setting), then kFields per band, then the output level.
    static constexpr int kSelected = 0;
    static constexpr int idx(int band, Field f) { return 1 + band * kFields + f; }
    static constexpr int kLevel = 1 + EqDsp::kBands * kFields;
    enum { InL, InR };
    enum { OutL, OutR };
    static constexpr int kBlock = 16;  // bands are redesigned every 16 samples at most

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_[0].prepare(sampleRate);
        dsp_[1].prepare(sampleRate);
    }
    void reset() override {
        dsp_[0].reset();
        dsp_[1].reset();
    }

    /// For the view: the audio going in and out (log-spaced dB, 20 Hz ... 20 kHz) and the sample rate. The view
    /// draws the response curve itself from the band params (modulation included), so it follows every change at once.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> in(kBins), wet(kBins);
        tap_.spectrum(false, sampleRate_, in);
        tap_.spectrum(true, sampleRate_, wet);
        out.emplace_back("spectrumIn", std::move(in));
        out.emplace_back("spectrumOut", std::move(wet));
        out.emplace_back("sampleRate", std::vector<float>{(float)sampleRate_});
    }

    void process(const ProcessContext& c) override {
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        EqBand bands[EqDsp::kBands];
        float level = 1.0f;
        for (int i = 0; i < c.numSamples; ++i) {
            if (i % kBlock == 0) {
                for (int k = 0; k < EqDsp::kBands; ++k) {
                    const int type = std::clamp((int)std::lround(setting(idx(k, Type))), 0, (int)EqBand::NumKinds - 1);
                    const int slope = std::clamp((int)std::lround(setting(idx(k, Slope))), 0, 5);
                    bands[k] = {(EqBand::Kind)type, setting(idx(k, On)) > 0.5f, value(c, idx(k, Hz), i), value(c, idx(k, Gain), i),
                                value(c, idx(k, Q), i), kSlopeOrders[slope]};
                }
                dsp_[0].setBands(bands);
                dsp_[1].setBands(bands);
                level = std::pow(10.0f, value(c, kLevel, i) * 0.05f);
            }
            c.outputs[OutL][i] = dsp_[0].tick(c.inputs[InL][i]) * level;
            c.outputs[OutR][i] = dsp_[1].tick(inR[i]) * level;
            tap_.push(0.5f * (c.inputs[InL][i] + inR[i]), 0.5f * (c.outputs[OutL][i] + c.outputs[OutR][i]));
        }
    }

private:
    static constexpr int kBins = 128;

    EqDsp dsp_[2];
    dsp::SpectrumTap tap_;
};

struct BandDefault {
    EqBand::Kind kind;
    float hz;
    float q;
    bool on;
};
// Bands 1 and 6 start as (off) cuts, 2 and 5 as shelves, 3 and 4 as bells.
constexpr BandDefault kDefaults[EqDsp::kBands] = {
    {EqBand::LowCut, 40.0f, 1.0f, false},  {EqBand::LowShelf, 120.0f, 0.7f, true}, {EqBand::Bell, 400.0f, 1.0f, true},
    {EqBand::Bell, 2000.0f, 1.0f, true},   {EqBand::HighShelf, 8000.0f, 0.7f, true}, {EqBand::HighCut, 16000.0f, 1.0f, false}};

}  // namespace

static void registerEqModule(Registry& r) {
    ModuleSpec s;
    s.type = "eq";
    s.name = "EQ";
    s.category = "Effects/Dynamics & EQ";
    s.colour = "#0ea5e9";
    s.description = "Six-band parametric equaliser. Every band is a bell, low or high shelf, low or high cut, notch or band-pass. "
                    "Frequency, gain and Q of every band can be modulated.";
    // The band being edited in the view: a setting of the view, not of the sound.
    s.params.push_back(ParamSpec::choice("band", "Band", {"1", "2", "3", "4", "5", "6"}, 0));
    for (int k = 0; k < EqDsp::kBands; ++k) {
        const std::string n = std::to_string(k + 1), id = "b" + n, name = "Band " + n + " ";
        const BandDefault& d = kDefaults[k];
        s.params.push_back(ParamSpec::toggle(id + "On", name + "On", d.on));
        s.params.push_back(ParamSpec::choice(id + "Type", name + "Type",
                                             {"Bell", "Low Shelf", "High Shelf", "Low Cut", "High Cut", "Notch", "Band Pass"}, (int)d.kind));
        s.params.push_back(ParamSpec::exponential(id + "Hz", name + "Freq", 20.0f, 20000.0f, d.hz, "Hz"));
        s.params.push_back(ParamSpec::number(id + "Gain", name + "Gain", -18.0f, 18.0f, 0.0f, "dB", 1));
        s.params.push_back(ParamSpec::exponential(id + "Q", name + "Q", 0.1f, 18.0f, d.q));
        s.params.push_back(ParamSpec::choice(id + "Slope", name + "Slope",
                                             {"6 dB/oct", "12 dB/oct", "18 dB/oct", "24 dB/oct", "36 dB/oct", "48 dB/oct"}, 1));
    }
    s.params.push_back(ParamSpec::number("level", "Level", -18.0f, 6.0f, 0.0f, "dB", 1));
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<EqModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerEqModule);

}  // namespace bleep::engine
