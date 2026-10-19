// SPDX-License-Identifier: GPL-3.0-or-later
// Endless Tone: the partials really glide, the window hides the wrap (no click
// at the octave boundary in either direction), the loop output counts octaves,
// and the level is steady.
#include "EndlessToneDsp.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using patch::EndlessParams;
using patch::EndlessToneDsp;

namespace {

constexpr double kSr = 48000.0;

struct Run {
    std::vector<float> l, r, loop;
    int wraps = 0;
};

Run render(const EndlessParams& p, int n) {
    EndlessToneDsp d;
    d.prepare(kSr);
    d.reset();
    Run out;
    for (int i = 0; i < n; ++i) {
        const auto f = d.tick(p);
        out.l.push_back(f.l), out.r.push_back(f.r), out.loop.push_back(f.loop);
        out.wraps += f.wrap;
    }
    return out;
}

/// Frequency of the strongest component between lo and hi (24 steps per octave).
double peak(const std::vector<float>& x, double lo, double hi) {
    double best = 0.0, bf = lo;
    for (double f = lo; f <= hi; f *= std::pow(2.0, 1.0 / 48.0)) {
        const double m = test::magnitudeAt(x, f, kSr);
        if (m > best) best = m, bf = f;
    }
    return bf;
}

void glides() {
    TEST("Up: a partial rises at Rate octaves per second; Down falls");
    EndlessParams p;
    p.speed = 0.5f;
    p.width = 0.0f;  // narrow window: clear partials
    p.centreHz = 440.0;
    const auto up = render(p, 48000);
    auto win = [&](const std::vector<float>& y, int s0) { return std::vector<float>(y.begin() + s0, y.begin() + s0 + 4800); };
    // Follow the partial that sits 1.5 octaves above the centre at t = 0 (1244 Hz): the window is 0.1 s long,
    // the search ±0.15 octave around where that partial should be at its middle.
    auto track = [&](const std::vector<float>& y, double t0, double rate) {
        const double mid = 440.0 * std::pow(2.0, 1.5 + rate * (t0 + 0.05));
        return peak(win(y, (int)(t0 * kSr)), mid * 0.9, mid * 1.1);
    };
    const double f1 = track(up.l, 0.05, 0.5), f2 = track(up.l, 0.25, 0.5);
    std::printf("  up: %.0f Hz → %.0f Hz (expected ratio %.3f)\n", f1, f2, std::pow(2.0, 0.5 * 0.2));
    EXPECT_NEAR(f2 / f1, std::pow(2.0, 0.1), 0.02);
    p.speed = -0.5f;
    const auto down = render(p, 48000);
    const double g1 = track(down.l, 0.05, -0.5), g2 = track(down.l, 0.25, -0.5);
    std::printf("  down: %.0f Hz → %.0f Hz\n", g1, g2);
    EXPECT_NEAR(g2 / g1, std::pow(2.0, -0.1), 0.02);
}

void noClicks() {
    TEST("no click at the octave wrap, up or down, narrow or wide, saw or sine");
    for (float speed : {1.0f, -1.0f, 0.2f, -2.0f})
        for (float width : {0.0f, 0.5f, 1.0f})
            for (float timbre : {0.0f, 1.0f})
                for (int count : {6, 9, 12}) {
                    EndlessParams p;
                    p.speed = speed, p.width = width, p.timbre = timbre, p.count = count, p.centreHz = 330.0;
                    const auto y = render(p, 48000 * 3);
                    EXPECT(y.wraps >= (int)(std::fabs(speed) * 3.0f) - 1);
                    // The largest sample-to-sample step stays in the range the sound itself reaches; a phase
                    // jump of a loud partial would be several times larger.
                    float maxStep = 0.0f, peakAbs = 0.0f;
                    for (size_t i = 1; i < y.l.size(); ++i) {
                        maxStep = std::max(maxStep, std::fabs(y.l[i] - y.l[i - 1]));
                        peakAbs = std::max(peakAbs, std::fabs(y.l[i]));
                    }
                    if (maxStep > 0.55f) std::printf("  speed %.1f width %.1f timbre %.0f count %d: step %.3f peak %.3f\n", speed, width, timbre, count, maxStep, peakAbs);
                    EXPECT(maxStep < 0.55f);
                    EXPECT(peakAbs < 1.5f);
                    EXPECT(test::allFinite(y.l));
                }
}

void steady() {
    TEST("the loudness stays steady while it glides (RMS within ±2.5 dB across a loop)");
    EndlessParams p;
    p.speed = 1.0f;
    p.width = 0.4f;
    p.centreHz = 261.6;
    const auto y = render(p, 48000 * 2);
    double lo = 1e9, hi = 0.0;
    for (int s0 = 4800; s0 + 2400 <= (int)y.l.size(); s0 += 2400) {
        const double r = test::rms(std::vector<float>(y.l.begin() + s0, y.l.begin() + s0 + 2400));
        lo = std::min(lo, r), hi = std::max(hi, r);
    }
    std::printf("  rms %.3f … %.3f (%.1f dB)\n", lo, hi, 20.0 * std::log10(hi / lo));
    EXPECT(20.0 * std::log10(hi / lo) < 2.5);
}

void loopOutput() {
    TEST("Loop is a ramp, one cycle per octave, falling when the tone falls");
    EndlessParams p;
    p.speed = 2.0f;
    auto y = render(p, 48000);
    EXPECT(y.wraps == 2);
    EXPECT(y.loop[100] > y.loop[50]);
    p.speed = -2.0f;
    y = render(p, 48000);
    EXPECT(y.wraps >= 2);
    EXPECT(y.loop[100] < y.loop[50] || y.loop[50] < 0.1f);
    TEST("Rate 0 holds the pattern; Phase moves it by an octave");
    p.speed = 0.0f;
    const auto still = render(p, 4800);
    EXPECT(still.wraps == 0);
    EXPECT_NEAR(still.loop.back(), 0.0f, 1e-6);
    p.phase = 0.5f;
    EXPECT_NEAR(render(p, 10).loop.back(), 0.5f, 1e-5);
}

void spread() {
    TEST("Spread 0: both channels equal; Spread 100 %: they differ");
    EndlessParams p;
    p.speed = 0.3f;
    p.spread = 0.0f;
    auto y = render(p, 9600);
    double d0 = 0.0;
    for (size_t i = 0; i < y.l.size(); ++i) d0 += std::fabs(y.l[i] - y.r[i]);
    EXPECT(d0 < 1e-3);
    p.spread = 1.0f;
    y = render(p, 9600);
    double d1 = 0.0;
    for (size_t i = 0; i < y.l.size(); ++i) d1 += std::fabs(y.l[i] - y.r[i]);
    EXPECT(d1 > 1.0);
}

void extremes() {
    TEST("extreme pitch and widths stay finite");
    for (double hz : {8.0, 2000.0, 12000.0})
        for (float w : {0.0f, 1.0f}) {
            EndlessParams p;
            p.centreHz = hz, p.width = w, p.speed = 2.0f, p.timbre = 1.0f, p.count = 12;
            const auto y = render(p, 48000);
            EXPECT(test::allFinite(y.l));
            for (float v : y.l) EXPECT(std::fabs(v) < 3.0f);
        }
}

}  // namespace

int main() {
    glides();
    noClicks();
    steady();
    loopOutput();
    spread();
    extremes();
    return test::finish("endless-tone");
}
