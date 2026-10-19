// SPDX-License-Identifier: GPL-3.0-or-later
// Test Oscillator: small-signal tuning on every range, lamp regulation, the
// bounce after a range change, the resonator's ping and decay, power-up
// determinism, warm-up and drift, Square duty and Sync
// (doc/specs/modules/test-oscillator.md §8).
#include "TestOscillatorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::TestOscillatorDsp;
using patch::TestOscillatorFrame;
using patch::TestOscillatorInput;
using patch::TestOscillatorParams;

static constexpr double kSr = 48000.0;

struct Render {
    std::vector<float> sine, square, sync, lamp;
    std::vector<double> y, heat;
};

/// An ideal instrument: Drift 0, Mains Off.
static TestOscillatorParams ideal() {
    TestOscillatorParams p;
    p.drift = 0.0f;
    p.mains = 0;
    return p;
}

/// Renders `seconds` from power-up; `change(i, p, in)` may edit params and input per sample.
template <class Change>
static Render render(TestOscillatorParams p, double seconds, Change&& change, double sr = kSr, uint32_t seed = 1) {
    TestOscillatorDsp d;
    d.setSeed(seed, -1);
    d.prepare(sr);
    Render r;
    TestOscillatorFrame f;
    const int n = (int)(seconds * sr);
    for (int i = 0; i < n; ++i) {
        TestOscillatorInput in;
        change(i, p, in);
        d.tick(p, in, f);
        r.sine.push_back(f.sine);
        r.square.push_back(f.square);
        r.sync.push_back(f.sync);
        r.lamp.push_back(f.lamp);
        r.y.push_back(d.y());
        r.heat.push_back(d.heat());
    }
    return r;
}
static auto nothing = [](int, TestOscillatorParams&, TestOscillatorInput&) {};
/// A kick on the first sample: starts the oscillation without waiting for the noise floor.
static auto kickStart = [](int i, TestOscillatorParams&, TestOscillatorInput& in) { in.kick = i < 4 ? 1.0f : 0.0f; };

static double peak(const std::vector<float>& x, size_t from) {
    double m = 0.0;
    for (size_t i = from; i < x.size(); ++i) m = std::max(m, (double)std::fabs(x[i]));
    return m;
}
static double cents(double f, double ref) { return 1200.0 * std::log2(f / ref); }

static void smallSignalFrequency() {
    TEST("105 %: the settled frequency is the dial within 1 cent on every range");
    for (int range = 0; range < 4; ++range) {
        TestOscillatorParams p = ideal();
        p.loopGain = 1.05f;
        p.settle = 2.0f;
        p.kick = 0.4f;
        p.range = range;
        const double seconds = range == 0 ? 8.0 : 3.0;
        const Render r = render(p, seconds, kickStart);
        const double want = TestOscillatorDsp::dialHz(4.4, 0.0, range);
        const double got = test::zeroCrossingHz(r.sine, kSr, r.sine.size() / 2);
        EXPECT(std::fabs(cents(got, want)) < 1.0);
        std::printf("  range %d: %.4f Hz for %.4f Hz (%+.3f ct)\n", range, got, want, cents(got, want));
    }
    TEST("tuning holds at 96 and 192 kHz (2× and 1× oversampling)");
    for (double sr : {96000.0, 192000.0}) {
        TestOscillatorParams p = ideal();
        p.loopGain = 1.05f;
        p.settle = 2.0f;
        p.kick = 0.4f;
        const Render r = render(p, 2.0, kickStart, sr);
        const double got = test::zeroCrossingHz(r.sine, sr, r.sine.size() / 2);
        EXPECT(std::fabs(cents(got, 880.0)) < 1.0);
    }
    TEST("Fine and Pitch: +50 cents, +1 octave");
    TestOscillatorParams p = ideal();
    p.fineCents = 50.0f;
    const Render r = render(p, 2.0, [](int i, TestOscillatorParams&, TestOscillatorInput& in) {
        in.kick = i < 4 ? 1.0f : 0.0f;
        in.pitch = 1.0f;
    });
    EXPECT(std::fabs(cents(test::zeroCrossingHz(r.sine, kSr, r.sine.size() / 2), 1760.0) - 50.0) < 1.0);
}

