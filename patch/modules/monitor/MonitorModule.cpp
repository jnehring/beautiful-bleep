// SPDX-License-Identifier: GPL-3.0-or-later
// Monitor node (doc/specs/modules/monitor.md): shows what is on a cable. A notes
// stream goes into a MIDI event table, audio into a peak/RMS meter, a control
// signal into a readout and a gate into a gate meter. Every input passes through
// to its output, so the Monitor can sit in a chain.
#include "LevelMeterDsp.h"
#include "MonitorDsp.h"
#include "Registry.h"

#include <algorithm>
#include <atomic>
#include <string>

namespace bleep::engine {
namespace {

using namespace patch;

/// Raises a to v if v is larger (audio thread; the UI resets it on read).
void raise(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v > prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}
/// Lowers a to v if v is smaller.
void lower(std::atomic<float>& a, float v) noexcept {
    float prev = a.load(std::memory_order_relaxed);
    while (v < prev && !a.compare_exchange_weak(prev, v, std::memory_order_relaxed)) {}
}

constexpr float kNoRange = 1e30f;  ///< "nothing since the last read" for the CV range

class MonitorModule final : public Module {
public:
    enum { Response, Floor };
    enum { NotesIn, InL, InR, Cv, Gate };
    enum { NotesOut, OutL, OutR, CvOut, GateOut };

    using Module::Module;

    void prepare(double sampleRate) override {
        Module::prepare(sampleRate);
        meter_.prepare(sampleRate);
        gate_.prepare(sampleRate);
    }
    void reset() override {
        meter_.reset();
        gate_.reset();
        cv_ = CvStats();
        log_.reset();
        held_.reset();
        gateHigh_.store(false);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        out.push_back({"peakL", (double)peakL_.exchange(0.0f)});
        out.push_back({"peakR", (double)peakR_.exchange(0.0f)});
        out.push_back({"rmsL", (double)rmsL_.load()});
        out.push_back({"rmsR", (double)rmsR_.load()});
        out.push_back({"clipL", clipL_.exchange(false) ? 1.0 : 0.0});
        out.push_back({"clipR", clipR_.exchange(false) ? 1.0 : 0.0});
        out.push_back({"stereo", stereo_.load() ? 1.0 : 0.0});
        out.push_back({"audioPatched", audioPatched_.load() ? 1.0 : 0.0});

        const float lo = cvLo_.exchange(kNoRange), hi = cvHi_.exchange(-kNoRange);
        const float now = cvNow_.load();
        out.push_back({"cv", (double)now});
        out.push_back({"cvLo", (double)(lo > hi ? now : lo)});
        out.push_back({"cvHi", (double)(lo > hi ? now : hi)});
        out.push_back({"cvPatched", cvPatched_.load() ? 1.0 : 0.0});

        out.push_back({"gate", gateHigh_.load() ? 1.0 : 0.0});
        out.push_back({"gateAny", gateAny_.exchange(false) ? 1.0 : 0.0});
        out.push_back({"gateCount", (double)gateCount_.load()});
        out.push_back({"gateLength", (double)gateLength_.load()});
        out.push_back({"gateRate", (double)gateRate_.load()});
        out.push_back({"gateDuty", (double)gateDuty_.load()});
        out.push_back({"gatePatched", gatePatched_.load() ? 1.0 : 0.0});

        out.push_back({"notesPatched", notesPatched_.load() ? 1.0 : 0.0});
        for (int i = 0; i < 4; ++i) out.push_back({"held" + std::to_string(i), (double)held_.word(i)});
    }

    /// The latest events: first the count of events ever logged, then four numbers per event
    /// (type, channel, number, data); see MonitorEvent. Stateless, so any number of views can read it.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        uint32_t total = 0;
        const auto events = log_.latest(kMonitorShown, total);
        std::vector<float> v;
        v.reserve(1 + events.size() * 4);
        v.push_back((float)(total & 0xffffff));  // exact in a float; the view takes differences modulo 2^24
        for (const auto& e : events) {
            v.push_back((float)e.type);
            v.push_back((float)e.channel);
            v.push_back((float)e.a);
            v.push_back((float)e.b);
        }
        out.push_back({"midi", std::move(v)});
    }

