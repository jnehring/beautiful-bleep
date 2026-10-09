// SPDX-License-Identifier: MIT
// Wave Analyzer node (doc/specs/modules/wave-analyzer.md): a very narrow tunable
// band-pass that picks single partials out of a sound, sweeps them into a
// plotted spectrum or hunts for the strongest one and locks to it.
#include "Registry.h"
#include "WaveAnalyzerDsp.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::WaveAnalyzerDsp;

/// Raises a to v if v is larger (audio thread; the view resets it on read).
void raise(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v > prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}

class WaveAnalyzerModule final : public Module {
public:
    enum { Frequency, Span, SweepTime, Capture, Drift, Listen, Threshold, Gain,
           Mode, Bandwidth, Range, SweepDir, Sync, Floor, Ballistics, Seed };
    enum { In, Pitch, Reset, Hold };
    enum { Thru, Band, Shifted, Level, Track, Peak, Locked };

    /// The plotter: columns over 20 Hz–20 kHz, log spaced (spec §5).
    static constexpr int kColumns = 384;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"f", (double)tuned_.load(std::memory_order_relaxed)});
        out.push_back({"level", (double)level_.load(std::memory_order_relaxed)});
        out.push_back({"locked", locked_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"hunting", hunting_.load(std::memory_order_relaxed) ? 1.0 : 0.0});
        out.push_back({"tooFast", tooFast_.exchange(false) ? 1.0 : 0.0});
        out.push_back({"pass", (double)pass_.load(std::memory_order_relaxed)});
    }

    /// Per-column needle maxima since the view last read them (then reset).
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> ink((size_t)kColumns);
        for (int k = 0; k < kColumns; ++k) ink[(size_t)k] = ink_[(size_t)k].exchange(0.0f, std::memory_order_relaxed);
        out.emplace_back("ink", std::move(ink));
    }

    void process(const ProcessContext& c) override {
        patch::WaveAnalyzerParams p;
        p.mode = (int)setting(Mode);
        p.bandwidth = (int)setting(Bandwidth);
        p.range = (int)setting(Range);
        p.sweepDir = (int)setting(SweepDir);
        p.sync = (int)setting(Sync);
        p.floor = (int)setting(Floor);
        p.needle = setting(Ballistics) < 0.5f;
        p.seed = (uint32_t)setting(Seed);
        p.voice = c.voice;
        patch::WaveAnalyzerInput in;
        in.running = c.transport->playing && c.transport->ppqValid;
        in.bpm = c.transport->bpm;
        in.wantShifted = c.isOutputConnected(Shifted);
        const double sr = sampleRate_ > 0.0 ? sampleRate_ : 48000.0;
        const int64_t songStart = c.transport->samplePos + c.offset;
        patch::WaveAnalyzerFrame f;
        bool tooFast = false;
        for (int i = 0; i < c.numSamples; ++i) {
            p.freqNorm = (double)c.params[Frequency][i];  // Range maps it (WaveAnalyzerDsp::dialHz)
            p.span = cachedValue(c, Span, i);
            p.sweepTime = cachedValue(c, SweepTime, i);
            p.capture = cachedValue(c, Capture, i);
            p.drift = cachedValue(c, Drift, i);
            p.listen = cachedValue(c, Listen, i);
            p.threshold = cachedValue(c, Threshold, i);
            p.gainDb = cachedValue(c, Gain, i);
            in.in = c.inputs[In][i];
            in.pitch = c.inputs[Pitch][i];
            in.reset = c.inputs[Reset][i];
            in.hold = c.inputs[Hold][i];
            in.started = c.transportStarted && i == 0;
            in.ppq = c.ppqAt(i);
            in.songSeconds = (double)(songStart + i) / sr;
            dsp_.tick(p, in, f);
            c.outputs[Thru][i] = in.in;
            c.outputs[Band][i] = f.band;
            c.outputs[Shifted][i] = f.shifted;
            c.outputs[Level][i] = f.level;
            c.outputs[Track][i] = f.track;
            c.outputs[Peak][i] = f.peak;
            c.outputs[Locked][i] = f.locked;
            tooFast = tooFast || dsp_.tooFast();
            pen(dsp_.tunedHz(), f.level);
        }
        flushPen();
        tuned_.store((float)dsp_.tunedHz(), std::memory_order_relaxed);
        level_.store(f.level, std::memory_order_relaxed);
        locked_.store(f.locked > 0.5f, std::memory_order_relaxed);
        hunting_.store(dsp_.lockState() == WaveAnalyzerDsp::LockState::Hunt, std::memory_order_relaxed);
        if (tooFast) tooFast_.store(true, std::memory_order_relaxed);
        pass_.store(dsp_.pass(), std::memory_order_relaxed);
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

    /// The plotter pen: keeps the column's maximum locally, publishes it when
    /// the pen leaves the column (one atomic per column visit, not per sample).
    void pen(double hz, float level) noexcept {
        const double x = std::log(std::max(hz, 1.0) / 20.0) / std::log(1000.0);
        const int col = (int)std::floor(x * kColumns);
        if (col != penCol_) {
            flushPen();
            penCol_ = col;
        }
        penMax_ = std::max(penMax_, level);
    }
    void flushPen() noexcept {
        if (penCol_ >= 0 && penCol_ < kColumns && penMax_ > 0.0f) raise(ink_[(size_t)penCol_], penMax_);
        penMax_ = 0.0f;
    }

    WaveAnalyzerDsp dsp_;
    mutable std::array<std::atomic<float>, kColumns> ink_{};
    int penCol_ = -1;
    float penMax_ = 0.0f;
    std::atomic<float> tuned_{440.0f}, level_{0.0f};
    std::atomic<bool> locked_{false}, hunting_{false};
    mutable std::atomic<bool> tooFast_{false};
    std::atomic<uint32_t> pass_{0};
    std::array<float, 32> knobNorm_ = [] {
        std::array<float, 32> a;
        a.fill(-1.0f);
        return a;
    }();
    std::array<float, 32> knobUnits_{};
};

}  // namespace

