// SPDX-License-Identifier: MIT
// Wave Analyzer: unity band, skirts, −3 dB points, no image at low tunings,
// long-run phase accuracy, Shifted, level mapping and needle, Peak, synced
// sweep, hunt and lock, drift and repeatability (specs/modules/wave-analyzer.md §8).
#include "WaveAnalyzerDsp.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

using namespace bleep;
using patch::WaveAnalyzerDsp;
using patch::WaveAnalyzerFrame;
using patch::WaveAnalyzerInput;
using patch::WaveAnalyzerParams;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

/// The Frequency knob position (Full range) for hz.
static double normFor(double hz) { return std::log(hz / 20.0) / std::log(1000.0); }

/// Quiet defaults for measuring: unity gain, no drift.
static WaveAnalyzerParams base(double hz, int bandwidth = 1) {
    WaveAnalyzerParams p;
    p.freqNorm = normFor(hz);
    p.bandwidth = bandwidth;
    p.gainDb = 0.0f;
    p.drift = 0.0f;
    return p;
}

struct Render {
    std::vector<float> band, shifted, level, peak, locked, track;
    std::vector<double> mag, f;
};

/// Renders `seconds`; `input(i, in)` fills the input of sample i.
template <class In>
static Render render(const WaveAnalyzerParams& p, double seconds, In&& input) {
    WaveAnalyzerDsp d;
    d.prepare(kSr);
    Render r;
    WaveAnalyzerFrame fr;
    const int n = (int)(seconds * kSr);
    for (auto* v : {&r.band, &r.shifted, &r.level, &r.peak, &r.locked, &r.track}) v->reserve((size_t)n);
    for (int i = 0; i < n; ++i) {
        WaveAnalyzerInput in;
        input(i, in);
        d.tick(p, in, fr);
        r.band.push_back(fr.band);
        r.shifted.push_back(fr.shifted);
        r.level.push_back(fr.level);
        r.peak.push_back(fr.peak);
        r.locked.push_back(fr.locked);
        r.track.push_back(fr.track);
        r.mag.push_back(d.magnitude());
        r.f.push_back(d.tunedHz());
    }
    return r;
}
static auto sine(double hz, double amp) {
    return [hz, amp](int i, WaveAnalyzerInput& in) { in.in = (float)(amp * std::sin(2.0 * kPi * hz * i / kSr)); };
}
static double mean(const std::vector<double>& v, size_t from) {
    double s = 0.0;
    for (size_t i = from; i < v.size(); ++i) s += v[i];
    return s / (double)(v.size() - from);
}
static double db(double x) { return 20.0 * std::log10(std::max(x, 1e-12)); }

static void unityAndSkirts() {
    TEST("a 1 kHz sine tuned to 1 kHz: Band is the same sine within 0.1 dB");
    const WaveAnalyzerParams p = base(1000.0);
    const Render r = render(p, 3.0, sine(1000.0, 0.5));
    const size_t from = (size_t)(2.0 * kSr);
    const double ratio = test::rms(r.band, from) / (0.5 / std::sqrt(2.0));
    EXPECT_NEAR(db(ratio), 0.0, 0.1);
    EXPECT_NEAR(db(mean(r.mag, from) / 0.5), 0.0, 0.1);
    EXPECT_NEAR(test::zeroCrossingHz(r.band, kSr, from), 1000.0, 0.5);
    std::printf("  band %.3f dB\n", db(ratio));

    TEST("tuned 3·B away: more than 40 dB down");
    const Render off = render(base(1030.0), 3.0, sine(1000.0, 0.5));
    const double rej = db(test::rms(off.band, from) / (0.5 / std::sqrt(2.0)));
    EXPECT(rej < -40.0);
    std::printf("  3·B away %.1f dB\n", rej);
}