    void process(const ProcessContext& c) override {
        const bool notes = c.inputConnected[NotesIn] && c.notesIn && c.notesIn[NotesIn];
        notesPatched_.store(notes);
        NoteBuffer* notesOut = c.notesOut ? c.notesOut[NotesOut] : nullptr;
        if (notesOut) notesOut->clear();
        if (notes) {
            const NoteBuffer& in = *c.notesIn[NotesIn];
            for (int k = 0; k < in.count; ++k) {
                const NoteEvent& e = in.events[k];
                if (notesOut) notesOut->push(e);
                logEvent(e);
            }
        } else if (c.offset == 0) {
            held_.reset();  // nothing patched: nothing can still be on
        }

        LevelMeterParams p;
        p.floorDb = kLevelMeterFloors[std::clamp((int)setting(Floor), 0, 5)];
        const bool stereo = c.inputConnected[InR];
        const float* inR = stereo ? c.inputs[InR] : c.inputs[InL];
        LevelMeterFrame f;
        float peakL = 0.0f, peakR = 0.0f;
        bool clipL = false, clipR = false;
        for (int i = 0; i < c.numSamples; ++i) {
            p.response = value(c, Response, i);
            const float l = c.inputs[InL][i], r = inR[i];
            meter_.tick(l, r, p, f);
            c.outputs[OutL][i] = l;
            c.outputs[OutR][i] = r;
            peakL = std::max(peakL, f.peakL);
            peakR = std::max(peakR, f.peakR);
            clipL = clipL || f.peakL > 1.0f;
            clipR = clipR || f.peakR > 1.0f;

            const float x = c.inputs[Cv][i];
            c.outputs[CvOut][i] = x;
            cv_.tick(x);

            const float g = c.inputs[Gate][i];
            c.outputs[GateOut][i] = g;
            gate_.tick(g);
        }
        raise(peakL_, peakL);
        raise(peakR_, peakR);
        rmsL_.store(f.rmsL);
        rmsR_.store(f.rmsR);
        if (clipL) clipL_.store(true);
        if (clipR) clipR_.store(true);
        stereo_.store(stereo);
        audioPatched_.store(c.inputConnected[InL] || stereo);

        float cvLo, cvHi;
        cv_.takeRange(cvLo, cvHi);
        lower(cvLo_, cvLo);
        raise(cvHi_, cvHi);
        cvNow_.store(cv_.last);
        cvPatched_.store(c.inputConnected[Cv]);

        gateHigh_.store(gate_.high());
        if (gate_.takeAnyHigh()) gateAny_.store(true);
        gateCount_.store(gate_.count());
        gateLength_.store(gate_.length());
        gateRate_.store(gate_.rateHz());
        gateDuty_.store(gate_.duty());
        gatePatched_.store(c.inputConnected[Gate]);
    }

private:
    void logEvent(const NoteEvent& e) noexcept {
        switch (e.type) {
            case NoteEvent::On:
                log_.push(monitorEvent(kMonNoteOn, e.channel, e.note, e.value));
                held_.on(e.note);
                break;
            case NoteEvent::Off:
                log_.push(monitorEvent(kMonNoteOff, e.channel, e.note, e.value));
                held_.off(e.note);
                break;
            case NoteEvent::Pressure:
                log_.push(monitorEvent(kMonPressure, e.channel, e.note, e.value));
                break;
            case NoteEvent::Cc:
                log_.push(monitorEvent(kMonCc, e.channel, e.note, e.value));
                if (e.note == 120 || e.note == 123) held_.reset();  // all sound / all notes off
                break;
            case NoteEvent::Program:
                log_.push(monitorEvent(kMonProgram, e.channel, e.note, 0.0f));
                break;
            case NoteEvent::Bend:
                log_.push(monitorEvent(kMonBend, e.channel, 0, e.value));
                break;
            case NoteEvent::ChannelPressure:
                log_.push(monitorEvent(kMonChannelPressure, e.channel, 0, e.value));
                break;
            case NoteEvent::System:
                log_.push(monitorEvent(kMonSystem, 0, e.note, 0.0f));
                break;
            default:
                break;  // a type from a later version: nothing to show
        }
    }

    LevelMeterDsp meter_;
    GateStats gate_;
    CvStats cv_;
    MidiLog log_;
    HeldNotes held_;

    mutable std::atomic<float> peakL_{0.0f}, peakR_{0.0f};
    mutable std::atomic<bool> clipL_{false}, clipR_{false};
    std::atomic<float> rmsL_{0.0f}, rmsR_{0.0f};
    std::atomic<bool> stereo_{false}, audioPatched_{false}, cvPatched_{false}, gatePatched_{false}, notesPatched_{false};

    mutable std::atomic<float> cvLo_{kNoRange}, cvHi_{-kNoRange};
    std::atomic<float> cvNow_{0.0f};

    std::atomic<bool> gateHigh_{false};
    mutable std::atomic<bool> gateAny_{false};
    std::atomic<uint32_t> gateCount_{0};
    std::atomic<float> gateLength_{0.0f}, gateRate_{0.0f}, gateDuty_{0.0f};
};

}  // namespace

static void registerMonitorModule(Registry& r) {
    ModuleSpec s;
    s.type = "monitor";
    s.name = "Monitor";
    s.category = "Utility/Metering";
    s.colour = "#7dd3fc";
    s.description = "Shows what is on a cable: a MIDI event table, an audio meter, a CV readout and a gate meter. Everything passes through.";
    s.params = {ParamSpec::seconds("response", "Response", 0.01f, 2.0f, 0.3f, 0.3f),
                ParamSpec::choice("floor", "Floor", {"-24 dB", "-36 dB", "-48 dB", "-60 dB", "-72 dB", "-96 dB"},
                                  kLevelMeterDefaultFloor)};
    s.inputs = {{"notes", "Notes", Signal::Notes},
                {"l", "Audio L", Signal::Audio},
                {"r", "Audio R", Signal::Audio},
                {"cv", "CV", Signal::Control},
                {"gate", "Gate", Signal::Gate}};
    s.outputs = {{"notes", "Notes", Signal::Notes, false},
                 {"l", "Audio L", Signal::Audio, true},
                 {"r", "Audio R", Signal::Audio, true},
                 {"cv", "CV", Signal::Control, false},
                 {"gate", "Gate", Signal::Gate, false}};
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<MonitorModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerMonitorModule);

}  // namespace bleep::engine
