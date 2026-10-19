// SPDX-License-Identifier: GPL-3.0-or-later
// Uncertainty: Fluctuating continuity and sync, Quantized levels and divide,
// Stored correlation / shape / distribution, seeking, Integrated
// (doc/specs/modules/uncertainty.md §8).
#include "UncertaintyDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <set>
#include <vector>

using namespace bleep;
using patch::UncertaintyDsp;
using patch::UncertaintyFrame;
using patch::UncertaintyInput;
using patch::UncertaintyParams;
using patch::UShape;

static constexpr double kSr = 48000.0;

template <class In>
static std::vector<UncertaintyFrame> render(const UncertaintyParams& p, double seconds, In&& input,
                                            UncertaintyDsp* use = nullptr) {
    UncertaintyDsp local;
    UncertaintyDsp& d = use ? *use : local;
    if (!use) d.prepare(kSr);
    std::vector<UncertaintyFrame> out;
    UncertaintyFrame f;
    for (int i = 0; i < (int)(seconds * kSr); ++i) {
        UncertaintyInput in;
        input(i, in);
        d.tick(p, in, f);
        out.push_back(f);
    }
    return out;
}
static auto noInput = [](int, UncertaintyInput&) {};
/// Transport playing at 120 BPM from `ppq0`.
static auto playing(double ppq0) {
    return [ppq0](int i, UncertaintyInput& in) {
        in.running = true;
        in.started = i == 0;
        in.ppq = ppq0 + i * 2.0 / kSr;
    };
}

static void fluct() {
    TEST("fluct is continuous and within ±Spread");
    UncertaintyParams p;
    p.fRate = {5.0f, 0.3f};
    p.fSpread = {0.6f, 1.0f};
    const auto r = render(p, 10.0, noInput);
    double maxStep = 0.0;
    for (size_t i = 0; i < r.size(); ++i) {
        EXPECT(std::fabs(r[i].fluct[0]) <= 0.6f + 1e-6f);
        EXPECT(std::fabs(r[i].fluct[1]) <= 1.0f);
        if (i) maxStep = std::max(maxStep, (double)std::fabs(r[i].fluct[0] - r[i - 1].fluct[0]));
    }
    EXPECT(maxStep < 0.6 * 4.0 * 5.0 * 2.0 / kSr * 4.0);  // slope bound: a few × spread·rate
    TEST("free point spacing averages 1 / Rate");
    UncertaintyDsp d;
    d.prepare(kSr);
    p.fRate = {4.0f, 4.0f};
    render(p, 100.0, noInput, &d);
    EXPECT_NEAR((double)d.fluctSegment(0) / 400.0, 1.0, 0.08);
    TEST("synced fluct is a function of the song position");
    UncertaintyParams q;
    q.fSync = 6;  // 1 bar
    const auto a = render(q, 2.0, playing(10.0));
    const auto b = render(q, 2.0, playing(10.0));
    const auto c = render(q, 1.0, playing(11.0));  // starts half-way, 1 s later = 2 beats
    for (size_t i = 0; i < a.size(); ++i) EXPECT(a[i].fluct[0] == b[i].fluct[0]);
    for (size_t i = 0; i < c.size(); ++i) EXPECT_NEAR(c[i].fluct[0], a[i + (size_t)(kSr / 2)].fluct[0], 1e-6);
}