static void regulation() {
    TEST("105–145 %: lamp-regulated at A0; faint third harmonic; Lamp ≈ 0.5");
    for (float lg : {1.05f, 1.1f, 1.2f, 1.35f, 1.45f}) {
        TestOscillatorParams p = ideal();
        p.loopGain = lg;
        const Render r = render(p, lg < 1.08f ? 8.0 : 4.0, nothing);
        const size_t from = r.sine.size() - (size_t)kSr;
        double ypk = 0.0;
        for (size_t i = from; i < r.y.size(); ++i) ypk = std::max(ypk, std::fabs(r.y[i]));
        const double spk = peak(r.sine, from);
        EXPECT(std::fabs(ypk / TestOscillatorDsp::kA0 - 1.0) < 0.05);
        EXPECT(std::fabs(spk / TestOscillatorDsp::kA0 - 1.0) < 0.05);
        const std::vector<float> tail(r.sine.begin() + (long)from, r.sine.end());
        const double h1 = test::magnitudeAt(tail, 880.0, kSr), h3 = test::magnitudeAt(tail, 2640.0, kSr);
        const double h3db = 20.0 * std::log10(h3 / h1);
        EXPECT(h3db < -30.0);
        EXPECT(std::fabs(r.lamp.back() - 0.5) < 0.05);
        std::printf("  %3.0f %%: y %.4f, Sine %.4f, H3 %.1f dB, Lamp %.3f\n", lg * 100.0, ypk, spk, h3db, r.lamp.back());
    }
    TEST("short Settle: the heat follows the waveform and the sine distorts");
    TestOscillatorParams p = ideal();
    p.settle = 0.001f;
    const Render d = render(p, 2.0, nothing);
    const std::vector<float> tail(d.sine.end() - (long)kSr / 2, d.sine.end());
    const double h1 = test::zeroCrossingHz(tail, kSr);
    const double h3db = 20.0 * std::log10(test::magnitudeAt(tail, 3.0 * h1, kSr) / test::magnitudeAt(tail, h1, kSr));
    EXPECT(h3db > -40.0);
    std::printf("  Settle 1 ms: H3 %.1f dB\n", h3db);
    TEST("above 150 %: louder, clipping, bounded");
    p = ideal();
    p.loopGain = 3.0f;
    const Render c = render(p, 2.0, nothing);
    const double cpk = peak(c.sine, c.sine.size() / 2);
    EXPECT(cpk > 0.9 && cpk <= 1.02);
}

static void bounce() {
    TEST("after a range change the amplitude bounces, then settles within 2 % in under 10 Settle times");
    TestOscillatorParams p = ideal();
    p.settle = 0.5f;
    const size_t change = (size_t)(6.0 * kSr);
    const Render r = render(p, 14.0, [&](int i, TestOscillatorParams& q, TestOscillatorInput&) { q.range = (size_t)i < change ? 1 : 2; });
    // Amplitude: the peak of |y| over two periods (880 Hz), per window.
    const size_t win = 110;
    std::vector<double> env;
    for (size_t w = change; w + win <= r.y.size(); w += win) {
        double m = 0.0;
        for (size_t i = w; i < w + win; ++i) m = std::max(m, std::fabs(r.y[i]));
        env.push_back(m);
    }
    const double final = env.back();
    double hi = 0.0, lo = 1e9;
    for (size_t k = 2; k < env.size(); ++k) hi = std::max(hi, env[k]), lo = std::min(lo, env[k]);
    EXPECT(lo < final * 0.5);   // the dip while the switch is open
    EXPECT(hi > final * 1.1);   // the surge after it
    size_t settled = 0;
    for (size_t k = 0; k < env.size(); ++k)
        if (std::fabs(env[k] / final - 1.0) > 0.02) settled = k;
    const double settleTimes = (double)(settled * win) / kSr / 0.5;
    EXPECT(settleTimes < 10.0 && settleTimes > 2.0);
    TEST("the heat overshoots too, and settles at the nominal amplitude");
    double heatHi = 0.0;
    for (size_t i = change; i < r.heat.size(); ++i) heatHi = std::max(heatHi, r.heat[i]);
    EXPECT(heatHi > r.heat.back() * 1.01);
    EXPECT(std::fabs(r.lamp.back() - 0.5) < 0.05);
    std::printf("  amplitude %.3f … %.3f → %.3f, settled within 2 %% after %.1f Settle times\n", lo, hi, final, settleTimes);
}

