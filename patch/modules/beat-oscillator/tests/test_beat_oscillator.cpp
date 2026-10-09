// SPDX-License-Identifier: MIT
// Beat Oscillator: the free beat and its measurement, the square-root law and
// locking, the bottleneck near the lock edge, the detector and aliasing,
// coupling, determinism and warm-up (specs/modules/beat-oscillator.md §8).
#include "BeatOscillatorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <vector>

using namespace bleep;
using patch::BeatOscillatorDsp;
using patch::BeatOscillatorFrame;
using patch::BeatOscillatorInput;
using patch::BeatOscillatorParams;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

struct Render {
    std::vector<float> out, a, b, beat, lock;
    std::vector<double> psi, fm;
    std::vector<uint32_t> slips;
};

/// Renders `seconds`; `input` is called per sample to fill the input.
template <class In>
static Render render(BeatOscillatorDsp& d, const BeatOscillatorParams& p, double seconds, In&& input) {
    Render r;
    BeatOscillatorFrame f;
    for (int i = 0; i < (int)(seconds * kSr); ++i) {
        BeatOscillatorInput in;
        input(i, in);
        d.tick(p, in, f);
        r.out.push_back(f.out);
        r.a.push_back(f.a);
        r.b.push_back(f.b);
        r.beat.push_back(f.beat);
        r.lock.push_back(f.lock);
        r.psi.push_back(d.psi());
        r.fm.push_back(d.measuredBeatHz());
        r.slips.push_back(d.slips());
    }
    return r;
}
template <class In>
static Render render(const BeatOscillatorParams& p, double seconds, In&& input) {
    BeatOscillatorDsp d;
    d.prepare(kSr);
    return render(d, p, seconds, input);
}
static auto noInput = [](int, BeatOscillatorInput&) {};

/// Clean test settings: no drift, no pull.
static BeatOscillatorParams clean(double offsetHz) {
    BeatOscillatorParams p;
    p.drift = 0.0f;
    p.offsetHz = (float)offsetHz;
    return p;
}

static std::vector<float> tail(const std::vector<float>& x, double fromSeconds) {
    return std::vector<float>(x.begin() + (long)(fromSeconds * kSr), x.end());
}

static void freeBeat() {
    TEST("Pull 0, Ideal, Drift 0: Out is a sine at |Δf|");
    for (double df : {261.6, -40.0, 1500.0}) {
        const Render r = render(clean(df), 1.5, noInput);
        const auto out = tail(r.out, 0.5);
        const double hz = test::zeroCrossingHz(out, kSr);
        EXPECT_NEAR(hz, std::fabs(df), std::fabs(df) * 0.001);
        // a sine: peak near 1 (the detector passes ≤ 2 kHz), no harmonics
        double peak = 0.0;
        for (float v : out) peak = std::max(peak, (double)std::fabs(v));
        EXPECT(peak > (std::fabs(df) > 1000.0 ? 0.6 : 0.9) && peak <= 1.0);
        EXPECT(test::magnitudeAt(out, 2.0 * std::fabs(df), kSr) < 0.001 * test::magnitudeAt(out, std::fabs(df), kSr));
        TEST("A and B run at fA and fB");
        EXPECT_NEAR(test::zeroCrossingHz(tail(r.a, 0.5), kSr), 10000.0, 0.5);
        EXPECT_NEAR(test::zeroCrossingHz(tail(r.b, 0.5), kSr), 10000.0 + df, 0.5);
        TEST("Beat output = log2(|Δf| / 261.626)");
        EXPECT_NEAR(r.beat.back(), std::log2(std::fabs(df) / 261.626), 1e-3);
        EXPECT(r.lock.back() == 0.0f);
        TEST("Pull 0, Ideal, Drift 0: Out is a sine at |Δf|");
    }
}

