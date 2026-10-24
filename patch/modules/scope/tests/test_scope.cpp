// SPDX-License-Identifier: GPL-3.0-only
// Scope: amplitude and frequency measurement, trigger edges and levels (a stable
// picture), Auto / Normal / Free Run, Hold, min/max columns that keep spikes, slow
// sweeps that fill in as they go, and determinism (doc/specs/modules/scope.md §8).
#include "ScopeDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <functional>
#include <vector>

using namespace bleep;
using patch::ScopeDsp;
using patch::ScopeParams;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

using Signal = std::function<double(double)>;

/// Runs `seconds` of up to two signals; returns the number of frames published.
static uint32_t run(ScopeDsp& d, const ScopeParams& p, double from, double seconds, const Signal& a, const Signal& b = nullptr) {
    const int64_t n0 = (int64_t)std::llround(from * kSr), n1 = n0 + (int64_t)(seconds * kSr);
    for (int64_t n = n0; n < n1; ++n) {
        const double t = (double)n / kSr;
        float in[4] = {(float)a(t), b ? (float)b(t) : 0.0f, 0.0f, 0.0f};
        d.tick(p, in);
    }
    return d.published();
}

static ScopeParams params(float timeDiv) {
    ScopeParams p;
    p.timeDiv = timeDiv;
    return p;
}

static void measuresSine() {
    TEST("amplitude and frequency of a sine");
    for (double f : {50.0, 440.0, 3000.0}) {
        ScopeDsp d;
        d.prepare(kSr);
        run(d, params(0.001f), 0.0, 0.8, [&](double t) { return 0.5 * std::sin(2 * kPi * f * t); });
        EXPECT_NEAR(d.amplitude(), 0.5, 0.02);
        EXPECT_NEAR(d.frequency(), f, f * 0.003);
        EXPECT(d.valid());
    }
}

static void measuresOffsetSquare() {
    TEST("a square wave with an offset");
    ScopeDsp d;
    d.prepare(kSr);
    run(d, params(0.001f), 0.0, 0.8, [](double t) { return 0.8 + 0.3 * (std::fmod(t * 220.0, 1.0) < 0.5 ? 1.0 : -1.0); });
    EXPECT_NEAR(d.amplitude(), 0.3, 0.02);
    EXPECT_NEAR(d.frequency(), 220.0, 1.0);
}

static void silenceIsInvalid() {
    TEST("silence and stopped signals");
    ScopeDsp d;
    d.prepare(kSr);
    run(d, params(0.001f), 0.0, 0.5, [](double t) { return std::sin(2 * kPi * 440.0 * t); });
    EXPECT(d.valid());
    run(d, params(0.001f), 0.5, 0.5, [](double) { return 0.0; });
    EXPECT(!d.valid());
    EXPECT(d.amplitude() < 0.01);
    EXPECT(std::isfinite(d.frequency()));
}

static void triggerGivesStablePicture() {
    TEST("the trigger holds the picture still");
    // Two different phases of the same sine must start the sweep at the same place.
    auto firstColumns = [&](double phase) {
        ScopeDsp d;
        d.prepare(kSr);
        ScopeParams p = params(0.0005f);  // 5 ms sweep, two periods of 440 Hz
        p.mode = patch::ScopeNormal;
        p.level = 0.1f;
        run(d, p, 0.0, 0.2, [&](double t) { return std::sin(2 * kPi * 440.0 * t + phase); });
        return d.frame();
    };
    const auto a = firstColumns(0.0), b = firstColumns(2.1);
    double worst = 0.0;
    for (int c = 0; c < patch::kScopeColumns; ++c) worst = std::max(worst, (double)std::fabs(a[(size_t)c * 2] - b[(size_t)c * 2]));
    EXPECT(worst < 0.03);
    // Starts at the trigger level, rising.
    EXPECT(a[0] > 0.09f && a[0] < 0.2f);
    EXPECT(a[2 * 20] > a[0]);
}

static void fallingAndEither() {
    TEST("falling edge");
    ScopeDsp d;
    d.prepare(kSr);
    ScopeParams p = params(0.0005f);
    p.mode = patch::ScopeNormal;
    p.edge = patch::ScopeFalling;
    p.level = 0.0f;
    run(d, p, 0.0, 0.2, [](double t) { return std::sin(2 * kPi * 440.0 * t); });
    EXPECT(std::fabs(d.frame()[0]) < 0.06);
    EXPECT(d.frame()[2 * 20] < d.frame()[0]);
}

