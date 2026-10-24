// SPDX-License-Identifier: GPL-3.0-only
// Sweep Generator: frequency laws, Freq output, synced position and End on
// bars, phase continuity, Triggered/Gated/Hold, bursts, markers and retrace,
// aliasing, drift and warm-up (doc/specs/modules/sweep-generator.md §8).
#include "SweepGeneratorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::SweepFrame;
using patch::SweepGeneratorDsp;
using patch::SweepInput;
using patch::SweepParams;

static constexpr double kSr = 48000.0;

struct Render {
    std::vector<SweepFrame> f;
    std::vector<float> out;
    std::vector<double> p, hz;
};

/// Renders `seconds`; `input(i, in, params)` fills the input (and may change params).
template <class In>
static Render render(SweepParams p, double seconds, In&& input, double sr = kSr) {
    SweepGeneratorDsp d;
    d.prepare(sr);
    Render r;
    SweepFrame f;
    for (int i = 0; i < (int)(seconds * sr); ++i) {
        SweepInput in;
        input(i, in, p);
        d.tick(p, in, f);
        r.f.push_back(f);
        r.out.push_back(f.out);
        r.p.push_back(d.progress());
        r.hz.push_back(d.frequency());
    }
    return r;
}
static auto noInput = [](int, SweepInput&, SweepParams&) {};

/// Defaults with Drift 0, so frequencies are exact.
static SweepParams clean() {
    SweepParams p;
    p.drift = 0.0f;
    return p;
}

static void laws() {
    TEST("s = 0.5: Log gives the geometric mean, Lin the arithmetic mean");
    EXPECT_NEAR(SweepGeneratorDsp::sweepHz(100.0, 5000.0, 0.5, false), std::sqrt(100.0 * 5000.0), 1e-9);
    EXPECT_NEAR(SweepGeneratorDsp::sweepHz(100.0, 5000.0, 0.5, true), 2550.0, 1e-9);
    EXPECT_NEAR(SweepGeneratorDsp::sweepHz(5000.0, 100.0, 0.25, false), 5000.0 * std::pow(0.02, 0.25), 1e-9);
    TEST("positions: Up, Down, Up-Down");
    EXPECT_NEAR(SweepGeneratorDsp::position(0.3, 0), 0.3, 1e-12);
    EXPECT_NEAR(SweepGeneratorDsp::position(0.3, 1), 0.7, 1e-12);
    EXPECT_NEAR(SweepGeneratorDsp::position(0.25, 2), 0.5, 1e-12);
    EXPECT_NEAR(SweepGeneratorDsp::position(0.75, 2), 0.5, 1e-12);

    TEST("the rendered sweep at s = 0.5 and Freq within 1 cent (Drift 0)");
    for (bool lin : {false, true}) {
        SweepParams p = clean();
        p.lin = lin;
        p.sweepSeconds = 1.0f;
        const Render r = render(p, 0.6, noInput);
        const size_t half = (size_t)(0.5 * kSr);
        EXPECT_NEAR(r.p[half], 0.5, 1e-9);
        const double expect = SweepGeneratorDsp::sweepHz(100.0, 5000.0, 0.5, lin);
        EXPECT_NEAR(1200.0 * std::log2(r.hz[half] / expect), 0.0, 1.0);
        EXPECT_NEAR(1200.0 * ((double)r.f[half].freq - std::log2(expect / 261.626)), 0.0, 1.0);
        EXPECT_NEAR(r.f[half].sweep, 0.5, 1e-6);
    }
    TEST("Pitch shifts the sweep by octaves");
    SweepParams p = clean();
    const Render r = render(p, 0.01, [](int, SweepInput& in, SweepParams&) { in.pitch = 1.0f; });
    EXPECT_NEAR(r.hz[0], 200.0, 1e-3);
}

static void synced() {
    TEST("synced: p = wrap01(ppq / beats), also after a seek; End lands on bars");
    SweepParams p = clean();
    p.sync = 3;  // 1 bar
    const double ppqPerSample = 2.0 / kSr;  // 120 BPM
    auto ppqAt = [&](int i) { return i < 48000 ? 0.3 + i * ppqPerSample : 37.9 + (i - 48000) * ppqPerSample; };
    const Render r = render(p, 3.0, [&](int i, SweepInput& in, SweepParams&) {
        in.running = true;
        in.started = i == 0;
        in.ppq = ppqAt(i);
    });
    int ends = 0;
    for (size_t i = 0; i < r.p.size(); ++i) {
        EXPECT_NEAR(r.p[i], dsp::wrap01(ppqAt((int)i) / 4.0), 1e-9);
        if (i == 0 || i == 48000) {
            EXPECT(r.f[i].end == 0.0f);  // a start or a seek is not the end of a sweep
            continue;
        }
        const bool bar = std::floor(ppqAt((int)i) / 4.0) != std::floor(ppqAt((int)i - 1) / 4.0);
        EXPECT((r.f[i].end > 0.5f) == bar);
        ends += r.f[i].end > 0.5f;
    }
    EXPECT(ends >= 1);

    TEST("synced Up-Down: End on every half bar");
    p.direction = 2;
    const Render u = render(p, 3.0, [&](int i, SweepInput& in, SweepParams&) {
        in.running = true;
        in.started = i == 0;
        in.ppq = i * ppqPerSample;
    });
    int halves = 0;
    for (size_t i = 1; i < u.f.size(); ++i) {
        const bool half = std::floor(i * ppqPerSample / 2.0) != std::floor((i - 1) * ppqPerSample / 2.0);
        EXPECT((u.f[i].end > 0.5f) == half);
        halves += half;
    }
    EXPECT(halves == 2);
}

