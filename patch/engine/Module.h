// SPDX-License-Identifier: GPL-3.0-or-later WITH AdditionRef-Bleep-Module-Exception
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
#include <string>
#include <utility>
#include <vector>

namespace bleep::engine {

constexpr int kChunk = 32;            ///< engine sub-block; also the feedback delay (spec §7.5)
constexpr int kMaxNotesPerChunk = 64;
constexpr int kNoteReserve = 16;      ///< slots of a notes buffer kept free of controller events
constexpr int kNumMacros = 16;

/// One event of the `notes` signal type. Pitch in virtual volts (1.0 = 1 octave, 0 = C4).
///
/// On, Off and Pressure play notes. The other types carry the rest of MIDI so a
/// module can show or use it (the Monitor); they reuse `note` and `value`, and the
/// layout stays 16 bytes. A module must ignore types it does not know: test for
/// the types it handles, never "anything else".
struct NoteEvent {
    enum Type : uint8_t {
        On,
        Off,
        Pressure,         ///< polyphonic key pressure: `note`, `value` 0..1
        Cc,               ///< control change: `note` = controller 0..127, `value` = data / 127
        Program,          ///< program change: `note` = program 0..127
        Bend,             ///< pitch bend: `value` −1..+1
        ChannelPressure,  ///< channel pressure: `value` 0..1
        System,           ///< realtime message: `note` = status byte (0xF8 clock, 0xFA start, 0xFB continue, 0xFC stop)
    };
    uint8_t type = On;
    uint8_t channel = 0;  ///< 0..15
    int16_t offset = 0;   ///< sample inside the chunk
    int32_t note = 60;    ///< MIDI note number: identifies the note (see Type for the others)
    float pitch = 0.0f;
    float value = 0.0f;   ///< velocity (On/Off) or pressure, 0..1 (see Type for the others)
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
    /// Pushes a controller-type event (anything but On/Off/Pressure) only while
    /// kNoteReserve slots stay free, so a flood of CCs never crowds out notes.
    bool pushController(const NoteEvent& e) noexcept {
        if (count >= kMaxNotesPerChunk - kNoteReserve) return false;
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

struct PortIO;     // Engine.h: a port's host-block data for the running tick
struct MediaClip;  // Media.h: decoded audio from the media folder
}  // namespace bleep::engine

namespace bleep::dsp {
struct HarmonyState;  // dsp/Harmony.h: the board-wide key, scale and chord
}

namespace bleep::engine {

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
    /// Per output jack: something reads it. Unread outputs may be skipped
    /// (their buffers must still hold valid numbers; leaving them as they are is fine).
    const bool* outputConnected = nullptr;
    PortIO* port = nullptr;                 ///< port nodes: this tick's host data (nullptr = ghost)
    /// The board-wide harmony buses (dsp::kHarmonyBuses of them), for modules
    /// whose spec declares a HarmonyRole. Writers run before readers.
    dsp::HarmonyState* harmony = nullptr;
    /// Inside a Voice Cell: this voice's index (0 … voices − 1), e.g. to give each
    /// voice its own random stream. -1 outside Voice Cells.
    int voice = -1;

    bool isOutputConnected(int jack) const noexcept { return !outputConnected || outputConnected[jack]; }
};

class Module {
public:
    explicit Module(const ModuleSpec& spec);
    virtual ~Module() = default;

    const ModuleSpec& spec() const noexcept { return spec_; }

    virtual void prepare(double sampleRate) { sampleRate_ = sampleRate; }
    virtual void reset() {}
    virtual void process(const ProcessContext& ctx) = 0;

    /// [message thread] The node's free-form data (board document "data", as
    /// JSON), after the spec's sanitiseData. Called when the module is built
    /// and whenever the data changes; modules hand it to the audio thread
    /// themselves.
    virtual void setData(const std::string& json) { (void)json; }
    /// [message thread] A performance gesture from the module view (a button
    /// press, a key played): no undo entry, not saved. Modules hand it to the
    /// audio thread themselves, e.g. through a ControlQueue.
    virtual void perform(const std::string& action, const std::vector<double>& args) { (void)action; (void)args; }
    /// [message thread] Extra live values for the module view, e.g. a playhead.
    virtual void liveValues(std::vector<std::pair<std::string, double>>& out) const { (void)out; }
    /// [message thread] Live arrays for custom displays (a spectrum, a register's
    /// bits, a buffer overview). Read audio-thread data safely (atomics).
    virtual void liveArrays(std::vector<std::pair<std::string, std::vector<float>>>& out) const { (void)out; }

    /// [message thread] Node data the module changed itself (e.g. a captured
    /// loop): return true and fill `json`. The engine stores it in the board
    /// (through sanitiseData), passes it back through setData and tells open
    /// views. Polled ten times a second; no undo entry of its own.
    virtual bool takeData(std::string& json) {
        (void)json;
        return false;
    }
    /// [message thread] Audio the module wants saved to the media folder
    /// (Media.h), e.g. a recorded reel; `slot` names which. Null: nothing to save.
    virtual std::shared_ptr<const MediaClip> exportMedia(const std::string& slot) {
        (void)slot;
        return nullptr;
    }