static void resonator() {
    TEST("95 %, 100 Hz: a kick peaks at 2·Kick·A0 and decays 60 dB in 2.2 s");
    TestOscillatorParams p = ideal();
    p.loopGain = 0.95f;
    p.range = 1;
    p.frequency = 5.0f;  // 100 Hz
    p.kick = 0.5f;
    const size_t at = (size_t)(0.1 * kSr);
    const Render r = render(p, 3.5, [&](int i, TestOscillatorParams&, TestOscillatorInput& in) {
        in.kick = (size_t)i >= at && (size_t)i < at + 4 ? 1.0f : 0.0f;
    });
    double first = 0.0;
    for (size_t i = at; i < at + (size_t)(0.01 * kSr); ++i) first = std::max(first, std::fabs(r.y[i]));
    EXPECT(std::fabs(first / (2.0 * 0.5 * TestOscillatorDsp::kA0) - 1.0) < 0.05);
    // Envelope: peak per 10 ms window; T60 where it falls below first/1000.
    const size_t win = (size_t)(0.01 * kSr);
    double t60 = 0.0;
    for (size_t w = at; w + win < r.y.size(); w += win) {
        double m = 0.0;
        for (size_t i = w; i < w + win; ++i) m = std::max(m, std::fabs(r.y[i]));
        if (m < first * 1e-3) {
            t60 = (double)(w - at) / kSr;
            break;
        }
    }
    EXPECT(std::fabs(t60 / 2.2 - 1.0) < 0.1);
    std::printf("  first peak %.4f, T60 %.3f s\n", first, t60);
    TEST("the ping is independent of frequency");
    for (int range : {0, 2, 3}) {
        TestOscillatorParams q = p;
        q.range = range;
        q.frequency = 2.5f;
        const Render k = render(q, 0.6, [](int i, TestOscillatorParams&, TestOscillatorInput& in) { in.kick = i == 100 ? 1.0f : 0.0f; });
        double m = 0.0;
        for (size_t i = 100; i < k.y.size(); ++i) m = std::max(m, std::fabs(k.y[i]));
        EXPECT(std::fabs(m / 0.5 - 1.0) < 0.05);
    }
}

static void determinism() {
    TEST("two renders from the same power-up are bit-identical (drift, hum, noise, inputs)");
    TestOscillatorParams p;
    p.drift = 1.0f;
    auto play = [](int i, TestOscillatorParams& q, TestOscillatorInput& in) {
        in.pitch = 0.2f * std::sin((float)i * 1e-4f);
        in.kick = i % 9000 < 4 ? 1.0f : 0.0f;
        in.audio = 0.3f * std::sin((float)i * 0.05f);
        in.audioPatched = true;
        in.fm = std::sin((float)i * 0.01f);
        q.fm = 0.1f;
        q.range = i < 30000 ? 2 : 3;
    };
    const Render a = render(p, 2.0, play), b = render(p, 2.0, play);
    EXPECT(a.sine == b.sine && a.square == b.square && a.sync == b.sync && a.lamp == b.lamp);
    TEST("after free running, a power-up repeats the fresh render");
    TestOscillatorDsp d;
    d.setSeed(1, -1);
    d.prepare(kSr);
    TestOscillatorFrame f;
    TestOscillatorParams q;
    q.drift = 1.0f;
    for (int i = 0; i < 20000; ++i) d.tick(q, TestOscillatorInput{}, f);
    d.powerUp();
    bool same = true;
    for (size_t i = 0; i < a.sine.size(); ++i) {
        TestOscillatorInput in;
        play((int)i, q, in);
        d.tick(q, in, f);
        same = same && f.sine == a.sine[i] && f.square == a.square[i];
    }
    EXPECT(same);
    TEST("another seed differs");
    EXPECT(render(p, 2.0, play, kSr, 2).sine != a.sine);
}

static void drift() {
    TEST("warm-up: −100 cents at power-up, within 5 cents at 30 s");
    const uint64_t key = 12345;
    auto warm = [&](double t) { return TestOscillatorDsp::driftAt(1.0, true, t, key, 0) - TestOscillatorDsp::driftAt(1.0, false, t, key, 0); };
    EXPECT_NEAR(warm(0.0), -100.0, 1e-9);
    EXPECT(std::fabs(warm(30.0)) < 5.0);
    TEST("wander stays within ±15 cents and moves");
    double lo = 0.0, hi = 0.0;
    for (double t = 0.0; t < 600.0; t += 0.05) {
        const double w = TestOscillatorDsp::driftAt(1.0, false, t, key, 0);
        lo = std::min(lo, w), hi = std::max(hi, w);
    }
    EXPECT(lo >= -15.0 && hi <= 15.0 && hi - lo > 10.0);
    TEST("Drift 0: no warm-up, wander or hum");
    EXPECT(TestOscillatorDsp::driftAt(0.0, true, 0.0, key, 0) == 0.0);
    TestOscillatorParams p;
    p.drift = 0.0f;
    p.loopGain = 0.0f;  // no oscillation: only the noise floor is left
    const Render r = render(p, 1.0, nothing);
    EXPECT(peak(r.sine, 0) < 1e-3);
    TEST("Drift 100 %, Mains 50 Hz: hum on Sine at −60 dB");
    p.drift = 1.0f;
    const Render h = render(p, 1.0, nothing);
    const std::vector<float> tail(h.sine.begin() + 4800, h.sine.end());
    EXPECT_NEAR(test::magnitudeAt(tail, 50.0, kSr), 0.0005, 0.0002);
    TEST("warm-up shows in the pitch: flat at power-up");
    TestOscillatorParams w = ideal();
    w.drift = 1.0f;
    w.mains = 0;
    const Render s = render(w, 1.5, kickStart);
    const double f0 = test::zeroCrossingHz(std::vector<float>(s.sine.begin() + 24000, s.sine.end()), kSr);
    EXPECT(cents(f0, 880.0) < -80.0 && cents(f0, 880.0) > -120.0);
}

