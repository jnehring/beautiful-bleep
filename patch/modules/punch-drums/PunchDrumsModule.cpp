// SPDX-License-Identifier: MIT
// Punch drums: one node per drum voice (specs/modules/punch-drums.md).
#include "DrumModule.h"
#include "PunchDrumsDsp.h"

namespace bleep::engine {

using namespace patch;

namespace {

constexpr const char* kColour = "#f43f5e";

ParamSpec semitones() { return ParamSpec::number("tune", "Tune", -12.0f, 12.0f, 0.0f, "st", 1); }

}  // namespace

void registerPunchDrumsModules(Registry& r) {
    addDrum<PunchKick>(r,
        drumSpec("punch-kick", "Punch Kick", kColour, "Hard, tight kick: a sine that sweeps down fast, with a noise click.",
                 {ParamSpec::hertz("tune", "Tune", 30.0f, 120.0f, 50.0f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 2.5f, 0.5f, 0.6f),
                  ParamSpec::percent("sweep", "Sweep", 0.0f, 1.0f, 0.5f),
                  ParamSpec::percent("attack", "Attack", 0.0f, 1.0f, 0.5f),
                  ParamSpec::percent("drive", "Drive", 0.0f, 1.0f, 0.3f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            PunchKick::Params p;
            p.tuneHz = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.sweep = m.value(c, 2, i);
            p.attack = m.value(c, 3, i);
            p.drive = m.value(c, 4, i);
            return p;
        });

    addDrum<PunchSnare>(r,
        drumSpec("punch-snare", "Punch Snare", kColour, "Snare: two swept sines for the body and filtered noise for the wires.",
                 {ParamSpec::hertz("tune", "Tune", 120.0f, 400.0f, 200.0f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f),
                  ParamSpec::percent("snappy", "Snappy", 0.0f, 1.0f, 0.6f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 1.0f, 0.3f, 0.3f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            PunchSnare::Params p;
            p.tuneHz = m.value(c, 0, i);
            p.tone = m.value(c, 1, i);
            p.snappy = m.value(c, 2, i);
            p.decay = m.value(c, 3, i);
            return p;
        });

    addDrum<PunchClap>(r,
        drumSpec("punch-clap", "Punch Clap", kColour, "Bright hand clap: tight bursts of noise and a roomy tail.",
                 {ParamSpec::hertz("tone", "Tone", 500.0f, 4000.0f, 1500.0f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 1.5f, 0.35f, 0.35f),
                  ParamSpec::seconds("spread", "Spread", 0.003f, 0.03f, 0.008f, 0.008f),
                  ParamSpec::integer("bursts", "Bursts", 1, 6, 4)}),
        [](const Module& m, const ProcessContext& c, int i) {
            PunchClap::Params p;
            p.toneHz = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.spread = m.value(c, 2, i);
            p.bursts = (int)m.setting(3);
            return p;
        });

    addDrum<PunchTom>(r,
        drumSpec("punch-tom", "Punch Tom", kColour, "Tom: a sine that drops in pitch, with a touch of noise.",
                 {ParamSpec::hertz("tune", "Tune", 50.0f, 500.0f, 110.0f),
                  ParamSpec::seconds("decay", "Decay", 0.05f, 2.0f, 0.45f, 0.45f),
                  ParamSpec::percent("bend", "Bend", 0.0f, 1.0f, 0.5f),
                  ParamSpec::percent("noise", "Noise", 0.0f, 1.0f, 0.2f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            PunchTom::Params p;
            p.tuneHz = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            p.bend = m.value(c, 2, i);
            p.noise = m.value(c, 3, i);
            return p;
        });

    addDrum<PunchRim>(r,
        drumSpec("punch-rim", "Punch Rim", kColour, "Rim shot: a hard, bright crack.",
                 {semitones(), ParamSpec::exponential("decay", "Decay", 0.25f, 4.0f, 1.0f, "×")}),
        [](const Module& m, const ProcessContext& c, int i) {
            PunchRim::Params p;
            p.tune = m.value(c, 0, i);
            p.decay = m.value(c, 1, i);
            return p;
        });

    addDrum<PunchHats, 2>(r,
        drumSpec("punch-hats", "Punch Hats", kColour, "Bright, crunchy closed and open hi-hats. Closed cuts open.",
                 {semitones(), ParamSpec::seconds("closed", "Closed Decay", 0.01f, 0.3f, 0.05f, 0.05f),
                  ParamSpec::seconds("open", "Open Decay", 0.05f, 3.0f, 0.4f, 0.4f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f),
                  ParamSpec::percent("crunch", "Crunch", 0.0f, 1.0f, 0.4f)},
                 {{"closed", "Closed", Signal::Trigger}, {"open", "Open", Signal::Trigger}}),
        [](const Module& m, const ProcessContext& c, int i) {
            PunchHats::Params p;
            p.tune = m.value(c, 0, i);
            p.closedDecay = m.value(c, 1, i);
            p.openDecay = m.value(c, 2, i);
            p.tone = m.value(c, 3, i);
            p.crunch = m.value(c, 4, i);
            return p;
        });

    addDrum<PunchCymbal>(r,
        drumSpec("punch-cymbal", "Punch Cymbal", kColour, "Crash or ride: bright, crunchy metal with a long decay.",
                 {ParamSpec::choice("voice", "Voice", {"Crash", "Ride"}, 0), semitones(),
                  ParamSpec::seconds("decay", "Decay", 0.3f, 8.0f, 2.0f, 2.0f),
                  ParamSpec::percent("tone", "Tone", 0.0f, 1.0f, 0.5f),
                  ParamSpec::percent("crunch", "Crunch", 0.0f, 1.0f, 0.3f)}),
        [](const Module& m, const ProcessContext& c, int i) {
            PunchCymbal::Params p;
            p.voice = (int)m.setting(0);
            p.tune = m.value(c, 1, i);
            p.decay = m.value(c, 2, i);
            p.tone = m.value(c, 3, i);
            p.crunch = m.value(c, 4, i);
            return p;
        });
}

}  // namespace bleep::engine