static void bandwidths() {
    TEST("−3 dB points at f ± B/2 within 5 % for every Bandwidth");
    // 4-pole Butterworth: ±5 % in frequency is −2.21 … −3.94 dB at the nominal edge.
    for (int k = 0; k <= patch::kWaveAnalyzerThirdOctave; ++k) {
        const double f = 1000.0, b = WaveAnalyzerDsp::bandwidthHz(k, f);
        const double seconds = 2.0 + 12.0 / b;
        for (double side : {-1.0, 1.0}) {
            const Render r = render(base(f, k), seconds, sine(f + side * b / 2.0, 0.5));
            const double g = db(mean(r.mag, (size_t)((seconds - 1.0) * kSr)) / 0.5);
            EXPECT(g < -2.21 && g > -3.94);
            std::printf("  B %.1f Hz, %+g·B/2: %.2f dB\n", b, side, g);
        }
    }
}

static void noImage() {
    TEST("no image: tuned to 30 Hz at B = 100 Hz, the 2f term of a 30 Hz input stays below −30 dB");
    // A real mixer would leave a 60 Hz term in Z, inside the 50 Hz low-pass;
    // with the analytic input |Z| hardly ripples.
    const Render r = render(base(30.0, 3), 3.0, sine(30.0, 0.5));
    const size_t from = (size_t)(2.0 * kSr);
    double lo = 1e9, hi = 0.0;
    for (size_t i = from; i < r.mag.size(); ++i) lo = std::min(lo, r.mag[i]), hi = std::max(hi, r.mag[i]);
    const double image = db((hi - lo) / 2.0 / mean(r.mag, from));
    EXPECT(image < -30.0);
    std::printf("  image %.1f dB\n", image);
}

static void phaseAccuracy() {
    TEST("after one hour at 15 kHz the double phase is within 1e-6 cycles");
    // At 44.1 kHz the increment 15000/44100 = 50/147 is not exact in binary;
    // the true phase after n samples is (50·n mod 147) / 147.
    const double sr = 44100.0;
    const int64_t hour = (int64_t)(3600.0 * sr);
    const double inc = 15000.0 / sr;
    double ph = 0.0;
    for (int64_t n = 0; n < hour; ++n) ph = WaveAnalyzerDsp::advance(ph, inc);
    auto exact = [](int64_t n) { return (double)((50 * n) % 147) / 147.0; };
    double err = std::fabs(ph - exact(hour));
    err = std::min(err, 1.0 - err);
    EXPECT(err < 1e-6);
    std::printf("  phase error after an hour %.2e cycles\n", err);

    TEST("and a 3 Hz band on that 15 kHz partial, an hour in, still reads within 0.5 dB");
    WaveAnalyzerParams p = base(15000.0, 0);
    WaveAnalyzerDsp d;
    d.prepare(sr);
    d.setPhase(ph);
    WaveAnalyzerFrame fr;
    WaveAnalyzerInput in;
    std::vector<double> mag;
    for (int i = 0; i < (int)(6.0 * sr); ++i) {
        in.in = (float)(0.5 * std::sin(2.0 * kPi * exact(hour + i)));
        d.tick(p, in, fr);
        mag.push_back(d.magnitude());
    }
    const double g = db(mean(mag, (size_t)(5.0 * sr)) / 0.5);
    EXPECT(std::fabs(g) < 0.5);
    std::printf("  15 kHz, 3 Hz: %.3f dB\n", g);
}

static void shifted() {
    TEST("Shifted: a 2 kHz sine tuned at 2 kHz with Listen 800 Hz is an 800 Hz sine");
    WaveAnalyzerParams p = base(2000.0);
    p.listen = 800.0f;
    const Render r = render(p, 2.0, sine(2000.0, 0.5));
    const size_t from = (size_t)kSr;
    EXPECT_NEAR(test::zeroCrossingHz(r.shifted, kSr, from), 800.0, 0.5);
    EXPECT_NEAR(db(test::rms(r.shifted, from) / (0.5 / std::sqrt(2.0))), 0.0, 0.2);
    std::vector<float> tail(r.shifted.begin() + (long)from, r.shifted.end());
    EXPECT(test::magnitudeAt(tail, 2000.0, kSr) < 0.001);
}

