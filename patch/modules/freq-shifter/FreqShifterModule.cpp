// SPDX-License-Identifier: MIT
// Freq Shifter node (specs/modules/frequency-shifter.md): moves every
// frequency of a stereo signal by the same number of hertz, with feedback
// spirals, opposite shifts left/right, tempo sync and a quadrature LFO out.
#include "FreqShifterDsp.h"
#include "Registry.h"
#include "dsp/Tempo.h"
#include "dsp/Waves.h"

#include <atomic>
#include <complex>

namespace bleep::engine {
namespace {

using patch::FreqShifterDsp;

/// The last kSize input and output samples (mono), written by the audio
/// thread and read by the view's spectrum on the message thread.
class SpectrumTap {
public:
    static constexpr int kSize = 4096;
    void push(float in, float out) noexcept {
        const uint32_t w = write_.load(std::memory_order_relaxed);
        in_[w % kSize].store(in, std::memory_order_relaxed);
        out_[w % kSize].store(out, std::memory_order_relaxed);
        write_.store(w + 1, std::memory_order_release);
    }
    /// Log-spaced magnitudes in dB (20 Hz … 20 kHz) of the newest kSize samples.
    void spectrum(bool output, double sampleRate, std::vector<float>& bins) const {
        const uint32_t w = write_.load(std::memory_order_acquire);
        std::vector<std::complex<float>> x(kSize);
        const auto& src = output ? out_ : in_;
        for (int i = 0; i < kSize; ++i) {
            const float hann = 0.5f - 0.5f * std::cos(6.2831853f * (float)i / (float)(kSize - 1));
            x[(size_t)i] = src[(w + (uint32_t)i) % kSize].load(std::memory_order_relaxed) * hann;
        }
        fft(x);
        const int n = (int)bins.size();
        for (int b = 0; b < n; ++b) {
            const double f0 = 20.0 * std::pow(1000.0, (double)b / n), f1 = 20.0 * std::pow(1000.0, (double)(b + 1) / n);
            int k0 = (int)(f0 / sampleRate * kSize), k1 = (int)(f1 / sampleRate * kSize);
            k0 = std::clamp(k0, 1, kSize / 2 - 1);
            k1 = std::clamp(std::max(k1, k0 + 1), 2, kSize / 2);
            float peak = 0.0f;
            for (int k = k0; k < k1; ++k) peak = std::max(peak, std::abs(x[(size_t)k]));
            bins[(size_t)b] = 20.0f * std::log10(std::max(peak * 4.0f / kSize, 1e-6f));  // full-scale sine ≈ 0 dB
        }
    }

private:
    static void fft(std::vector<std::complex<float>>& a) {
        const size_t n = a.size();
        for (size_t i = 1, j = 0; i < n; ++i) {
            size_t bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) std::swap(a[i], a[j]);
        }
        for (size_t len = 2; len <= n; len <<= 1) {
            const float ang = -6.2831853f / (float)len;
            const std::complex<float> wl(std::cos(ang), std::sin(ang));
            for (size_t i = 0; i < n; i += len) {
                std::complex<float> w(1.0f, 0.0f);
                for (size_t j = 0; j < len / 2; ++j) {
                    const auto u = a[i + j], v = a[i + j + len / 2] * w;
                    a[i + j] = u + v;
                    a[i + j + len / 2] = u - v;
                    w *= wl;
                }
            }
        }
    }
    std::array<std::atomic<float>, kSize> in_{}, out_{};
    std::atomic<uint32_t> write_{0};
};

class FreqShifterModule final : public Module {
public:
    enum { Shift, Fine, Feedback, FbDelay, Spread, Mix, Range, Sync, AntiAlias };
    enum { InL, InR, Reset };
    enum { OutL, OutR, UpL, UpR, DownL, DownR, Sin, Cos };

