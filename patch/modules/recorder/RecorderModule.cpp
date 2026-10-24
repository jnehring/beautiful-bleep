// SPDX-License-Identifier: GPL-3.0-only
// Recorder node (doc/specs/modules/recorder.md): bounces its stereo input into a take, which the
// view saves to the media folder (exportMedia("take")) as a WAV file and can show in the
// computer's file manager. The audio passes through.
#include "Media.h"
#include "RecorderDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <atomic>

namespace bleep::engine {
namespace {

using namespace patch;

constexpr double kLimits[5] = {10.0, 30.0, 60.0, 90.0, 120.0};

/// The last saved take: its media id and length. The audio itself lives in the media folder, not in the board.
std::string sanitiseData(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    const juce::String take = in["take"].toString();
    if (media::validId(take.toStdString())) {
        out->setProperty("take", take);
        const juce::var sec = in["seconds"];
        out->setProperty("seconds", (sec.isDouble() || sec.isInt() || sec.isInt64()) ? std::clamp((double)sec, 0.0, 7200.0) : 0.0);
    }
    return juce::JSON::toString(result, true).toStdString();
}

class RecorderModule final : public Module {
public:
    enum { Limit, Start, Threshold, Preroll, GateControl, AutoSave };
    enum { InL, InR, Gate };
    enum { OutL, OutR, Rec, Done, Progress };
    enum { Arm, Record, Stop, Clear };  // button order

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override { dsp_.reset(); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"state", (double)dsp_.state()});
        out.push_back({"seconds", (double)length_.load(std::memory_order_relaxed) / sampleRate_});
        out.push_back({"limit", dsp_.peakSeconds()});
        out.push_back({"level", (double)level_.exchange(0.0f)});
    }

    /// "peaks": one value per column across the limit (the take fills from the left).
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        std::vector<float> v(kRecorderPeakColumns);
        for (int i = 0; i < kRecorderPeakColumns; ++i) v[(size_t)i] = dsp_.peak(i);
        out.push_back({"peaks", std::move(v)});
    }

    /// The finished take as a clip, for the view to save. Null while recording or when there is none.
    std::shared_ptr<const MediaClip> exportMedia(const std::string& slot) override {
        if (slot != "take") return nullptr;
        if (!dsp_.beginRead()) return nullptr;
        std::shared_ptr<MediaClip> clip;
        const size_t n = dsp_.length();
        if (n > 0 && dsp_.state() == RecDone) {
            clip = std::make_shared<MediaClip>();
            clip->name = "Recorder take";
            clip->sampleRate = dsp_.sampleRate();
            clip->channels.resize(2);
            clip->channels[0].assign(dsp_.left(), dsp_.left() + n);
            clip->channels[1].assign(dsp_.right(), dsp_.right() + n);
        }
        dsp_.endRead();
        return clip;
    }

    void process(const ProcessContext& c) override {
        pollCommands([&](const Command& cmd) {
            if (cmd.value < 0.5f) return;
            switch (cmd.index) {
                case Arm: dsp_.arm(); break;
                case Record: dsp_.record(); break;
                case Stop: dsp_.stop(); break;
                case Clear: dsp_.clear(); break;
            }
        });
        RecorderParams p;
        p.limit = kLimits[std::clamp((int)setting(Limit), 0, 4)];
        p.autoStart = (int)setting(Start) == 1;
        p.threshold = std::pow(10.0f, value(c, Threshold, 0) / 20.0f);
        p.preroll = value(c, Preroll, 0);
        p.gateControl = (int)setting(GateControl) == 1;
        const bool gated = c.inputConnected[Gate];
        const bool stereo = c.inputConnected[InR];
        float peak = 0.0f;
        for (int i = 0; i < c.numSamples; ++i) {
            const float l = c.inputs[InL][i], r = stereo ? c.inputs[InR][i] : l;
            const RecorderFrame f = dsp_.tick(p, l, r, gated ? c.inputs[Gate][i] : 0.0f);
            c.outputs[OutL][i] = c.inputs[InL][i];
            c.outputs[OutR][i] = c.inputs[InR][i];
            c.outputs[Rec][i] = f.recording;
            c.outputs[Done][i] = f.done;
            c.outputs[Progress][i] = f.progress;
            peak = std::max(peak, std::max(std::fabs(l), std::fabs(r)));
        }
        length_.store(dsp_.state() == RecRecording ? dsp_.recordedSoFar() : dsp_.length(), std::memory_order_relaxed);
        float prev = level_.load(std::memory_order_relaxed);
        while (peak > prev && !level_.compare_exchange_weak(prev, peak, std::memory_order_relaxed)) {}
    }

private:
    RecorderDsp dsp_;
    std::atomic<size_t> length_{0};
    mutable std::atomic<float> level_{0.0f};
};

}  // namespace

static void registerRecorderModule(Registry& r) {
    ModuleSpec s;
    s.type = "recorder";
    s.name = "Recorder";
    s.category = "Utility";
    s.colour = "#fca5a5";
    s.description = "Bounces its stereo input into a take and saves it as a WAV file. Arm it to start on signal (with a pre-roll "
                    "that catches the beginning), start it by hand or with a gate, and end it at a length limit.";
    s.memoryHeavy = true;
    s.params = {ParamSpec::choice("limit", "Length Limit", {"10 s", "30 s", "60 s", "90 s", "2 min"}, 1),
                ParamSpec::choice("start", "Armed Start", {"By Hand", "On Signal"}, 1),
                ParamSpec::number("threshold", "Signal Level", -60.0f, -6.0f, -36.0f, "dB", 0),
                ParamSpec::seconds("preroll", "Pre-roll", 0.0f, 2.0f, 0.3f, 0.25f),
                ParamSpec::choice("gatecontrol", "Gate Input", {"Ignored", "Starts and Ends"}, 0),
                ParamSpec::toggle("autosave", "Save When Done", true)};  // the view saves; the module does not read it
    s.buttons = {{"arm", "Arm"}, {"record", "Record"}, {"stop", "Stop"}, {"clear", "Clear"}};
    s.inputs = {{"l", "In L", Signal::Audio}, {"r", "In R", Signal::Audio}, {"gate", "Gate", Signal::Gate}};
    s.outputs = {{"l", "Out L", Signal::Audio, true},
                 {"r", "Out R", Signal::Audio, true},
                 {"rec", "Recording", Signal::Gate, false},
                 {"done", "Done", Signal::Trigger, false},
                 {"progress", "Progress", Signal::Control, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<RecorderModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerRecorderModule);

}  // namespace bleep::engine
