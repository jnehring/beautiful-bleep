// SPDX-License-Identifier: MIT
// Ring drums: one node per drum voice (specs/modules/ring-drums.md).
#include "DrumModule.h"
#include "RingDrumsDsp.h"

namespace bleep::engine {

using namespace patch;

namespace {

constexpr const char* kColour = "#f59e0b";

ParamSpec semitones() { return ParamSpec::number("tune", "Tune", -12.0f, 12.0f, 0.0f, "st", 1); }

}  // namespace

void registerRingDrumsModules(Registry& r) {
    addDrum<RingKick>(r,
        drumSpec("ring-kick", "Ring Kick", kColour, "Deep, round kick: a struck resonator that rings and dies away.",
                 {ParamSpec::hertz("tune", "Tune", 30.0f, 120.0f, 50.0f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 3.0f, 0.6f, 0.8f),
                  ParamSpec::percent("sweep", "Sweep", 0.0f, 1.0f, 0.3f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.3f),
                  ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.0f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingKick::Params p;
            p.tuneHz = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.sweep = m.value(c, 2, i);
            p.tone = m.value(c, 3, i);
            p.drive = m.value(c, 4, i);
            return p;
        });

    addDrum<RingSnare>(r,
        drumSpec("ring-snare", "Ring Snare", kColour, "Snare: two ringing drum heads and a burst of bright noise.",
                 {ParamSpec::hertz("tune", "Tune", 100.0f, 400.0f, 180.0f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f),
                  ParamSpec::percent("snappy", "Snappy", 0.0f, 1.0f, 0.6f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 1.0f, 0.25f, 0.25f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingSnare::Params p;
            p.tuneHz = m.value(c, 0, i);
            p.tone = m.value(c, 1, i);
            p.snappy = m.value(c, 2, i);
            p.decay = m.value(c, 3, i);
            return p;
        });

    addDrum<RingClap>(r,
        drumSpec("ring-clap", "Ring Clap", kColour, "Hand clap: a few quick bursts of noise and a short tail.",
                 {ParamSpec::hertz("tone", "Tone", 500.0f, 4000.0f, 1100.0f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 1.5f, 0.3f, 0.3f),
                  ParamSpec::seconds("spread", "Spread", 0.003f, 0.03f, 0.011f, 0.011f),
                  ParamSpec::integer("bursts", "Bursts", 1, 6, 4)}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingClap::Params p;
            p.toneHz = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.spread = m.value(c, 2, i);
            p.bursts = (int)m.setting(3);
            return p;
        });

    addDrum<RingTom>(r,
        drumSpec("ring-tom", "Ring Tom", kColour, "Tom or hand drum: a ringing tone that falls in pitch, with a little noise.",
                 {ParamSpec::hertz("tune", "Tune", 50.0f, 600.0f, 140.0f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 2.0f, 0.4f, 0.4f),
                  ParamSpec::percent("bend", "Bend", 0.0f, 1.0f, 0.3f),
                  ParamSpec::percent("noise", "Noise", 0.0f, 1.0f, 0.3f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingTom::Params p;
            p.tuneHz = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.bend = m.value(c, 2, i);
            p.noise = m.value(c, 3, i);
            return p;
        });

    addDrum<RingRim>(r,
        drumSpec("ring-rim", "Ring Rim", kColour, "Rim shot or clave: short, high, woody clicks.",
                 {ParamSpec::choice("voice", "Voice", {"Rim", "Clave"}, 0), semitones(),
                  ParamSpec::exponential("decay", "Decay", 0.25f, 4.0f, 1.0f, "×")}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingRim::Params p;
            p.voice = (int)m.setting(0);
            p.tune = m.value(c, 1, i);
            p.decay = m.value(c, 2, i);
            return p;
        });

    addDrum<RingCowbell>(r,
        drumSpec("ring-cowbell", "Ring Cowbell", kColour, "Cowbell: two square waves through a band-pass, a sharp hit and a tail.",
                 {semitones(), ParamSpec::seconds("decay", "Decay", 0.05f, 2.0f, 0.4f, 0.4f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingCowbell::Params p;
            p.tune = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.tone = m.value(c, 2, i);
            return p;
        });

    addDrum<RingHats, 2>(r,
        drumSpec("ring-hats", "Ring Hats", kColour, "Closed and open hi-hats from six detuned squares. Closed cuts open.",
                 {semitones(), ParamSpec::seconds("closed", "Closed Decay", 0.01f, 0.3f, 0.06f, 0.06f),
                  ParamSpec::seconds("open", "Open Decay", 0.05f, 3.0f, 0.5f, 0.5f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f)},
                 {{"closed", "Closed", Signal::Trigger}, {"open", "Open", Signal::Trigger}}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingHats::Params p;
            p.tune = m.value(c, 0, i);
            p.closedDecay = m.value(c, 1, i);
            p.openDecay = m.value(c, 2, i);
            p.tone = m.value(c, 3, i);
            return p;
        });

    addDrum<RingCymbal>(r,
        drumSpec("ring-cymbal", "Ring Cymbal", kColour, "Cymbal: a low clang and a long sizzle from six detuned squares.",
                 {semitones(), ParamSpec::seconds("decay", "Decay", 0.3f, 8.0f, 2.0f, 2.0f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            RingCymbal::Params p;
            p.tune = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.tone = m.value(c, 2, i);
            return p;
        });
}

}  // namespace bleep::engine
