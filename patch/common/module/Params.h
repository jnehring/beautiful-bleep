// SPDX-License-Identifier: MIT
// Parameter helpers shared by the modules.
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

#include "dsp/Tempo.h"

#include <cmath>
#include <memory>

namespace bleep::patch::params {

constexpr int kVersion = 1; ///< juce::ParameterID version hint for all v0.1 parameters

inline juce::ParameterID id(const char* name) { return {name, kVersion}; }

/// Logarithmic range with `centre` in the middle of the knob.
inline juce::NormalisableRange<float> skewed(float min, float max, float centre) {
    juce::NormalisableRange<float> r(min, max);
    r.setSkewForCentre(centre);
    return r;
}

/// Exponential range: equal knob distance per octave (cutoff, rates).
inline juce::NormalisableRange<float> exponential(float min, float max) {
    const float ratio = max / min;
    return {min, max,
            [=](float, float, float x) { return min * std::pow(ratio, x); },
            [=](float, float, float v) { return std::log(v / min) / std::log(ratio); },
            [](float, float, float v) { return v; }};
}

inline std::unique_ptr<juce::AudioParameterFloat> number(const char* pid, const char* name,
                                                         juce::NormalisableRange<float> range, float def,
                                                         const char* label = "", int decimals = 2) {
    return std::make_unique<juce::AudioParameterFloat>(
        id(pid), name, range, def,
        juce::AudioParameterFloatAttributes().withLabel(label).withStringFromValueFunction(
            [decimals](float v, int) { return juce::String(v, decimals); }));
}

/// Seconds, shown as ms below one second.
inline std::unique_ptr<juce::AudioParameterFloat> seconds(const char* pid, const char* name, float min, float max,
                                                          float centre, float def) {
    return std::make_unique<juce::AudioParameterFloat>(
        id(pid), name, skewed(min, max, centre), def,
        juce::AudioParameterFloatAttributes().withStringFromValueFunction([](float v, int) {
            return v < 1.0f ? juce::String(juce::roundToInt(v * 1000.0f)) + " ms" : juce::String(v, 2) + " s";
        }));
}

inline std::unique_ptr<juce::AudioParameterFloat> percent(const char* pid, const char* name, float min, float max,
                                                          float def) {
    return std::make_unique<juce::AudioParameterFloat>(
        id(pid), name, juce::NormalisableRange<float>(min, max), def,
        juce::AudioParameterFloatAttributes().withStringFromValueFunction(
            [](float v, int) { return juce::String(juce::roundToInt(v * 100.0f)) + " %"; }));
}

inline std::unique_ptr<juce::AudioParameterChoice> choice(const char* pid, const char* name,
                                                          const juce::StringArray& choices, int def) {
    return std::make_unique<juce::AudioParameterChoice>(id(pid), name, choices, def);
}

inline std::unique_ptr<juce::AudioParameterBool> toggle(const char* pid, const char* name, bool def) {
    return std::make_unique<juce::AudioParameterBool>(id(pid), name, def);
}

inline std::unique_ptr<juce::AudioParameterInt> integer(const char* pid, const char* name, int min, int max, int def) {
    return std::make_unique<juce::AudioParameterInt>(id(pid), name, min, max, def);
}

inline juce::StringArray syncChoices() {
    juce::StringArray a;
    for (const char* s : bleep::dsp::syncNames()) a.add(s);
    return a;
}

}  // namespace bleep::patch::params