static void quantized() {
    TEST("quantized: 2^Bits levels, all of them");
    for (int bits = 1; bits <= 4; ++bits) {
        std::set<int> levels;
        for (int64_t k = 0; k < 10000; ++k) levels.insert(UncertaintyDsp::quantLevel(5, k, 0, bits));
        EXPECT((int)levels.size() == (1 << bits));
        EXPECT(*levels.begin() == 0 && *levels.rbegin() == (1 << bits) - 1);
    }
    EXPECT_NEAR(UncertaintyDsp::quantValue(7, 3, 0), 1.0, 1e-6);
    EXPECT_NEAR(UncertaintyDsp::quantValue(3, 3, 7), 21.0 / 12.0, 1e-6);
    TEST("Interval 7 with 3 bits outputs multiples of 7/12");
    UncertaintyParams p;
    p.qRate = 30.0f;
    p.qSync = 0;
    p.interval = {7, 0};
    const auto r = render(p, 5.0, noInput);
    std::set<float> seen;
    for (const auto& f : r) {
        const double steps = f.quant[0] * 12.0 / 7.0;
        EXPECT_NEAR(steps, std::round(steps), 1e-4);
        seen.insert(f.quant[0]);
    }
    EXPECT(seen.size() <= 8 && seen.size() >= 6);
    TEST("Q2 Divide 2 steps Q2 on every second Q1 step");
    UncertaintyParams q;
    q.qSync = 0;
    q.bits = {4, 4};
    q.q2Divide = 2;
    int q1Changes = 0, q2Changes = 0;
    const auto clocked = render(q, 3.0, [](int i, UncertaintyInput& in) {
        in.q1Patched = true;
        in.clockQ1 = i % 2400 == 0 ? 1.0f : 0.0f;
    });
    for (size_t i = 1; i < clocked.size(); ++i) {
        if (i % 2400 == 0) {
            const int64_t n = (int64_t)(i / 2400);
            EXPECT_NEAR(clocked[i].quant[0], UncertaintyDsp::quantValue(UncertaintyDsp::quantLevel(1, n, 0, 4), 4, 0), 1e-6);
            if (n % 2 == 0)
                EXPECT_NEAR(clocked[i].quant[1], UncertaintyDsp::quantValue(UncertaintyDsp::quantLevel(1, n / 2, 1, 4), 4, 0), 1e-6);
            else
                EXPECT(clocked[i].quant[1] == clocked[i - 1].quant[1]);
        }
        q1Changes += clocked[i].quant[0] != clocked[i - 1].quant[0];
        q2Changes += clocked[i].quant[1] != clocked[i - 1].quant[1];
    }
    EXPECT(q2Changes <= q1Changes / 2 + 1);
}

static double lag1(double c) {
    double sxy = 0.0, sxx = 0.0;
    double prev = UncertaintyDsp::correlatedNormal(1, -1, c);
    for (int64_t k = 0; k < 20000; ++k) {
        const double z = UncertaintyDsp::correlatedNormal(1, k, c);
        sxy += z * prev;
        sxx += z * z;
        prev = z;
    }
    return sxy / sxx;
}

static void stored() {
    TEST("correlation in the z domain");
    EXPECT_NEAR(lag1(0.0), 0.0, 0.03);
    EXPECT_NEAR(lag1(0.9), 0.9, 0.03);
    EXPECT_NEAR(lag1(-0.9), -0.9, 0.03);
    TEST("the histogram of u stays uniform for every Correlation");
    for (double c : {-0.95, -0.5, 0.0, 0.5, 0.95}) {
        int bins[10] = {};
        const int n = 20000;
        for (int64_t k = 0; k < n; ++k) ++bins[std::min(9, (int)(UncertaintyDsp::storedUniform(3, k, c) * 10.0))];
        for (int b : bins) EXPECT_NEAR(b / (double)n, 0.1, c * c > 0.8 ? 0.035 : 0.015);
    }
    TEST("Distribution moves the mean; Bell and Edges move mass");
    auto stats = [](UShape shape, double dist, double& mean, double& centre) {
        mean = centre = 0.0;
        for (int i = 0; i < 10000; ++i) {
            const double v = UncertaintyDsp::shapeStored((i + 0.5) / 10000.0, shape, dist);
            mean += v / 10000.0;
            centre += std::fabs(v) < 0.5 ? 1e-4 : 0.0;
        }
    };
    double m0, c0, m1, c1, m2, c2, mb, cb, me, ce;
    stats(UShape::Uniform, 0.0, m0, c0);
    stats(UShape::Uniform, 1.0, m1, c1);
    stats(UShape::Uniform, -1.0, m2, c2);
    stats(UShape::Bell, 0.0, mb, cb);
    stats(UShape::Edges, 0.0, me, ce);
    EXPECT_NEAR(m0, 0.0, 1e-3);
    EXPECT(m1 > 0.4 && m2 < -0.4);
    EXPECT(cb > c0 + 0.1 && ce < c0 - 0.1);
    TEST("seek: the direct sum equals the recursion");
    const double c = 0.9, g = std::sqrt(1.0 - c * c);
    double z = UncertaintyDsp::correlatedNormal(1, 0, c);
    for (int64_t k = 1; k <= 2000; ++k) {
        z = c * z + g * dsp::standardNormal(1, (uint64_t)k, patch::ustream::kStored);
        if (k % 250 == 0) EXPECT_NEAR(z, UncertaintyDsp::correlatedNormal(1, k, c), 1e-9);
    }
}