    /// [message thread] A view button (ModuleSpec::buttons) or another one-shot
    /// command. The default queues it for the audio thread: drain the queue
    /// with pollCommands() at the start of process().
    virtual void command(const std::string& id, float value) {
        for (size_t i = 0; i < spec_.buttons.size(); ++i)
            if (spec_.buttons[i].id == id) postCommand((int)i, value);
    }
    /// One queued command: `index` into ModuleSpec::buttons (or a module's own code).
    struct Command {
        int index = 0;
        float value = 0.0f;
    };
    /// [message thread] Queues a command; false if the queue is full.
    bool postCommand(int index, float value) noexcept {
        const uint32_t w = cmdWrite_.load(std::memory_order_relaxed);
        if (w - cmdRead_.load(std::memory_order_acquire) >= kCommandQueue) return false;
        commands_[w % kCommandQueue] = {index, value};
        cmdWrite_.store(w + 1, std::memory_order_release);
        return true;
    }
    /// [audio thread] Calls f(Command) for every queued command, oldest first.
    template <class F>
    void pollCommands(F&& f) noexcept {
        uint32_t r = cmdRead_.load(std::memory_order_relaxed);
        const uint32_t w = cmdWrite_.load(std::memory_order_acquire);
        for (; r != w; ++r) f(commands_[r % kCommandQueue]);
        cmdRead_.store(r, std::memory_order_release);
    }

    /// [audio threads] Only one thread runs a module at a time. A module belongs to one thread in steady state (the tick, or the
    /// plugin whose cell it is in, Program::runLocal); a recompile can move it from one to the other while the old program is still
    /// running somewhere, and the one that finds it taken skips the module for that chunk.
    bool tryEnter() noexcept { return !busy_.exchange(true, std::memory_order_acquire); }
    void leave() noexcept { busy_.store(false, std::memory_order_release); }

    // ---- knobs: written by the message thread, read by the audio thread ----
    void setKnob(int i, float normalised) noexcept { knobs_[(size_t)i].store(normalised, std::memory_order_relaxed); }
    float knob(int i) const noexcept { return knobs_[(size_t)i].load(std::memory_order_relaxed); }

    /// A param's effective value in its own units at sample s.
    float value(const ProcessContext& c, int i, int s) const noexcept {
        return spec_.params[(size_t)i].fromNormalised(c.params[i][s]);
    }
    /// A setting in its own units: the knob, or, when a cable drives it (ParamSpec::cableable), the value the compiler worked out
    /// at the start of this block (the knob plus the cables). Modules read settings through this, once per block.
    float setting(int i) const noexcept {
        const float driven = driven_[(size_t)i].load(std::memory_order_relaxed);
        return spec_.params[(size_t)i].fromNormalised(driven >= 0.0f ? driven : knob(i));
    }
    /// [audio thread, the compiler] The driven value of a cableable setting (normalised), or -1 when no cable drives it.
    void setDriven(int i, float normalised) noexcept { driven_[(size_t)i].store(normalised, std::memory_order_relaxed); }

    // ---- live values for the UI (audio thread writes, UI reads) ------------
    struct Display {
        std::atomic<float> value{0.0f};
        std::atomic<bool> active{false};
        /// Outputs: the signal's range since the UI last read it (activity()).
        std::atomic<float> lo{1e30f}, hi{-1e30f};
        /// The swing since the last call (0 when idle or constant), then resets. UI thread.
        float activity() noexcept {
            const float h = hi.exchange(-1e30f, std::memory_order_relaxed);
            const float l = lo.exchange(1e30f, std::memory_order_relaxed);
            return h > l ? h - l : 0.0f;
        }
    };
    Display& paramDisplay(int i) noexcept { return paramDisplay_[(size_t)i]; }
    Display& outputDisplay(int i) noexcept { return outputDisplay_[(size_t)i]; }

    /// [audio thread] The engine found NaN, inf or a runaway level in this module's output, silenced it and reset the module.
    void noteRunaway() noexcept { runaways_.fetch_add(1, std::memory_order_relaxed); }
    /// [message thread] How many runaways since the last call, then clears the count.
    uint32_t takeRunaways() noexcept { return runaways_.exchange(0, std::memory_order_relaxed); }

protected:
    double sampleRate_ = 48000.0;

private:
    static constexpr uint32_t kCommandQueue = 64;
    Command commands_[kCommandQueue];
    std::atomic<uint32_t> cmdWrite_{0}, cmdRead_{0};
    std::atomic<bool> busy_{false};                  // see tryEnter()
    std::atomic<uint32_t> runaways_{0};

    const ModuleSpec& spec_;
    std::unique_ptr<std::atomic<float>[]> knobs_;
    std::unique_ptr<std::atomic<float>[]> driven_;   // see setting()
    std::unique_ptr<Display[]> paramDisplay_;
    std::unique_ptr<Display[]> outputDisplay_;
};

inline Module::Module(const ModuleSpec& spec)
    : spec_(spec),
      knobs_(new std::atomic<float>[spec.params.size() + 1]),
      driven_(new std::atomic<float>[spec.params.size() + 1]),
      paramDisplay_(new Display[spec.params.size() + 1]),
      outputDisplay_(new Display[spec.outputs.size() + 1]) {
    for (size_t i = 0; i < spec.params.size(); ++i) {
        knobs_[i].store(spec.params[i].defaultNormalised());
        driven_[i].store(-1.0f);
        paramDisplay_[i].value.store(spec.params[i].defaultNormalised());
    }
}

}  // namespace bleep::engine
