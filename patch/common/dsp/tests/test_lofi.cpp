// SPDX-License-Identifier: MIT
#include "dsp/Drums.h"
#include "dsp/Lofi.h"
#include "dsp/tests/TestUtil.h"

#include <set>
#include <vector>

using namespace bleep::dsp;

static constexpr double kSr = 48000.0;

static size_t levels(float bits) {
    std::set<float> v;
    for (int i = -100000; i <= 100000; ++i) v.insert(quantizeBits((float)i / 100000.0f, bits));
    return v.size();
}

static void bitReduction() {
    TEST("bit reduction: level count");
    EXPECT(levels(1.0f) == 3);  // −1, 0, +1
    EXPECT(levels(3.0f) == 9);
    EXPECT(levels(4.0f) == 17);
    EXPECT(levels(8.0f) == 257);
    EXPECT_NEAR(quantizeBits(0.3f, 16.0f), 0.3, 1.0 / 65536.0);
}

static void decimationHolds() {
    TEST("decimation holds each value for fs / rate samples");
    Decimator d;
    d.reset();
    int changes = 0;
    float prev = -1.0f;
    int run = 0, minRun = 1 << 30, maxRun = 0;
    for (int n = 0; n < 48000; ++n) {
        const float y = d.process((float)n, 1000.0, kSr);
        if (y < prev || y > prev) {
            if (n > 0) {
                minRun = std::min(minRun, run);
                maxRun = std::max(maxRun, run);
            }
            ++changes;
            run = 0;
        }
        ++run;
        prev = y;
    }
    EXPECT(changes >= 999 && changes <= 1001);
    EXPECT(minRun >= 47 && maxRun <= 49);

    TEST("anti-aliased decimation removes content above the new Nyquist");
    std::vector<float> plain, aa;
    Decimator d1, d2;
    d1.reset();
    d2.reset();
    for (int n = 0; n < 48000; ++n) {
        const float x = (float)std::sin(2.0 * 3.14159265358979323846 * 7000.0 * n / kSr);
        plain.push_back(d1.process(x, 8000.0, kSr));
        aa.push_back(d2.process(x, 8000.0, kSr, true));
    }
    // 7 kHz at an 8 kHz rate aliases to 1 kHz.
    EXPECT(bleep::test::magnitudeAt(plain, 1000.0, kSr) > 0.1);
    EXPECT(bleep::test::magnitudeAt(aa, 1000.0, kSr) < 0.1 * bleep::test::magnitudeAt(plain, 1000.0, kSr));
}

static void dropout() {
    TEST("dropout: seeded, monotonic in amount, fades");
    Dropout a, b;
    int droppedLo = 0, droppedHi = 0, subset = 1;
    for (uint64_t c = 0; c < 2000; ++c) {
        const bool lo = Dropout::dropped(4, c, 0.3f), hi = Dropout::dropped(4, c, 0.6f);
        droppedLo += lo;
        droppedHi += hi;
        if (lo && !hi) subset = 0;
    }
    EXPECT(subset == 1);
    EXPECT_NEAR(droppedLo, 600, 80);
    EXPECT_NEAR(droppedHi, 1200, 80);
    a.reset(4);
    b.reset(4);
    double maxStep = 0.0, energy = 0.0;
    float prev = 1.0f;
    bool same = true;
    for (int n = 0; n < 48000; ++n) {
        const float y = a.process(1.0f, 0.5f, 480, 48);
        const float yb = b.process(1.0f, 0.5f, 480, 48);
        same = same && !(y < yb || y > yb);
        maxStep = std::max(maxStep, (double)std::fabs(y - prev));
        energy += y;
        prev = y;
    }
    EXPECT(maxStep <= 1.0 / 48.0 + 1e-6);
    EXPECT(same);
    EXPECT(energy > 48000 * 0.3 && energy < 48000 * 0.7);
    Dropout z;
    z.reset(1);
    float last = 0.0f;
    for (int n = 0; n < 1000; ++n) last = z.process(0.7f, 0.0f, 10, 1);
    EXPECT_NEAR(last, 0.7, 1e-7);
}

