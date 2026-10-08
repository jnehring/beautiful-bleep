// SPDX-License-Identifier: MIT
//
// Spec.h — what a node type looks like from the outside: its parameters
// (knobs and settings), input jacks and output jacks. The board UI, the board
// model and the compiler all work from these descriptions. No JUCE here.
#pragma once

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace bleep::engine {

/// Signal types (spec §7.1). All but `notes` are one float per sample.
enum class Signal { Control, Gate, Trigger, Pitch, Audio, Notes };

const char* signalName(Signal s) noexcept;
bool signalFromName(const std::string& name, Signal& out) noexcept;

/// Cable compatibility (spec §7.4): notes only connect to notes.
inline bool compatible(Signal from, Signal to) noexcept {
    return (from == Signal::Notes) == (to == Signal::Notes);
}

/// A knob or setting. Values cross the bridge and are saved normalised (0..1).
struct ParamSpec {
    enum class Kind { Float, Choice, Bool, Int };
    enum class Map { Linear, Exponential, Skew };
    enum class Format { Number, Seconds, Percent, Hertz, Choice, Integer, Toggle, FilterMode, Semitones };

    std::string id;
    std::string name;
    Kind kind = Kind::Float;
    Map map = Map::Linear;
    Format format = Format::Number;
    float min = 0.0f, max = 1.0f;
    float centre = 0.5f;         ///< Map::Skew: value in the middle of the knob
    float def = 0.0f;            ///< default, in units
    int decimals = 2;
    std::string label;           ///< unit suffix for Format::Number
    std::vector<std::string> choices;
    bool modulatable = true;     ///< a knob (input jack) or a plain setting

    /// Units → 0..1 and back, with JUCE's NormalisableRange semantics.
    float toNormalised(float value) const noexcept;
    float fromNormalised(float normalised) const noexcept;
    float defaultNormalised() const noexcept { return toNormalised(def); }
    int numSteps() const noexcept;  ///< 0 for continuous
    std::string text(float value) const;

    // Builders, mirroring the old per-plugin parameter helpers.
    static ParamSpec number(std::string id, std::string name, float min, float max, float def,
                            std::string label = {}, int decimals = 2);
    static ParamSpec seconds(std::string id, std::string name, float min, float max, float centre, float def);
    static ParamSpec percent(std::string id, std::string name, float min, float max, float def);
    static ParamSpec hertz(std::string id, std::string name, float min, float max, float def);
    static ParamSpec exponential(std::string id, std::string name, float min, float max, float def,
                                 std::string label = {});
    static ParamSpec choice(std::string id, std::string name, std::vector<std::string> choices, int def);
    static ParamSpec toggle(std::string id, std::string name, bool def);
    static ParamSpec integer(std::string id, std::string name, int min, int max, int def);
};

struct JackSpec {
    std::string id;
    std::string name;
    Signal type = Signal::Control;
    bool bipolar = true;  ///< outputs: declared range, for scopes
};

/// Which plugin in Live a port node belongs to (spec §6). None for modules.
enum class PortKind { None, Patch, MidiIn, MidiOut, AudioIn, AudioOut, Instrument, AudioInsert };

const char* portKindName(PortKind k) noexcept;

struct ModuleSpec {
    std::string type;        ///< stable id saved in boards, e.g. "function"
    std::string name;        ///< "Function"
    std::string category;    ///< browser group: "Modulation", "Audio", "Ports", "Cells"
    std::string colour;      ///< "#4fd1c5"
    std::string description;
    PortKind port = PortKind::None;
    bool userCreatable = true;  ///< false for ports and cell boundaries
    std::vector<ParamSpec> params;
    std::vector<JackSpec> inputs;
    std::vector<JackSpec> outputs;

    int paramIndex(const std::string& id) const noexcept;
    int inputIndex(const std::string& id) const noexcept;
    int outputIndex(const std::string& id) const noexcept;
};

// ---- inline implementation -------------------------------------------------

inline const char* signalName(Signal s) noexcept {
    switch (s) {
        case Signal::Gate: return "gate";
        case Signal::Trigger: return "trigger";
        case Signal::Pitch: return "pitch";
        case Signal::Audio: return "audio";
        case Signal::Notes: return "notes";
        case Signal::Control: break;
    }
    return "control";
}

inline bool signalFromName(const std::string& n, Signal& out) noexcept {
    for (Signal s : {Signal::Control, Signal::Gate, Signal::Trigger, Signal::Pitch, Signal::Audio, Signal::Notes})
        if (n == signalName(s)) {
            out = s;
            return true;
        }
    return false;
}

inline const char* portKindName(PortKind k) noexcept {
    switch (k) {
        case PortKind::Patch: return "patch";
        case PortKind::MidiIn: return "midi-in";
        case PortKind::MidiOut: return "midi-out";
        case PortKind::AudioIn: return "audio-in";
        case PortKind::AudioOut: return "audio-out";
        case PortKind::Instrument: return "instrument";
        case PortKind::AudioInsert: return "audio-insert";
        case PortKind::None: break;
    }
    return "";
}

inline float ParamSpec::toNormalised(float v) const noexcept {
    if (max <= min) return 0.0f;
    v = std::fmin(std::fmax(v, min), max);
    float x = 0.0f;
    switch (map) {
        case Map::Linear: x = (v - min) / (max - min); break;
        case Map::Exponential: x = std::log(v / min) / std::log(max / min); break;
        case Map::Skew: {
            const float skew = std::log(0.5f) / std::log((centre - min) / (max - min));
            const float p = (v - min) / (max - min);
            x = p <= 0.0f ? 0.0f : std::pow(p, skew);
            break;
        }
    }
    return std::fmin(std::fmax(x, 0.0f), 1.0f);
}

inline float ParamSpec::fromNormalised(float x) const noexcept {
    x = std::fmin(std::fmax(x, 0.0f), 1.0f);
    float v = min;
    switch (map) {
        case Map::Linear: v = min + (max - min) * x; break;
        case Map::Exponential: v = min * std::pow(max / min, x); break;
        case Map::Skew: {
            const float skew = std::log(0.5f) / std::log((centre - min) / (max - min));
            v = x <= 0.0f ? min : min + (max - min) * std::exp(std::log(x) / skew);
            break;
        }
    }
    if (kind != Kind::Float) v = std::round(v);
    return v;
}

inline int ParamSpec::numSteps() const noexcept {
    return kind == Kind::Float ? 0 : (int)std::lround(max - min) + 1;
}

inline std::string ParamSpec::text(float v) const {
    char buf[64];
    switch (format) {
        case Format::Seconds:
            if (v < 1.0f) std::snprintf(buf, sizeof buf, "%d ms", (int)std::lround(v * 1000.0f));
            else std::snprintf(buf, sizeof buf, "%.2f s", v);
            return buf;
        case Format::Percent: std::snprintf(buf, sizeof buf, "%d %%", (int)std::lround(v * 100.0f)); return buf;
        case Format::Hertz:
            if (v < 1000.0f) std::snprintf(buf, sizeof buf, v < 10.0f ? "%.2f Hz" : "%.0f Hz", v);
            else std::snprintf(buf, sizeof buf, "%.2f kHz", v / 1000.0f);
            return buf;
        case Format::Choice: {
            const int i = (int)std::lround(v - min);
            return i >= 0 && i < (int)choices.size() ? choices[(size_t)i] : std::string();
        }
        case Format::Integer: std::snprintf(buf, sizeof buf, "%d", (int)std::lround(v)); return buf;
        case Format::Toggle: return v >= 0.5f ? "On" : "Off";
        case Format::Semitones: std::snprintf(buf, sizeof buf, "%+d st", (int)std::lround(v)); return buf;
        case Format::FilterMode: {
            static const char* names[] = {"LP", "BP", "HP", "Notch"};
            const float m = std::fmin(std::fmax(v, 0.0f), 1.0f) * 3.0f;
            const int i = (int)std::lround(m);
            if (std::fabs(m - (float)i) < 0.05f) return names[i];
            const int lo = (int)m;
            return std::string(names[lo]) + "›" + names[lo < 3 ? lo + 1 : 3];
        }
        case Format::Number: break;
    }
    std::snprintf(buf, sizeof buf, "%.*f", decimals, v);
    return label.empty() ? std::string(buf) : std::string(buf) + " " + label;
}

inline ParamSpec ParamSpec::number(std::string id, std::string name, float min, float max, float def,
                                   std::string label, int decimals) {
    ParamSpec p;
    p.id = std::move(id);
    p.name = std::move(name);
    p.min = min;
    p.max = max;
    p.def = def;
    p.label = std::move(label);
    p.decimals = decimals;
    return p;
}

inline ParamSpec ParamSpec::seconds(std::string id, std::string name, float min, float max, float centre, float def) {
    ParamSpec p = number(std::move(id), std::move(name), min, max, def);
    p.map = Map::Skew;
    p.centre = centre;
    p.format = Format::Seconds;
    return p;
}

inline ParamSpec ParamSpec::percent(std::string id, std::string name, float min, float max, float def) {
    ParamSpec p = number(std::move(id), std::move(name), min, max, def);
    p.format = Format::Percent;
    return p;
}

inline ParamSpec ParamSpec::hertz(std::string id, std::string name, float min, float max, float def) {
    ParamSpec p = number(std::move(id), std::move(name), min, max, def);
    p.map = Map::Exponential;
    p.format = Format::Hertz;
    return p;
}

inline ParamSpec ParamSpec::exponential(std::string id, std::string name, float min, float max, float def,
                                        std::string label) {
    ParamSpec p = number(std::move(id), std::move(name), min, max, def, std::move(label));
    p.map = Map::Exponential;
    return p;
}

inline ParamSpec ParamSpec::choice(std::string id, std::string name, std::vector<std::string> choices, int def) {
    ParamSpec p = number(std::move(id), std::move(name), 0.0f, (float)choices.size() - 1.0f, (float)def);
    p.kind = Kind::Choice;
    p.format = Format::Choice;
    p.choices = std::move(choices);
    p.modulatable = false;
    return p;
}

inline ParamSpec ParamSpec::toggle(std::string id, std::string name, bool def) {
    ParamSpec p = number(std::move(id), std::move(name), 0.0f, 1.0f, def ? 1.0f : 0.0f);
    p.kind = Kind::Bool;
    p.format = Format::Toggle;
    p.modulatable = false;
    return p;
}

inline ParamSpec ParamSpec::integer(std::string id, std::string name, int min, int max, int def) {
    ParamSpec p = number(std::move(id), std::move(name), (float)min, (float)max, (float)def);
    p.kind = Kind::Int;
    p.format = Format::Integer;
    p.modulatable = false;
    return p;
}

inline int ModuleSpec::paramIndex(const std::string& id) const noexcept {
    for (size_t i = 0; i < params.size(); ++i)
        if (params[i].id == id) return (int)i;
    return -1;
}
inline int ModuleSpec::inputIndex(const std::string& id) const noexcept {
    for (size_t i = 0; i < inputs.size(); ++i)
        if (inputs[i].id == id) return (int)i;
    return -1;
}
inline int ModuleSpec::outputIndex(const std::string& id) const noexcept {
    for (size_t i = 0; i < outputs.size(); ++i)
        if (outputs[i].id == id) return (int)i;
    return -1;
}

}  // namespace bleep::engine