static void squareRootLaw() {
    TEST("square-root law: L = 25 Hz, Δf = 30 Hz beats at √(30² − 25²)");
    BeatOscillatorParams p = clean(30.0);
    p.pull = 0.5f;
    EXPECT_NEAR(BeatOscillatorDsp::lockRangeHz(0.5), 25.0, 1e-9);
    const Render r = render(p, 3.0, noInput);
    const double expect = std::sqrt(30.0 * 30.0 - 25.0 * 25.0);
    EXPECT_NEAR(r.fm.back(), expect, expect * 0.02);
    // over many slips too
    const uint32_t n = r.slips.back() - r.slips[(size_t)kSr];
    EXPECT_NEAR(n / 2.0, expect, 1.0);
    EXPECT(r.lock.back() == 0.0f);
    std::printf("  measured %.3f Hz (expected %.3f)\n", r.fm.back(), expect);

    TEST("Δf = 20 Hz inside L = 25 Hz: locked, no slips, A and B at one frequency");
    p.offsetHz = 20.0f;
    const Render l = render(p, 2.0, noInput);
    EXPECT(l.slips.back() == l.slips[(size_t)(0.5 * kSr)]);
    for (size_t i = (size_t)(0.5 * kSr); i < l.lock.size(); ++i) EXPECT(l.lock[i] == 1.0f);
    const double fa = test::zeroCrossingHz(tail(l.a, 0.5), kSr), fb = test::zeroCrossingHz(tail(l.b, 0.5), kSr);
    EXPECT_NEAR(fa, fb, 0.05);
    EXPECT_NEAR(fa, 10010.0, 0.5);
    EXPECT_NEAR(l.psi.back(), std::asin(20.0 / 25.0), 1e-3);
    EXPECT(l.beat.back() < -11.0f);
}

static void nearEdge() {
    TEST("near the edge (Δf = 1.05 L): ψ dwells at π/2, Out is a train of blips");
    BeatOscillatorParams p = clean(1.05 * 25.0);
    p.pull = 0.5f;
    p.dcCoupled = true;
    const Render r = render(p, 6.0, noInput);
    size_t near = 0, n = 0;
    for (size_t i = (size_t)kSr; i < r.psi.size(); ++i, ++n) {
        double w = std::fmod(r.psi[i], 2.0 * kPi);
        if (w < 0.0) w += 2.0 * kPi;
        if (std::fabs(w - 0.5 * kPi) < 0.25 * kPi) ++near;
    }
    const double share = (double)near / (double)n;
    EXPECT(share > 0.5);
    // crest factor of the AC part, against a sine's √2
    const auto out = tail(r.out, 1.0);
    double mean = 0.0;
    for (float v : out) mean += v;
    mean /= (double)out.size();
    double peak = 0.0, sq = 0.0;
    for (float v : out) {
        peak = std::max(peak, std::fabs(v - mean));
        sq += (v - mean) * (v - mean);
    }
    const double crest = peak / std::sqrt(sq / (double)out.size());
    EXPECT(crest > 1.8);  // a sine: 1.41
    std::printf("  ψ near π/2 %.0f %% of the time, crest factor %.2f\n", share * 100.0, crest);
}

/// Goertzel magnitude at `hz` of Hann-windowed x, a full-scale sine ≈ 0.5.
static double goertzel(const std::vector<float>& x, double hz) {
    const double w = 2.0 * kPi * hz / kSr, cw = 2.0 * std::cos(w);
    double s1 = 0.0, s2 = 0.0, wsum = 0.0;
    const size_t n = x.size();
    for (size_t i = 0; i < n; ++i) {
        const double win = 0.5 - 0.5 * std::cos(2.0 * kPi * (double)i / (double)(n - 1));
        const double s0 = win * x[i] + cw * s1 - s2;
        s2 = s1, s1 = s0;
        wsum += win;
    }
    return std::sqrt(std::max(0.0, s1 * s1 + s2 * s2 - cw * s1 * s2)) / wsum;
}

