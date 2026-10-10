// SPDX-License-Identifier: MIT
#include "PitchShifterDsp.h"
#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

static std::vector<float> shiftSine(double hz, float semitones, int n, float drift = 0.0f, float feedback = 0.0f) {
    PitchShifterDsp d;
    d.prepare(kSr);
    PitchShifterParams p;
    p.semitones = semitones;
    p.drift = drift;
    p.feedback = feedback;
    std::vector<float> out;
    for (int i = 0; i < n + 9600; ++i) {
        const float y = d.tick((float)std::sin(2.0 * kPi * hz * i / kSr), p);
        if (i >= 9600) out.push_back(y);
    }
    return out;
}

/// The strongest component within ±40 Hz of `hz`: the two heads do not keep phase across their crossfade, so a
/// shifted sine is spread into sidebands at multiples of the sweep rate (12.5 Hz for an octave at an 80 ms window).
static double bandMax(const std::vector<float>& y, double hz) {
    double m = 0.0;
    for (double f = hz - 40.0; f <= hz + 40.0; f += 2.5) m = std::max(m, bleep::test::magnitudeAt(y, f, kSr));
    return m;
}

static void shiftsByTheRatio() {
    TEST("an octave up doubles the frequency, a fifth down gives 2/3");
    for (const auto [semi, ratio] : {std::pair{12.0f, 2.0}, std::pair{-12.0f, 0.5}, std::pair{7.0f, std::pow(2.0, 7.0 / 12.0)},
                                     std::pair{-7.0f, std::pow(2.0, -7.0 / 12.0)}}) {
        const auto y = shiftSine(440.0, semi, 48000);
        const double wanted = bandMax(y, 440.0 * ratio);
        const double original = bandMax(y, 440.0);
        EXPECT(wanted > 0.15);                 // a strong component at the shifted pitch
        EXPECT(wanted > 4.0 * original);       // and the original pitch is gone
    }
}

static void zeroShiftKeepsPitchAndLevel() {
    TEST("0 semitones passes the pitch at a steady level");
    const auto y = shiftSine(1000.0, 0.0f, 48000);
    EXPECT(bandMax(y, 1000.0) > 0.3);
    EXPECT(bleep::test::rms(y) > 0.4 && bleep::test::rms(y) < 1.0);
}

static void feedbackStaysBounded() {
    TEST("feedback at 100 % stays bounded");
    const auto y = shiftSine(440.0, 12.0f, 96000, 0.3f, 1.0f);
    float peak = 0.0f;
    for (float v : y) {
        EXPECT(std::isfinite(v));
        peak = std::max(peak, std::fabs(v));
    }
    EXPECT(peak < 4.0f);
}

static void rendersRepeat() {
    TEST("the same input renders the same audio, drift included");
    EXPECT(shiftSine(300.0, 5.0f, 4800, 0.8f) == shiftSine(300.0, 5.0f, 4800, 0.8f));
}

int main() {
    shiftsByTheRatio();
    zeroShiftKeepsPitchAndLevel();
    feedbackStaysBounded();
    rendersRepeat();
    return bleep::test::finish("pitch-shifter");
}
