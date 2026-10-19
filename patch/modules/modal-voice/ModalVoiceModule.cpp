// SPDX-License-Identifier: GPL-3.0-or-later
// Modal Voice node: bow, blow, mallet and external audio drive a modal body
// in a small room (doc/specs/modules/modal-voice.md). Built for Voice Cells: an
// Active output, and the voice sleeps when silent. The view shows an
// exciter scope and the partials from live arrays.
#include "ModalVoiceDsp.h"
#include "Registry.h"
#include "dsp/Smoothing.h"

#include <array>
#include <atomic>

namespace bleep::engine {
namespace {

using patch::ModalVoiceDsp;
using patch::ModalVoiceParams;

class ModalVoiceModule final : public Module {
public:
    enum { Bow, BowTimbre, Blow, BlowTimbre, Strike, StrikeTimbre, Contour, ExtLevel, Coarse, Fine, Geometry, Brightness,
           Damping, Position, Size, Space, Partials, Seed };
    enum { PitchIn, GateIn, StrikeIn, VelocityIn, ExtIn };
    enum { OutL, OutR, Exciter, Active };
    enum { PlayButton };

    static constexpr int kScope = 64;       // points over 50 ms
    static constexpr int kMaxShown = 64;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        scopeLen_ = std::max(1, (int)(0.05 * sampleRate / kScope));
        viewEvery_ = std::max(1, (int)(sampleRate / 30.0));
        reset();
    }
    void reset() override {
        dsp_.reset();
        gate_.reset();
        strike_.reset();
        button_ = false;
        sub_ = 0;
        scopeLeft_ = scopeLen_;
        scopePeak_ = 0.0f;
    }

    void process(const ProcessContext& c) override {
        bool pressed = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index != PlayButton) return;
            const bool down = cmd.value > 0.5f;
            pressed = pressed || (down && !button_);
            button_ = down;
        });
        if (c.transportStarted) dsp_.resetCount();
        const bool strikePatched = c.inputConnected[StrikeIn];
        const bool velocityPatched = c.inputConnected[VelocityIn];
        const bool extPatched = c.inputConnected[ExtIn];
        ModalVoiceParams p;
        static constexpr int partials[3] = {16, 32, 64};
        p.partials = partials[std::clamp((int)setting(Partials), 0, 2)];
        p.seed = (uint64_t)setting(Seed);
        for (int i = 0; i < c.numSamples; ++i) {
            if (sub_ == 0) {
                read(c, i, p);
                dsp_.set(p, c.inputs[PitchIn][i]);
            }
            sub_ = (sub_ + 1) % ModalVoiceDsp::kSub;
            const float vel = velocityPatched ? std::clamp(c.inputs[VelocityIn][i], 0.0f, 1.0f) : 1.0f;
            // The Play button is a gate (and a strike) while held.
            const int edge = gate_.process(std::max(c.inputs[GateIn][i], button_ ? 1.0f : 0.0f));
            const bool rising = edge > 0 || (pressed && i == 0);
            dsp_.gate(gate_.high() || button_, vel);
            const bool strike = strike_.process(c.inputs[StrikeIn][i]) > 0;
            if (strike || (rising && (!strikePatched || (pressed && i == 0)))) dsp_.strike(vel);
            const auto f = dsp_.tick(extPatched ? c.inputs[ExtIn][i] : 0.0f);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
            c.outputs[Exciter][i] = f.exciter;
            c.outputs[Active][i] = f.active ? 1.0f : 0.0f;
            recordScope(f.exciter);
        }
        viewLeft_ -= c.numSamples;
        if (viewLeft_ <= 0) {
            viewLeft_ = viewEvery_;
            publishPartials();
        }
        active_.store(c.numSamples > 0 && c.outputs[Active][c.numSamples - 1] > 0.5f ? 1.0f : 0.0f,
                      std::memory_order_relaxed);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"active", active_.load(std::memory_order_relaxed)});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> scope((size_t)kScope);
        const int w = scopeWrite_.load(std::memory_order_acquire);
        for (int k = 0; k < kScope; ++k) scope[(size_t)k] = scope_[(size_t)((w + k) % kScope)].load(std::memory_order_relaxed);
        out.push_back({"exciter", std::move(scope)});
        const int n = shown_.load(std::memory_order_acquire);
        std::vector<float> hz((size_t)n), amp((size_t)n), level((size_t)n);
        for (size_t k = 0; k < (size_t)n; ++k) {
            hz[k] = hz_[k].load(std::memory_order_relaxed);
            amp[k] = amp_[k].load(std::memory_order_relaxed);
            level[k] = level_[k].load(std::memory_order_relaxed);
        }
        out.push_back({"modeHz", std::move(hz)});
        out.push_back({"modeAmp", std::move(amp)});
        out.push_back({"modeLevel", std::move(level)});
    }