static void detector() {
    TEST("Carrier 5 kHz: the sum is below −40 dB at Detector 0 %, present at 100 %");
    BeatOscillatorParams p = clean(261.6);
    p.carrierHz = 5000.0f;
    p.dcCoupled = true;
    const double sum = 2.0 * 5000.0 + 261.6;
    double ratio[2];
    for (int k = 0; k < 2; ++k) {
        p.detector = (float)k;
        const auto out = tail(render(p, 1.5, noInput).out, 0.5);
        ratio[k] = test::magnitudeAt(out, sum, kSr) / test::magnitudeAt(out, 261.6, kSr);
    }
    EXPECT(ratio[0] < 0.01);
    EXPECT(ratio[1] > 0.3);
    std::printf("  sum / beat: %.1f dB closed, %.1f dB open\n", 20 * std::log10(ratio[0]), 20 * std::log10(ratio[1]));

    TEST("Diode at 18 kHz: harmonic beats only, no alias above −60 dB");
    BeatOscillatorParams d = clean(317.0);
    d.carrierHz = 18000.0f;
    d.mixer = BeatOscillatorDsp::Diode;
    const auto out = tail(render(d, 1.5, noInput).out, 0.5);
    const double ref = goertzel(out, 317.0);
    double worst = 0.0, worstHz = 0.0;
    for (double hz = 40.0; hz < 20000.0; hz += 7.0) {
        const double k = std::round(hz / 317.0);
        if (std::fabs(hz - k * 317.0) < 12.0) continue;  // a harmonic beat
        const double m = goertzel(out, hz);
        if (m > worst) worst = m, worstHz = hz;
    }
    EXPECT(worst < 0.001 * ref);
    std::printf("  worst non-harmonic %.1f dB at %.0f Hz\n", 20 * std::log10(worst / ref + 1e-12), worstHz);
    TEST("Diode and Overdriven beats peak near ±1");
    for (int mode : {1, 2}) {
        BeatOscillatorParams m = clean(100.0);
        m.mixer = mode;
        m.dcCoupled = true;
        const auto o = tail(render(m, 1.0, noInput).out, 0.5);
        double lo = 0.0, hi = 0.0;
        for (float v : o) lo = std::min(lo, (double)v), hi = std::max(hi, (double)v);
        EXPECT(hi > 0.7 && hi <= 1.0 && lo < -0.7 && lo >= -1.0);
        std::printf("  mixer %d: %.3f … %.3f\n", mode, lo, hi);
    }
}

static void coupling() {
    TEST("Coupling AC: a locked pair is silent");
    BeatOscillatorParams p = clean(20.0);
    p.pull = 0.5f;
    const Render ac = render(p, 3.0, noInput);
    EXPECT(test::rms(tail(ac.out, 2.0)) < 0.01);
    TEST("Coupling DC: a locked pair holds cos ψ");
    p.dcCoupled = true;
    const Render dc = render(p, 1.5, noInput);
    const auto t = tail(dc.out, 0.5);
    double lo = 1.0, hi = -1.0;
    for (float v : t) lo = std::min(lo, (double)v), hi = std::max(hi, (double)v);
    EXPECT(hi - lo < 0.002);
    EXPECT_NEAR(t.back(), 0.6, 0.01);  // cos(asin(0.8))
}

static void determinism() {
    TEST("same Seed twice is identical; another Seed differs");
    BeatOscillatorParams p;
    p.drift = 1.0f;
    p.pull = 0.4f;
    p.offsetHz = 5.0f;
    p.warmupSeconds = 10.0f;
    const Render a = render(p, 1.0, noInput), b = render(p, 1.0, noInput);
    EXPECT(a.out == b.out && a.a == b.a && a.beat == b.beat);
    p.seed = 9;
    EXPECT(render(p, 1.0, noInput).out != a.out);

    TEST("two renders from one position are identical, whatever came before");
    p.seed = 1;
    auto play = [](int i, BeatOscillatorInput& in) {
        in.running = true;
        in.started = i == 0;
        in.ppq = 37.3 + i * 2.0 / kSr;
        in.fm = 0.3f * (float)std::sin(i * 0.01);
    };
    BeatOscillatorDsp d1, d2;
    d1.prepare(kSr);
    d2.prepare(kSr);
    render(d2, p, 0.7, [](int i, BeatOscillatorInput& in) { in.fm = 0.5f * (float)std::sin(i * 0.003); });
    const Render x = render(d1, p, 1.0, play), y = render(d2, p, 1.0, play);
    // The first 5 ms after a start fade out the step from before (declick).
    const size_t from = (size_t)(BeatOscillatorDsp::kDeclickSeconds * kSr) + 1;
    EXPECT(std::equal(x.out.begin() + (long)from, x.out.end(), y.out.begin() + (long)from));
    EXPECT(x.a == y.a && x.b == y.b && x.psi == y.psi);

    TEST("the drift is the seeded spline (streams 1–4), ±D cents at most");
    BeatOscillatorParams q;
    q.drift = 1.0f;
    q.seed = 4;
    BeatOscillatorDsp d;
    d.prepare(kSr);
    double maxA = 0.0;
    render(d, q, 2.0, [&](int i, BeatOscillatorInput& in) {
        in.running = true;
        in.ppq = 3.0 + i * 2.0 / kSr;
        if (i % 977 == 0 && i > 0) {
            const double u = (3.0 + (i - 1) * 2.0 / kSr) / 8.0;
            const double expect = 25.0 * (dsp::smoothNoise(4, 1, u) + 0.25 * dsp::smoothNoise(4, 2, 8.0 * u));
            EXPECT_NEAR(d.driftA(), expect, 1e-9);
        }
        maxA = std::max(maxA, std::fabs(d.driftA()));
    });
    EXPECT(maxA <= 25.0 * 1.25 + 1e-9 && maxA > 1.0);
}

