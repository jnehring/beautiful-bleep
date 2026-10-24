// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
// Svf.h: the float filter keeps its behaviour (5 Hz floor by default, lower
// on request); SvfLow (double) is accurate and stable down to 0.001 Hz.
#include "dsp/Svf.h"

#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;

/// Critically damped (q 0.5) 2-pole step response: 1 − (1 + ωt)·e^(−ωt).
static double criticalStep(double hz, double t) {
    const double w = 2.0 * 3.14159265358979323846 * hz * t;
    return 1.0 - (1.0 + w) * std::exp(-w);
}

static void defaultFloorUnchanged() {
    TEST("svf: default 5 Hz floor unchanged");
    dsp::Svf a, b;
    a.set(1.0f, 0.5f, 48000.0);       // clamped to 5 Hz, as before
    b.set(5.0f, 0.5f, 48000.0);
    a.reset();
    b.reset();
    bool same = true;
    for (int i = 0; i < 20000; ++i) same = same && a.process(1.0f).lp == b.process(1.0f).lp;
    EXPECT(same);
    // With a lower floor the cutoff really is lower.
    dsp::Svf c;
    c.set(1.0f, 0.5f, 48000.0, 0.1);
    c.reset();
    float y = 0.0f;
    for (int i = 0; i < 48000; ++i) y = c.process(1.0f).lp;
    EXPECT_NEAR(y, criticalStep(1.0, 1.0), 0.01);
    // resetTo: settled at a value, no movement.
    dsp::Svf d;
    d.set(100.0f, 2.0f, 48000.0);
    d.resetTo(0.7f);
    float worst = 0.0f;
    for (int i = 0; i < 1000; ++i) worst = std::max(worst, std::fabs(d.process(0.7f).lp - 0.7f));
    EXPECT(worst < 1e-6f);
}

static void lowCutoffAccurate() {
    TEST("svf: SvfLow tracks the analytic response at 0.001 Hz");
    const double sr = 48000.0;
    for (double hz : {0.001, 0.01, 0.1}) {
        dsp::SvfLow f;
        f.set(hz, 0.5, sr);
        f.reset();
        const double seconds = 1.2 / (2.0 * 3.14159265358979323846 * hz) * 1.0;  // ωt = 1.2
        const int64_t n = (int64_t)(seconds * sr);
        double y = 0.0, worst = 0.0;
        for (int64_t i = 0; i < n; ++i) {
            y = f.lowpass(1.0);
            if (i % 4096 == 0) worst = std::max(worst, std::fabs(y - criticalStep(hz, (double)(i + 1) / sr)));
        }
        EXPECT(std::isfinite(y));
        EXPECT(worst < 2e-4);
        EXPECT_NEAR(y, criticalStep(hz, (double)n / sr), 2e-4);
    }
    // The float filter can't do this: at 0.001 Hz its output stalls.
    dsp::Svf fl;
    fl.set(0.001f, 0.5f, sr, 0.0001);
    fl.reset();
    float yf = 0.0f;
    for (int i = 0; i < 48000 * 100; ++i) yf = fl.process(1.0f).lp;
    const double expect = criticalStep(0.001, 100.0);
    std::printf("    float Svf at 0.001 Hz after 100 s: %.5f (exact %.5f)\n", yf, expect);
}

static void lowCutoffSettles() {
    TEST("svf: SvfLow settles and stays stable");
    const double sr = 48000.0;
    // 0.01 Hz, critically damped: settles to the target with no overshoot.
    dsp::SvfLow f;
    f.set(0.01, 0.5, sr);
    f.resetTo(-0.5);
    double y = -0.5, peak = -1.0;
    for (int64_t i = 0; i < (int64_t)(400.0 * sr); ++i) {
        y = f.lowpass(0.8);
        peak = std::max(peak, y);
    }
    EXPECT_NEAR(y, 0.8, 1e-6);
    EXPECT(peak <= 0.8 + 1e-9);
    // Resonant (q 8) at 0.001 Hz: rings but is bounded and finite, and resetTo holds still.
    dsp::SvfLow r;
    r.set(0.001, 8.0, sr);
    r.reset();
    double lo = 0.0, hi = 0.0;
    for (int64_t i = 0; i < (int64_t)(600.0 * sr); ++i) {
        const double v = r.lowpass(1.0);
        lo = std::min(lo, v);
        hi = std::max(hi, v);
    }
    EXPECT(std::isfinite(lo) && std::isfinite(hi));
    EXPECT(hi > 1.5 && hi < 2.05);  // overshoot of a q-8 2-pole: ≈ 1 + e^(−π/√(4q²−1)) ≈ 1.82
    r.resetTo(0.3);
    double drift = 0.0;
    for (int i = 0; i < 480000; ++i) drift = std::max(drift, std::fabs(r.lowpass(0.3) - 0.3));
    EXPECT(drift < 1e-12);
    // Cutoff changing every sample across the whole range stays finite.
    dsp::SvfLow m;
    m.reset();
    double v = 0.0;
    for (int i = 0; i < 2000000; ++i) {
        m.set(std::pow(10.0, -4.0 + 8.0 * (0.5 + 0.5 * std::sin(i * 1e-4))), 4.0, sr);
        v = m.lowpass((i / 3000) % 2 ? 1.0 : -1.0);
        if (!std::isfinite(v) || std::fabs(v) > 20.0) break;
    }
    EXPECT(std::isfinite(v) && std::fabs(v) <= 20.0);
}

int main() {
    defaultFloorUnchanged();
    lowCutoffAccurate();
    lowCutoffSettles();
    return bleep::test::finish("svf");
}
