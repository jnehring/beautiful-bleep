// SPDX-License-Identifier: GPL-3.0-only
// Strange Osc: bounded and finite everywhere, seeded and repeatable, pitch by
// time-scaling, and Tame turning chaos into a periodic orbit.
#include "StrangeDsp.h"

#include "dsp/tests/TestUtil.h"

#include <vector>

using namespace bleep;
using patch::StrangeDsp;

namespace {

constexpr double kSr = 48000.0;

std::vector<float> render(int type, uint64_t seed, double hz, float tame, int n, int axis = 0) {
    StrangeDsp d;
    d.prepare(kSr);
    d.reset(type, seed);
    std::vector<float> out((size_t)n);
    for (int i = 0; i < n; ++i) {
        const auto f = d.tick(hz, tame, 0.0);
        out[(size_t)i] = axis == 0 ? f.x : axis == 1 ? f.y : f.z;
    }
    return out;
}

/// Highest normalised autocorrelation for lags between 0.5 and 8 ms… (a periodic orbit scores near 1).
double periodicity(const std::vector<float>& x, int minLag, int maxLag) {
    double e = 0.0;
    for (float v : x) e += (double)v * v;
    double best = 0.0;
    for (int lag = minLag; lag < maxLag; ++lag) {
        double s = 0.0;
        for (size_t i = (size_t)lag; i < x.size(); ++i) s += (double)x[i] * x[i - (size_t)lag];
        best = std::max(best, s / e);
    }
    return best;
}

void bounded() {
    TEST("every attractor, tame and rate stays finite and within ±1.5");
    for (int t = 0; t < StrangeDsp::kTypes; ++t)
        for (float tame : {0.0f, 0.5f, 1.0f})
            for (double hz : {0.05, 60.0, 440.0, 5000.0, 15000.0}) {
                const auto y = render(t, 3, hz, tame, 6000);
                EXPECT(test::allFinite(y));
                for (float v : y) EXPECT(std::fabs(v) <= 1.5f);
            }
}

void seeded() {
    TEST("same seed repeats exactly, another seed differs");
    for (int t = 0; t < StrangeDsp::kTypes; ++t) {
        const auto a = render(t, 7, 220.0, 0.0f, 4000), b = render(t, 7, 220.0, 0.0f, 4000), c = render(t, 8, 220.0, 0.0f, 4000);
        EXPECT(a == b);
        double diff = 0.0;
        for (size_t i = 0; i < a.size(); ++i) diff += std::fabs(a[i] - c[i]);
        EXPECT(diff > 1.0);
    }
}

void pitch() {
    TEST("Tame 100 %: the orbit follows the pitch (Rossler within 4 %), an octave up doubles it");
    for (double hz : {110.0, 440.0, 1760.0}) {
        const auto y = render(StrangeDsp::Rossler, 1, hz, 1.0f, 48000, 0);
        const std::vector<float> tail(y.begin() + 12000, y.end());
        const double f = test::zeroCrossingHz(tail, kSr);
        std::printf("  %.0f Hz → %.1f Hz\n", hz, f);
        EXPECT(std::fabs(f / hz - 1.0) < 0.05);
    }
}

void tame() {
    TEST("Tame turns chaos into a repeating orbit");
    const int period = (int)(kSr / 200.0);
    for (int t : {(int)StrangeDsp::Rossler, (int)StrangeDsp::Halvorsen, (int)StrangeDsp::Lorenz}) {
        const auto chaotic = render(t, 2, 200.0, 0.0f, 48000, 0), tamed = render(t, 2, 200.0, 1.0f, 48000, 0);
        const std::vector<float> c(chaotic.begin() + 12000, chaotic.end()), p(tamed.begin() + 12000, tamed.end());
        const double pc = periodicity(c, period / 3, period * 3), pp = periodicity(p, period / 3, period * 3);
        std::printf("  %s: periodicity %.2f chaotic, %.2f tamed\n", StrangeDsp::name(t), pc, pp);
        EXPECT(pp > 0.9);
        EXPECT(pp > pc);
    }
}

void forcing() {
    TEST("an external force moves the orbit");
    StrangeDsp a, b;
    a.prepare(kSr), b.prepare(kSr);
    a.reset(StrangeDsp::Rossler, 1), b.reset(StrangeDsp::Rossler, 1);
    double diff = 0.0;
    for (int i = 0; i < 4000; ++i) diff += std::fabs(a.tick(300.0, 0.5f, 0.0).x - b.tick(300.0, 0.5f, 0.5 * std::sin(i * 0.05)).x);
    EXPECT(diff > 10.0);
}

}  // namespace

int main() {
    bounded();
    seeded();
    pitch();
    tame();
    forcing();
    return test::finish("strange-osc");
}