static void squareAndSync() {
    TEST("Square keeps 50 % duty during a bounce; Sync fires once per period");
    TestOscillatorParams p = ideal();
    p.settle = 0.3f;
    const size_t change = (size_t)(3.0 * kSr);
    const Render r = render(p, 5.0, [&](int i, TestOscillatorParams& q, TestOscillatorInput& in) {
        q.frequency = (size_t)i < change ? 4.4f : 3.3f;
        in.kick = (size_t)i >= change + 9000 && (size_t)i < change + 9004 ? 1.0f : 0.0f;
    });
    // Duty over whole periods in 0.1 s windows through the bounce.
    for (size_t w = change; w + 4800 < r.square.size(); w += 4800) {
        size_t a = w, b = w + 4800;
        while (a < b && !(r.square[a - 1] < 0.0f && r.square[a] >= 0.0f)) ++a;
        while (b > a && !(r.square[b - 1] < 0.0f && r.square[b] >= 0.0f)) --b;
        double high = 0.0;
        for (size_t i = a; i < b; ++i) high += 0.5 + 0.5 * std::clamp((double)r.square[i], -1.0, 1.0);
        EXPECT(std::fabs(high / (double)(b - a) - 0.5) < 0.01);
    }
    int syncs = 0, crossings = 0;
    for (size_t i = (size_t)kSr; i < r.sine.size(); ++i) {
        syncs += r.sync[i] > 0.5f;
        crossings += r.sine[i - 1] < 0.0f && r.sine[i] >= 0.0f;
    }
    EXPECT(std::abs(syncs - crossings) <= 1);
    std::printf("  %d syncs, %d crossings\n", syncs, crossings);
    TEST("Sync lands on Sine's upward crossing (within two samples)");
    for (size_t i = (size_t)kSr; i < (size_t)(2 * kSr); ++i)
        if (r.sync[i] > 0.5f) {
            bool near = false;
            for (size_t k = i - 2; k <= i + 2; ++k) near = near || (r.sine[k - 1] < 0.0f && r.sine[k] >= 0.0f);
            EXPECT(near);
        }
    TEST("silent loop: no Sync, Square fades out");
    TestOscillatorParams s = ideal();
    s.loopGain = 0.5f;
    const Render q = render(s, 1.0, nothing);
    EXPECT(peak(q.sync, 0) == 0.0);
    EXPECT(peak(q.square, q.square.size() / 2) == 0.0);
}

static void bounded() {
    TEST("extremes stay finite and bounded");
    TestOscillatorParams p;
    p.loopGain = 3.0f;
    p.settle = 0.005f;
    p.kick = 1.0f;
    p.fm = 1.0f;
    p.drift = 1.0f;
    for (int range = 0; range < 4; ++range) {
        p.range = range;
        p.frequency = 10.0f;
        const Render r = render(p, 1.0, [](int i, TestOscillatorParams&, TestOscillatorInput& in) {
            in.kick = (i / 50) % 2 ? 1.0f : 0.0f;
            in.audio = (float)((i * 7919) % 2001 - 1000) / 100.0f;
            in.audioPatched = true;
            in.fm = (float)((i * 104729) % 2001 - 1000) / 200.0f;
            in.pitch = (float)((i / 1000) % 9) - 4.0f;
        });
        EXPECT(test::allFinite(r.sine) && test::allFinite(r.square) && test::allFinite(r.lamp));
        EXPECT(peak(r.sine, 0) < 1.5 && peak(r.square, 0) < 1.5 && peak(r.lamp, 0) <= 1.0);
    }
}

int main() {
    smallSignalFrequency();
    regulation();
    bounce();
    resonator();
    determinism();
    drift();
    squareAndSync();
    bounded();
    return bleep::test::finish("test-oscillator");
}