/// Largest sample-to-sample step of a full-scale waveform at `hz`, with margin.
static double slopeBound(double hz) { return 1.2 * 2.0 * 3.14159265358979 * hz / kSr + 1e-4; }

static void continuity() {
    TEST("phase continuity across wraps, retriggers and seeks (Phase Reset Off)");
    SweepParams p = clean();
    p.level = 1.0f;
    p.sweepSeconds = 0.05f;  // many wraps: 5 kHz → 100 Hz
    const Render a = render(p, 0.5, [](int i, SweepInput& in, SweepParams&) { in.trigger = i % 1777 == 0 ? 1.0f : 0.0f; });
    double worst = 0.0;
    for (size_t i = 1; i < a.out.size(); ++i) worst = std::max(worst, std::fabs((double)a.out[i] - a.out[i - 1]));
    EXPECT(worst <= slopeBound(5000.0));
    p.sync = 1;
    const Render b = render(p, 0.5, [](int i, SweepInput& in, SweepParams&) {
        in.running = true;
        in.ppq = (i < 9000 ? i : i + 3333) * 2.0 / kSr;  // a seek
    });
    worst = 0.0;
    for (size_t i = 1; i < b.out.size(); ++i) worst = std::max(worst, std::fabs((double)b.out[i] - b.out[i - 1]));
    EXPECT(worst <= slopeBound(5000.0));
    std::printf("  largest step %.4f (bound %.4f)\n", worst, slopeBound(5000.0));

    TEST("Phase Reset On: a trigger restarts the cycle with a half step");
    p = clean();
    p.phaseReset = true;
    p.startHz = p.stopHz = 440.0f;
    const Render c = render(p, 0.1, [](int i, SweepInput& in, SweepParams&) { in.trigger = i == 1000 ? 1.0f : 0.0f; });
    EXPECT(c.f[1000].sync > 0.5f);
    EXPECT_NEAR(c.out[1001], 0.8 * std::sin(2.0 * 3.14159265358979 * 440.0 / kSr), 1e-4);
}

static void triggered() {
    TEST("Triggered: waits at Start, one sweep and one End per trigger, holds at Stop");
    SweepParams p = clean();
    p.mode = 1;
    p.sweepSeconds = 0.1f;
    const Render r = render(p, 0.5, [](int i, SweepInput& in, SweepParams&) {
        in.trigger = i == 4800 || i == 14400 ? 1.0f : 0.0f;
    });
    for (size_t i = 0; i < 4800; ++i) EXPECT(r.f[i].sweep == 0.0f && std::fabs(r.hz[i] - 100.0) < 1e-3);
    int ends = 0;
    for (size_t i = 0; i < r.f.size(); ++i) ends += r.f[i].end > 0.5f;
    EXPECT(ends == 2);
    auto endNear = [&](size_t at) { return r.f[at - 1].end + r.f[at].end + r.f[at + 1].end > 0.5f; };
    EXPECT(endNear(4800 + 4800));  // 0.1 s after the trigger (±1 sample: the knob is a float)
    EXPECT(endNear(14400 + 4800));
    for (size_t i = 14400 + 4802; i < r.f.size(); ++i) EXPECT(r.f[i].sweep == 1.0f && std::fabs(r.hz[i] - 5000.0) < 0.01);

    TEST("Gated advances only while high; Hold freezes p");
    p.mode = 2;
    p.sweepSeconds = 1.0f;
    const Render g = render(p, 1.0, [](int i, SweepInput& in, SweepParams&) {
        in.gate = (i >= 4800 && i < 9600) || i >= 19200 ? 1.0f : 0.0f;
        in.hold = i >= 24000 && i < 28800 ? 1.0f : 0.0f;
    });
    EXPECT(g.p[4799] == 0.0);
    EXPECT_NEAR(g.p[9600], 0.1, 2e-4);
    EXPECT_NEAR(g.p[19200], 0.1, 2e-4);
    EXPECT_NEAR(g.p[24000], 0.2, 2e-4);
    EXPECT_NEAR(g.p[28799], g.p[24000], 0.0);
    EXPECT_NEAR(g.p[33600], 0.3, 2e-4);
}

