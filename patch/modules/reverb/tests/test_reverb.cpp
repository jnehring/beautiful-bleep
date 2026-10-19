// SPDX-License-Identifier: GPL-3.0-or-later
#include "ReverbDsp.h"
#include "dsp/Delay.h"
#include "dsp/Svf.h"
#include "dsp/tests/TestUtil.h"

#include <random>
#include <vector>

using namespace bleep::patch;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

/// The Decay knob for a T60 in seconds (below 60 s).
static float decayKnob(double seconds) {
    return (float)(ReverbDsp::kLimitFrom * std::log(seconds / ReverbDsp::kMinT60) /
                   std::log(ReverbDsp::kMaxT60 / ReverbDsp::kMinT60));
}

static ReverbParams wetOnly() {
    ReverbParams p;
    p.mix = 1.0f;
    p.preDelaySamples = 0.0;
    return p;
}

/// Mono wet output ((L + R) / 2) for an impulse, `seconds` long.
static std::vector<float> impulseResponse(const ReverbParams& p, double seconds, uint64_t seed = 1) {
    ReverbDsp d;
    d.prepare(kSr, 16, seed);
    ReverbFrame f;
    std::vector<float> y;
    for (int i = 0; i < (int)(seconds * kSr); ++i) {
        f.in[0] = f.in[1] = i == 0 ? 1.0f : 0.0f;
        d.tick(p, f);
        y.push_back(0.5f * (f.wet[0] + f.wet[1]));
    }
    return y;
}

/// T60 from the Schroeder energy decay curve between −5 and −35 dB.
static double measureT60(const std::vector<float>& x) {
    std::vector<double> edc(x.size() + 1, 0.0);
    for (size_t i = x.size(); i-- > 0;) edc[i] = edc[i + 1] + (double)x[i] * x[i];
    double t5 = -1.0, t35 = -1.0;
    for (size_t i = 0; i < x.size(); ++i) {
        const double db = 10.0 * std::log10(std::max(edc[i] / edc[0], 1e-30));
        if (t5 < 0.0 && db <= -5.0) t5 = (double)i / kSr;
        if (t35 < 0.0 && db <= -35.0) {
            t35 = (double)i / kSr;
            break;
        }
    }
    return t5 < 0.0 || t35 < 0.0 ? -1.0 : 2.0 * (t35 - t5);
}

static void decayTime() {
    TEST("impulse response: T60 follows Decay; Damping shortens the highs");
    ReverbParams p = wetOnly();
    p.decay = decayKnob(2.0);
    p.damping = 0.0f;
    p.bass = 1.0f;
    const auto y = impulseResponse(p, 3.0);
    const double t60 = measureT60(y);
    std::printf("  T60 2 s: measured %.3f s\n", t60);
    EXPECT_NEAR(t60, 2.0, 0.2);
    // Damping 100 %: above 5 kHz, at least 5× faster.
    p.damping = 1.0f;
    auto z = impulseResponse(p, 3.0);
    bleep::dsp::Svf hp;
    hp.set(5000.0f, 0.7071f, kSr);
    std::vector<float> high;
    for (float v : z) high.push_back(hp.process(v).hp);
    const double hiT60 = measureT60(high);
    std::printf("  > 5 kHz with Damping 100 %%: T60 %.3f s\n", hiT60);
    EXPECT(hiT60 > 0.0 && hiT60 < 0.4);
}

static double rmsRange(const std::vector<float>& y, double from, double to) {
    return bleep::test::rms(std::vector<float>(y.begin() + (long)(from * kSr), y.begin() + (long)(to * kSr)));
}

