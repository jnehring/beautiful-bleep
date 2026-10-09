// SPDX-License-Identifier: MIT
// Modal Voice: strike tuning, bowed and blown bodies, strikes adding up and
// repeating, velocity, Active and sleep, stability, the dry path at Space 0
// (doc/specs/modules/modal-voice.md §8).
#include "ModalVoiceDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace bleep;
using patch::ModalVoiceDsp;
using patch::ModalVoiceParams;

static double cents(double hz, double ref) { return 1200.0 * std::log2(hz / ref); }

struct Rig {
    ModalVoiceDsp d;
    ModalVoiceParams p;
    float pitch = 0.0f;
    double sr;
    int phase = 0;
    explicit Rig(const ModalVoiceParams& params, double sampleRate = 48000.0) : p(params), sr(sampleRate) {
        d.prepare(sampleRate);
        d.set(p, pitch);
    }
    ModalVoiceDsp::Frame tick(float ext = 0.0f) {
        if (phase == 0) d.set(p, pitch);
        phase = (phase + 1) % ModalVoiceDsp::kSub;
        return d.tick(ext);
    }
    std::vector<float> run(int n, bool right = false) {
        std::vector<float> y;
        for (int i = 0; i < n; ++i) {
            const auto f = tick();
            y.push_back(right ? f.r : f.l);
        }
        return y;
    }
};

static double peakHz(const std::vector<float>& y, double ref, double sr) {
    double lo = ref * std::exp2(-30.0 / 1200.0), hi = ref * std::exp2(30.0 / 1200.0);
    for (int it = 0; it < 60; ++it) {
        const double a = lo + (hi - lo) * 0.382, b = lo + (hi - lo) * 0.618;
        if (test::magnitudeAt(y, a, sr) > test::magnitudeAt(y, b, sr)) hi = b;
        else lo = a;
    }
    return 0.5 * (lo + hi);
}

static void strikeTuning() {
    TEST("strike tuning");
    for (float oct : {-2.0f, 0.0f, 2.0f}) {
        ModalVoiceParams p;
        p.geometry = 0.0f;
        p.damping = 0.2f;
        p.space = 0.0f;
        Rig r(p);
        r.pitch = oct;
        r.d.set(r.p, oct);
        r.d.strike(1.0f);
        r.run(2400);
        const auto y = r.run(48000);
        const double f0 = 261.6255653 * std::exp2(oct);
        const double c = cents(peakHz(y, f0, 48000.0), f0);
        std::printf("  %.0f Hz: %.2f cents\n", f0, c);
        EXPECT_NEAR(c, 0.0, 2.0);
    }
}

static void bowed() {
    TEST("bow");
    ModalVoiceParams p;
    p.strike = 0.0f;
    p.bow = 0.8f;
    p.damping = 0.5f;
    p.space = 0.0f;
    p.geometry = 0.0f;
    Rig r(p);
    r.d.gate(true, 1.0f);
    r.run((int)(0.3 * 48000));
    const auto y = r.run(9600);
    const double hz = peakHz(y, 261.6255653, 48000.0);
    std::printf("  bowed: rms %.3f at %.2f cents (zero crossings %.1f Hz)\n", test::rms(y), cents(hz, 261.6255653),
                test::zeroCrossingHz(y, 48000.0));
    EXPECT(test::rms(y) > 0.05);
    EXPECT_NEAR(cents(hz, 261.6255653), 0.0, 5.0);
    // Steady: the level in two halves of the window agrees.
    const double a = test::rms(std::vector<float>(y.begin(), y.begin() + 4800));
    const double b = test::rms(std::vector<float>(y.begin() + 4800, y.end()));
    EXPECT_NEAR(a / b, 1.0, 0.1);
    // Release: it stops.
    r.d.gate(false, 0.0f);
    const auto tail = r.run(4 * 48000);
    EXPECT(test::rms(std::vector<float>(tail.end() - 4800, tail.end())) < 0.001 * test::rms(y));
}

static void blown() {
    TEST("blow");
    auto run = [](float timbre, bool gate) {
        ModalVoiceParams p;
        p.strike = 0.0f;
        p.blow = 0.8f;
        p.blowTimbre = timbre;
        p.space = 0.0f;
        p.geometry = 0.0f;
        p.damping = 0.6f;
        Rig r(p);
        r.d.gate(gate, 1.0f);
        r.run(24000);
        return r.run(24000);
    };
    const auto off = run(1.0f, false);
    EXPECT(test::rms(off) == 0.0);
    const auto breathy = run(0.4f, true), singing = run(1.0f, true);
    const double hz = peakHz(singing, 261.6255653, 48000.0);
    const double tonal = test::magnitudeAt(singing, 261.6255653, 48000.0);
    const double tonalBreathy = test::magnitudeAt(breathy, 261.6255653, 48000.0);
    std::printf("  breathy rms %.3f (f0 %.4f), singing rms %.3f (f0 %.4f) at %.1f cents\n", test::rms(breathy),
                tonalBreathy, test::rms(singing), tonal, cents(hz, 261.6255653));
    EXPECT(tonal > 3.0 * tonalBreathy);
    EXPECT(test::rms(singing) < 1.0);
}