static void warmUp() {
    TEST("warm-up: −40 · c cents at the start, within 5 % after its length");
    BeatOscillatorParams p = clean(261.6);
    p.warmupSeconds = 10.0f;
    BeatOscillatorDsp d;
    d.prepare(kSr);
    double first = 0.0, firstB = 0.0;
    render(d, p, 10.0 + 1.0 / kSr, [&](int i, BeatOscillatorInput&) {
        if (i == 1) first = d.driftA(), firstB = d.driftB();
    });
    EXPECT_NEAR(first, -40.0, 0.01);
    const double cb = BeatOscillatorDsp::warmFactorB(1, -1);
    EXPECT(cb >= 0.7 && cb <= 1.3);
    EXPECT_NEAR(firstB, -40.0 * cb, 0.01);
    EXPECT(std::fabs(d.driftA()) < 0.05 * 40.0);
    EXPECT(std::fabs(d.driftB()) < 0.05 * 40.0 * cb);
    TEST("Cold restarts the warm-up while stopped");
    BeatOscillatorFrame f;
    BeatOscillatorInput in;
    in.cold = true;
    d.tick(p, in, f);
    EXPECT_NEAR(d.driftA(), -40.0, 0.01);
    TEST("voices drift apart");
    BeatOscillatorParams v0 = clean(0.0), v1 = clean(0.0);
    v0.drift = v1.drift = 0.5f;
    v1.voice = 1;
    BeatOscillatorDsp e0, e1;
    e0.prepare(kSr);
    e1.prepare(kSr);
    render(e0, v0, 0.5, noInput);
    render(e1, v1, 0.5, noInput);
    EXPECT(std::fabs(e0.driftA() - e1.driftA()) > 1e-6);
}

static void staysBounded() {
    TEST("extreme settings stay finite and within ±1");
    BeatOscillatorParams p;
    p.pull = 1.0f;
    p.detector = 1.0f;
    p.drift = 1.0f;
    p.carrierHz = 18000.0f;
    p.offsetHz = -2000.0f;
    for (int mode : {0, 1, 2}) {
        p.mixer = mode;
        const Render r = render(p, 1.0, [](int i, BeatOscillatorInput& in) {
            in.fm = (float)std::sin(i * 0.37) * 3.0f;
            in.pitch = (float)std::sin(i * 0.001) * 6.0f;
            in.detune = 1.0f;
        });
        EXPECT(test::allFinite(r.out) && test::allFinite(r.beat));
        for (float v : r.out) EXPECT(std::fabs(v) <= 1.0f);
        for (float v : r.beat) EXPECT(v >= -11.36f && v < 12.0f);
    }
}

int main() {
    freeBeat();
    squareRootLaw();
    nearEdge();
    detector();
    coupling();
    determinism();
    warmUp();
    staysBounded();
    return bleep::test::finish("beat-oscillator");
}
