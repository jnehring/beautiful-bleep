// SPDX-License-Identifier: MIT
// Perc Voice: pure sine and T60, ratio tables, Damp, decay and Active per
// engine, accent, click-free retriggers and choke, audio-rate modulation,
// seeds (specs/modules/perc-voice.md §8).
#include "PercVoiceDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace bleep;
using patch::PercEngine;
using patch::PercHit;
using patch::PercParams;
using patch::PercVoiceDsp;

static constexpr double kSr = 48000.0;

struct Render {
    std::vector<float> l, r, env;
    std::vector<bool> active;
};

static Render render(PercEngine engine, const PercParams& p, int samples, float accent = 0.7f) {
    PercVoiceDsp d;
    d.prepare(kSr);
    PercHit h;
    h.engine = engine;
    h.accent = accent;
    d.strike(h, p);
    Render out;
    for (int i = 0; i < samples; ++i) {
        const auto f = d.tick(p, 0.0f);
        out.l.push_back(f.l);
        out.r.push_back(f.r);
        out.env.push_back(f.env);
        out.active.push_back(f.active);
    }
    return out;
}

static std::vector<float> slice(const std::vector<float>& x, double from, double to) {
    return std::vector<float>(x.begin() + (long)(from * kSr), x.begin() + (long)(to * kSr));
}

static void pureSine() {
    TEST("tone 0: a pure sine with the set T60");
    PercParams p;
    p.tone = 0.0f;
    p.sweep = 0.0f;
    p.click = 0.0f;
    p.pitchHz = 220.0f;
    p.decay = 1.0f;
    p.spread = 0.0f;
    p.level = 1.0f;
    const auto y = render(PercEngine::Modal, p, (int)(1.2 * kSr)).l;
    const auto a = slice(y, 0.1, 0.2), b = slice(y, 0.6, 0.7);
    const double f0 = test::magnitudeAt(a, 220.0, kSr);
    double harm = 0.0;
    for (int k = 2; k <= 6; ++k) harm += std::pow(test::magnitudeAt(a, 220.0 * k, kSr), 2.0);
    const double thd = 10.0 * std::log10(harm / (f0 * f0) + 1e-30);
    const double t60 = 0.5 * 60.0 / (20.0 * std::log10(test::rms(a) / test::rms(b)));
    std::printf("  THD %.1f dB, T60 %.3f s, zero-crossing %.2f Hz\n", thd, t60, test::zeroCrossingHz(a, kSr));
    EXPECT(thd < -60.0);
    EXPECT_NEAR(t60, 1.0, 0.1);
    EXPECT_NEAR(test::zeroCrossingHz(a, kSr), 220.0, 0.5);
}

static void ratioTables() {
    TEST("ratio tables");
    for (float tone : {1.0f / 3.0f, 2.0f / 3.0f}) {
        PercParams p;
        p.tone = tone;
        p.sweep = 0.0f;
        p.click = 0.0f;
        p.pitchHz = 110.0f;
        p.decay = 2.0f;
        p.damp = 0.0f;
        p.morph = 1.0f;
        p.spread = 0.0f;
        const float* table = tone < 0.5f ? patch::perc::kMembrane : patch::perc::kBar;
        const auto y = slice(render(PercEngine::Modal, p, (int)(0.6 * kSr)).l, 0.05, 0.55);
        for (int k = 1; k < 5; ++k) {
            const double hz = 110.0 * table[k];
            const double on = test::magnitudeAt(y, hz, kSr);
            const double off = std::max(test::magnitudeAt(y, hz * 1.03, kSr), test::magnitudeAt(y, hz * 0.97, kSr));
            EXPECT(on > 2.0 * off);
        }
    }
}

static void damp() {
    TEST("damp shortens the upper partials");
    PercParams p;
    p.tone = 1.0f / 3.0f;
    p.sweep = 0.0f;
    p.click = 0.0f;
    p.pitchHz = 200.0f;
    p.decay = 1.0f;
    p.damp = 1.0f;
    p.morph = 1.0f;
    const auto y = render(PercEngine::Modal, p, (int)kSr).l;
    const double hz2 = 200.0 * patch::perc::kMembrane[1];
    const double a = test::magnitudeAt(slice(y, 0.02, 0.07), hz2, kSr);
    const double b = test::magnitudeAt(slice(y, 0.12, 0.17), hz2, kSr);
    const double t60 = 0.1 * 60.0 / (20.0 * std::log10(a / b));
    const double expected = 1.0 * std::pow(1.0 / patch::perc::kMembrane[1], 3.0);
    std::printf("  partial 2: T60 %.3f s (formula %.3f s)\n", t60, expected);
    EXPECT_NEAR(t60 / expected, 1.0, 0.15);
}

static void enginesDecay() {
    TEST("engines: sound, decay and Active");
    for (PercEngine e : {PercEngine::FM, PercEngine::Modal, PercEngine::Noise}) {
        PercParams p;  // defaults: Decay 400 ms
        const auto out = render(e, p, (int)(2.0 * kSr));
        double peak = 0.0;
        for (float v : out.l) peak = std::max(peak, (double)std::fabs(v));
        int quiet = -1, inactive = -1;
        for (size_t i = 0; i < out.l.size(); ++i) {
            if (std::fabs(out.l[i]) > 1e-4f || std::fabs(out.r[i]) > 1e-4f) quiet = (int)i + 1;
            if (out.active[i]) inactive = (int)i + 1;
        }
        std::printf("  engine %d: peak %.2f, rms(50 ms) %.3f, below -80 dB after %.0f ms, Active fell at %.0f ms\n",
                    (int)e, peak, test::rms(slice(out.l, 0.0, 0.05)), quiet * 1000.0 / kSr, inactive * 1000.0 / kSr);
        EXPECT(test::allFinite(out.l) && test::allFinite(out.r));
        EXPECT(peak > 0.1 && peak <= 1.0);
        EXPECT(quiet < (int)(1.4 * 0.4 * kSr));
        EXPECT(inactive >= quiet && inactive < (int)(1.4 * 0.4 * kSr) + 480);
    }
}