static void levelAndNeedle() {
    TEST("level mapping: 0 dBFS reads 1, Floor reads 0");
    for (int k = 0; k < 6; ++k) {
        const double floor = WaveAnalyzerDsp::floorDb(k);
        EXPECT_NEAR(WaveAnalyzerDsp::levelMap(1.0, floor), 1.0, 1e-12);
        EXPECT_NEAR(WaveAnalyzerDsp::levelMap(std::pow(10.0, floor / 20.0), floor), 0.0, 1e-9);
        EXPECT_NEAR(WaveAnalyzerDsp::levelMap(std::pow(10.0, floor / 40.0), floor), 0.5, 1e-9);
    }
    TEST("Needle: overshoot under 2 %, settled in about 300 ms");
    WaveAnalyzerParams p = base(1000.0, 3);
    const Render r = render(p, 2.0, sine(1000.0, 0.5));  // −6 dB → 0.9 on −60 dB
    const double target = WaveAnalyzerDsp::levelMap(0.5, -60.0);
    float peak = 0.0f;
    for (float v : r.level) peak = std::max(peak, v);
    const double over = peak / target - 1.0;
    EXPECT(over > 0.0 && over < 0.02);
    EXPECT_NEAR(r.level.back(), target, 1e-3);
    EXPECT(std::fabs(r.level[(size_t)(0.4 * kSr)] - target) < 0.03 * target);
    EXPECT(r.level[(size_t)(0.1 * kSr)] < 0.9 * target);  // a needle, not a light
    std::printf("  needle overshoot %.2f %%\n", 100.0 * over);
    TEST("Fast: there in 30 ms");
    p.needle = false;
    const Render f = render(p, 0.2, sine(1000.0, 0.5));
    EXPECT(std::fabs(f.level[(size_t)(0.03 * kSr)] - target) < 0.02);
}

static void peaks() {
    TEST("Peak: one trigger per crossing, no chatter");
    for (bool needle : {true, false}) {
        WaveAnalyzerParams p = base(1000.0, 2);
        p.needle = needle;
        p.threshold = 0.6f;
        // Loud (−6 dB) and quiet (−40 dB) halves of each second, with noise on top.
        uint64_t k = 0;
        const Render r = render(p, 4.0, [&](int i, WaveAnalyzerInput& in) {
            const double amp = (i / 24000) % 2 == 0 ? 0.5 : 0.01;
            const double noise = 0.02 * (2.0 * dsp::uniform01(9, k++, 0) - 1.0);
            in.in = (float)(amp * std::sin(2.0 * kPi * 1000.0 * i / kSr) + noise);
        });
        int count = 0;
        for (float v : r.peak) count += v > 0.5f ? 1 : 0;
        EXPECT(count == 4);
        std::printf("  %s: %d triggers\n", needle ? "Needle" : "Fast", count);
    }
}

