// SPDX-License-Identifier: MIT
// Wobble: seeded values, transport grid, Smooth/Wobble step responses, cutoff
// scaling, soft limit, Hold, bursts, Compare, Chaos determinism
// (specs/modules/wobble.md §8).
#include "WobbleDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::WobbleDsp;
using patch::WobbleFrame;
using patch::WobbleInput;
using patch::WobbleParams;

static constexpr double kSr = 48000.0;

struct Render {
    std::vector<WobbleFrame> f;
    std::vector<double> raw, smooth, wobble;
};

/// Renders `seconds`; `in` is called per sample to fill the input.
template <class In>
static Render render(const WobbleParams& p, double seconds, In&& input) {
    WobbleDsp d;
    d.prepare(kSr);
    Render r;
    WobbleFrame f;
    for (int i = 0; i < (int)(seconds * kSr); ++i) {
        WobbleInput in;
        input(i, in);
        d.tick(p, in, f);
        r.f.push_back(f);
        r.raw.push_back(d.value());
        r.smooth.push_back(d.smoothValue());
        r.wobble.push_back(d.wobbleValue());
    }
    return r;
}
static auto noInput = [](int, WobbleInput&) {};

static void seededValues() {
    TEST("stepped follows the seeded sequence");
    WobbleParams p;
    p.rateHz = 10.0f;
    p.burst = 0.0f;
    const Render r = render(p, 3.0, noInput);
    int64_t k = 0;
    for (size_t i = 0; i < r.f.size(); ++i)
        if (r.f[i].clock > 0.5f) {
            EXPECT_NEAR(r.f[i].stepped, WobbleDsp::rawValue(1, k), 1e-6);
            ++k;
        }
    EXPECT(k >= 29 && k <= 31);
    TEST("same seed twice is identical; another seed differs");
    const Render again = render(p, 3.0, noInput);
    EXPECT(again.raw == r.raw && again.wobble == r.wobble);
    p.seed = 7;
    EXPECT(render(p, 3.0, noInput).raw != r.raw);

    TEST("Sample patched: Stepped samples the input");
    WobbleParams q;
    q.burst = 0.0f;
    const Render s = render(q, 1.0, [](int i, WobbleInput& in) {
        in.clockPatched = true;
        in.clock = i % 4800 == 0 ? 1.0f : 0.0f;
        in.samplePatched = true;
        in.sample = std::sin(i * 0.001f);
    });
    for (size_t i = 0; i < s.f.size(); ++i)
        if (s.f[i].clock > 0.5f) EXPECT_NEAR(s.f[i].stepped, std::sin((float)i * 0.001f), 1e-6);
}

static void grid() {
    TEST("transport steps land on floor(ppq / beats), also with Chaos");
    for (float chaos : {0.0f, 0.8f}) {
        WobbleParams p;
        p.sync = 2;  // 1/16
        p.chaos = chaos;
        const double ppqPerSample = 2.0 / kSr;  // 120 BPM
        const Render r = render(p, 2.0, [&](int i, WobbleInput& in) {
            in.running = true;
            in.started = i == 0;
            in.ppq = 0.1 + i * ppqPerSample;
        });
        for (size_t i = 1; i < r.f.size(); ++i) {
            const bool boundary = std::floor((0.1 + i * ppqPerSample) / 0.25) != std::floor((0.1 + (i - 1) * ppqPerSample) / 0.25);
            EXPECT((r.f[i].clock > 0.5f) == boundary);
        }
        if (chaos == 0.0f) {
            const int64_t n = (int64_t)std::floor((0.1 + 1000 * ppqPerSample) / 0.25);
            EXPECT_NEAR(r.f[1000].stepped, WobbleDsp::rawValue(1, n), 1e-6);
        }
    }
}

/// Step response from rest: Clock patched, one pulse, Sample 1.
static Render stepResponse(float smooth, float wobble, double seconds = 2.0) {
    WobbleParams p;
    p.smooth = smooth;
    p.wobble = wobble;
    p.rateHz = 1.0f;
    p.burst = 0.0f;
    return render(p, seconds, [](int i, WobbleInput& in) {
        in.clockPatched = true;
        in.clock = i == 0 ? 1.0f : 0.0f;
        in.samplePatched = true;
        in.sample = 1.0f;
    });
}

static void responses() {
    TEST("Smooth never overshoots from rest");
    const Render s = stepResponse(0.5f, 1.0f);
    for (size_t i = 1; i < s.smooth.size(); ++i) {
        EXPECT(s.smooth[i] >= s.smooth[i - 1] - 1e-12);
        EXPECT(s.smooth[i] <= 1.0 + 1e-9);
    }
    TEST("Wobble 100 % overshoots by more than 30 %");
    double peak = 0.0;
    for (double w : s.wobble) peak = std::max(peak, w);
    EXPECT(peak > 1.3);
    std::printf("  wobble peak %.3f\n", peak);
    TEST("Wobble 0 % equals Smooth");
    const Render z = stepResponse(0.5f, 0.0f);
    for (size_t i = 0; i < z.smooth.size(); ++i) EXPECT_NEAR(z.wobble[i], z.smooth[i], 1e-12);
    TEST("Smooth 50 % arrives about in time for the next step");
    EXPECT(s.smooth[(size_t)kSr] > 0.95);
    EXPECT(s.smooth[(size_t)(kSr * 0.3)] < 0.9);
}

