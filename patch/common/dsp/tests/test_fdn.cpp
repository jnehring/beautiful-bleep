// SPDX-License-Identifier: MIT
#include "dsp/Fdn.h"
#include "dsp/Random.h"
#include "dsp/Svf.h"
#include "dsp/tests/TestUtil.h"

#include <memory>
#include <vector>

using namespace bleep::dsp;

static constexpr double kSr = 48000.0;

static float noise(uint64_t i, uint64_t stream = 7) { return (float)(2.0 * uniform01(42, i, stream) - 1.0); }

// T60 from the Schroeder energy decay curve between −5 and −35 dB.
static double t60(const std::vector<float>& x) {
    std::vector<double> edc(x.size() + 1, 0.0);
    for (size_t i = x.size(); i-- > 0;) edc[i] = edc[i + 1] + (double)x[i] * x[i];
    const double e0 = edc[0];
    double t5 = -1.0, t35 = -1.0;
    for (size_t i = 0; i < x.size(); ++i) {
        const double db = 10.0 * std::log10(std::max(edc[i] / e0, 1e-30));
        if (t5 < 0.0 && db <= -5.0) t5 = (double)i / kSr;
        if (t35 < 0.0 && db <= -35.0) {
            t35 = (double)i / kSr;
            break;
        }
    }
    return t5 < 0.0 || t35 < 0.0 ? -1.0 : 2.0 * (t35 - t5);
}

static std::vector<float> impulseResponse(Fdn& f, const FdnParams& p, double seconds, int highPassHz = 0) {
    f.clear();
    std::vector<float> out;
    Svf hp;
    hp.set((float)highPassHz, 0.7071f, kSr);
    for (int n = 0; n < (int)(seconds * kSr); ++n) {
        float l, r;
        f.process(n == 0 ? 1.0f : 0.0f, 0.0f, l, r, p);
        float m = 0.5f * (l + r);
        if (highPassHz > 0) m = hp.process(m).hp;
        out.push_back(m);
    }
    return out;
}

static void decayMatchesRt60() {
    TEST("impulse decay time matches the T60");
    auto f = std::make_unique<Fdn>();
    for (int lines : {8, 16}) {
        f->prepare(kSr, lines);
        for (float decay : {0.6f, 2.0f}) {
            FdnParams p;
            p.decay = decay;
            p.damping = 0.0f;
            p.bass = 1.0f;
            p.preDelaySamples = 0.0;
            const double t = t60(impulseResponse(*f, p, decay * 1.5));
            std::printf("  %d lines, T60 %.2f s: measured %.3f s\n", lines, decay, t);
            EXPECT_NEAR(t, decay, 0.1 * decay);
        }
    }
    TEST("damping makes the highs decay faster");
    f->prepare(kSr, 16);
    FdnParams p;
    p.decay = 2.0f;
    p.damping = 1.0f;
    const double high = t60(impulseResponse(*f, p, 2.0, 5000));
    p.damping = 0.0f;
    const double flat = t60(impulseResponse(*f, p, 3.0, 5000));
    std::printf("  > 5 kHz T60: damping 0 %.3f s, damping 1 %.3f s\n", flat, high);
    EXPECT(high > 0.0 && high * 5.0 < flat);
}

// Noise low-passed at 6 kHz (12 dB/oct): program-like material.
static double windowRms(Fdn& f, const FdnParams& p, int samples, uint64_t& clock, bool feed) {
    static Svf lp;
    lp.set(6000.0f, 0.7071f, kSr);
    double s = 0.0;
    for (int n = 0; n < samples; ++n, ++clock) {
        float l, r;
        const float x = feed ? lp.process(noise(clock)).lp : 0.0f;
        f.process(x, x, l, r, p);
        s += (double)l * l + (double)r * r;
    }
    return std::sqrt(s / (2.0 * samples));
}

static void freezeHolds() {
    TEST("freeze holds the tail without loss or growth");
    auto f = std::make_unique<Fdn>();
    f->prepare(kSr, 16);
    FdnParams p;
    p.decay = 3.0f;
    p.modDepth = 0.25f;
    uint64_t clock = 0;
    windowRms(*f, p, 24000, clock, true);
    p.freeze = true;
    windowRms(*f, p, 4800, clock, true);  // input fades out within 20 ms
    const double ref = windowRms(*f, p, 48000, clock, true);
    double lo = ref, hi = ref;
    for (int s = 0; s < 60; ++s) {
        const double r = windowRms(*f, p, 48000, clock, true);
        lo = std::min(lo, r);
        hi = std::max(hi, r);
    }
    std::printf("  frozen RMS %.4f, range %+.2f … %+.2f dB over 60 s\n", ref, 20.0 * std::log10(lo / ref),
                20.0 * std::log10(hi / ref));
    EXPECT(ref > 0.01);
    EXPECT(20.0 * std::log10(lo / ref) > -0.5);  // spec: ±0.5 dB over 60 s
    EXPECT(20.0 * std::log10(hi / ref) < 0.5);

    TEST("release from freeze decays again");
    p.freeze = false;
    windowRms(*f, p, 48000 * 4, clock, false);
    EXPECT(windowRms(*f, p, 4800, clock, false) < ref * 0.05);
}

static void infiniteIsBounded() {
    TEST("infinite decay with continuous noise stays bounded");
    auto f = std::make_unique<Fdn>();
    f->prepare(kSr, 8);
    FdnParams p;
    p.infinite = true;
    double peak = 0.0;
    std::vector<float> out;
    for (int n = 0; n < 48000 * 10; ++n) {
        float l, r;
        f->process(noise((uint64_t)n), noise((uint64_t)n, 9), l, r, p);
        peak = std::max(peak, (double)std::max(std::fabs(l), std::fabs(r)));
        if (!std::isfinite(l) || !std::isfinite(r)) peak = 1e9;
    }
    std::printf("  peak %.3f\n", peak);
    EXPECT(peak < 4.0);
}

