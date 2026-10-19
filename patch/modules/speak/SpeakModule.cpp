// SPDX-License-Identifier: GPL-3.0-or-later
// Speak node (doc/specs/modules/speak.md): a phoneme string sequenced through
// a small formant voice. The text is node data, parsed on the message thread
// and handed over with RtHandoff.
#include "Handoff.h"
#include "Registry.h"
#include "SpeakDsp.h"

#include <juce_core/juce_core.h>

#include <atomic>

namespace bleep::engine {
namespace {

using patch::SpeakDsp;
using patch::SpeakParams;
namespace sp = patch::speak;

constexpr int kMaxText = 400;

std::string textOf(const juce::var& in) {
    std::string s = in.getProperty("text", juce::String()).toString().toStdString();
    std::string clean;
    for (char ch : s)
        if ((unsigned char)ch >= 32 && (unsigned char)ch < 127) clean += ch;
        else if (ch == '\n' || ch == '\t') clean += ' ';
    if ((int)clean.size() > kMaxText) clean.resize(kMaxText);
    return clean;
}

std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    std::string t = textOf(in);
    if (!in.hasProperty("text")) t = "h e l 'o . w 'er l d .";
    auto* o = new juce::DynamicObject();
    o->setProperty("text", juce::String(t));
    return juce::JSON::toString(juce::var(o), true).toStdString();
}

class SpeakModule final : public Module {
public:
    enum { Speed, Coarse, Fine, Formant, Breath, Intonation, Glide, Level, Mode };
    enum { Pitch, Go };
    enum { Out, Trig, Voiced, Position };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
        dsp_.reset();
    }
    void reset() override { dsp_.reset(); }

    void setData(const std::string& json) override {
        auto seq = std::make_shared<sp::Sequence>(sp::parse(textOf(juce::JSON::parse(juce::String(json)))));
        count_.store(seq->count);
        handoff_.publish(std::move(seq));
    }
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"segment", (double)segment_.load(std::memory_order_relaxed)});
        out.push_back({"count", (double)count_.load()});
    }

    void process(const ProcessContext& c) override {
        const sp::Sequence* seq = handoff_.get();
        SpeakParams p;
        p.mode = (int)setting(Mode);
        for (int i = 0; i < c.numSamples; ++i) {
            p.speed = value(c, Speed, i);
            p.pitchOct = c.inputs[Pitch][i] + value(c, Coarse, i) / 12.0f + value(c, Fine, i) / 1200.0f;
            p.formantShift = value(c, Formant, i);
            p.breath = value(c, Breath, i);
            p.intonation = value(c, Intonation, i);
            p.glide = value(c, Glide, i);
            const auto f = dsp_.tick(seq, p, c.inputs[Go][i] > 0.5f);
            c.outputs[Out][i] = f.out * value(c, Level, i);
            c.outputs[Trig][i] = f.trig ? 1.0f : 0.0f;
            c.outputs[Voiced][i] = f.voiced ? 1.0f : 0.0f;
            c.outputs[Position][i] = f.position;
        }
        segment_.store(dsp_.segment(), std::memory_order_relaxed);
    }

private:
    SpeakDsp dsp_;
    RtHandoff<sp::Sequence> handoff_;
    std::atomic<int> count_{0}, segment_{0};
};

}  // namespace

static void registerSpeakModule(Registry& r) {
    ModuleSpec s;
    s.type = "speak";
    s.name = "Speak";
    s.category = "Sources/Voices";
    s.colour = "#fb923c";
    s.description = "A small formant speech synthesiser: a phoneme string sequenced at a rate, with vowels, nasals, "
                    "fricatives and plosives, pitch, speed and formant shift.";
    s.params = {ParamSpec::exponential("speed", "Speed", 1.0f, 40.0f, 8.0f, "u/s"),
                ParamSpec::number("coarse", "Pitch", -36.0f, 24.0f, -12.0f, "st", 1),
                ParamSpec::number("fine", "Fine", -100.0f, 100.0f, 0.0f, "ct", 0),
                ParamSpec::number("formant", "Formant", -12.0f, 12.0f, 0.0f, "st", 1),
                ParamSpec::percent("breath", "Breath", 0.0f, 1.0f, 0.15f),
                ParamSpec::percent("intonation", "Intonation", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("glide", "Glide", 0.0f, 1.0f, 0.5f),
                ParamSpec::percent("level", "Level", 0.0f, 1.0f, 0.7f),
                ParamSpec::choice("mode", "Mode", {"Loop", "Gate", "Step"}, 0)};
    s.inputs = {{"pitch", "Pitch", Signal::Pitch}, {"go", "Go", Signal::Gate}};
    s.outputs = {{"out", "Out", Signal::Audio, true}, {"trig", "Sound", Signal::Trigger, false},
                 {"voiced", "Voiced", Signal::Gate, false}, {"position", "Position", Signal::Control, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<SpeakModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerSpeakModule);

}  // namespace bleep::engine