static void smear() {
    TEST("smear averages over its length");
    Smear s;
    s.reset();
    for (int n = 0; n < 1000; ++n) s.process(1.0f, 64.0f);
    EXPECT_NEAR(s.process(1.0f, 64.0f), 1.0, 1e-6);
    s.reset();
    std::vector<float> y;
    for (int n = 0; n < 200; ++n) y.push_back(s.process(n == 100 ? 1.0f : 0.0f, n < 50 ? 1.0f : 20.0f));
    EXPECT_NEAR(y[100], 1.0 / 20.0, 1e-6);
    EXPECT_NEAR(y[119], 1.0 / 20.0, 1e-6);
    EXPECT_NEAR(y[120], 0.0, 1e-6);
    s.reset();
    EXPECT_NEAR(s.process(0.4f, 1.0f), 0.4, 1e-7);  // length 1 is a bypass
    // Modulating the length keeps DC at DC.
    s.reset();
    double err = 0.0;
    for (int n = 0; n < 20000; ++n) {
        const float v = s.process(0.5f, 1.0f + 2000.0f * (float)(0.5 + 0.5 * std::sin(n * 0.01)));
        if (n > 5000) err = std::max(err, std::fabs(v - 0.5));
    }
    EXPECT(err < 1e-5);
}

static void foldAndCrush() {
    TEST("fold: clean at 0, bounded at full");
    EXPECT_NEAR(foldCorrupt(0.37f, 0.0f), 0.37f, 0.0);
    float peak = 0.0f;
    for (int i = -1000; i <= 1000; ++i) peak = std::max(peak, std::fabs(foldCorrupt((float)i / 250.0f, 1.0f)));
    EXPECT(peak <= 1.0f);
    // At full amount a gentle ramp folds many times.
    int turns = 0;
    float p0 = foldCorrupt(-1.0f, 1.0f), p1 = p0;
    for (int i = -999; i <= 1000; ++i) {
        const float v = foldCorrupt((float)i / 1000.0f, 1.0f);
        if ((v - p1) * (p1 - p0) < 0.0f) ++turns;
        p0 = p1;
        p1 = v;
    }
    EXPECT(turns >= 10);

    TEST("crush: clean at 0, 3 bits at 1 kHz at full");
    Crush c;
    c.reset();
    EXPECT_NEAR(c.process(0.123f, 0.0f, kSr), 0.123f, 0.0);
    std::set<float> v;
    int changes = 0;
    float prev = 2.0f;
    for (int n = 0; n < 48000; ++n) {
        const float y = c.process((float)std::sin(n * 0.001), 1.0f, kSr);
        v.insert(y);
        if (y < prev || y > prev) ++changes;
        prev = y;
    }
    EXPECT(v.size() <= 9);
    EXPECT(changes <= 1000);
}

static void drumCrusherUnchanged() {
    TEST("Drums Crusher matches its original arithmetic");
    Crusher c;
    c.reset();
    float held = 0.0f;
    double ph = 1.0;
    bool same = true;
    for (int n = 0; n < 100000; ++n) {
        const float crunch = (float)uniform01(8, (uint64_t)n / 500, 1);
        const float x = (float)std::sin(n * 0.0123) * 0.9f;
        // The pre-Lofi implementation, verbatim.
        float ref = x;
        if (crunch > 0.0f) {
            ph += (1.0 - 0.6 * crunch) * 44100.0 / 44100.0;
            if (ph >= 1.0) {
                ph -= std::floor(ph);
                const float steps = std::exp2(15.0f - 9.0f * crunch);
                held = std::round(x * steps) / steps;
            }
            ref = held;
        }
        const float y = c.process(x, crunch, 44100.0);
        same = same && !(y < ref || y > ref);
    }
    EXPECT(same);
}

int main() {
    bitReduction();
    decimationHolds();
    dropout();
    smear();
    foldAndCrush();
    drumCrusherUnchanged();
    return bleep::test::finish("lofi");
}
