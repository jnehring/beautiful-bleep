// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// Spec.h — what a node type looks like from the outside: its parameters
// (knobs and settings), input jacks and output jacks. The board UI, the board
// model and the compiler all work from these descriptions. No JUCE here.
#pragma once

#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <utility>
#include <vector>

namespace bleep::engine {

/// Signal types (spec §7.1). All but `notes` are one float per sample.
enum class Signal { Control, Gate, Trigger, Pitch, Audio, Notes, Patchbay };

const char* signalName(Signal s) noexcept;
bool signalFromName(const std::string& name, Signal& out) noexcept;

/// Cable compatibility (spec §7.4): notes only connect to notes, and a patch bay's bundle only to a bundle.
inline bool compatible(Signal from, Signal to) noexcept {
    return (from == Signal::Notes) == (to == Signal::Notes) && (from == Signal::Patchbay) == (to == Signal::Patchbay);
}

/// Shows a knob, setting or jack only while another setting's value (in its
/// own units, rounded) lies in [min, max]; e.g. jacks 5–8 only while Count ≥ 5,
/// or a knob only in one mode. Hidden jacks keep their cables (the board dims
/// them); hidden knobs keep their values. Empty `param`: always shown.
struct ShowIf {
    std::string param;
    int min = 0, max = 0;
    std::string param2;  ///< optional second condition, both must hold (e.g. a channel exists and is stereo)
    int min2 = 0, max2 = 0;
    bool active() const noexcept { return !param.empty(); }
};

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
    std::vector<std::string> choiceGroups;  ///< optional: each choice's heading in the dropdown
    std::vector<std::string> legacyChoices; ///< optional: an earlier, shorter list that boards stored this choice
                                            ///< against (normalised: index / (n − 1)); Board::parse moves those
                                            ///< values to the same names in `choices`
    bool modulatable = true;     ///< a knob (input jack) or a plain setting;
                                 ///< choices and integers can be modulatable too (stepped knobs)
    bool cableable = false;      ///< a setting (not modulatable) that a cable may still drive: the module reads it through
                                 ///< Module::setting(), which gives the driven value (set in Registry.cpp, cableableSettings)
    bool drivable() const noexcept { return modulatable || cableable; }  ///< can a cable end here?
    std::string group;           ///< optional heading the module view groups knobs under
    ShowIf show;                 ///< optional: only shown while another setting is in range
    std::string namesBy;         ///< optional: the shown name is names[value of this setting]
    std::vector<std::string> names;

    // Chainable modifiers: ParamSpec::percent(...).inGroup("Env").when("mode", 1, 1)
    ParamSpec inGroup(std::string g) const {
        ParamSpec p = *this;
        p.group = std::move(g);
        return p;
    }
    ParamSpec when(std::string param, int lo, int hi) const {
        ParamSpec p = *this;
        p.show = {std::move(param), lo, hi};
        return p;
    }
    ParamSpec namedBy(std::string param, std::vector<std::string> list) const {
        ParamSpec p = *this;
        p.namesBy = std::move(param);
        p.names = std::move(list);
        return p;
    }

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
    /// A modulatable choice: a stepped knob whose value snaps to the choices.
    static ParamSpec stepped(std::string id, std::string name, std::vector<std::string> choices, int def);
    /// A modulatable integer: a stepped knob.
    static ParamSpec steppedInt(std::string id, std::string name, int min, int max, int def);
};

struct JackSpec {
    JackSpec() = default;
    /// {id, name, type, bipolar}: the optional fields below are set with when(),
    /// namedBy() and normalledTo().
    JackSpec(std::string jackId, std::string jackName, Signal signal = Signal::Control, bool isBipolar = true)
        : id(std::move(jackId)), name(std::move(jackName)), type(signal), bipolar(isBipolar) {}

    std::string id;
    std::string name;
    Signal type = Signal::Control;
    bool bipolar = true;  ///< outputs: declared range, for scopes
    ShowIf show;          ///< optional: only shown while a setting is in range (cables are kept)
    std::string namesBy;  ///< optional: the shown name is names[value of this setting]
    std::vector<std::string> names;
    /// Inputs: while unpatched, this input reads the signal of the input named
    /// here (normalling, e.g. Trig B follows Trig A). It still reports itself
    /// as unpatched in ProcessContext::inputConnected.
    std::string normal;

    JackSpec when(std::string param, int lo, int hi) const {
        JackSpec j = *this;
        j.show = {std::move(param), lo, hi};
        return j;
    }
    /// Also requires another setting in range (with when()).
    JackSpec andWhen(std::string param, int lo, int hi) const {
        JackSpec j = *this;
        j.show.param2 = std::move(param);
        j.show.min2 = lo;
        j.show.max2 = hi;
        return j;
    }
    JackSpec namedBy(std::string param, std::vector<std::string> list) const {
        JackSpec j = *this;
        j.namesBy = std::move(param);
        j.names = std::move(list);
        return j;
    }
    JackSpec normalledTo(std::string input) const {
        JackSpec j = *this;
        j.normal = std::move(input);
        return j;
    }
};

/// A button in the module view (e.g. Ping, Clear, Capture). Pressing it calls
/// Module::command(id, 1); a momentary button also sends (id, 0) on release.
struct ButtonSpec {
    std::string id;
    std::string name;
    bool momentary = false;
};