static void bursts() {
    TEST("Burst: exactly Burst Count Sync pulses per burst, silence between");
    for (int count : {1, 4, 9}) {
        SweepParams p = clean();
        p.mode = 3;
        p.burstCount = count;
        p.startHz = p.stopHz = 1000.0f;
        const Render r = render(p, 0.5, [](int i, SweepInput& in, SweepParams&) { in.trigger = i % 4800 == 100 ? 1.0f : 0.0f; });
        int syncs = 0, bursts = 0;
        for (size_t i = 0; i < r.f.size(); ++i) {
            if (i % 4800 == 100) {
                if (bursts++) EXPECT(syncs == count);
                syncs = 0;
            }
            syncs += r.f[i].sync > 0.5f;
            const size_t since = (i + 4800 - 100) % 4800;
            if (i < 100 || since > (size_t)(count * 48 + 2)) EXPECT(r.out[i] == 0.0f);
        }
        EXPECT(syncs == count);
    }
    TEST("Burst fades in and out (no step at either end)");
    SweepParams p = clean();
    p.mode = 3;
    p.wave = 1;  // the triangle starts and ends at −1
    p.startHz = p.stopHz = 300.0f;
    const Render r = render(p, 0.1, [](int i, SweepInput& in, SweepParams&) { in.trigger = i == 10 ? 1.0f : 0.0f; });
    EXPECT(std::fabs(r.out[10]) < 1e-6);
    double worst = 0.0;
    for (size_t i = 1; i < r.out.size(); ++i) worst = std::max(worst, std::fabs((double)r.out[i] - r.out[i - 1]));
    EXPECT(worst < 0.15);  // without the 0.5 ms fades: a 0.8 step at each end
}

static void markers() {
    TEST("markers at 250 Hz, 1 kHz, 4 kHz fire at the predicted times; none during retrace");
    for (bool glide : {false, true}) {
        SweepParams p = clean();
        p.markers = 3;
        p.glide = glide;
        p.sweepSeconds = 1.0f;
        const Render r = render(p, 2.5, noInput);
        std::vector<double> predicted;
        for (int cycle = 0; cycle < 3; ++cycle)
            for (double m : {250.0, 1000.0, 4000.0}) {
                const double sm = std::log2(m / 100.0) / std::log2(50.0);
                predicted.push_back(std::ceil((cycle + sm) * kSr));
            }
        std::vector<double> fired;
        for (size_t i = 0; i < r.f.size(); ++i)
            if (r.f[i].marker > 0.5f) fired.push_back((double)i);
        EXPECT(fired.size() == 7);  // three per sweep, the third sweep only reaches 250 Hz
        for (size_t k = 0; k < fired.size() && k < predicted.size(); ++k) EXPECT(std::fabs(fired[k] - predicted[k]) <= 1.0);
        // Marker Gate: high for 10 ms after each pulse.
        if (!fired.empty()) {
            const size_t at = (size_t)fired[0];
            EXPECT(r.f[at + 479].markerGate > 0.5f && r.f[at + 480].markerGate == 0.0f);
        }
        if (glide) {  // the retrace: 5 % of 1 s, from Stop down to the sweep
            EXPECT(r.f[(size_t)kSr].end > 0.5f);
            EXPECT(r.f[(size_t)kSr + 100].sweep > 0.5f);
            EXPECT(r.f[(size_t)(kSr * 1.06)].sweep < 0.1f);
        }
    }
}

static void aliasing() {
    TEST("Square at 15 kHz: aliases at least 20 dB below a naive square");
    SweepParams p = clean();
    p.wave = 2;
    p.level = 1.0f;
    p.startHz = p.stopHz = 15000.0f;
    const Render r = render(p, 0.3, noInput);
    std::vector<float> blep(r.out.begin() + 4096, r.out.begin() + 4096 + 8192), naive;
    for (size_t i = 0; i < blep.size(); ++i) naive.push_back(dsp::wrap01((double)(i + 4096) * 15000.0 / kSr) < 0.5 ? 1.0f : -1.0f);
    // Alias power from the strongest folded harmonics, measured bin by bin.
    auto aliasBins = [](const std::vector<float>& x) {
        double s = 0.0;
        for (double hz : {3000.0, 9000.0, 21000.0})
            s += std::pow(test::magnitudeAt(x, hz, kSr), 2.0);
        return s;
    };
    const double db = 10.0 * std::log10(aliasBins(naive) / aliasBins(blep));
    std::printf("  aliases %.1f dB below naive\n", db);
    EXPECT(db >= 20.0);
}

