// SPDX-License-Identifier: GPL-3.0-only
// Room Print node (doc/specs/modules/room-print.md): partitioned convolution
// reverb. The response (a built-in one or a WAV from the media folder) is
// prepared on the message thread whenever it or its shaping settings change
// (setData, and a ten-per-second poll of the settings in takeData) and handed
// to the audio thread with RtHandoff.
#include "Handoff.h"
#include "Media.h"
#include "Registry.h"
#include "RoomPrintDsp.h"

#include <juce_core/juce_core.h>

#include <atomic>
#include <cstring>

namespace bleep::engine {
namespace {

namespace rp = patch::roomprint;

std::string clipOf(const juce::var& in) {
    const juce::String id = in.getProperty("clip", juce::String()).toString();
    return media::validId(id.toStdString()) ? id.toStdString() : std::string();
}
std::string nameOf(const juce::var& in) { return in.getProperty("name", juce::String()).toString().substring(0, 80).toStdString(); }

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* o = new juce::DynamicObject();
    o->setProperty("clip", juce::String(clipOf(in)));
    o->setProperty("name", juce::String(nameOf(in)));
    return juce::JSON::toString(juce::var(o), true).toStdString();
}

class RoomPrintModule final : public Module {
public:
    enum { Source, Mix, Predelay, Balance, Width, Level, Stretch, TrimStart, TrimEnd, DampLow, DampHigh };
    enum { InL, InR };
    enum { OutL, OutR };
    static constexpr int kSampleChoice = rp::kSynthCount;

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        key_.clear();  // a new rate needs a new response
        rebuild();
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        const juce::var d = juce::JSON::parse(juce::String(json));
        const std::string id = clipOf(d);
        if (id != clipId_) {
            clipId_ = id;
            clip_.reset();
            missing_ = false;
            if (!id.empty()) {
                clip_ = media::load(id);
                missing_ = !clip_;
            }
            key_.clear();
        }
        rebuild();
    }
    bool takeData(std::string&) override {
        rebuild();  // a no-op unless a shaping setting moved
        return false;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"seconds", seconds_});
        out.push_back({"missing", missing_ ? 1.0 : 0.0});
    }
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override { out.push_back({"ir", peaks_}); }

    void process(const ProcessContext& c) override {
        const rp::Ir* ir = handoff_.get();
        rp::RoomParams p;
        const bool stereo = c.inputConnected[InR] && c.inputConnected[InL];
        for (int i = 0; i < c.numSamples; ++i) {
            p.mix = value(c, Mix, i);
            p.predelay = value(c, Predelay, i);
            p.balance = value(c, Balance, i);
            p.width = value(c, Width, i);
            p.level = value(c, Level, i);
            const float l = c.inputs[InL][i], r = c.inputs[InR][i];
            const auto f = dsp_.tick(ir, p, c.inputConnected[InL] || !c.inputConnected[InR] ? l : r, r, stereo);
            c.outputs[OutL][i] = f.l;
            c.outputs[OutR][i] = f.r;
        }
    }

private:
    float units(int i) const { return spec().params[(size_t)i].fromNormalised(knob(i)); }

    /// Message thread: builds and publishes the response if what it depends on changed.
    void rebuild() {
        const int source = std::clamp((int)std::lround(units(Source)), 0, kSampleChoice);
        rp::Shape sh;
        sh.stretch = units(Stretch);
        sh.trimStart = units(TrimStart);
        sh.trimEnd = units(TrimEnd);
        sh.dampLow = units(DampLow);
        sh.dampHigh = units(DampHigh);
        char key[256];
        std::snprintf(key, sizeof key, "%d|%.4f|%.4f|%.4f|%.4f|%.4f|%.0f|%s|%d", source, sh.stretch, sh.trimStart, sh.trimEnd, sh.dampLow,
                      sh.dampHigh, sampleRate_, clipId_.c_str(), clip_ ? 1 : 0);
        if (key_ == key) return;
        key_ = key;
        rp::Stereo src;
        if (source < kSampleChoice) src = rp::makeSynthetic(source, sampleRate_);
        else if (clip_) src = rp::fromChannels(clip_->channels, clip_->sampleRate);
        auto ir = rp::buildIr(src, sh, sampleRate_);
        peaks_ = ir->peaks;
        seconds_ = sampleRate_ > 0.0 ? (double)ir->length / sampleRate_ : 0.0;
        handoff_.publish(std::move(ir));
    }

    rp::RoomPrintDsp dsp_;
    RtHandoff<rp::Ir> handoff_;
    std::string clipId_, key_;
    std::shared_ptr<const MediaClip> clip_;
    bool missing_ = false;
    double seconds_ = 0.0;
    std::vector<float> peaks_ = std::vector<float>(320, 0.0f);
};

}  // namespace

static void registerRoomPrintModule(Registry& r) {
    ModuleSpec s;
    s.type = "room-print";
    s.name = "Room Print";
    s.category = "Effects/Space & Time";
    s.colour = "#818cf8";
    s.description = "Convolution reverb from a dropped WAV or ten built-in impulse responses, with predelay, stretch, trim, "
                    "low/high damping and an early/late balance.";
    s.memoryHeavy = true;
    std::vector<std::string> names;
    for (int i = 0; i < rp::kSynthCount; ++i) names.push_back(rp::synthNames()[i]);
    names.push_back("Sample");
    auto setting = [](ParamSpec p) {
        p.modulatable = false;
        return p;
    };
    s.params = {ParamSpec::choice("source", "Impulse", names, 1),
                ParamSpec::percent("mix", "Mix", 0.0f, 1.0f, 0.35f),
                ParamSpec::seconds("predelay", "Predelay", 0.0f, 0.5f, 0.05f, 0.0f),
                ParamSpec::percent("balance", "Early/Late", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("width", "Width", 0.0f, 2.0f, 1.0f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.5f),
                setting(ParamSpec::number("stretch", "Stretch", 0.5f, 2.0f, 1.0f, "x", 2)).inGroup("Shape"),
                setting(ParamSpec::percent("trimstart", "Trim Start", 0.0f, 0.9f, 0.0f)).inGroup("Shape"),
                setting(ParamSpec::percent("trimend", "Trim End", 0.05f, 1.0f, 1.0f)).inGroup("Shape"),
                setting(ParamSpec::percent("damplow", "Damp Low", 0.0f, 1.0f, 0.0f)).inGroup("Shape"),
                setting(ParamSpec::percent("damphigh", "Damp High", 0.0f, 1.0f, 0.0f)).inGroup("Shape")};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}};
    s.outputs = {{"l", "Out L", Signal::Audio, true}, {"r", "Out R", Signal::Audio, true}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RoomPrintModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerRoomPrintModule);

}  // namespace bleep::engine