private:
    void read(const ProcessContext& c, int i, ModalVoiceParams& p) const noexcept {
        p.bow = value(c, Bow, i);
        p.bowTimbre = value(c, BowTimbre, i);
        p.blow = value(c, Blow, i);
        p.blowTimbre = value(c, BlowTimbre, i);
        p.strike = value(c, Strike, i);
        p.strikeTimbre = value(c, StrikeTimbre, i);
        p.contour = value(c, Contour, i);
        p.extLevel = value(c, ExtLevel, i);
        p.coarse = value(c, Coarse, i);
        p.fine = value(c, Fine, i);
        p.geometry = value(c, Geometry, i);
        p.brightness = value(c, Brightness, i);
        p.damping = value(c, Damping, i);
        p.position = value(c, Position, i);
        p.size = value(c, Size, i);
        p.space = value(c, Space, i);
    }

    /// The exciter scope keeps the largest (signed) value of each slice.
    void recordScope(float x) noexcept {
        if (std::fabs(x) > std::fabs(scopePeak_)) scopePeak_ = x;
        if (--scopeLeft_ > 0) return;
        scopeLeft_ = scopeLen_;
        const int w = scopeWrite_.load(std::memory_order_relaxed);
        scope_[(size_t)w].store(scopePeak_, std::memory_order_relaxed);
        scopeWrite_.store((w + 1) % kScope, std::memory_order_release);
        scopePeak_ = 0.0f;
    }

    void publishPartials() noexcept {
        const auto& b = dsp_.bank();
        const int n = std::min(b.activeModes(), kMaxShown);
        for (int k = 0; k < n; ++k) {
            hz_[(size_t)k].store(b.modeHz(k), std::memory_order_relaxed);
            amp_[(size_t)k].store(b.modeGain(k), std::memory_order_relaxed);
            level_[(size_t)k].store(dsp_.sleeping() ? 0.0f : b.modeLevel(k), std::memory_order_relaxed);
        }
        shown_.store(n, std::memory_order_release);
    }

    ModalVoiceDsp dsp_;
    dsp::GateEdge gate_, strike_;
    bool button_ = false;
    int sub_ = 0, viewEvery_ = 1600, viewLeft_ = 0;
    int scopeLen_ = 37, scopeLeft_ = 37;
    float scopePeak_ = 0.0f;
    std::array<std::atomic<float>, kScope> scope_{};
    std::atomic<int> scopeWrite_{0};
    std::array<std::atomic<float>, kMaxShown> hz_{}, amp_{}, level_{};
    std::atomic<int> shown_{0};
    std::atomic<float> active_{0.0f};
};

}  // namespace

static void registerModalVoiceModule(Registry& r) {
    ModuleSpec s;
    s.type = "modal-voice";
    s.name = "Modal Voice";
    s.category = "Sources/Voices";
    s.colour = "#14b8a6";
    s.description = "Physical-modelling instrument: bow, breath, mallet or any audio drive a modal body (string, bar, "
                    "plate, bell) in a small room. Active frees a Voice Cell's voice.";
    const char* ex = "Exciter";
    const char* res = "Resonator";
    const char* sp = "Space";
    ParamSpec coarse = ParamSpec::number("coarse", "Coarse", -24.0f, 24.0f, 0.0f, "st", 1);
    coarse.format = ParamSpec::Format::Semitones;
    s.params = {ParamSpec::percent("bow", "Bow", 0.0f, 1.0f, 0.0f).inGroup(ex),
                ParamSpec::percent("bowTimbre", "Bow Timbre", 0.0f, 1.0f, 0.5f).inGroup(ex),
                ParamSpec::percent("blow", "Blow", 0.0f, 1.0f, 0.0f).inGroup(ex),
                ParamSpec::percent("blowTimbre", "Blow Timbre", 0.0f, 1.0f, 0.4f).inGroup(ex),
                ParamSpec::percent("strike", "Strike", 0.0f, 1.0f, 0.8f).inGroup(ex),
                ParamSpec::percent("strikeTimbre", "Strike Timbre", 0.0f, 1.0f, 0.5f).inGroup(ex),
                ParamSpec::percent("contour", "Contour", 0.0f, 1.0f, 0.3f).inGroup(ex),
                ParamSpec::percent("extLevel", "Ext Level", 0.0f, 1.0f, 1.0f).inGroup(ex),
                coarse.inGroup(res),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0).inGroup(res),
                ParamSpec::percent("geometry", "Geometry", 0.0f, 1.0f, 0.25f).inGroup(res),
                ParamSpec::percent("brightness", "Brightness", 0.0f, 1.0f, 0.55f).inGroup(res),
                ParamSpec::percent("damping", "Damping", 0.0f, 1.0f, 0.4f).inGroup(res),
                ParamSpec::percent("position", "Position", 0.0f, 1.0f, 0.3f).inGroup(res),
                ParamSpec::percent("size", "Size", 0.0f, 1.0f, 0.4f).inGroup(sp),
                ParamSpec::percent("space", "Space", 0.0f, 1.0f, 0.2f).inGroup(sp),
                ParamSpec::choice("partials", "Partials", {"16", "32", "64"}, 1),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch},
                {"gate", "Gate", Signal::Gate},
                {"strike", "Strike", Signal::Trigger},
                {"velocity", "Velocity", Signal::Control},
                {"ext", "Ext In", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"exciter", "Exciter", Signal::Audio, true},
                 {"active", "Active", Signal::Gate, false}};
    s.buttons = {{"play", "Play", true}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ModalVoiceModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerModalVoiceModule);

}  // namespace bleep::engine
