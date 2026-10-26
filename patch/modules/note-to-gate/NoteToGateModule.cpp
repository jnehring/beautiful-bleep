// SPDX-License-Identifier: GPL-3.0-only
// Note to Gate (doc/note-to-gate.md): a MIDI note stream in; a gate per chosen note out, and a list of the notes heard.
#include "Registry.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <string>
#include <vector>

namespace bleep::engine {
namespace {

constexpr int kMaxGates = 16;
constexpr int kShownNotes = 12;  ///< how many of the latest notes the view lists

/// Each gate listens to one MIDI note (any channel) and is high while that note is held.
class NoteToGateModule final : public Module {
public:
    // Params: Gates, then Note 1–16.
    enum { Gates = 0, Note };

    using Module::Module;

    void reset() override {
        held_.fill(0);
        for (auto& g : high_) g.store(false);
    }

    void liveValues(std::vector<std::pair<std::string, double>>& out) const override {
        for (int k = 0; k < kMaxGates; ++k) out.push_back({"gate" + std::to_string(k + 1), high_[(size_t)k].load() ? 1.0 : 0.0});
    }

    /// The latest note-ons, newest first: the count of note-ons ever heard, then (note, velocity 0…127) per note.
    void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const override {
        const uint32_t total = total_.load();
        std::vector<float> v;
        v.push_back((float)(total & 0xffffff));  // exact in a float; the view takes differences modulo 2^24
        for (uint32_t n = 0; n < kShownNotes && n < total; ++n) {
            const uint32_t packed = log_[(total - 1 - n) % kShownNotes].load();
            v.push_back((float)(packed >> 8));
            v.push_back((float)(packed & 0xff));
        }
        out.push_back({"notes", std::move(v)});
    }

    void process(const ProcessContext& c) override {
        const int gates = std::clamp((int)setting(Gates), 1, kMaxGates);
        std::array<int, kMaxGates> note{};
        for (int k = 0; k < kMaxGates; ++k) note[(size_t)k] = (int)setting(Note + k);
        const NoteBuffer* notes = c.inputConnected[0] ? c.notesIn[0] : nullptr;
        if (!notes) held_.fill(0);  // nothing patched: nothing can still be held
        int e = 0;
        for (int i = 0; i < c.numSamples; ++i) {
            for (; notes && e < notes->count && notes->events[e].offset <= i; ++e) {
                const NoteEvent& ev = notes->events[e];
                if (ev.type == NoteEvent::On) {
                    const uint32_t total = total_.load();
                    log_[total % kShownNotes].store(((uint32_t)ev.note << 8) | (uint32_t)std::clamp((int)(ev.value * 127.0f + 0.5f), 0, 127));
                    total_.store(total + 1);
                }
                for (int k = 0; k < gates; ++k) {
                    int& h = held_[(size_t)k];
                    if (ev.type == NoteEvent::On && ev.note == note[(size_t)k]) ++h;
                    else if (ev.type == NoteEvent::Off && ev.note == note[(size_t)k]) h = std::max(0, h - 1);
                    else if (ev.type == NoteEvent::Cc && (ev.note == 120 || ev.note == 123)) h = 0;  // all sound / notes off
                }
            }
            for (int k = 0; k < kMaxGates; ++k)
                if (c.outputs[k]) c.outputs[k][i] = k < gates && held_[(size_t)k] > 0 ? 1.0f : 0.0f;
        }
        for (int k = 0; k < kMaxGates; ++k) high_[(size_t)k].store(k < gates && held_[(size_t)k] > 0);
    }

private:
    std::array<int, kMaxGates> held_{};  ///< audio thread: notes held per gate (a note on two channels counts twice)
    std::array<std::atomic<bool>, kMaxGates> high_{};
    std::array<std::atomic<uint32_t>, kShownNotes> log_{};  ///< note << 8 | velocity, a ring
    std::atomic<uint32_t> total_{0};
};

}  // namespace

static void registerNoteToGateModule(Registry& r) {
    ModuleSpec s;
    s.type = "note-to-gate";
    s.name = "Note to Gate";
    s.category = "Utility/Converters";
    s.colour = "#c084fc";
    s.description = "A MIDI note stream in; a gate per note you choose out (1 to 16 gates, each with its own note), "
                    "and a list of the latest notes that came in, to find the notes to set.";
    s.params.push_back(ParamSpec::integer("gates", "Gates", 1, kMaxGates, 4));
    for (int k = 1; k <= kMaxGates; ++k)
        s.params.push_back(ParamSpec::integer("note" + std::to_string(k), "Note " + std::to_string(k), 0, 127, 35 + k).when("gates", k, kMaxGates));
    s.inputs = {{"notes", "Notes", Signal::Notes}};
    for (int k = 1; k <= kMaxGates; ++k)
        s.outputs.push_back(JackSpec{"gate" + std::to_string(k), "Gate " + std::to_string(k), Signal::Gate, false}.when("gates", k, kMaxGates));
    r.add(std::move(s), [](const ModuleSpec& spec) { return std::make_unique<NoteToGateModule>(spec); });
}

BLEEP_REGISTER_MODULE(registerNoteToGateModule);

}  // namespace bleep::engine