static void integrated() {
    TEST("integrated: within ±1, slope = Stored · Integrate");
    UncertaintyParams p;
    p.storeSync = 0;
    p.storeRate = 3.0f;
    p.integrate = 4.0f;
    const auto r = render(p, 10.0, noInput);
    int checked = 0;
    for (size_t i = 2; i < r.size(); ++i) {
        EXPECT(std::fabs(r[i].integrated) <= 1.0f + 1e-6f);
        const double d1 = r[i].integrated - r[i - 1].integrated, d0 = r[i - 1].integrated - r[i - 2].integrated;
        if (r[i].storeTrig == 0.0f && r[i - 1].storeTrig == 0.0f && std::fabs(r[i].integrated) < 0.99f &&
            std::fabs(r[i - 2].integrated) < 0.99f) {
            EXPECT_NEAR(std::fabs(d1), std::fabs(r[i].stored) * 4.0 / kSr, 1e-6);  // the sign flips on the reflected part
            EXPECT_NEAR(d1, d0, 1e-6);
            ++checked;
        }
    }
    EXPECT(checked > 100000);
    TEST("same start, same output");
    UncertaintyParams q;
    q.correlation = 0.8f;
    const auto a = render(q, 3.0, playing(5.0)), b = render(q, 3.0, playing(5.0));
    bool same = true;
    for (size_t i = 0; i < a.size(); ++i) same = same && a[i].integrated == b[i].integrated && a[i].stored == b[i].stored;
    EXPECT(same);
    TEST("a loop jump rebuilds Integrated from the song position");
    UncertaintyDsp d;
    d.prepare(kSr);
    render(q, 2.0, playing(3.0), &d);
    // jump back to 20.0 beats (not a start): synced Store sees a jump
    const auto j = render(q, 0.5, [](int i, UncertaintyInput& in) {
        in.running = true;
        in.ppq = 20.0 + i * 2.0 / kSr;
    }, &d);
    UncertaintyDsp e;
    e.prepare(kSr);
    render(q, 1.0, playing(7.0), &e);
    const auto k = render(q, 0.5, [](int i, UncertaintyInput& in) {
        in.running = true;
        in.ppq = 20.0 + i * 2.0 / kSr;
    }, &e);
    EXPECT_NEAR(j[100].integrated, k[100].integrated, 1e-9);
}

static void stopped() {
    TEST("defaults move without a transport (synced clocks run at the synced length)");
    UncertaintyParams p;  // Q Sync 1/8, Store Sync 1/4 at 120 BPM: 4 and 2 events per second
    int q = 0, s = 0;
    const auto r = render(p, 4.0, noInput);
    for (size_t i = 1; i < r.size(); ++i) {
        q += r[i].quant[0] != r[i - 1].quant[0];
        s += r[i].storeTrig > 0.5f;
    }
    EXPECT(s >= 7 && s <= 9);
    EXPECT(q >= 8);
}

int main() {
    stopped();
    fluct();
    quantized();
    stored();
    integrated();
    return bleep::test::finish("uncertainty");
}
