// SPDX-License-Identifier: GPL-3.0-only
// CV to MIDI node (doc/specs/modules/cv-to-midi.md): four lanes of control
// signal → controller messages on a notes stream. Patched lanes only; the
// Resend button sends every patched lane's value again.
#include "CvToMidiDsp.h"
#include "Registry.h"

#include <array>
#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using patch::kCvToMidiLanes;

class CvToMidiModule final : public Module {
public:
    // Params: per lane n: cc 4n, channel 4n + 1, min 4n + 2, max 4n + 3; then Range, Resolution, Rate.
    enum { Range = 4 * kCvToMidiLanes, Resolution, Rate };
    enum { Notes };
    enum { ResendButton };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        reset();
    }
    void reset() override {
        for (auto& l : lanes_) l.reset();
    }

    /// "lane1" … "lane4": the controller value last sent in data units 0…127 (14 bit lanes give fractions),
    /// -1 while a lane is not patched.
    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        for (int k = 0; k < kCvToMidiLanes; ++k) out.push_back({"lane" + std::to_string(k + 1), (double)shown_[(size_t)k].load()});
    }

    void process(const ProcessContext& c) override {
        bool resend = false;
        pollCommands([&](const Command& cmd) {
            if (cmd.index == ResendButton && cmd.value > 0.5f) resend = true;
        });
        NoteBuffer& out = *c.notesOut[Notes];
        out.clear();

        patch::CvToMidiLaneParams p[kCvToMidiLanes];
        const bool bipolar = (int)setting(Range) == 1, hires = (int)setting(Resolution) == 1;
        const float perSecond = setting(Rate);
        const int gap = perSecond >= 1000.0f ? 0 : (int)(sampleRate_ / std::max(perSecond, 1.0f));
        int channel[kCvToMidiLanes];
        for (int k = 0; k < kCvToMidiLanes; ++k) {
            p[k].cc = (int)setting(4 * k);
            channel[k] = (int)setting(4 * k + 1) - 1;
            p[k].minData = (int)setting(4 * k + 2);
            p[k].maxData = (int)setting(4 * k + 3);
            p[k].bipolar = bipolar;
            p[k].hires = hires;
            p[k].minGapSamples = gap;
            if (!c.inputConnected[k]) lanes_[k].reset();  // patched again later: the value goes out at once
            else if (resend) lanes_[k].resend();
        }
        patch::CvToMidiMessages m;
        for (int i = 0; i < c.numSamples; ++i) {
            for (int k = 0; k < kCvToMidiLanes; ++k) {
                if (!c.inputConnected[k]) continue;
                lanes_[k].tick(c.inputs[k][i], p[k], m);
                for (int j = 0; j < m.count; ++j) {
                    NoteEvent e;
                    e.type = NoteEvent::Cc;
                    e.channel = (uint8_t)channel[k];
                    e.offset = (int16_t)i;
                    e.note = m.cc[j];
                    e.value = (float)m.data[j] / 127.0f;
                    out.pushController(e);
                }
            }
        }
        for (int k = 0; k < kCvToMidiLanes; ++k) {
            const int last = lanes_[k].last();
            const bool fine = hires && p[k].cc < 32;
            shown_[(size_t)k].store(!c.inputConnected[k] || last < 0 ? -1.0f : fine ? (float)last * 127.0f / 16383.0f : (float)last);
        }
    }

private:
    patch::CvToMidiLane lanes_[kCvToMidiLanes];
    std::array<std::atomic<float>, kCvToMidiLanes> shown_{{-1.0f, -1.0f, -1.0f, -1.0f}};
};

}  // namespace

static void registerCvToMidiModule(Registry& r) {
    ModuleSpec s;
    s.type = "cv-to-midi";
    s.name = "CV to MIDI";
    s.category = "Utility/Converters";
    s.colour = "#7dd3fc";
    s.description = "Four lanes that turn control signals into MIDI control changes (CC), "
                    "7 or 14 bit, sent only when the value moves.";
    static const int kDefaultCc[kCvToMidiLanes] = {1, 74, 71, 91};
    for (int k = 0; k < kCvToMidiLanes; ++k) {
        const std::string n = std::to_string(k + 1), lane = "Lane " + n;
        s.params.push_back(ParamSpec::integer("cc" + n, "CC " + n, 0, 127, kDefaultCc[k]).inGroup(lane));
        s.params.push_back(ParamSpec::integer("channel" + n, "Channel " + n, 1, 16, 1).inGroup(lane));
        s.params.push_back(ParamSpec::integer("min" + n, "Min " + n, 0, 127, 0).inGroup(lane));
        s.params.push_back(ParamSpec::integer("max" + n, "Max " + n, 0, 127, 127).inGroup(lane));
        s.inputs.push_back({"in" + n, "In " + n, Signal::Control});
    }
    s.groupColumns = true;
    s.params.push_back(ParamSpec::choice("range", "Input Range", {"0 … +1", "−1 … +1"}, 0));
    s.params.push_back(ParamSpec::choice("resolution", "Resolution", {"7 bit", "14 bit (CC 0–31)"}, 0));
    ParamSpec rate = ParamSpec::number("rate", "Max Rate", 10.0f, 1000.0f, 200.0f, "/s", 0);
    rate.modulatable = false;
    s.params.push_back(rate);
    s.outputs = {{"notes", "Notes", Signal::Notes, false}};
    s.buttons = {{"resend", "Resend"}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<CvToMidiModule>(spec); });
}
BLEEP_REGISTER_MODULE(registerCvToMidiModule);

}  // namespace bleep::engine
