// SPDX-License-Identifier: MIT
// OscCore / SyncOsc / OscDrift, and the guard that OscillatorDsp's output did
// not change when its core moved to OscCore.h.
#include "dsp/OscCore.h"
#include "dsp/tests/TestUtil.h"

#include "../../../modules/oscillator/dsp/OscillatorDsp.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using bleep::test::magnitudeAt;
using bleep::test::rms;
using bleep::test::zeroCrossingHz;

namespace {

constexpr double kSr = 48000.0;

// The Oscillator exactly as it was before the refactor (commit 05dfc5a).
namespace legacy {
struct Frame {
    float out, sine, triangle, saw, square, sub;
};
class Oscillator {
public:
    static constexpr double kC4 = 261.6255653005986;
    void prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; }
    static float frequency(float pitchOctaves) noexcept { return (float)(kC4 * std::exp2((double)pitchOctaves)); }
    Frame tick(const patch::OscillatorParams& p, float fm, float sync) noexcept {
        const bool syncHigh = sync >= 0.5f;
        if (syncHigh && !lastSync_) phase_ = 0.0;
        lastSync_ = syncHigh;
        const double f0 = frequency(p.pitch);
        const double f = f0 * (1.0 + 4.0 * (double)p.fmDepth * (double)fm);
        const double dt = std::clamp(f / sampleRate_, -0.49, 0.49);
        const double adt = std::max(std::fabs(dt), 1e-9);
        const double ph = phase_;
        const float pw = std::clamp(p.pulseWidth, 0.05f, 0.95f);
        Frame o;
        o.sine = (float)std::sin(2.0 * 3.14159265358979323846 * ph);
        o.triangle = (float)(ph < 0.5 ? 4.0 * ph - 1.0 : 3.0 - 4.0 * ph);
        o.saw = (float)(2.0 * ph - 1.0 - blep(ph, adt));
        double sq = ph < pw ? 1.0 : -1.0;
        sq += blep(ph, adt);
        sq -= blep(wrap(ph - pw), adt);
        o.square = (float)sq;
        o.sub = sub_;
        const float m = std::clamp(p.shape, 0.0f, 1.0f) * 3.0f;
        const float waves[4] = {o.sine, o.triangle, o.saw, o.square};
        const int i = std::min((int)m, 2);
        const float t = m - (float)i;
        o.out = waves[i] + t * (waves[i + 1] - waves[i]);
        double next = ph + dt;
        if (next >= 1.0) {
            next -= 1.0;
            sub_ = -sub_;
        } else if (next < 0.0) {
            next += 1.0;
        }
        phase_ = next;
        return o;
    }

private:
    static double wrap(double x) noexcept { return x - std::floor(x); }
    static double blep(double t, double dt) noexcept {
        if (t < dt) {
            t /= dt;
            return t + t - t * t - 1.0;
        }
        if (t > 1.0 - dt) {
            t = (t - 1.0) / dt;
            return t * t + t + t + 1.0;
        }
        return 0.0;
    }
    double sampleRate_ = 48000.0, phase_ = 0.0;
    float sub_ = 1.0f;
    bool lastSync_ = false;
};
}  // namespace legacy

void oscillatorUnchanged() {
    TEST("OscillatorDsp bit-identical to the pre-OscCore code");
    for (double sr : {44100.0, 48000.0, 96000.0}) {
        legacy::Oscillator a;
        patch::OscillatorDsp b;
        a.prepare(sr), b.prepare(sr), b.reset();
        float maxDiff = 0.0f;
        for (int n = 0; n < 200000; ++n) {
            patch::OscillatorParams p;
            const double t = n / sr;
            p.pitch = (float)(-3.0 + 9.0 * (0.5 + 0.5 * std::sin(0.31 * t)));  // C1..C7 and beyond (clamp)
            p.shape = (float)(0.5 + 0.6 * std::sin(1.7 * t));                  // also outside 0..1
            p.pulseWidth = (float)(0.5 + 0.5 * std::sin(2.3 * t));
            p.fmDepth = (float)(0.5 + 0.5 * std::sin(0.13 * t));
            const float fm = (float)std::sin(2.0 * 3.14159265358979 * 523.0 * t);
            const float sync = (n / 517) % 2 == 0 ? 0.0f : 1.0f;
            const auto x = a.tick(p, fm, sync);
            const auto y = b.tick(p, fm, sync);
            const float d[] = {x.out - y.out, x.sine - y.sine, x.triangle - y.triangle, x.saw - y.saw, x.square - y.square, x.sub - y.sub};
            for (float v : d) maxDiff = std::max(maxDiff, std::fabs(v));
        }
        EXPECT(maxDiff == 0.0f);
        EXPECT(legacy::Oscillator::frequency(0.37f) == patch::OscillatorDsp::frequency(0.37f));
    }
}