static void modes() {
    TEST("Normal waits, Auto free-runs, Free Run always draws");
    auto flat = [](double) { return 0.0; };
    ScopeDsp n;
    n.prepare(kSr);
    ScopeParams p = params(0.001f);
    p.mode = patch::ScopeNormal;
    p.level = 0.5f;
    EXPECT(run(n, p, 0.0, 0.5, flat) == 0);
    ScopeDsp a;
    a.prepare(kSr);
    p.mode = patch::ScopeAuto;
    EXPECT(run(a, p, 0.0, 0.5, flat) > 3);
    EXPECT(!a.triggered());
    ScopeDsp f;
    f.prepare(kSr);
    p.mode = patch::ScopeFree;
    EXPECT(run(f, p, 0.0, 0.5, flat) > 20);
}

static void holdFreezes() {
    TEST("Hold freezes the picture, not the measurement");
    ScopeDsp d;
    d.prepare(kSr);
    ScopeParams p = params(0.001f);
    run(d, p, 0.0, 0.3, [](double t) { return 0.5 * std::sin(2 * kPi * 440.0 * t); });
    const uint32_t before = d.published();
    p.hold = true;
    run(d, p, 0.3, 0.3, [](double t) { return 0.25 * std::sin(2 * kPi * 440.0 * t); });
    EXPECT(d.published() == before);
    EXPECT_NEAR(d.amplitude(), 0.25, 0.02);
}

static void spikesSurvive() {
    TEST("columns keep the peak of a spike");
    ScopeDsp d;
    d.prepare(kSr);
    ScopeParams p = params(0.05f);  // 0.5 s sweep: ~60 samples per column
    p.mode = patch::ScopeFree;
    run(d, p, 0.0, 1.2, [](double t) { return std::fabs(t - 0.75) < 1e-5 ? 1.0 : 0.0; });
    float top = 0.0f;
    for (int c = 0; c < patch::kScopeColumns; ++c) top = std::max(top, d.frame()[(size_t)c * 2 + 1]);
    EXPECT(top > 0.99f);
}

static void fastSweepFillsColumns() {
    TEST("a sweep faster than one sample per column has no holes");
    ScopeDsp d;
    d.prepare(kSr);
    ScopeParams p = params(0.00005f);  // 500 us across: 24 samples over 400 columns
    p.mode = patch::ScopeFree;
    run(d, p, 0.0, 0.05, [](double t) { return std::sin(2 * kPi * 2000.0 * t); });
    float prev = d.frame()[0];
    double jump = 0.0;
    for (int c = 1; c < patch::kScopeColumns; ++c) {
        jump = std::max(jump, (double)std::fabs(d.frame()[(size_t)c * 2] - prev));
        prev = d.frame()[(size_t)c * 2];
    }
    EXPECT(jump < 0.1);
}

static void slowSweepFillsIn() {
    TEST("a slow sweep publishes while it runs");
    ScopeDsp d;
    d.prepare(kSr);
    ScopeParams p = params(0.2f);  // 2 s sweep
    p.mode = patch::ScopeFree;
    run(d, p, 0.0, 1.0, [](double) { return 0.7; });
    EXPECT(d.published() >= 25);
    EXPECT(d.writeColumn() > 150 && d.writeColumn() < 250);
    EXPECT_NEAR(d.frame()[100 * 2], 0.7, 1e-4);
}

static void determinism() {
    TEST("same input, same picture");
    auto render = [] {
        ScopeDsp d;
        d.prepare(kSr);
        run(d, params(0.002f), 0.0, 0.3, [](double t) { return std::sin(2 * kPi * 123.0 * t) * std::sin(2 * kPi * 3.1 * t); });
        return d.frame();
    };
    EXPECT(render() == render());
}

int main() {
    measuresSine();
    measuresOffsetSquare();
    silenceIsInvalid();
    triggerGivesStablePicture();
    fallingAndEither();
    modes();
    holdFreezes();
    spikesSurvive();
    fastSweepFillsColumns();
    slowSweepFillsIn();
    determinism();
    return test::finish("scope");
}