    static constexpr float kRanges[4] = {10.0f, 200.0f, 2000.0f, 10000.0f};

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override {
        dsp_.reset();
        resetHigh_ = false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"phaseL", (double)phaseL_.load()});
        out.push_back({"phaseR", (double)phaseR_.load()});
        out.push_back({"shiftHz", (double)shiftHz_.load()});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> in(96), wet(96);
        tap_.spectrum(false, sampleRate_, in);
        tap_.spectrum(true, sampleRate_, wet);
        out.emplace_back("spectrumIn", std::move(in));
        out.emplace_back("spectrumOut", std::move(wet));
    }

    void process(const ProcessContext& c) override {
        // A mono source (only L patched) feeds both channels.
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const float range = kRanges[std::clamp((int)setting(Range), 0, 3)];
        const double beats = dsp::syncBeats((int)setting(Sync));
        const bool locked = beats > 0.0 && c.transport->playing && c.transport->ppqValid;
        if (c.transportStarted && beats > 0.0) dsp_.restartPhase();
        patch::FreqShifterParams p;
        p.antiAlias = setting(AntiAlias) >= 0.5f;
        patch::FreqShifterFrame f;
        for (int i = 0; i < c.numSamples; ++i) {
            const float shift = value(c, Shift, i);
            if (beats > 0.0) {
                const double sign = shift >= 0.0f ? 1.0 : -1.0;
                p.shiftHz = sign * dsp::syncedHz(c.transport->bpm, beats);
                if (locked) dsp_.setPhase(sign * dsp::ppqPhase(c.ppqAt(i), beats));
            } else {
                p.shiftHz = (double)(shift * range + value(c, Fine, i));
            }
            const bool high = c.inputs[Reset][i] >= 0.5f;
            if (high && !resetHigh_ && !locked) dsp_.triggerReset();
            resetHigh_ = high;
            p.feedback = value(c, Feedback, i);
            p.fbDelay = value(c, FbDelay, i);
            p.spread = value(c, Spread, i);
            p.mix = value(c, Mix, i);
            f.in[0] = c.inputs[InL][i];
            f.in[1] = inR[i];
            dsp_.tick(p, f);
            c.outputs[OutL][i] = f.out[0];
            c.outputs[OutR][i] = f.out[1];
            c.outputs[UpL][i] = f.up[0];
            c.outputs[UpR][i] = f.up[1];
            c.outputs[DownL][i] = f.down[0];
            c.outputs[DownR][i] = f.down[1];
            c.outputs[Sin][i] = f.sin;
            c.outputs[Cos][i] = f.cos;
            tap_.push(0.5f * (f.in[0] + f.in[1]), 0.5f * (f.out[0] + f.out[1]));
        }
        phaseL_.store((float)dsp_.phaseL());
        phaseR_.store((float)dsp_.phaseR());
        shiftHz_.store((float)p.shiftHz);
    }

private:
    FreqShifterDsp dsp_;
    SpectrumTap tap_;
    bool resetHigh_ = false;
    std::atomic<float> phaseL_{0.0f}, phaseR_{0.0f}, shiftHz_{0.0f};
};

}  // namespace

void registerFreqShifterModule(Registry& r) {
    ModuleSpec s;
    s.type = "freq-shifter";
    s.name = "Freq Shifter";
    s.category = "Audio";
    s.colour = "#65a30d";
    s.description = "Single-sideband frequency shifter: barber-pole phasing, bells and spirals with feedback, "
                    "opposite shifts left/right, tempo sync, quadrature LFO out.";
    std::vector<std::string> sync;
    for (const char* n : dsp::syncNames()) sync.emplace_back(n);
    auto fine = ParamSpec::number("fine", "Fine", -10.0f, 10.0f, 0.0f, "Hz", 2);
    auto fbDelay = ParamSpec::seconds("fbDelay", "FB Delay", 0.0f, 1.0f, 0.1f, 0.0f);
    s.params = {ParamSpec::percent("shift", "Shift", -1.0f, 1.0f, 0.0f),
                fine.when("sync", 0, 0),
                ParamSpec::percent("feedback", "Feedback", -1.0f, 1.0f, 0.0f).inGroup("Feedback"),
                fbDelay.inGroup("Feedback"),
                ParamSpec::percent("spread", "Spread", 0.0f, 1.0f, 0.0f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 1.0f),
                ParamSpec::choice("range", "Range", {"\xc2\xb1" "10 Hz", "\xc2\xb1" "200 Hz", "\xc2\xb1" "2 kHz", "\xc2\xb1" "10 kHz"}, 1),
                ParamSpec::choice("sync", "Sync", sync, 0),
                ParamSpec::toggle("antiAlias", "Anti-alias", true)};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"reset", "Reset", Signal::Trigger}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},       {"r", "Out R", Signal::Audio, true},
                 {"upL", "Up L", Signal::Audio, true},      {"upR", "Up R", Signal::Audio, true},
                 {"downL", "Down L", Signal::Audio, true},  {"downR", "Down R", Signal::Audio, true},
                 {"sin", "Sin", Signal::Control, true},     {"cos", "Cos", Signal::Control, true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<FreqShifterModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerFreqShifterModule);

}  // namespace bleep::engine