static void registerWaveAnalyzerModule(Registry& r) {
    ModuleSpec s;
    s.type = "wave-analyzer";
    s.name = "Wave Analyzer";
    s.category = "Audio";
    s.colour = "#22d3ee";
    s.description = "A very narrow tunable band-pass: pick single partials out of a sound, sweep them into a "
                    "spectrum, or lock onto the strongest one and follow it.";
    std::vector<std::string> sync;
    for (const char* n : WaveAnalyzerDsp::syncNames()) sync.emplace_back(n);
    s.params = {ParamSpec::hertz("frequency", "Frequency", 20.0f, 20000.0f, 440.0f),
                ParamSpec::number("span", "Span", 0.0f, 10.0f, 4.0f, "oct", 2).when("mode", 1, 1),
                ParamSpec::exponential("sweeptime", "Sweep Time", 0.1f, 120.0f, 8.0f, "s").when("mode", 1, 1),
                ParamSpec::number("capture", "Capture", 0.0f, 24.0f, 7.0f, "st", 1).when("mode", 2, 2),
                ParamSpec::percent("drift", "Drift", 0.0f, 1.0f, 0.15f),
                ParamSpec::hertz("listen", "Listen", 50.0f, 4000.0f, 800.0f),
                ParamSpec::percent("threshold", "Threshold", 0.0f, 1.0f, 0.6f),
                ParamSpec::number("gain", "Gain", -20.0f, 40.0f, 12.0f, "dB", 1),
                ParamSpec::choice("mode", "Mode", {"Manual", "Sweep", "Lock"}, 0),
                ParamSpec::choice("bandwidth", "Bandwidth", {"3 Hz", "10 Hz", "30 Hz", "100 Hz", "1/3 octave"}, 1),
                ParamSpec::choice("range", "Range", {"Full", "20–200 Hz", "200 Hz–2 kHz", "2–20 kHz"}, 0),
                ParamSpec::choice("sweepdir", "Sweep Dir", {"Up", "Down", "Up-Down"}, 0).when("mode", 1, 1),
                ParamSpec::choice("sync", "Sync", sync, 0).when("mode", 1, 1),
                ParamSpec::choice("floor", "Floor", {"-24 dB", "-36 dB", "-48 dB", "-60 dB", "-72 dB", "-96 dB"},
                                  patch::kWaveAnalyzerDefaultFloor),
                ParamSpec::choice("ballistics", "Ballistics", {"Needle", "Fast"}, 0),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"in", "In", Signal::Audio},
                {"pitch", "Pitch", Signal::Pitch},
                {"reset", "Reset", Signal::Trigger},
                {"hold", "Hold", Signal::Gate}};
    s.outputs = {{"thru", "Thru", Signal::Audio, true},       {"band", "Band", Signal::Audio, true},
                 {"shifted", "Shifted", Signal::Audio, true}, {"level", "Level", Signal::Control, false},
                 {"track", "Track", Signal::Pitch, true},     {"peak", "Peak", Signal::Trigger, false},
                 {"locked", "Locked", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<WaveAnalyzerModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerWaveAnalyzerModule);

}  // namespace bleep::engine