static void drift() {
    TEST("Drift: same Seed identical, another Seed differs; Drift 0 exact");
    SweepParams p;  // Drift 15 %
    p.drift = 1.0f;
    const Render a = render(p, 1.0, noInput), b = render(p, 1.0, noInput);
    EXPECT(a.out == b.out);
    p.seed = 9;
    EXPECT(render(p, 1.0, noInput).out != a.out);
    SweepParams z = clean();
    z.startHz = z.stopHz = 440.0f;
    const Render c = render(z, 0.5, noInput);
    for (double hz : c.hz) EXPECT(std::fabs(hz - 440.0) < 1e-9 * 440.0 + 1e-4);

    TEST("warm-up: down to e^-3 after Warm-up; the drift follows the formula");
    for (double w : {10.0, 30.0, 120.0}) {
        const double w0 = SweepGeneratorDsp::warmupCents(5, 0.0, w);
        EXPECT(std::fabs(w0) > 0.0 && std::fabs(w0) <= 40.0);
        EXPECT_NEAR(SweepGeneratorDsp::warmupCents(5, w, w) / w0, std::exp(-3.0), 1e-9);
    }
    EXPECT(SweepGeneratorDsp::warmupCents(5, 0.0, 0.0) == 0.0);
    SweepParams d = clean();
    d.drift = 1.0f;
    d.startHz = d.stopHz = 1000.0f;
    d.warmupSeconds = 10.0f;
    const Render r = render(d, 12.0, noInput);
    for (double t : {0.5, 3.3, 10.0, 11.9}) {
        const size_t i = (size_t)(t * kSr);
        const double cents = SweepGeneratorDsp::driftCents(1, 1.0, (double)i / kSr, (double)i / kSr, 10.0);
        EXPECT_NEAR(1200.0 * std::log2(r.hz[i] / 1000.0), cents, 1.0);
    }
    TEST("drift follows song time: a seek lands on the same drift");
    SweepParams s = clean();
    s.drift = 1.0f;
    s.warmupSeconds = 0.0f;
    s.startHz = s.stopHz = 1000.0f;
    const Render x = render(s, 0.5, [](int i, SweepInput& in, SweepParams&) {
        in.running = true;
        in.ppq = 20.0 + i * 2.0 / kSr;
    });
    const double cents = SweepGeneratorDsp::driftCents(1, 1.0, (20.0 + 12000 * 2.0 / kSr) * 0.5, 0.0, 0.0);
    EXPECT_NEAR(1200.0 * std::log2(x.hz[12000] / 1000.0), cents, 0.5);
}

static void transport() {
    TEST("transport start resets p and φ: renders from the same position are identical");
    SweepParams p;
    p.drift = 0.5f;
    p.wave = 1;
    auto play = [](int i, SweepInput& in, SweepParams&) {
        in.running = i >= 3000;
        in.started = i == 3000;
        in.ppq = 8.0 + (i - 3000) * 2.0 / kSr;
    };
    const Render a = render(p, 1.0, play);
    const Render b = render(p, 1.0, [&](int i, SweepInput& in, SweepParams& q) {
        play(i, in, q);
        in.trigger = i == 1000 ? 1.0f : 0.0f;  // a different history before the start
    });
    EXPECT(a.p[3000] == 0.0 && b.p[3000] == 0.0);
    EXPECT(std::vector<float>(a.out.begin() + 3001, a.out.end()) == std::vector<float>(b.out.begin() + 3001, b.out.end()));
}

static void bounded() {
    TEST("outputs finite and bounded with extreme settings and inputs");
    for (int w = 0; w < 6; ++w)
        for (float sym : {-1.0f, 0.0f, 1.0f}) {
            SweepParams p;
            p.wave = w;
            p.symmetry = sym;
            p.fm = 1.0f;
            p.level = 1.0f;
            p.startHz = 20000.0f;
            p.stopHz = 0.01f;
            p.sweepSeconds = 0.01f;
            p.mode = w % 4;
            const Render r = render(p, 0.2, [](int i, SweepInput& in, SweepParams&) {
                in.fm = (float)std::sin(i * 0.37) * 3.0f;
                in.am = 1.0f;
                in.trigger = i % 333 == 0 ? 1.0f : 0.0f;
                in.gate = (i / 500) % 2 ? 1.0f : 0.0f;
            });
            float peak = 0.0f;
            for (const auto& f : r.f) {
                EXPECT(std::isfinite(f.out) && std::isfinite(f.freq));
                peak = std::max(peak, std::fabs(f.out));
            }
            if (peak >= 4.0f) std::printf("  wave %d symmetry %+.0f: peak %.2f\n", w, (double)sym, (double)peak);
            EXPECT(peak < 4.0f);
        }
}

int main() {
    laws();
    synced();
    continuity();
    triggered();
    bursts();
    markers();
    aliasing();
    drift();
    transport();
    bounded();
    return bleep::test::finish("sweep-generator");
}