std::vector<float> renderCore(double hz, int wave, bool blamp, int n = 48000) {
    dsp::OscCore o;
    o.setTriangleBlamp(blamp);
    std::vector<float> y((size_t)n);
    const double dt = dsp::osc::increment(hz, kSr);
    for (auto& v : y) {
        const auto w = o.tick(dt, 0.5f);
        const float all[] = {w.sine, w.triangle, w.saw, w.square, w.sub};
        v = all[wave];
    }
    return y;
}

// Sum of magnitudes at a few frequencies that are not harmonics of hz.
double aliasEnergy(const std::vector<float>& y, double hz) {
    double s = 0.0;
    for (double f : {1000.0, 3100.0, 6230.0, 9050.0, 13370.0}) {
        const double k = f / hz;
        if (std::fabs(k - std::round(k)) < 0.05) continue;
        s = std::max(s, magnitudeAt(y, f, kSr));
    }
    return s;
}

void corePitch() {
    TEST("OscCore pitch");
    for (double hz : {55.0, 261.6255653005986, 1760.0}) {
        for (int wave : {0, 2, 3}) {
            const auto y = renderCore(hz, wave, false);
            EXPECT_NEAR(zeroCrossingHz(y, kSr) / hz, 1.0, 1e-4);
        }
    }
    EXPECT_NEAR(dsp::osc::pitchToHz(1.0), 2.0 * dsp::osc::kC4Hz, 1e-9);
    EXPECT_NEAR(dsp::osc::linearFm(100.0, 0.5, -1.0), -100.0, 1e-12);
    EXPECT_NEAR(dsp::osc::expFm(100.0, 0.25, 1.0), 200.0, 1e-9);
    EXPECT_NEAR(dsp::osc::expFm(100.0, 0.25, -1.0), 50.0, 1e-9);
}

void triangleBlamp() {
    TEST("OscCore triangle polyBLAMP lowers aliasing");
    const double hz = 4186.0 * 1.13;  // above C8-ish
    const double naive = aliasEnergy(renderCore(hz, 1, false), hz);
    const double blamp = aliasEnergy(renderCore(hz, 1, true), hz);
    EXPECT(blamp < 0.5 * naive);
    const auto y = renderCore(hz, 1, true);
    EXPECT_NEAR(magnitudeAt(y, hz, kSr), magnitudeAt(renderCore(hz, 1, false), hz, kSr), 0.03);
}

void syncOscMatchesCore() {
    TEST("SyncOsc without sync ≈ OscCore (same polyBLEP)");
    dsp::OscCore a;
    dsp::SyncOsc b;
    b.reset();
    const double dt = dsp::osc::increment(1234.5, kSr);
    double maxDiff = 0.0;
    for (int n = 0; n < 20000; ++n) {
        const auto x = a.tick(dt, 0.3f);
        const auto y = b.process(dt, 0.3f);
        if (n == 0) continue;  // OscCore treats phase 0 as "just wrapped"
        maxDiff = std::max({maxDiff, (double)std::fabs(x.saw - y.saw), (double)std::fabs(x.square - y.square),
                            (double)std::fabs(x.sine - y.sine)});
    }
    EXPECT(maxDiff < 1e-5);
}

void syncOscThroughZero() {
    TEST("SyncOsc through-zero FM stays bounded and in tune");
    dsp::SyncOsc o;
    o.reset();
    std::vector<float> y(96000);
    const double f0 = 440.0;
    double peak = 0.0;
    for (size_t n = 0; n < y.size(); ++n) {
        const double m = std::sin(dsp::osc::kTwoPi * f0 * (double)n / kSr);
        const double dt = dsp::osc::increment(dsp::osc::linearFm(f0, 0.6, m), kSr);
        const auto w = o.process(dt, 0.5f);
        y[n] = w.saw;
        peak = std::max({peak, (double)std::fabs(w.saw), (double)std::fabs(w.square), (double)std::fabs(w.triangle)});
        EXPECT(std::isfinite(w.saw) && std::isfinite(w.triangle));
    }
    EXPECT(peak < 1.6);
    // Integer-ratio TZFM: the spectrum is harmonic on f0 (nothing at f0/2).
    EXPECT(magnitudeAt(y, f0 * 1.5, kSr) < 0.1 * magnitudeAt(y, f0, kSr) + 1e-3);
}

