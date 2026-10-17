// SPDX-License-Identifier: MIT
// Quantizer node (doc/specs/modules/quantizer.md): snaps a pitch to a scale,
// with a custom scale in the node's data.
#include "QuantizerDsp.h"
#include "Registry.h"

#include <juce_core/juce_core.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>

namespace bleep::engine {
namespace {

constexpr uint16_t kMajorMask = 0xab5;  // 0 2 4 5 7 9 11

uint16_t parseMask(const std::string& json) {
    const juce::var in = json.empty() ? juce::var() : juce::JSON::parse(juce::String(json));
    const juce::var m = in["customMask"];
    if (!(m.isInt() || m.isInt64() || m.isDouble())) return kMajorMask;
    return (uint16_t)((int)m & 0xfff);
}

std::string sanitiseData(const std::string& json) {
    auto* out = new juce::DynamicObject();
    juce::var result(out);
    out->setProperty("customMask", (int)parseMask(json));
    return juce::JSON::toString(result, true).toStdString();
}

class QuantizerModule final : public Module {
public:
    enum { Range, Hysteresis, Glide, Root, Scale, Rounding };
    enum { In, Clock, Transpose, Shift, RootIn, NotesIn };
    enum { Out, Trigger, Gate, NotesOut };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        dsp_.prepare(sampleRate);
    }
    void reset() override {
        dsp_.reset();
        clearMap();
    }

    void setData(const std::string& json) override { customMask_.store(parseMask(json)); }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"note", (double)note_.load()});
        out.push_back({"root", (double)root_.load()});
    }

    void process(const ProcessContext& c) override {
        const int scale = (int)setting(Scale);
        const auto& list = dsp::scales();
        patch::QuantizerParams p;
        p.mask = scale >= 0 && scale < (int)list.size() ? list[(size_t)scale].mask : customMask_.load();
        p.rounding = (int)setting(Rounding);
        const bool rootPatched = c.inputConnected[RootIn];
        const int rootSetting = (int)setting(Root);
        patch::QuantizerInputs in;
        in.clockPatched = c.inputConnected[Clock];
        patch::QuantizerFrame f;
        // Notes in: every note is snapped to the scale on its way through. A cable pulled
        // with notes held ends them, so nothing hangs.
        const NoteBuffer* notesIn = c.inputConnected[NotesIn] ? c.notesIn[NotesIn] : nullptr;
        NoteBuffer& notesOut = *c.notesOut[NotesOut];
        notesOut.clear();
        if (!notesIn && active_ > 0) releaseAll(notesOut);
        int e = 0;
        for (int i = 0; i < c.numSamples; ++i) {
            p.range = value(c, Range, i);
            p.hysteresis = value(c, Hysteresis, i);
            p.glide = value(c, Glide, i);
            p.root = rootPatched ? (((int)std::lround(c.inputs[RootIn][i] * 12.0f) % 12) + 12) % 12 : rootSetting;
            for (; notesIn && e < notesIn->count && notesIn->events[e].offset <= i; ++e)
                quantizeEvent(notesIn->events[e], i, p, c.inputs[Transpose][i], c.inputs[Shift][i], notesOut);
            in.in = c.inputs[In][i];
            in.clock = c.inputs[Clock][i];
            in.transpose = c.inputs[Transpose][i];
            in.shift = c.inputs[Shift][i];
            dsp_.tick(in, p, f);
            c.outputs[Out][i] = f.out;
            c.outputs[Trigger][i] = f.trigger;
            c.outputs[Gate][i] = f.gate;
        }
        note_.store(dsp_.note());
        root_.store(p.root);
    }

