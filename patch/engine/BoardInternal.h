// SPDX-License-Identifier: MIT
// BoardInternal.h — what the files of the board document implementation share: the includes and the small readers.
// Board.cpp (the model, parse, find, add), BoardSanitise.cpp (sanitise), BoardPresets.cpp (cells as presets),
// BoardTypes.cpp (describeTypes).
#pragma once

#include "Board.h"
#include "../common/SafeJson.h"

#include <cmath>
#include <cstring>
#include <set>

namespace bleep::engine {
namespace board {

inline juce::String str(const juce::var& v, const char* key) { return v.getProperty(key, {}).toString(); }
inline std::string sstr(const juce::var& v, const char* key) { return str(v, key).toStdString(); }

inline juce::var jackVar(const CellJack& j) {
    auto* o = new juce::DynamicObject();
    o->setProperty("id", juce::String(j.id));
    o->setProperty("name", juce::String(j.name));
    o->setProperty("type", signalName(j.type));
    return juce::var(o);
}

inline std::vector<CellJack> parseJacks(const juce::var& list) {
    std::vector<CellJack> out;
    std::set<std::string> seen;
    if (auto* a = list.getArray()) {
        for (const auto& j : *a) {
            CellJack c;
            c.id = sstr(j, "id");
            c.name = sstr(j, "name");
            if (c.id.empty() || !seen.insert(c.id).second) continue;
            if (!signalFromName(sstr(j, "type"), c.type)) c.type = Signal::Control;
            if (c.name.empty()) c.name = c.id;
            out.push_back(std::move(c));
        }
    }
    return out;
}

inline double num(const juce::var& v, const char* key, double fallback) {
    const auto p = v.getProperty(key, fallback);
    return p.isDouble() || p.isInt() || p.isInt64() ? (double)p : fallback;
}

}  // namespace board
}  // namespace bleep::engine
