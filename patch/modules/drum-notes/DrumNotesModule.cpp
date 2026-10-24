// SPDX-License-Identifier: GPL-3.0-only
// Drum Notes (doc/drum-notes.md): General MIDI drum notes in; a trigger per drum out, and the hit's velocity.
#include "Registry.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <string>
#include <vector>

namespace bleep::engine {
namespace {

/// The drums, each with the General MIDI notes that play it.
struct GmDrum {
    const char* id;
    const char* name;
    std::vector<int> notes;
};
const std::vector<GmDrum>& gmDrums() {
    static const std::vector<GmDrum> drums{
        {"kick", "Kick", {35, 36}},
        {"snare", "Snare", {38, 40}},
        {"rim", "Rim", {37}},
        {"clap", "Clap", {39}},
        {"hat", "Closed Hat", {42, 44}},
        {"open", "Open Hat", {46}},
        {"tom", "Tom", {41, 43, 45, 47, 48, 50}},
        {"bell", "Cowbell", {56}},
        {"ride", "Ride", {51, 53, 59}},
        {"crash", "Crash", {49, 52, 55, 57}},
    };
    return drums;
}
constexpr size_t kDrums = 10;

/// A note-on of a General MIDI drum note pulses that drum's trigger for one sample. `velocity` carries the
/// note's velocity for a short moment around the trigger and is 0 otherwise, so it adds to a pattern's own
/// velocity only while a hit from the keys is sounding.
class DrumNotesModule final : public Module {
public:
    using Module::Module;

    void reset() override {
        hold_ = 0;
        velocity_ = 0.0f;
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        for (size_t d = 0; d < kDrums; ++d) out.push_back({std::string("hits_") + gmDrums()[d].id, (double)hits_[d].load()});
        out.push_back({"velocity", (double)lastVelocity_.load()});
    }

    void process(const ProcessContext& c) override {
        const auto& drums = gmDrums();
        for (size_t d = 0; d < kDrums; ++d) std::fill(c.outputs[d], c.outputs[d] + c.numSamples, 0.0f);
        const NoteBuffer* notes = c.inputConnected[0] ? c.notesIn[0] : nullptr;
        int e = 0;
        for (int i = 0; i < c.numSamples; ++i) {
            for (; notes && e < notes->count && notes->events[e].offset <= i; ++e) {
                const NoteEvent& ev = notes->events[e];
                if (ev.type != NoteEvent::On) continue;
                for (size_t d = 0; d < kDrums; ++d)
                    if (std::find(drums[d].notes.begin(), drums[d].notes.end(), ev.note) != drums[d].notes.end()) {
                        c.outputs[d][i] = 1.0f;
                        velocity_ = ev.value;
                        hold_ = kHoldSamples;
                        hits_[d].fetch_add(1);
                        lastVelocity_.store(ev.value);
                    }
            }
            c.outputs[kDrums][i] = hold_ > 0 ? velocity_ : 0.0f;
            if (hold_ > 0) --hold_;
        }
    }

private:
    static constexpr int kHoldSamples = 48;
    int hold_ = 0;
    float velocity_ = 0.0f;
    std::array<std::atomic<int>, kDrums> hits_{};
    std::atomic<float> lastVelocity_{0.0f};
};

}  // namespace

static void registerDrumNotesModule(Registry& r) {
    ModuleSpec s;
    s.type = "drum-notes";
    s.name = "Drum Notes";
    s.category = "Utility/Converters";
    s.colour = "#c084fc";
    s.description = "General MIDI drum notes in; a trigger per drum out (kick, snare, rim, clap, hats, tom, cowbell, ride, crash) and the hit's velocity.";
    s.inputs = {{"notes", "Notes", Signal::Notes}};
    for (const auto& d : gmDrums()) s.outputs.push_back({d.id, d.name, Signal::Trigger, false});
    s.outputs.push_back({"velocity", "Velocity", Signal::Control, false});
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<DrumNotesModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerDrumNotesModule);

}  // namespace bleep::engine