static void strikes() {
    TEST("strikes add up and repeat");
    ModalVoiceParams p;
    p.space = 0.0f;
    p.damping = 0.2f;
    Rig r(p);
    r.d.strike(1.0f);
    const auto one = r.run(4800);
    r.d.strike(1.0f);
    const auto two = r.run(4800);
    float peak1 = 0.0f;
    for (float v : one) peak1 = std::max(peak1, std::fabs(v));
    std::printf("  default strike peak %.3f\n", peak1);
    EXPECT(peak1 > 0.2f && peak1 < 1.0f);
    EXPECT(test::rms(two) > test::rms(std::vector<float>(one.end() - 2400, one.end())));
    // Scrape strikes repeat for the same seed and strike count.
    auto scrape = [](uint64_t seed) {
        ModalVoiceParams q;
        q.strikeTimbre = 0.9f;
        q.seed = seed;
        Rig s(q);
        s.d.strike(1.0f);
        return s.run(4800);
    };
    EXPECT(scrape(4) == scrape(4));
    EXPECT(scrape(4) != scrape(5));
}

static void velocity() {
    TEST("velocity scales the exciters");
    auto level = [](float vel, bool bow) {
        ModalVoiceParams p;
        p.space = 0.0f;
        if (bow) p.strike = 0.0f, p.bow = 0.8f;
        Rig r(p);
        if (bow) r.d.gate(true, vel);
        else r.d.strike(vel);
        return test::rms(r.run(14400));
    };
    EXPECT(level(0.3f, false) < 0.5 * level(1.0f, false));
    EXPECT(level(0.3f, true) < 0.7 * level(1.0f, true));
}

static void active() {
    TEST("active");
    ModalVoiceParams p;
    p.damping = 0.6f;
    Rig r(p);
    EXPECT(!r.tick().active);
    r.d.gate(true, 1.0f);
    for (int i = 0; i < 4800; ++i) EXPECT(r.tick().active);
    r.d.gate(false, 0.0f);
    r.d.strike(1.0f);
    int lastLoud = -1, fell = -1;
    for (int i = 0; i < 20 * 48000; ++i) {
        const auto f = r.tick();
        if (std::fabs(f.l) > 1e-4f || std::fabs(f.r) > 1e-4f) lastLoud = i;
        if (!f.active) {
            fell = i;
            break;
        }
    }
    std::printf("  Active fell %.1f ms after the output went below -80 dB (space tail included)\n",
                (fell - lastLoud) * 1000.0 / 48000.0);
    EXPECT(fell > 0 && fell - lastLoud <= (int)(0.06 * 48000));
    r.run(4800);
    EXPECT(r.d.sleeping());
}

static void stability() {
    TEST("stability");
    ModalVoiceParams p;
    p.bow = p.blow = p.strike = 1.0f;
    p.bowTimbre = p.blowTimbre = 1.0f;
    p.damping = 0.0f;
    p.space = 0.0f;
    p.contour = 1.0f;
    for (float geometry : {0.0f, 0.5f, 1.0f}) {
        p.geometry = geometry;
        Rig r(p);
        r.d.gate(true, 1.0f);
        float peak = 0.0f;
        bool finite = true;
        for (int i = 0; i < 10 * 48000; ++i) {
            if (i % 4800 == 0) r.d.strike(1.0f);
            const auto f = r.tick();
            finite = finite && std::isfinite(f.l) && std::isfinite(f.r) && std::isfinite(f.exciter);
            peak = std::max(peak, std::max(std::fabs(f.l), std::fabs(f.r)));
        }
        EXPECT(finite);
        EXPECT(peak <= 1.0f);
    }
}

static void dryAtSpaceZero() {
    TEST("space 0 % is the dry body");
    // The room adds nothing at 0 %: two renders that differ only in Size match.
    ModalVoiceParams p;
    p.space = 0.0f;
    Rig a(p), b(p);
    b.p.size = 1.0f;
    a.d.strike(1.0f);
    b.d.strike(1.0f);
    EXPECT(a.run(9600) == b.run(9600));
    // And with space on, the output differs from the dry one.
    ModalVoiceParams q;
    q.space = 0.5f;
    Rig c(q);
    c.d.strike(1.0f);
    Rig d(p);
    d.d.strike(1.0f);
    EXPECT(c.run(9600) != d.run(9600));
}

int main() {
    strikeTuning();
    bowed();
    blown();
    strikes();
    velocity();
    active();
    stability();
    dryAtSpaceZero();
    return test::finish("modal-voice");
}
