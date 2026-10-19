// SPDX-License-Identifier: MIT
// Zone Delay node (doc/specs/modules/zone-delay.md): a stereo delay over five
// time zones with tape or crossfade time changes, loop characters, diffusion
// and the Reverse / Hold / Ping-Pong switches (gates ORed with the view's
// latched buttons, which live in the node's data).
#include "ZoneDelayDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

using patch::ZoneDelayDsp;

constexpr const char* kLatches[3] = {"reverse", "hold", "pingPong"};

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    for (const char* k : kLatches) {
        const juce::var v = in.getProperty(k, false);
        out->setProperty(k, v.isBool() || v.isInt() || v.isDouble() ? (bool)v : false);
    }
    return juce::JSON::toString(result, true).toStdString();
}

class ZoneDelayModule final : public Module {
public:
    enum { Zone, Time, Feedback, Character, Tone, Diffuse, Offset, Wobble, Mix, Sync, TimeChange, Glide, ClearOnPlay, Seed };
    enum { InL, InR, Clock, Pitch, Reverse, Hold, PingPong };
    enum { OutL, OutR, WetL, WetR, Tap };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const juce::var d = juce::JSON::parse(juce::String(json));
        for (int i = 0; i < 3; ++i) latch_[i].store((bool)d.getProperty(kLatches[i], false));
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"timeL", timeL_.load() / sampleRate_});
        out.push_back({"timeR", timeR_.load() / sampleRate_});
        out.push_back({"note", (double)note_.load()});
        out.push_back({"zone", (double)zone_.load()});
        out.push_back({"env", (double)env_.exchange(0.0f)});
        out.push_back({"reverse", active_[0].load() ? 1.0 : 0.0});
        out.push_back({"hold", active_[1].load() ? 1.0 : 0.0});
        out.push_back({"pingPong", active_[2].load() ? 1.0 : 0.0});
    }

    void process(const ProcessContext& c) override {
        const Transport& tr = *c.transport;
        const uint32_t seed = (uint32_t)setting(Seed);
        if (c.transportStarted) {
            if (setting(ClearOnPlay) >= 0.5f) dsp_.clear();
            else dsp_.restart(seed);
        }
        patch::ZoneDelayParams p;
        p.synced = setting(Sync) >= 0.5f;
        p.crossfade = setting(TimeChange) >= 0.5f;
        p.glide = setting(Glide);
        p.seed = seed;
        patch::ZoneDelayInput in;
        in.bpm = tr.bpm;
        in.clockPatched = c.inputConnected[Clock];
        in.pitchPatched = c.inputConnected[Pitch];
        const float* inR = c.inputConnected[InR] ? c.inputs[InR] : c.inputs[InL];
        const bool latched[3] = {latch_[0].load(), latch_[1].load(), latch_[2].load()};
        patch::ZoneDelayFrame f;
        float peak = env_.load();
        for (int i = 0; i < c.numSamples; ++i) {
            p.zone = (int)value(c, Zone, i);
            p.time = value(c, Time, i);
            p.feedback = value(c, Feedback, i);
            p.character = value(c, Character, i);
            p.tone = value(c, Tone, i);
            p.diffuse = value(c, Diffuse, i);
            p.offset = value(c, Offset, i);
            p.wobble = value(c, Wobble, i);
            p.mix = value(c, Mix, i);
            p.reverse = latched[0] || c.inputs[Reverse][i] >= 0.5f;
            p.hold = latched[1] || c.inputs[Hold][i] >= 0.5f;
            p.pingPong = latched[2] || c.inputs[PingPong][i] >= 0.5f;
            in.l = c.inputs[InL][i];
            in.r = inR[i];
            in.clock = c.inputs[Clock][i];
            in.pitch = c.inputs[Pitch][i];
            dsp_.tick(p, in, f);
            c.outputs[OutL][i] = f.outL;
            c.outputs[OutR][i] = f.outR;
            c.outputs[WetL][i] = f.wetL;
            c.outputs[WetR][i] = f.wetR;
            c.outputs[Tap][i] = f.tap;
            peak = std::max(peak, std::max(std::fabs(f.wetL), std::fabs(f.wetR)));
        }
        env_.store(peak);
        timeL_.store(dsp_.timeL());
        timeR_.store(dsp_.timeR());
        note_.store(dsp_.noteIndex());
        zone_.store(p.zone);
        active_[0].store(p.reverse);
        active_[1].store(p.hold);
        active_[2].store(p.pingPong);
    }

private:
    ZoneDelayDsp dsp_;
    std::atomic<bool> latch_[3] = {false, false, false};
    std::atomic<bool> active_[3] = {false, false, false};
    std::atomic<double> timeL_{0.0}, timeR_{0.0};
    std::atomic<int> note_{-1}, zone_{3};
    mutable std::atomic<float> env_{0.0f};
};

}  // namespace

static void registerZoneDelayModule(Registry& r) {
    ModuleSpec s;
    s.type = "zone-delay";
    s.name = "Zone Delay";
    s.category = "Effects/Space & Time";
    s.colour = "#3b82f6";
    s.description = "Stereo delay from tuned combs to 20-second loops: five time zones, tape or crossfade time changes, "
                    "loop characters, diffusion, Reverse, Hold and Ping-Pong.";
    auto tone = ParamSpec::number("tone", "Tone", -1.0f, 1.0f, 0.0f, "", 2);
    auto glide = ParamSpec::seconds("glide", "Glide", 0.005f, 2.0f, 0.15f, 0.15f);
    glide.modulatable = false;
    s.params = {ParamSpec::steppedInt("zone", "Zone", 1, 5, 3),
                ParamSpec::percent("time", "Time", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("feedback", "Feedback", 0.0f, 2.0f, 0.4f),
                ParamSpec::percent("character", "Character", 0.0f, 1.0f, 0.25f).inGroup("Repeats"),
                tone.inGroup("Repeats"),
                ParamSpec::percent("diffuse", "Diffuse", 0.0f, 1.0f, 0.0f).inGroup("Repeats"),
                ParamSpec::percent("offset", "Offset", -0.5f, 0.5f, 0.0f).inGroup("Stereo"),
                ParamSpec::percent("wobble", "Wobble", 0.0f, 1.0f, 0.1f).inGroup("Stereo"),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.35f),
                ParamSpec::choice("sync", "Sync", {"Free", "Transport"}, 0),
                ParamSpec::choice("timechange", "Time Change", {"Tape", "Crossfade"}, 0),
                glide.when("timechange", 0, 0),
                ParamSpec::toggle("clearonplay", "Clear on Play", false),
                ParamSpec::integer("seed", "Seed", 0, 999, 1)};
    s.inputs = {{"l", "In L", Signal::Audio},         {"r", "In R", Signal::Audio},
                {"clock", "Clock", Signal::Trigger},  {"pitch", "Pitch", Signal::Pitch},
                {"reverse", "Reverse", Signal::Gate}, {"hold", "Hold", Signal::Gate},
                {"pingpong", "Ping-Pong", Signal::Gate}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},  {"r", "Out R", Signal::Audio, true},
                 {"wetl", "Wet L", Signal::Audio, true}, {"wetr", "Wet R", Signal::Audio, true},
                 {"tap", "Tap", Signal::Trigger, false}};
    s.memoryHeavy = true;
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<ZoneDelayModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerZoneDelayModule);

}  // namespace bleep::engine
