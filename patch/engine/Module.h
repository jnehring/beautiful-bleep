// SPDX-License-Identifier: MIT
//
// Module.h — the processing side of a node. The engine runs modules in
// chunks of at most kChunk samples; every input is already summed from its
// cables and every knob already carries its modulation:
//
//     effective = clamp(knob + Σ source × amount, 0, 1)      (spec §5.6)
//
// so a module only reads buffers and writes buffers. No JUCE here.
#pragma once

#include "Spec.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace bleep::engine {

constexpr int kChunk = 32;            ///< engine sub-block; also the feedback delay (spec §7.5)
constexpr int kMaxNotesPerChunk = 64;
constexpr int kNumMacros = 16;

/// One event of the `notes` signal type. Pitch in virtual volts (1.0 = 1 octave, 0 = C4).
struct NoteEvent {
    enum Type : uint8_t { On, Off, Pressure };
    uint8_t type = On;
    uint8_t channel = 0;  ///< 0..15
    int16_t offset = 0;   ///< sample inside the chunk
    int32_t note = 60;    ///< MIDI note number: identifies the note
    float pitch = 0.0f;
    float value = 0.0f;   ///< velocity (On/Off) or pressure, 0..1
};

struct NoteBuffer {
    NoteEvent events[kMaxNotesPerChunk];
    int count = 0;
    void clear() noexcept { count = 0; }
    bool push(const NoteEvent& e) noexcept {
        if (count >= kMaxNotesPerChunk) return false;
        events[count++] = e;
        return true;
    }
};

/// Host musical time for the block being processed.
struct Transport {
    double sampleRate = 48000.0;
    double bpm = 120.0;
    double ppq = 0.0;          ///< quarter notes at the block start
    bool ppqValid = false;
    bool playing = false;
    int64_t samplePos = 0;
};

/// Raw MIDI, as exchanged with the MIDI ports.
struct MidiEvent {
    int32_t offset = 0;        ///< sample inside the host block
    uint8_t bytes[3] = {0, 0, 0};
    uint8_t size = 0;
};

struct PortIO;  // Engine.h: a port's host-block data for the running tick

struct ProcessContext {
    int numSamples = 0;
    int offset = 0;                    ///< chunk start inside the host block
    const Transport* transport = nullptr;
    bool transportStarted = false;     ///< first block after the transport started
    double ppqStart = 0.0;             ///< at the chunk start
    double ppqPerSample = 0.0;
    double ppqAt(int i) const noexcept { return ppqStart + ppqPerSample * i; }

    const float* const* params = nullptr;   ///< effective normalised value per param, per sample
    const float* const* inputs = nullptr;   ///< per input jack (nullptr for notes jacks)
    const bool* inputConnected = nullptr;
    const NoteBuffer* const* notesIn = nullptr;  ///< per input jack (nullptr unless notes)
    float* const* outputs = nullptr;        ///< per output jack (nullptr for notes jacks)
    NoteBuffer* const* notesOut = nullptr;  ///< per output jack (nullptr unless notes)
    PortIO* port = nullptr;                 ///< port nodes: this tick's host data (nullptr = ghost)
};

class Module {
public:
    explicit Module(const ModuleSpec& spec);
    virtual ~Module() = default;

    const ModuleSpec& spec() const noexcept { return spec_; }

    virtual void prepare(double sampleRate) { sampleRate_ = sampleRate; }
    virtual void reset() {}
    virtual void process(const ProcessContext& ctx) = 0;

    // ---- knobs: written by the message thread, read by the audio thread ----
    void setKnob(int i, float normalised) noexcept { knobs_[(size_t)i].store(normalised, std::memory_order_relaxed); }
    float knob(int i) const noexcept { return knobs_[(size_t)i].load(std::memory_order_relaxed); }

    /// A param's effective value in its own units at sample s.
    float value(const ProcessContext& c, int i, int s) const noexcept {
        return spec_.params[(size_t)i].fromNormalised(c.params[i][s]);
    }
    /// A non-modulated setting in its own units.
    float setting(int i) const noexcept { return spec_.params[(size_t)i].fromNormalised(knob(i)); }

    // ---- live values for the UI (audio thread writes, UI reads) ------------
    struct Display {
        std::atomic<float> value{0.0f};
        std::atomic<bool> active{false};
    };
    Display& paramDisplay(int i) noexcept { return paramDisplay_[(size_t)i]; }
    Display& outputDisplay(int i) noexcept { return outputDisplay_[(size_t)i]; }

protected:
    double sampleRate_ = 48000.0;

private:
    const ModuleSpec& spec_;
    std::unique_ptr<std::atomic<float>[]> knobs_;
    std::unique_ptr<Display[]> paramDisplay_;
    std::unique_ptr<Display[]> outputDisplay_;
};

inline Module::Module(const ModuleSpec& spec)
    : spec_(spec),
      knobs_(new std::atomic<float>[spec.params.size() + 1]),
      paramDisplay_(new Display[spec.params.size() + 1]),
      outputDisplay_(new Display[spec.outputs.size() + 1]) {
    for (size_t i = 0; i < spec.params.size(); ++i) {
        knobs_[i].store(spec.params[i].defaultNormalised());
        paramDisplay_[i].value.store(spec.params[i].defaultNormalised());
    }
}

}  // namespace bleep::engine