/// The board-wide harmony bus (doc/specs/modules/harmony-master.md §7): writers
/// publish a key, scale and chord; readers follow it. The compiler orders
/// every writer before every reader.
enum class HarmonyRole { None, Writer, Reader };

/// Which plugin in Live (or which device of the standalone app, spec §11) a port node
/// belongs to (spec §6). None for modules.
enum class PortKind { None, Patch, MidiIn, MidiOut, AudioIn, AudioOut, Instrument, AudioInsert, AudioBridge, Link, MidiDevice };

const char* portKindName(PortKind k) noexcept;

/// The return half of an Audio Insert / Audio Bridge node, made by the compiler (never in a saved board).
constexpr const char* kAudioReturn = "audio-return";

struct ModuleSpec {
    std::string type;        ///< stable id saved in boards, e.g. "function"
    std::string version;     ///< the module's version ("1.2.3"); empty for modules compiled in. A node may pin one (NodeModel::version)
    std::string name;        ///< "Function"
    std::string category;    ///< browser group, "Group/Subgroup" nests in the Add menu: "Modulation/LFOs", "Audio/Filters", "Ports", "Cells"
    std::string colour;      ///< "#4fd1c5"
    std::string description;
    PortKind port = PortKind::None;
    bool userCreatable = true;  ///< false for ports and cell boundaries
    bool standaloneOnly = false;  ///< only offered in the standalone app (spec §11)
    std::vector<ParamSpec> params;
    std::vector<JackSpec> inputs;
    std::vector<JackSpec> outputs;
    std::vector<ButtonSpec> buttons;
    /// Large buffers (delays, samplers): the board warns before putting one
    /// into a Voice Cell, where memory multiplies by the number of voices.
    bool memoryHeavy = false;
    /// Knob groups sit side by side as columns (knobs stacked within each) instead of rows.
    bool groupColumns = false;
    HarmonyRole harmony = HarmonyRole::None;
    /// Modules with node data (board document "data"): JSON in (may be empty
    /// or broken), valid JSON out, including the defaults for a new node.
    std::function<std::string(const std::string&)> sanitiseData;

    int paramIndex(const std::string& id) const noexcept;
    int inputIndex(const std::string& id) const noexcept;
    int outputIndex(const std::string& id) const noexcept;
};

// ---- inline implementation -------------------------------------------------

inline const char* formatName(ParamSpec::Format f) noexcept {
    switch (f) {
        case ParamSpec::Format::Seconds: return "seconds";
        case ParamSpec::Format::Percent: return "percent";
        case ParamSpec::Format::Hertz: return "hertz";
        case ParamSpec::Format::Choice: return "choice";
        case ParamSpec::Format::Integer: return "integer";
        case ParamSpec::Format::Toggle: return "toggle";
        case ParamSpec::Format::FilterMode: return "filterMode";
        case ParamSpec::Format::Semitones: return "semitones";
        case ParamSpec::Format::Number: break;
    }
    return "number";
}

inline bool formatFromName(const std::string& name, ParamSpec::Format& out) noexcept {
    for (auto f : {ParamSpec::Format::Number, ParamSpec::Format::Seconds, ParamSpec::Format::Percent, ParamSpec::Format::Hertz, ParamSpec::Format::Choice,
                   ParamSpec::Format::Integer, ParamSpec::Format::Toggle, ParamSpec::Format::FilterMode, ParamSpec::Format::Semitones})
        if (name == formatName(f)) { out = f; return true; }
    return false;
}

inline const char* signalName(Signal s) noexcept {
    switch (s) {
        case Signal::Gate: return "gate";
        case Signal::Trigger: return "trigger";
        case Signal::Pitch: return "pitch";
        case Signal::Audio: return "audio";
        case Signal::Notes: return "notes";
        case Signal::Patchbay: return "patchbay";
        case Signal::Control: break;
    }
    return "control";
}

inline bool signalFromName(const std::string& n, Signal& out) noexcept {
    for (Signal s : {Signal::Control, Signal::Gate, Signal::Trigger, Signal::Pitch, Signal::Audio, Signal::Notes, Signal::Patchbay})
        if (n == signalName(s)) {
            out = s;
            return true;
        }
    return false;
}

inline bool portKindFromName(const std::string& n, PortKind& out) noexcept {
    for (PortKind k : {PortKind::None, PortKind::Patch, PortKind::MidiIn, PortKind::MidiOut, PortKind::AudioIn, PortKind::AudioOut, PortKind::Instrument,
                       PortKind::AudioInsert, PortKind::AudioBridge, PortKind::Link, PortKind::MidiDevice})
        if (n == portKindName(k)) {
            out = k;
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
        case PortKind::AudioBridge: return "audio-bridge";
        case PortKind::Link: return "link";
        case PortKind::MidiDevice: return "midi-device";
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

inline ParamSpec ParamSpec::stepped(std::string id, std::string name, std::vector<std::string> choices, int def) {
    ParamSpec p = choice(std::move(id), std::move(name), std::move(choices), def);
    p.modulatable = true;
    return p;
}

inline ParamSpec ParamSpec::steppedInt(std::string id, std::string name, int min, int max, int def) {
    ParamSpec p = integer(std::move(id), std::move(name), min, max, def);
    p.modulatable = true;
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