// Hard sync of a saw: band-limited sync vs a naive reset.
void hardSync() {
    TEST("SyncOsc hard sync: master period, less aliasing than a naive reset");
    const double master = 261.6255653005986 * 0.5, slave = master * 2.71;
    dsp::SyncOsc m, s;
    m.reset(), s.reset();
    dsp::OscCore naive;
    std::vector<float> bl(65536), nv(65536);
    for (size_t n = 0; n < bl.size(); ++n) {
        m.process(dsp::osc::increment(master, kSr), 0.5f);
        bl[n] = s.process(dsp::osc::increment(slave, kSr), 0.5f, m.wrapAt(), 1.0f).saw;
        // Naive: reset at the sample after the master wrap.
        const auto w = naive.tick(dsp::osc::increment(slave, kSr), 0.5f);
        nv[n] = w.saw;
        if (m.wrapAt() >= 0.0) naive.hardSync();
    }
    // Periodic at the master's frequency.
    EXPECT_NEAR(magnitudeAt(bl, master * 1.5, kSr) / magnitudeAt(bl, master, kSr), 0.0, 0.02);
    // Alias floor between harmonics, in the upper band.
    double aBl = 0.0, aNv = 0.0;
    for (int k = 20; k < 80; ++k) {
        const double f = master * (k + 0.5);
        aBl += magnitudeAt(bl, f, kSr);
        aNv += magnitudeAt(nv, f, kSr);
    }
    EXPECT(aBl < 0.25 * aNv);
}

void softSync() {
    TEST("SyncOsc soft sync: bounded, continuous, amount 0 = free");
    for (float amount : {0.0f, 0.2f, 0.45f, 0.5f, 0.75f, 0.99f}) {
        dsp::SyncOsc m, s, free;
        m.reset(), s.reset(), free.reset();
        float maxJump = 0.0f, prev = 0.0f, peak = 0.0f, maxDiffFree = 0.0f;
        const double dtm = dsp::osc::increment(220.0, kSr), dts = dsp::osc::increment(220.0 * 1.37, kSr);
        for (int n = 0; n < 48000; ++n) {
            m.process(dtm, 0.5f);
            const float y = s.process(dts, 0.5f, m.wrapAt(), amount).sine;
            const float z = free.process(dts, 0.5f).sine;
            maxDiffFree = std::max(maxDiffFree, std::fabs(y - z));
            if (n > 0) maxJump = std::max(maxJump, std::fabs(y - prev));
            peak = std::max(peak, std::fabs(y));
            prev = y;
        }
        EXPECT(peak < 1.3f);
        if (amount == 0.0f) EXPECT(maxDiffFree == 0.0f);
        else EXPECT(maxDiffFree > 0.01f);
        // Reversal (amount < 0.5) never jumps in value: the sine stays smooth.
        if (amount < 0.5f) EXPECT(maxJump < 0.06f);
    }
}

void drift() {
    TEST("OscDrift bounded, repeatable, seed-dependent, slow");
    dsp::OscDrift a, b, c;
    a.prepare(kSr, 0.2), b.prepare(kSr, 0.2), c.prepare(kSr, 0.2);
    a.reset(7, 1), b.reset(7, 1), c.reset(7, 2);
    float maxStep = 0.0f, prev = a.next(), diff = 0.0f, lo = 1.0f, hi = -1.0f;
    b.next(), c.next();
    for (int n = 0; n < 48000 * 30; ++n) {
        const float x = a.next(), y = b.next(), z = c.next();
        EXPECT(x == y);
        if (x != y) break;
        diff = std::max(diff, std::fabs(x - z));
        maxStep = std::max(maxStep, std::fabs(x - prev));
        lo = std::min(lo, x), hi = std::max(hi, x);
        prev = x;
    }
    EXPECT(lo >= -1.0f && hi <= 1.0f);
    EXPECT(hi - lo > 0.3f);
    EXPECT(diff > 0.1f);
    EXPECT(maxStep < 1e-4f);
}

}  // namespace

int main() {
    oscillatorUnchanged();
    corePitch();
    triangleBlamp();
    syncOscMatchesCore();
    syncOscThroughZero();
    hardSync();
    softSync();
    drift();
    return bleep::test::finish("osc_core");
}