private:
    static constexpr int kNoNote = -1;

    void clearMap() {
        for (auto& ch : map_) ch.fill(kNoNote);
        active_ = 0;
    }

    /// One incoming event: notes are quantized (Transpose before, Shift after, like the pitch
    /// path), the matching Off and Pressure follow the note that was actually sent.
    void quantizeEvent(NoteEvent ev, int offset, const patch::QuantizerParams& p, float transpose, float shift,
                       NoteBuffer& out) {
        ev.offset = (int16_t)offset;
        const bool isNote = ev.type == NoteEvent::On || ev.type == NoteEvent::Off || ev.type == NoteEvent::Pressure;
        if (!isNote || ev.note < 0 || ev.note > 127) {
            out.push(ev);
            return;
        }
        int8_t& slot = map_[ev.channel & 15][(size_t)ev.note];
        if (ev.type == NoteEvent::On) {
            const float semis = (float)(ev.note - 60) + transpose * 12.0f - (float)p.root;
            const int q = patch::QuantizerDsp::round(semis, p.mask, p.rounding) + p.root + (int)std::lround(shift * 12.0f);
            const int note = std::clamp(60 + q, 0, 127);
            if (slot == kNoNote) ++active_;
            slot = (int8_t)note;
            ev.note = note;
            ev.pitch = (float)(note - 60) / 12.0f;
        } else if (slot != kNoNote) {
            ev.note = slot;
            ev.pitch = (float)(slot - 60) / 12.0f;
            if (ev.type == NoteEvent::Off) {
                slot = kNoNote;
                --active_;
            }
        }
        out.push(ev);
    }

    void releaseAll(NoteBuffer& out) {
        for (int ch = 0; ch < 16; ++ch)
            for (int n = 0; n < 128; ++n) {
                const int8_t sent = map_[(size_t)ch][(size_t)n];
                if (sent == kNoNote) continue;
                NoteEvent ev;
                ev.type = NoteEvent::Off;
                ev.channel = (uint8_t)ch;
                ev.note = sent;
                ev.pitch = (float)(sent - 60) / 12.0f;
                out.push(ev);
            }
        clearMap();
    }

    patch::QuantizerDsp dsp_;
    std::array<std::array<int8_t, 128>, 16> map_ = [] {
        std::array<std::array<int8_t, 128>, 16> m{};
        for (auto& ch : m) ch.fill(kNoNote);
        return m;
    }();
    int active_ = 0;
    std::atomic<uint16_t> customMask_{kMajorMask};
    std::atomic<int> note_{0}, root_{0};
};

}  // namespace

void registerQuantizerModule(Registry& r) {
    ModuleSpec s;
    s.type = "quantizer";
    s.name = "Quantizer";
    s.category = "Utility/Harmony";
    s.colour = "#93c5fd";
    s.description = "Snaps a pitch or incoming notes to the notes of a scale: any modulator becomes a melody.";
    std::vector<std::string> scales;
    for (const auto& sc : dsp::scales()) scales.emplace_back(sc.name);
    scales.emplace_back("Custom");
    auto range = ParamSpec::number("range", "Range", 0.0f, 4.0f, 1.0f, "oct", 2);
    s.params = {range,
                ParamSpec::percent("hysteresis", "Hysteresis", 0.0f, 0.5f, 0.1f),
                ParamSpec::seconds("glide", "Glide", 0.0f, 2.0f, 0.2f, 0.0f),
                ParamSpec::choice("root", "Root", {"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}, 0),
                ParamSpec::choice("scale", "Scale", scales, 1),
                ParamSpec::choice("rounding", "Rounding", {"Nearest", "Down", "Up"}, 0)};
    s.inputs = {{"in", "In", Signal::Pitch},
                {"clock", "Clock", Signal::Trigger},
                {"transpose", "Transpose", Signal::Pitch},
                {"shift", "Shift", Signal::Pitch},
                {"rootin", "Root In", Signal::Pitch},
                {"notesin", "Notes In", Signal::Notes}};
    s.outputs = {{"out", "Out", Signal::Pitch, true},
                 {"trigger", "Trigger", Signal::Trigger, false},
                 {"gate", "Gate", Signal::Gate, false},
                 {"notes", "Notes", Signal::Notes, false}};
    s.sanitiseData = sanitiseData;
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<QuantizerModule>(spec); });
}

}  // namespace bleep::engine