static void syncedSweep() {
    TEST("synced sweep: f is a function of the song position, also after a jump");
    WaveAnalyzerParams p = base(100.0);
    p.mode = patch::WaSweep;
    p.sync = 6;  // 1 bar
    p.span = 5.0f;
    p.sweepDir = patch::WaUpDown;
    const double ppqPerSample = 2.0 / kSr;  // 120 BPM
    auto ppqAt = [&](int i) { return i < 48000 ? 3.3 + i * ppqPerSample : 77.9 + i * ppqPerSample; };
    const Render r = render(p, 2.0, [&](int i, WaveAnalyzerInput& in) {
        in.running = true;
        in.started = i == 0;
        in.ppq = ppqAt(i);
    });
    bool ok = true;
    for (size_t i = 0; i < r.f.size(); i += 97) {
        const double rr = dsp::wrap01(ppqAt((int)i) / 4.0);
        const double want = 100.0 * std::exp2(5.0 * (1.0 - std::fabs(2.0 * rr - 1.0)));
        ok = ok && std::fabs(r.f[i] / want - 1.0) < 1e-9;
    }
    EXPECT(ok);
    TEST("free sweep: Sweep Time per pass, Reset restarts, Hold pauses");
    WaveAnalyzerParams q = base(200.0);
    q.mode = patch::WaSweep;
    q.span = 2.0f;
    q.sweepTime = 0.5f;
    const Render s = render(q, 1.2, [](int i, WaveAnalyzerInput& in) {
        in.reset = i >= 36000 && i < 36010 ? 1.0f : 0.0f;
        in.hold = i >= 48000 && i < 52800 ? 1.0f : 0.0f;
    });
    EXPECT_NEAR(s.f[12000], 200.0 * std::exp2(2.0 * 0.5), 0.05);  // half a pass
    EXPECT_NEAR(s.f[36000 + 1], 200.0, 0.05);  // just reset
    EXPECT(s.f[50000] == s.f[48000]);           // held
    EXPECT_NEAR(s.f[52800 + 2400], 200.0 * std::exp2(2.0 * (12000.0 + 2400.0) / 24000.0), 0.5);
}

/// Hunts in the default window around 440 Hz; returns the render.
static Render hunt(double seconds, double hz1, double a1, double hz2, double a2) {
    WaveAnalyzerParams p = base(440.0);
    p.mode = patch::WaLock;
    p.capture = 7.0f;
    return render(p, seconds, [=](int i, WaveAnalyzerInput& in) {
        const double t = i / kSr;
        in.in = (float)(a1 * std::sin(2.0 * kPi * hz1 * t) + a2 * std::sin(2.0 * kPi * hz2 * t));
    });
}

static void lock() {
    TEST("Lock: 523 Hz, Frequency 440 Hz, Capture 7 st: Locked within scan + 1 s, Track within 2 cents");
    const double lo = 440.0 * std::exp2(-7.0 / 12.0), hi = 440.0 * std::exp2(7.0 / 12.0);
    const double scan = (hi - lo) / std::max(0.5 * 10.0 * 10.0, (hi - lo) / 8.0);
    const Render r = hunt(scan + 4.0, 523.0, 0.5, 100.0, 0.0);
    size_t at = r.locked.size();
    for (size_t i = 0; i < r.locked.size(); ++i)
        if (r.locked[i] > 0.5f) {
            at = i;
            break;
        }
    EXPECT((double)at / kSr < scan + 1.0);
    for (size_t i = at; i < r.locked.size(); ++i) EXPECT(r.locked[i] > 0.5f);
    const double want = std::log2(523.0 / 261.626);
    double worst = 0.0;
    for (size_t i = (size_t)((scan + 1.0) * kSr); i < r.track.size(); ++i)
        worst = std::max(worst, std::fabs(r.track[i] - want) * 1200.0);
    EXPECT(worst < 2.0);
    std::printf("  scan %.2f s, locked at %.2f s, worst %.2f cents after scan + 1 s\n", scan, (double)at / kSr, worst);

    TEST("two sines in the window: it locks to the louder one");
    for (int k = 0; k < 2; ++k) {
        const double loud = k ? 380.0 : 560.0, quiet = k ? 560.0 : 380.0;
        const Render t = hunt(scan + 4.0, quiet, 0.25, loud, 0.5);
        EXPECT(t.locked.back() > 0.5f);
        EXPECT(std::fabs(t.track.back() - std::log2(loud / 261.626)) * 1200.0 < 2.0);
        std::printf("  louder %.0f Hz: tracked %.2f Hz\n", loud, t.f.back());
    }

    TEST("silence: it keeps hunting, never locks");
    const Render q = hunt(20.0, 523.0, 0.0, 100.0, 0.0);
    for (float v : q.locked) EXPECT(v < 0.5f);

    TEST("the partial goes away: lock is lost, the hunt starts again");
    WaveAnalyzerParams p = base(440.0);
    p.mode = patch::WaLock;
    const Render g = render(p, scan + 6.0, [&](int i, WaveAnalyzerInput& in) {
        const double t = i / kSr;
        in.in = t < scan + 2.0 ? (float)(0.5 * std::sin(2.0 * kPi * 500.0 * t)) : 0.0f;
    });
    EXPECT(g.locked[(size_t)((scan + 1.5) * kSr)] > 0.5f);
    EXPECT(g.locked.back() < 0.5f);
}