static void randomModulationIsSafe() {
    TEST("random per-sample modulation of every parameter: no NaN, bounded");
    auto f = std::make_unique<Fdn>();
    f->prepare(kSr, 16);
    double peak = 0.0;
    bool finite = true;
    for (int n = 0; n < 48000 * 5; ++n) {
        const auto u = [&](uint64_t s) { return (float)uniform01(3, (uint64_t)n, s); };
        FdnParams p;
        p.size = u(1);
        p.decay = 0.1f + 30.0f * u(2);
        p.damping = u(3);
        p.bass = 0.5f + 1.5f * u(4);
        p.diffusion = u(5);
        p.modRate = 0.05f + 8.0f * u(6);
        p.modDepth = u(7);
        p.preDelaySamples = 48000.0 * u(8);
        p.freeze = u(9) < 0.01f;
        float l, r;
        f->process(noise((uint64_t)n), noise((uint64_t)n, 9), l, r, p);
        finite = finite && std::isfinite(l) && std::isfinite(r);
        peak = std::max(peak, (double)std::max(std::fabs(l), std::fabs(r)));
    }
    EXPECT(finite);
    EXPECT(peak < 50.0);
}

static void sizeSweepIsSmooth() {
    TEST("Size sweep is click-free");
    auto f = std::make_unique<Fdn>();
    f->prepare(kSr, 16);
    auto run = [&](bool sweep) {
        f->clear();
        f->restartModulation();
        FdnParams p;
        p.decay = 4.0f;
        double maxStep = 0.0;
        float prev = 0.0f;
        for (int n = 0; n < 48000 * 2; ++n) {
            if (sweep && n > 24000) p.size = std::min(1.0f, (float)(n - 24000) / 480.0f);  // 0.5 → 1 in 10 ms
            if (sweep && n > 60000) p.size = 0.5f + 0.5f * (float)std::sin(n * 0.13);   // ~1 kHz
            float l, r;
            f->process(n < 12000 ? noise((uint64_t)n) * 0.5f : 0.0f, 0.0f, l, r, p);
            if (n > 24000) maxStep = std::max(maxStep, (double)std::fabs(l - prev));
            prev = l;
        }
        return maxStep;
    };
    const double still = run(false), swept = run(true);
    std::printf("  max step: static %.4f, swept %.4f\n", still, swept);
    EXPECT(swept < 3.0 * still);
}

static void deterministic() {
    TEST("same seed, same output; mono input gives a decorrelated stereo tail");
    auto a = std::make_unique<Fdn>(), b = std::make_unique<Fdn>();
    a->prepare(kSr, 16, 1.0, 5);
    b->prepare(kSr, 16, 1.0, 5);
    FdnParams p;
    bool same = true;
    double sll = 0.0, srr = 0.0, slr = 0.0;
    for (int n = 0; n < 48000; ++n) {
        float l1, r1, l2, r2;
        const float x = n < 4800 ? noise((uint64_t)n) : 0.0f;
        a->process(x, x, l1, r1, p);
        b->process(x, x, l2, r2, p);
        same = same && l1 == l2 && r1 == r2;  // NOLINT: bit-identical on purpose
        if (n > 9600) {
            sll += (double)l1 * l1;
            srr += (double)r1 * r1;
            slr += (double)l1 * r1;
        }
    }
    EXPECT(same);
    const double corr = slr / std::sqrt(sll * srr);
    std::printf("  L/R correlation %.3f\n", corr);
    EXPECT(std::fabs(corr) < 0.5);
}

static void preDelay() {
    TEST("pre-delay delays the onset");
    auto f = std::make_unique<Fdn>();
    f->prepare(kSr, 8);
    FdnParams p;
    p.preDelaySamples = 12000.0;
    p.diffusion = 0.0f;
    int first = -1;
    for (int n = 0; n < 20000 && first < 0; ++n) {
        float l, r;
        f->process(n == 0 ? 1.0f : 0.0f, n == 0 ? 1.0f : 0.0f, l, r, p);
        if (std::fabs(l) + std::fabs(r) > 1e-6f) first = n;
    }
    // Onset = pre-delay + diffuser path + the shortest line.
    EXPECT(first > 12000 && first < 12000 + 1200);
}

static void diffuserIsAllpass() {
    TEST("diffuser keeps the energy of white noise");
    Diffuser d;
    const float ms[4] = {3.1f, 7.3f, 13.7f, 23.1f};
    d.prepare(kSr, ms, 4, 1.0f, 0.5f);
    d.setModulation(0.3f, 0.4f);
    double ein = 0.0, eout = 0.0;
    for (int n = 0; n < 48000 * 4; ++n) {
        const float x = n < 48000 * 3 ? noise((uint64_t)n) : 0.0f;
        const float y = d.process(x, 0.6f);
        ein += (double)x * x;
        eout += (double)y * y;
    }
    EXPECT_NEAR(10.0 * std::log10(eout / ein), 0.0, 0.3);
}

int main() {
    decayMatchesRt60();
    freezeHolds();
    infiniteIsBounded();
    randomModulationIsSafe();
    sizeSweepIsSmooth();
    deterministic();
    preDelay();
    diffuserIsAllpass();
    return bleep::test::finish("fdn");
}
