// SPDX-License-Identifier: GPL-3.0-only
// Verb node (doc/specs/modules/reverb.md): a stereo FDN reverb whose every knob,
// Size and Decay included, can be modulated at audio rate; infinite decay,
// Freeze (gate or latch), Clear, tempo-synced pre-delay. Type switches the
// tank from the hall to a dispersive spring.
#include "ReverbDsp.h"
#include "Registry.h"
#include "dsp/Delay.h"
#include "dsp/Tempo.h"

#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::ReverbDsp;

/// Pre-delay Sync choices: Free, then 1/64 … 1/2, each triplet, straight, dotted.
const std::vector<std::string>& preSyncNames() {
    static const std::vector<std::string> names = [] {
        std::vector<std::string> n{"Free"};
        for (const char* v : {"1/64", "1/32", "1/16", "1/8", "1/4", "1/2"})
            for (const char* suffix : {"T", "", "."}) n.push_back(std::string(v) + suffix);
        return n;
    }();
    return names;
}

class ReverbModule final : public Module {
public:
    enum { Size, Decay, PreDelay, Diffusion, Damping, Bass, ModRate, ModDepth, Tone, Width, Mix,
           PreSync, Quality, ClearOnPlay, Seed, FreezeLatch, Type, Early, Room };
    enum { InL, InR, Freeze, Clear };
    enum { OutL, OutR, WetL, WetR, Env };
    enum { ClearButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.setType((int)setting(Type));
        dsp_.setRoom((int)setting(Room));
        dsp_.prepare(sampleRate, setting(Quality) >= 0.5f ? 16 : 8, (uint64_t)setting(Seed));
        clearHigh_ = false;
    }
    void reset() override { dsp_.clearNow(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"frozen", frozen_.load() ? 1.0 : 0.0});
        out.push_back({"preDelayMs", (double)preDelayMs_.load()});
        out.push_back({"env", (double)env_.load()});
    }

    void process(const ProcessContext& c) override {
        pollCommands([&](const Command& cmd) {
            if (cmd.index == ClearButton && cmd.value > 0.5f) dsp_.clear();
        });
        dsp_.setLines(setting(Quality) >= 0.5f ? 16 : 8);
        dsp_.setSeed((uint64_t)setting(Seed));
        dsp_.setType((int)setting(Type));
        dsp_.setRoom((int)setting(Room));
        if (c.transportStarted) {
            if (setting(ClearOnPlay) >= 0.5f) dsp_.clearNow();
            else dsp_.restartModulation();
        }
        const bool latched = setting(FreezeLatch) >= 0.5f;
        // Synced pre-delay: the note value at the current tempo, at most 1 s.
        const int sync = (int)setting(PreSync);
        double syncedSamples = -1.0;
        if (sync > 0) {
            const int index = dsp::noteValueIndex(preSyncNames()[(size_t)sync].c_str());
            syncedSamples = std::min(dsp::noteValueSamples(index, c.transport->bpm, sampleRate_), sampleRate_);
        }
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        patch::ReverbParams& p = params_;  // kept: the slow params are only refreshed every 8 samples
        patch::ReverbFrame f;
        bool frozen = latched;
        for (int i = 0; i < c.numSamples; ++i) {
            const bool clearHigh = c.inputs[Clear][i] >= 0.5f;
            if (clearHigh && !clearHigh_) dsp_.clear();
            clearHigh_ = clearHigh;
            p.freeze = latched || c.inputs[Freeze][i] >= 0.5f;
            frozen = frozen || p.freeze;
            p.size = value(c, Size, i);
            p.preDelaySamples = syncedSamples >= 0.0 ? syncedSamples : dsp::msToSamples(1000.0 * value(c, PreDelay, i), sampleRate_);
            if (dsp_.controlDue()) {  // the rest is read at the tank's gain rate (every 8 samples)
                p.decay = c.params[Decay][i];  // normalised: the infinite region is on the knob's top
                p.diffusion = value(c, Diffusion, i);
                p.damping = value(c, Damping, i);
                p.bass = value(c, Bass, i);
                p.modRate = value(c, ModRate, i);
                p.modDepth = value(c, ModDepth, i);
                p.tone = value(c, Tone, i);
                p.width = value(c, Width, i);
                p.mix = value(c, Mix, i);
                p.early = value(c, Early, i);
            }
            f.in[0] = c.inputs[InL][i];
            f.in[1] = inR[i];
            dsp_.tick(p, f);
            c.outputs[OutL][i] = f.out[0];
            c.outputs[OutR][i] = f.out[1];
            c.outputs[WetL][i] = f.wet[0];
            c.outputs[WetR][i] = f.wet[1];
            c.outputs[Env][i] = f.env;
        }
        frozen_.store(frozen);
        preDelayMs_.store((float)(1000.0 * p.preDelaySamples / sampleRate_));
        env_.store(f.env);
    }