static void drift() {
    TEST("Drift 0: f is exactly the dial");
    const Render z = render(base(440.0), 1.0, sine(440.0, 0.1));
    for (double f : z.f) EXPECT(f == WaveAnalyzerDsp::dialHz(normFor(440.0), 0));
    TEST("Drift: |drift| ≤ 24 cents, smooth, moving");
    double most = 0.0, step = 0.0, prev = WaveAnalyzerDsp::driftOctaves(1.0, 1, 1, 0.0);
    for (double t = 0.0; t < 3600.0; t += 0.01) {
        const double d = WaveAnalyzerDsp::driftOctaves(1.0, 1, 1, t);
        most = std::max(most, std::fabs(d));
        step = std::max(step, std::fabs(d - prev));
        prev = d;
    }
    EXPECT(most <= 0.02 + 1e-12 && most > 0.01);
    EXPECT(step < 1e-4);
    TEST("Drift > 0: two renders from the same position are identical");
    WaveAnalyzerParams p = base(440.0);
    p.drift = 1.0f;
    p.mode = patch::WaLock;
    auto play = [](int i, WaveAnalyzerInput& in) {
        in.running = true;
        in.started = i == 0;
        in.songSeconds = 123.4 + i / kSr;
        in.ppq = 246.8 + i * 2.0 / kSr;
        in.in = (float)(0.3 * std::sin(2.0 * kPi * 470.0 * i / kSr));
    };
    const Render a = render(p, 3.0, play), b = render(p, 3.0, play);
    EXPECT(a.band == b.band && a.f == b.f && a.level == b.level);
    TEST("another voice drifts differently");
    p.voice = 3;
    EXPECT(render(p, 3.0, play).f != a.f);
}

static void bounded() {
    TEST("noise at +40 dB in every mode and bandwidth: finite and within ±1");
    for (int mode = 0; mode < 3; ++mode)
        for (int bw = 0; bw <= 4; ++bw) {
            WaveAnalyzerParams p = base(1000.0, bw);
            p.mode = mode;
            p.gainDb = 40.0f;
            p.sweepTime = 0.3f;
            p.drift = 1.0f;
            uint64_t k = 0;
            const Render r = render(p, 1.0, [&](int, WaveAnalyzerInput& in) {
                in.in = (float)(2.0 * dsp::uniform01(5, k, 0) - 1.0);
                in.pitch = (float)(4.0 * dsp::uniform01(5, k++, 1) - 2.0);
            });
            for (size_t i = 0; i < r.band.size(); ++i) {
                EXPECT(std::isfinite(r.band[i]) && std::fabs(r.band[i]) <= 1.0f);
                EXPECT(std::isfinite(r.shifted[i]) && std::fabs(r.shifted[i]) <= 1.0f);
                EXPECT(r.level[i] >= 0.0f && r.level[i] <= 1.0f && std::isfinite(r.track[i]));
            }
        }
}

int main() {
    unityAndSkirts();
    bandwidths();
    noImage();
    phaseAccuracy();
    shifted();
    levelAndNeedle();
    peaks();
    syncedSweep();
    lock();
    drift();
    bounded();
    return bleep::test::finish("wave-analyzer");
}