static void cutoffScales() {
    TEST("the step response measured in steps is the same at 1 Hz and 8 Hz");
    double half[2];
    const float rates[2] = {1.0f, 8.0f};
    for (int k = 0; k < 2; ++k) {
        WobbleParams p;
        p.rateHz = rates[k];
        p.burst = 0.0f;
        // From +1 (the first step) to −1 at the second step: time to the zero
        // crossing of Smooth, in steps.
        WobbleDsp d;
        d.prepare(kSr);
        WobbleFrame f;
        WobbleInput in;
        in.samplePatched = true;
        in.sample = 1.0f;
        int i = 0, steps = 0;
        for (; steps < 2; ++i) {
            d.tick(p, in, f);
            if (f.clock > 0.5f) ++steps;
            in.sample = -1.0f;
        }
        const int start = i - 1;
        while (d.smoothValue() > 0.0 && i < (int)(10 * kSr)) d.tick(p, in, f), ++i;
        half[k] = (double)(i - start) / kSr * rates[k];
    }
    EXPECT_NEAR(half[0], half[1], 0.01);
}

static void softLimit() {
    TEST("soft limit");
    for (double x = -1.0; x <= 1.0; x += 0.01) EXPECT_NEAR(WobbleDsp::softLimit(x), x, 1e-12);
    for (double x = -20.0; x <= 20.0; x += 0.07) EXPECT(std::fabs(WobbleDsp::softLimit(x)) <= 1.5);
    TEST("Wobble output stays within ±1.5 at full resonance and fast steps");
    WobbleParams p;
    p.wobble = 1.0f;
    p.smooth = 0.0f;
    p.rateHz = 40.0f;
    p.chaos = 1.0f;
    const Render r = render(p, 2.0, noInput);
    for (const auto& f : r.f) EXPECT(std::isfinite(f.wobble) && std::fabs(f.wobble) <= 1.5f);
}

static void hold() {
    TEST("Hold: no new values or clocks; filters settle");
    WobbleParams p;
    p.rateHz = 20.0f;
    const Render r = render(p, 1.0, [](int i, WobbleInput& in) { in.hold = i >= 4800 ? 1.0f : 0.0f; });
    const double held = r.raw[4800];
    for (size_t i = 4801; i < r.f.size(); ++i) {
        EXPECT(r.f[i].clock == 0.0f);
        EXPECT(r.raw[i] == held);
    }
    EXPECT_NEAR(r.smooth.back(), held, 1e-3);
}

static void bursts() {
    TEST("burst probability and size");
    int fired = 0;
    for (int64_t k = 0; k < 10000; ++k) {
        const int n = WobbleDsp::burstPulses(3, k, 0.3, 5);
        if (n) {
            ++fired;
            EXPECT(n >= 2 && n <= 5);
        }
    }
    EXPECT_NEAR(fired / 10000.0, 0.3, 0.02);
    TEST("no burst pulse after the next step starts; counts match");
    WobbleParams p;
    p.rateHz = 7.0f;
    p.burst = 1.0f;
    p.burstSize = 8;
    p.chaos = 1.0f;
    const Render r = render(p, 5.0, noInput);
    int64_t step = -1;
    int count = 0;
    for (size_t i = 0; i < r.f.size(); ++i) {
        if (r.f[i].clock > 0.5f) {
            if (step >= 0) EXPECT(count <= WobbleDsp::burstPulses(1, step, 1.0, 8));
            ++step;
            count = 0;
        }
        if (r.f[i].burst > 0.5f) ++count;
    }
}

static void compare() {
    TEST("Compare is high exactly while Stepped > Smooth");
    WobbleParams p;
    p.rateHz = 5.0f;
    const Render r = render(p, 2.0, noInput);
    for (size_t i = 0; i < r.f.size(); ++i) EXPECT((r.f[i].compare > 0.5f) == (r.raw[i] > r.smooth[i]));
}

static void chaos() {
    TEST("Chaos 0: Stepped does not depend on the filters");
    WobbleParams a, b;
    a.smooth = 0.1f;
    b.smooth = 0.9f;
    b.wobble = 1.0f;
    a.rateHz = b.rateHz = 6.0f;
    EXPECT(render(a, 2.0, noInput).raw == render(b, 2.0, noInput).raw);
    TEST("Chaos > 0: two renders from the same start are identical");
    WobbleParams c;
    c.chaos = 0.7f;
    c.sync = 2;
    auto play = [](int i, WobbleInput& in) {
        in.running = true;
        in.started = i == 0;
        in.ppq = 37.3 + i * 2.0 / kSr;
    };
    const Render x = render(c, 2.0, play), y = render(c, 2.0, play);
    EXPECT(x.raw == y.raw && x.wobble == y.wobble);
    const Render free = render(a, 2.0, noInput);
    EXPECT(x.raw != free.raw);
}

int main() {
    seededValues();
    grid();
    responses();
    cutoffScales();
    softLimit();
    hold();
    bursts();
    compare();
    chaos();
    return bleep::test::finish("wobble");
}
