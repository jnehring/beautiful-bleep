// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
//
// SafeJson — juce::JSON::parse with a nesting limit. JUCE's parser recurses once per '[' or '{' and has no depth
// limit, so a few hundred KB of "[[[[…" overflows the stack. Everything that parses text from outside the process
// (web pages, store answers, packages, project files) goes through here: the text is scanned first, and input nested
// deeper than the limit is refused with an undefined var (the same answer as for malformed JSON).
#pragma once

#include <juce_core/juce_core.h>

#include <cstddef>

namespace bleep::safejson {

inline constexpr int kDefaultMaxDepth = 64;     ///< messages, store answers, signatures
inline constexpr int kProjectMaxDepth = 128;    ///< .bleepboard project files

/// True when `text` nests arrays/objects deeper than `limit`. Brackets inside strings (both quote styles JUCE accepts)
/// and comments (which JUCE accepts too) do not count; the scan is iterative and stops at the first excess.
inline bool exceedsDepth(const char* text, size_t size, int limit = kDefaultMaxDepth) {
    long depth = 0;
    for (size_t i = 0; i < size; ++i) {
        const char c = text[i];
        if (c == '"' || c == '\'') {
            for (++i; i < size && text[i] != c; ++i)
                if (text[i] == '\\') ++i;
        } else if (c == '/' && i + 1 < size && text[i + 1] == '/') {
            for (i += 2; i < size && text[i] != '\n' && text[i] != '\r'; ++i) {}
        } else if (c == '/' && i + 1 < size && text[i + 1] == '*') {
            for (i += 2; i + 1 < size && !(text[i] == '*' && text[i + 1] == '/'); ++i) {}
            ++i;
        } else if (c == '[' || c == '{') {
            if (++depth > limit) return true;
        } else if ((c == ']' || c == '}') && depth > 0) {
            --depth;
        }
    }
    return false;
}

inline bool exceedsDepth(const juce::String& text, int limit = kDefaultMaxDepth) {
    return exceedsDepth(text.toRawUTF8(), text.getNumBytesAsUTF8(), limit);
}

/// Parses `text`; too-deep or malformed input gives a void var.
inline juce::var parse(const juce::String& text, int limit = kDefaultMaxDepth) {
    return exceedsDepth(text, limit) ? juce::var() : juce::JSON::parse(text);
}

inline juce::var parseUtf8(const void* data, size_t size, int limit = kDefaultMaxDepth) {
    if (exceedsDepth(static_cast<const char*>(data), size, limit)) return {};
    return juce::JSON::parse(juce::String::fromUTF8(static_cast<const char*>(data), (int)size));
}

inline juce::var parse(const juce::File& file, int limit = kDefaultMaxDepth) {
    return parse(file.loadFileAsString(), limit);
}

}  // namespace bleep::safejson