static void lossless() {
    TEST("Decay ∞ and Freeze hold a burst for 60 s (±0.5 dB)");
    for (int mode : {0, 1}) {
        ReverbParams p = wetOnly();
        p.decay = mode == 0 ? 1.0f : decayKnob(2.0);
        ReverbDsp d;
        d.prepare(kSr);
        ReverbFrame f;
        std::mt19937 rng(11);
        std::uniform_real_distribution<float> noise(-0.3f, 0.3f);
        bleep::dsp::Svf lp[2];  // program-like material: noise low-passed at 6 kHz
        for (auto& l : lp) l.set(6000.0f, 0.7071f, kSr);
        std::vector<float> y;
        for (int i = 0; i < (int)(62.0 * kSr); ++i) {
            const bool burst = i < (int)(0.2 * kSr);
            p.freeze = mode == 1 && i >= (int)(0.3 * kSr);
            f.in[0] = lp[0].process(burst ? noise(rng) : 0.0f).lp;
            f.in[1] = lp[1].process(burst ? noise(rng) : 0.0f).lp;
            d.tick(p, f);
            y.push_back(f.wet[0]);
        }
        const double early = rmsRange(y, 2.0, 4.0), late = rmsRange(y, 58.0, 60.0);
        const double change = 20.0 * std::log10(late / early);
        std::printf("  %s: %+.2f dB over 56 s\n", mode ? "freeze" : "infinite", change);
        EXPECT(std::fabs(change) <= 0.5);
    }
}

static void limiterBounds() {
    TEST("Decay ∞ with continuous full-scale noise stays bounded");
    ReverbParams p = wetOnly();
    p.decay = 1.0f;
    ReverbDsp d;
    d.prepare(kSr);
    ReverbFrame f;
    std::mt19937 rng(5);
    std::uniform_real_distribution<float> noise(-1.0f, 1.0f);
    float peak = 0.0f;
    bool finite = true;
    for (int i = 0; i < (int)(20.0 * kSr); ++i) {
        f.in[0] = noise(rng);
        f.in[1] = noise(rng);
        d.tick(p, f);
        peak = std::max({peak, std::fabs(f.wet[0]), std::fabs(f.wet[1])});
        finite = finite && std::isfinite(f.wet[0]) && std::isfinite(f.wet[1]);
    }
    std::printf("  peak %.3f\n", peak);
    EXPECT(finite);
    EXPECT(peak < 2.0f);
}

/// Max sample-to-sample step of the wet output over a tail, with a parameter
/// driven by `mod(i)` (or not), after a 0.5 s noise burst.
template <class F>
static float maxStep(F mod, float* peakOut = nullptr) {
    ReverbParams p = wetOnly();
    p.decay = decayKnob(4.0);
    ReverbDsp d;
    d.prepare(kSr);
    ReverbFrame f;
    std::mt19937 rng(9);
    std::uniform_real_distribution<float> noise(-0.5f, 0.5f);
    float step = 0.0f, last = 0.0f, peak = 0.0f;
    for (int i = 0; i < (int)(3.0 * kSr); ++i) {
        const bool burst = i < (int)(0.5 * kSr);
        // Low-passed noise so the unmodulated tail has moderate slopes.
        f.in[0] = f.in[1] = burst ? noise(rng) * 0.2f + 0.8f * f.in[0] : 0.0f;
        if (i > (int)(0.6 * kSr)) mod(p, i);
        d.tick(p, f);
        if (i > (int)(0.6 * kSr)) {
            step = std::max(step, std::fabs(f.wet[0] - last));
            peak = std::max(peak, std::fabs(f.wet[0]));
        }
        last = f.wet[0];
    }
    if (peakOut) *peakOut = peak;
    return step;
}

static void clickFreeModulation() {
    TEST("Size, Decay and Pre-delay modulate without clicks");
    const float base = maxStep([](ReverbParams&, int) {});
    float peak = 0.0f;
    const auto check = [&](const char* what, float step) {
        if (step > 3.0f * base || peak > 2.0f) std::printf("  %s: step %.4f (unmodulated %.4f), peak %.3f\n", what, step, base, peak);
        EXPECT(step <= 3.0f * base);
        EXPECT(peak <= 2.0f);
    };
    // Size: a 10 ms sweep 0 → 100 %, then 1 kHz at full depth.
    check("size", maxStep([](ReverbParams& p, int i) {
        const int t = i - (int)(0.6 * kSr);
        p.size = t < 480 ? (float)t / 480.0f : 0.5f + 0.5f * (float)std::sin(2.0 * kPi * 1000.0 * i / kSr);
    }, &peak));
    check("decay", maxStep([](ReverbParams& p, int i) {
        p.decay = 0.5f + 0.45f * (float)std::sin(2.0 * kPi * 1000.0 * i / kSr);
    }, &peak));
    check("pre-delay", maxStep([](ReverbParams& p, int i) {
        p.preDelaySamples = 0.25 * kSr * (1.0 + std::sin(2.0 * kPi * 1000.0 * i / kSr));
    }, &peak));
}