static double centroid(const std::vector<float>& y) {
    double num = 0.0, den = 0.0;
    for (double hz = 50.0; hz < 12000.0; hz *= 1.06) {
        const double m = test::magnitudeAt(y, hz, kSr);
        num += hz * m;
        den += m;
    }
    return num / std::max(den, 1e-30);
}

static void accent() {
    TEST("accent: louder and brighter");
    for (PercEngine e : {PercEngine::FM, PercEngine::Modal, PercEngine::Noise}) {
        PercParams p;
        p.pitchHz = 150.0f;
        const auto soft = slice(render(e, p, 4800, 0.0f).l, 0.0, 0.05);
        const auto hard = slice(render(e, p, 4800, 1.0f).l, 0.0, 0.05);
        std::printf("  engine %d: rms %.3f → %.3f, centroid %.0f → %.0f Hz\n", (int)e, test::rms(soft),
                    test::rms(hard), centroid(soft), centroid(hard));
        EXPECT(test::rms(hard) > 1.5 * test::rms(soft));
        EXPECT(centroid(hard) > centroid(soft));
    }
}

static void retriggerAndChoke() {
    TEST("retriggers don't click; choke fades in 5 ms");
    for (PercEngine e : {PercEngine::FM, PercEngine::Modal, PercEngine::Noise}) {
        PercParams p;
        p.click = 0.0f;  // the click is a deliberate transient
        p.sweep = 0.0f;
        PercVoiceDsp d;
        d.prepare(kSr);
        PercHit h;
        h.engine = e;
        float prev = 0.0f, maxStep = 0.0f, peak = 0.0f;
        for (int i = 0; i < (int)kSr; ++i) {
            if (i % 480 == 0) d.strike(h, p);
            const float y = d.tick(p, 0.0f).l;
            maxStep = std::max(maxStep, std::fabs(y - prev));
            peak = std::max(peak, std::fabs(y));
            prev = y;
        }
        // A 55 Hz body can't move more than a small share of its peak per
        // sample; a click would jump by about the peak.
        std::printf("  engine %d: max step %.4f (peak %.3f)\n", (int)e, maxStep, peak);
        EXPECT(test::allFinite({prev}));
        EXPECT(maxStep < (e == PercEngine::Noise ? 0.5f : 0.08f) * std::max(peak, 1e-3f));
    }
    PercParams p;
    p.decay = 4.0f;
    PercVoiceDsp d;
    d.prepare(kSr);
    d.strike(PercHit(), p);
    for (int i = 0; i < 4800; ++i) d.tick(p, 0.0f);
    d.choke();
    int silentAt = -1;
    for (int i = 0; i < 4800; ++i) {
        const auto f = d.tick(p, 0.0f);
        if (!f.active && silentAt < 0) silentAt = i;
    }
    std::printf("  choke: silent after %.2f ms\n", silentAt * 1000.0 / kSr);
    EXPECT_NEAR(silentAt * 1000.0 / kSr, 5.0, 1.0);
}

static void audioRateModulation() {
    TEST("audio-rate modulation stays bounded");
    for (PercEngine e : {PercEngine::FM, PercEngine::Modal, PercEngine::Noise}) {
        PercParams p;
        p.decay = 8.0f;
        PercVoiceDsp d;
        d.prepare(kSr);
        PercHit h;
        h.engine = e;
        d.strike(h, p);
        float peak = 0.0f;
        bool finite = true;
        for (int i = 0; i < 48000; ++i) {
            const float m = (float)std::sin(2.0 * M_PI * 220.0 * i / kSr);
            p.pitchHz = 55.0f * std::exp2(3.0f + 3.0f * m);
            p.tone = 0.5f + 0.5f * m;
            if (i % 4800 == 0) d.strike(h, p);
            const auto f = d.tick(p, 2.0f * m);
            finite = finite && std::isfinite(f.l) && std::isfinite(f.r);
            peak = std::max(peak, std::max(std::fabs(f.l), std::fabs(f.r)));
        }
        EXPECT(finite);
        EXPECT(peak <= 1.0f);
    }
}

static void seeds() {
    TEST("seeds repeat");
    PercParams p;
    p.tone = 1.0f;
    auto run = [&](PercEngine e, uint64_t seed) {
        PercParams q = p;
        q.seed = seed;
        return render(e, q, 9600).l;
    };
    EXPECT(run(PercEngine::Noise, 3) == run(PercEngine::Noise, 3));
    EXPECT(run(PercEngine::Noise, 3) != run(PercEngine::Noise, 4));
    EXPECT(run(PercEngine::Modal, 3) == run(PercEngine::Modal, 3));
    EXPECT(run(PercEngine::Modal, 3) != run(PercEngine::Modal, 4));
    float a[8], b[8];
    patch::perc::metalRatios(7, a);
    patch::perc::metalRatios(7, b);
    for (int k = 0; k < 8; ++k) EXPECT(a[k] == b[k]);
    for (int k = 1; k < 8; ++k) EXPECT(a[k] >= 1.3f && a[k] <= 9.0f && a[k] >= a[k - 1]);
}

int main() {
    pureSine();
    ratioTables();
    damp();
    enginesDecay();
    accent();
    retriggerAndChoke();
    audioRateModulation();
    seeds();
    return test::finish("perc-voice");
}
