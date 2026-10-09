// SPDX-License-Identifier: MIT
// Audio Mixer node (specs/modules/audio-mixer.md): four stereo channels,
// a send and return, a master with a limiter, a mono option and meters.
#include "AudioMixerDsp.h"
#include "Registry.h"

#include <algorithm>
#include <cmath>
#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::kMixerChannels;

ParamSpec fader(const std::string& id, const std::string& name, float def) {
    // 0 dB sits at about 80 % of the travel; the bottom is silence.
    ParamSpec p = ParamSpec::number(id, name, dsp::kFaderFloorDb, 6.0f, def, "dB", 1);
    p.map = ParamSpec::Map::Skew;
    p.centre = -12.0f;
    return p;
}

/// Raises a to v if v is larger (audio thread; the view resets it on read).
void raise(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v > prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}

class AudioMixerModule final : public Module {
public:
    // Per channel k: params Level, Pan, Send at 3k…3k+2; then these.
    enum { ReturnLevel = 3 * kMixerChannels, Master, Mute1, Solo1 = Mute1 + kMixerChannels,
           SendPoint1 = Solo1 + kMixerChannels, Limiter = SendPoint1 + kMixerChannels,
           Mono };
    // Inputs: In k L at 2k, In k R at 2k+1; then these.
    enum { ReturnL = 2 * kMixerChannels, ReturnR, MuteIn1 };
    enum { OutL, OutR, SendL, SendR, Level };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        for (int k = 0; k < kMixerChannels; ++k) out.push_back({"peak" + std::to_string(k + 1), (double)peak_[k].exchange(0.0f)});
        out.push_back({"masterL", (double)masterL_.exchange(0.0f)});
        out.push_back({"masterR", (double)masterR_.exchange(0.0f)});
        out.push_back({"gr", (double)reduction_.load()});
    }

    void process(const ProcessContext& c) override {
        patch::AudioMixerParams p;
        p.limiter = setting(Limiter) >= 0.5f;
        p.mono = setting(Mono) >= 0.5f;
        patch::AudioMixerInputs in;
        for (int k = 0; k < kMixerChannels; ++k) {
            p.ch[k].mute = setting(Mute1 + k) >= 0.5f;
            p.ch[k].solo = setting(Solo1 + k) >= 0.5f;
            p.ch[k].preFader = setting(SendPoint1 + k) >= 0.5f;
            in.stereo[k] = c.inputConnected[2 * k + 1];
        }
        const bool returnStereo = c.inputConnected[ReturnR];
        patch::AudioMixerFrame f;
        float peaks[kMixerChannels] = {}, masterL = 0.0f, masterR = 0.0f;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kMixerChannels; ++k) {
                p.ch[k].levelDb = value(c, 3 * k, i);
                p.ch[k].pan = value(c, 3 * k + 1, i);
                p.ch[k].sendDb = value(c, 3 * k + 2, i);
                in.l[k] = c.inputs[2 * k][i];
                in.r[k] = c.inputs[2 * k + 1][i];
                in.muteGate[k] = c.inputs[MuteIn1 + k][i] >= 0.5f;
            }
            p.returnDb = value(c, ReturnLevel, i);
            p.masterDb = value(c, Master, i);
            in.returnL = c.inputs[ReturnL][i];
            in.returnR = returnStereo ? c.inputs[ReturnR][i] : in.returnL;
            dsp_.tick(in, p, f);
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[SendL][i] = f.sendL;
            c.outputs[SendR][i] = f.sendR;
            c.outputs[Level][i] = f.level;
            for (int k = 0; k < kMixerChannels; ++k) peaks[k] = std::max(peaks[k], f.peak[k]);
            masterL = std::max(masterL, std::fabs(f.outL));
            masterR = std::max(masterR, std::fabs(f.outR));
        }
        for (int k = 0; k < kMixerChannels; ++k) raise(peak_[k], peaks[k]);
        raise(masterL_, masterL);
        raise(masterR_, masterR);
        reduction_.store(dsp_.gainReduction());
    }

private:
    patch::AudioMixerDsp dsp_;
    // Peaks since the view last read them (liveValues resets them), so no short peak is missed.
    mutable std::atomic<float> peak_[kMixerChannels] = {};
    mutable std::atomic<float> masterL_{0.0f}, masterR_{0.0f};
    std::atomic<float> reduction_{1.0f};
};

}  // namespace

void registerAudioMixerModule(Registry& r) {
    ModuleSpec s;
    s.type = "audio-mixer";
    s.name = "Audio Mixer";
    s.category = "Audio";
    s.colour = "#fb7185";
    s.description = "Four stereo channels with level, pan, mute, solo and a send; return, master and limiter.";
    for (int k = 1; k <= kMixerChannels; ++k) {
        const std::string n = std::to_string(k);
        s.params.push_back(fader("level" + n, "Level " + n, 0.0f));
        s.params.push_back(ParamSpec::number("pan" + n, "Pan " + n, -1.0f, 1.0f, 0.0f));
        s.params.push_back(fader("send" + n, "Send " + n, dsp::kFaderFloorDb));
    }
    s.params.push_back(fader("return", "Return Level", 0.0f));
    s.params.push_back(fader("master", "Master", 0.0f));
    for (int k = 1; k <= kMixerChannels; ++k) s.params.push_back(ParamSpec::toggle("mute" + std::to_string(k), "Mute " + std::to_string(k), false));
    for (int k = 1; k <= kMixerChannels; ++k) s.params.push_back(ParamSpec::toggle("solo" + std::to_string(k), "Solo " + std::to_string(k), false));
    for (int k = 1; k <= kMixerChannels; ++k)
        s.params.push_back(ParamSpec::choice("sendpoint" + std::to_string(k), "Send Point " + std::to_string(k),
                                             {"Post-Fader", "Pre-Fader"}, 0));
    s.params.push_back(ParamSpec::toggle("limiter", "Limiter", true));
    s.params.push_back(ParamSpec::toggle("mono", "Mono", false));
    for (int k = 1; k <= kMixerChannels; ++k) {
        const std::string n = std::to_string(k);
        s.inputs.push_back({"in" + n + "l", "In " + n + " L", Signal::Audio});
        s.inputs.push_back({"in" + n + "r", "In " + n + " R", Signal::Audio});
    }
    s.inputs.push_back({"returnl", "Return L", Signal::Audio});
    s.inputs.push_back({"returnr", "Return R", Signal::Audio});
    for (int k = 1; k <= kMixerChannels; ++k)
        s.inputs.push_back({"mute" + std::to_string(k) + "in", "Mute " + std::to_string(k), Signal::Gate});
    s.outputs = {{"outl", "Out L", Signal::Audio, true},
                 {"outr", "Out R", Signal::Audio, true},
                 {"sendl", "Send L", Signal::Audio, true},
                 {"sendr", "Send R", Signal::Audio, true},
                 {"level", "Level", Signal::Control, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<AudioMixerModule>(spec); });
}

}  // namespace bleep::engine