static void freeze() {
    TEST("Freeze on/off is smooth, holds the tail and leaves the dry path alone");
    const float base = maxStep([](ReverbParams&, int) {});
    const float toggled = maxStep([](ReverbParams& p, int i) { p.freeze = (i / 24000) % 2 == 0; });
    EXPECT(toggled <= 1.5f * base);
    // Dry path untouched: mix 0 gives the input exactly.
    ReverbParams p;
    p.mix = 0.0f;
    p.freeze = true;
    ReverbDsp d;
    d.prepare(kSr);
    ReverbFrame f;
    float err = 0.0f;
    for (int i = 0; i < 4800; ++i) {
        f.in[0] = f.in[1] = (float)std::sin(i * 0.05);
        d.tick(p, f);
        err = std::max(err, std::fabs(f.out[0] - f.in[0]));
    }
    EXPECT(err < 1e-6f);
}

static std::vector<float> renderAfter(int prior, bool clearOnPlay) {
    ReverbDsp d;
    d.prepare(kSr);
    ReverbParams p;
    ReverbFrame f;
    std::mt19937 rng((unsigned)prior);
    std::uniform_real_distribution<float> noise(-0.5f, 0.5f);
    for (int i = 0; i < 24000; ++i) {  // different material before the "transport start"
        f.in[0] = noise(rng);
        f.in[1] = noise(rng);
        d.tick(p, f);
    }
    if (clearOnPlay) d.clearNow();
    else d.restartModulation();
    std::vector<float> y;
    for (int i = 0; i < 48000; ++i) {
        f.in[0] = f.in[1] = i < 4800 ? (float)std::sin(i * 0.03) : 0.0f;
        d.tick(p, f);
        y.push_back(f.out[0]);
        y.push_back(f.out[1]);
    }
    return y;
}

static void clearOnPlay() {
    TEST("Clear on Play: renders after different prior input are bit-identical");
    EXPECT(renderAfter(1, true) == renderAfter(2, true));
    EXPECT(renderAfter(1, false) != renderAfter(2, false));
}

static void seeds() {
    TEST("same seed, same output; different seeds, different modulation");
    ReverbParams p = wetOnly();
    p.modDepth = 1.0f;
    EXPECT(impulseResponse(p, 1.0, 7) == impulseResponse(p, 1.0, 7));
    EXPECT(impulseResponse(p, 1.0, 7) != impulseResponse(p, 1.0, 8));
}

static void monoWidth() {
    TEST("a mono input gives a decorrelated tail at Width 100 %, mono at 0 %");
    for (float width : {1.0f, 0.0f}) {
        ReverbParams p = wetOnly();
        p.width = width;
        ReverbDsp d;
        d.prepare(kSr);
        ReverbFrame f;
        std::mt19937 rng(3);
        std::uniform_real_distribution<float> noise(-0.5f, 0.5f);
        double lr = 0, ll = 0, rr = 0, maxDiff = 0;
        for (int i = 0; i < 96000; ++i) {
            f.in[0] = f.in[1] = i < 24000 ? noise(rng) : 0.0f;
            d.tick(p, f);
            if (i < 4800) continue;
            lr += (double)f.wet[0] * f.wet[1];
            ll += (double)f.wet[0] * f.wet[0];
            rr += (double)f.wet[1] * f.wet[1];
            maxDiff = std::max(maxDiff, (double)std::fabs(f.wet[0] - f.wet[1]));
        }
        const double corr = lr / std::sqrt(ll * rr);
        if (width > 0.5f) EXPECT(std::fabs(corr) < 0.5);
        else EXPECT(maxDiff < 1e-6);
    }
}