private:
    ReverbDsp dsp_;
    patch::ReverbParams params_;
    bool clearHigh_ = false;
    std::atomic<bool> frozen_{false};
    std::atomic<float> preDelayMs_{0.0f}, env_{0.0f};
};

}  // namespace

static void registerReverbModule(Registry& r) {
    ModuleSpec s;
    s.type = "reverb";
    s.name = "Verb";
    s.category = "Effects/Space & Time";
    s.colour = "#f0abfc";
    s.description = "Stereo FDN reverb built to be played: every knob, Size and Decay included, modulates "
                    "click-free; small rooms to endless pads, infinite decay and Freeze; "
                    "a Room adds discrete early reflections ahead of the tail; or switch Type to Spring for a metallic, dispersive, boingy tail.";
    auto decay = ParamSpec::exponential("decay", "Decay", (float)ReverbDsp::kMinT60, (float)ReverbDsp::knobTopSeconds(), 2.5f);
    decay.format = ParamSpec::Format::Seconds;
    auto bass = ParamSpec::exponential("bass", "Bass", 0.5f, 2.0f, 1.0f, "\xc3\x97");
    auto modRate = ParamSpec::hertz("modRate", "Mod Rate", 0.05f, 8.0f, 0.6f);
    s.params = {ParamSpec::percent("size", "Size", 0.0f, 1.0f, 0.5f),
                decay,
                ParamSpec::seconds("preDelay", "Pre-delay", 0.0f, 1.0f, 0.1f, 0.02f).when("preSync", 0, 0),
                ParamSpec::percent("diffusion", "Diffusion", 0.0f, 1.0f, 0.7f),
                ParamSpec::percent("damping", "Damping", 0.0f, 1.0f, 0.4f).inGroup("Tone"),
                bass.inGroup("Tone"),
                modRate.inGroup("Modulation"),
                ParamSpec::percent("modDepth", "Mod Depth", 0.0f, 1.0f, 0.25f).inGroup("Modulation"),
                ParamSpec::number("tone", "Tone", -1.0f, 1.0f, 0.0f, "", 2).inGroup("Tone"),
                ParamSpec::percent("width", "Width", 0.0f, 1.5f, 1.0f),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.35f),
                ParamSpec::choice("preSync", "Pre-delay Sync", preSyncNames(), 0),
                ParamSpec::choice("quality", "Quality", {"Eco (8 lines)", "Fine (16 lines)"}, 1).when("type", 0, 0),
                ParamSpec::toggle("clearOnPlay", "Clear on Play", false),
                ParamSpec::integer("seed", "Seed", 0, 999, 1).when("type", 0, 0),
                ParamSpec::toggle("freeze", "Freeze (latch)", false),
                ParamSpec::choice("type", "Type", {"Hall", "Spring"}, 0),
                ParamSpec::percent("early", "Early", 0.0f, 1.0f, 0.5f),
                ParamSpec::choice("room", "Room", {"Off", "Booth", "Studio", "Club", "Hall", "Chapel"}, 0)};
    s.inputs = {{"l", "In L", Signal::Audio},
                {"r", "In R", Signal::Audio},
                {"freeze", "Freeze", Signal::Gate},
                {"clear", "Clear", Signal::Trigger}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"wetL", "Wet L", Signal::Audio, true},
                 {"wetR", "Wet R", Signal::Audio, true},
                 {"env", "Env", Signal::Control, false}};
    s.buttons = {{"clear", "Clear"}};
    s.memoryHeavy = true;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ReverbModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerReverbModule);

}  // namespace bleep::engine