static void preDelaySync() {
    TEST("Pre-delay sync: 1/8 at 120 BPM is 250 ms");
    const int index = bleep::dsp::noteValueIndex("1/8");
    EXPECT(index >= 0);
    EXPECT_NEAR(bleep::dsp::noteValueSamples(index, 120.0, kSr), 0.25 * kSr, 1.0);
    // And the tail really starts that late.
    ReverbParams p = wetOnly();
    p.preDelaySamples = 0.25 * kSr;
    const auto y = impulseResponse(p, 0.5);
    float before = 0.0f;
    for (int i = 0; i < (int)(0.25 * kSr); ++i) before = std::max(before, std::fabs(y[(size_t)i]));
    EXPECT(before < 1e-6f);
    EXPECT(rmsRange(y, 0.26, 0.4) > 1e-4);
}

static void decayMapping() {
    TEST("Decay knob: 0.1 s … 60 s, then towards ∞");
    EXPECT_NEAR(ReverbDsp::t60(0.0f), 0.1, 1e-6);
    EXPECT_NEAR(ReverbDsp::t60(ReverbDsp::kLimitFrom), 60.0, 1e-3);
    EXPECT(ReverbDsp::t60(0.95f) > 200.0);
    EXPECT(std::isinf(ReverbDsp::t60(0.97f)));
    EXPECT_NEAR(ReverbDsp::t60(decayKnob(2.5)), 2.5, 1e-4);
}

/// A spring-type ReverbDsp, ready to run.
static void prepareSpring(ReverbDsp& d) {
    d.setType(ReverbDsp::Spring);
    d.prepare(kSr);
}

static std::vector<float> springImpulse(const ReverbParams& p, double seconds, float amplitude = 0.05f) {
    ReverbDsp d;
    prepareSpring(d);
    ReverbFrame f;
    std::vector<float> y;
    for (int i = 0; i < (int)(seconds * kSr); ++i) {
        f.in[0] = f.in[1] = i == 0 ? amplitude : 0.0f;
        d.tick(p, f);
        y.push_back(0.5f * (f.wet[0] + f.wet[1]));
    }
    return y;
}

/// Energy-weighted mean arrival time (seconds) of the first `seconds`.
static double centroid(const std::vector<float>& x, double seconds) {
    double e = 0.0, te = 0.0;
    for (size_t i = 0; i < x.size() && i < (size_t)(seconds * kSr); ++i) {
        const double v = (double)x[i] * x[i];
        e += v;
        te += v * (double)i / kSr;
    }
    return e > 0.0 ? te / e : 0.0;
}

static void springTail() {
    TEST("Spring: the tail decays with Decay and is finite and silent at the start");
    ReverbParams p = wetOnly();
    p.type = ReverbDsp::Spring;
    p.decay = decayKnob(2.0);
    p.damping = 0.0f;
    p.diffusion = 0.7f;
    p.modDepth = 0.0f;
    const auto y = springImpulse(p, 4.0);
    EXPECT(std::fabs(y[0]) < 1e-3f);
    const double t60 = measureT60(y);
    std::printf("  spring T60 2 s: measured %.3f s\n", t60);
    EXPECT(t60 > 1.2 && t60 < 3.2);
    EXPECT(rmsRange(y, 0.1, 0.5) > 1e-4);
    // Damping darkens the tail.
    p.damping = 1.0f;
    const auto z = springImpulse(p, 4.0);
    bleep::dsp::Svf hp;
    hp.set(3000.0f, 0.7071f, kSr);
    std::vector<float> hy, hz;
    bleep::dsp::Svf hp2 = hp;
    for (size_t i = 0; i < y.size(); ++i) {
        hy.push_back(hp.process(y[i]).hp);
        hz.push_back(hp2.process(z[i]).hp);
    }
    EXPECT(rmsRange(hz, 0.3, 1.5) < 0.3 * rmsRange(hy, 0.3, 1.5));
}

static void springDispersion() {
    TEST("Spring: Diffusion disperses; the lows arrive after the highs (a falling chirp)");
    ReverbParams p = wetOnly();
    p.type = ReverbDsp::Spring;
    p.decay = decayKnob(3.0);
    p.damping = 0.1f;
    p.modDepth = 0.0f;
    p.size = 0.4f;
    double gap[2];
    int k = 0;
    for (float diffusion : {0.0f, 1.0f}) {
        p.diffusion = diffusion;
        const auto y = springImpulse(p, 1.5);
        bleep::dsp::Svf lo, hi;
        lo.set(350.0f, 0.7071f, kSr);
        hi.set(3500.0f, 0.7071f, kSr);
        std::vector<float> low, high;
        for (float v : y) {
            low.push_back(lo.process(v).lp);
            high.push_back(hi.process(v).hp);
        }
        gap[k++] = centroid(low, 1.2) - centroid(high, 1.2);
    }
    std::printf("  low - high arrival: %.1f ms undispersed, %.1f ms dispersed\n", 1000 * gap[0], 1000 * gap[1]);
    EXPECT(gap[1] > gap[0] + 0.015);
}

static void springStability() {
    TEST("Spring: stays bounded and alive at infinite decay, full modulation and loud input; Freeze holds");
    for (int mode : {0, 1}) {
        ReverbParams p = wetOnly();
        p.type = ReverbDsp::Spring;
        p.decay = mode == 0 ? 1.0f : decayKnob(2.0);
        p.modDepth = 1.0f;
        p.modRate = 8.0f;
        p.size = 1.0f;
        ReverbDsp d;
        prepareSpring(d);
        ReverbFrame f;
        std::mt19937 rng(5);
        std::uniform_real_distribution<float> noise(-1.0f, 1.0f);
        std::vector<float> y;
        float peak = 0.0f;
        for (int i = 0; i < (int)(20.0 * kSr); ++i) {
            const bool burst = i < (int)(0.3 * kSr);
            p.freeze = mode == 1 && i >= (int)(0.5 * kSr);
            f.in[0] = burst ? noise(rng) : 0.0f;
            f.in[1] = burst ? noise(rng) : 0.0f;
            d.tick(p, f);
            peak = std::max({peak, std::fabs(f.wet[0]), std::fabs(f.wet[1])});
            y.push_back(f.wet[0]);
            if (!std::isfinite(f.wet[0]) || !std::isfinite(f.wet[1])) break;
        }
        EXPECT(std::isfinite(peak) && peak < 4.0f);
        EXPECT(rmsRange(y, 18.0, 20.0) > 0.02 * rmsRange(y, 1.0, 3.0));
    }
}

static void springSwitch() {
    TEST("Type: Hall is the default, switching is click-free and Clear on Play is repeatable for Spring");
    EXPECT(ReverbParams{}.type == ReverbDsp::Hall);
    // Switch Hall -> Spring -> Hall while a tone runs: no step beyond the tone's own.
    ReverbDsp d;
    d.prepare(kSr);
    ReverbParams p;
    p.mix = 1.0f;
    ReverbFrame f;
    float last = 0.0f, maxStep = 0.0f;
    for (int i = 0; i < 96000; ++i) {
        d.setType((i / 24000) % 2 ? ReverbDsp::Spring : ReverbDsp::Hall);
        f.in[0] = f.in[1] = 0.4f * (float)std::sin(i * 0.05);
        d.tick(p, f);
        if (i > 100) maxStep = std::max(maxStep, std::fabs(f.out[0] - last));
        last = f.out[0];
        EXPECT(std::isfinite(f.out[0]));
    }
    EXPECT(maxStep < 0.35f);
    auto render = [](int prior) {
        ReverbDsp r;
        prepareSpring(r);
        ReverbParams q;
        ReverbFrame g;
        std::mt19937 rng((unsigned)prior);
        std::uniform_real_distribution<float> noise(-0.5f, 0.5f);
        for (int i = 0; i < 24000; ++i) {
            g.in[0] = noise(rng);
            g.in[1] = noise(rng);
            q.type = ReverbDsp::Spring;
            r.tick(q, g);
        }
        r.clearNow();
        std::vector<float> y;
        for (int i = 0; i < 48000; ++i) {
            g.in[0] = g.in[1] = i < 4800 ? (float)std::sin(i * 0.03) : 0.0f;
            r.tick(q, g);
            y.push_back(g.out[0]);
        }
        return y;
    };
    EXPECT(render(1) == render(2));
}

int main() {
    decayMapping();
    decayTime();
    lossless();
    limiterBounds();
    clickFreeModulation();
    freeze();
    clearOnPlay();
    seeds();
    monoWidth();
    preDelaySync();
    springTail();
    springDispersion();
    springStability();
    springSwitch();
    return bleep::test::finish("reverb");
}
