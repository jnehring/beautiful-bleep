// SPDX-License-Identifier: GPL-3.0-only
// Pulse Generator: Free Run timing, transport grid with jitter, bursts,
// Gated runs, External Width delay line and its overflow, Double and
// Complement, band-limiting (aliasing, sub-sample edges), ringing, warm-up
// (doc/specs/modules/pulse-generator.md §8).
#include "PulseGeneratorDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <complex>
#include <cstdio>
#include <vector>

using namespace bleep;
using patch::PulseGeneratorDsp;
using patch::PulseGeneratorFrame;
using patch::PulseGeneratorInput;
using patch::PulseGeneratorParams;

static constexpr double kSr = 48000.0;

struct Render {
    std::vector<PulseGeneratorFrame> f;
    std::vector<float> out, ring, gate, sync;
    std::vector<double> logical;  ///< naive p at each input sample
    bool duty = false;
};

/// Renders `seconds`; `input` is called per sample to fill the input.
template <class In>
static Render render(const PulseGeneratorParams& p, double seconds, In&& input, double sr = kSr) {
    PulseGeneratorDsp d;
    d.prepare(sr);
    Render r;
    PulseGeneratorFrame f;
    for (int i = 0; i < (int)(seconds * sr); ++i) {
        PulseGeneratorInput in;
        input(i, in);
        d.tick(p, in, f);
        r.f.push_back(f);
        r.out.push_back(f.out);
        r.ring.push_back(f.ring);
        r.gate.push_back(f.gate);
        r.sync.push_back(f.sync);
        r.logical.push_back(d.logical((double)i));
        r.duty = r.duty || f.duty;
    }
    return r;
}
static auto noInput = [](int, PulseGeneratorInput&) {};

static std::vector<int> rising(const std::vector<float>& x) {
    std::vector<int> e;
    for (size_t i = 0; i < x.size(); ++i)
        if (x[i] > 0.5f && (i == 0 || x[i - 1] <= 0.5f)) e.push_back((int)i);
    return e;
}
static std::vector<int> falling(const std::vector<float>& x) {
    std::vector<int> e;
    for (size_t i = 1; i < x.size(); ++i)
        if (x[i] <= 0.5f && x[i - 1] > 0.5f) e.push_back((int)i);
    return e;
}

static void freeRun() {
    TEST("Free Run 100 ms: Sync every 4800 samples, Gate W long, Delay after Sync");
    PulseGeneratorParams p;
    p.periodSec = 0.1;
    p.widthSec = 0.01;
    p.delaySec = 0.005;
    const Render r = render(p, 1.0, noInput);
    const auto s = rising(r.sync), g = rising(r.gate), gf = falling(r.gate);
    EXPECT(s.size() == 10);
    for (size_t k = 1; k < s.size(); ++k) EXPECT(s[k] - s[k - 1] == 4800);
    EXPECT(g.size() == s.size() && gf.size() == s.size());
    for (size_t k = 0; k < std::min(g.size(), gf.size()); ++k) {
        EXPECT(std::abs(g[k] - s[k] - 240) <= 1);
        EXPECT(std::abs(gf[k] - g[k] - 480) <= 1);
    }
    TEST("Width at the period is limited and lights Duty");
    p.widthSec = 0.2;
    const Render d = render(p, 0.5, noInput);
    EXPECT(d.duty);
    EXPECT(rising(d.gate).size() == 5);
}

static void synced() {
    TEST("Synced: period starts on the grid even with Jitter 100 %");
    PulseGeneratorParams p;
    p.sync = 2;  // 1/16
    p.jitter = 1.0;
    p.widthSec = 0.02;
    const double dppq = 2.0 / kSr;  // 120 BPM
    auto play = [&](int i, PulseGeneratorInput& in) {
        in.running = true;
        in.started = i == 0;
        in.ppq = 0.1 + i * dppq;
        in.ppqPerSample = dppq;
    };
    const Render r = render(p, 2.0, play);
    int starts = 0;
    for (size_t j = 2; j < r.sync.size(); ++j) {
        const size_t i = j - 1;  // outputs are one sample late
        const bool boundary = std::floor((0.1 + i * dppq) / 0.25) != std::floor((0.1 + (i - 1) * dppq) / 0.25);
        EXPECT((r.sync[j] > 0.5f) == boundary);
        starts += boundary;
    }
    EXPECT(starts == 16);
    TEST("Synced: pulses move with jitter but never before their period");
    const auto g = rising(r.gate);
    bool moved = false;
    for (int e : g) {
        const double ppq = 0.1 + (e - 1) * dppq, into = ppq - 0.25 * std::floor(ppq / 0.25);
        moved = moved || into > 0.01;
        EXPECT(into < 0.25 * 0.26 + 1e-9);  // within +25 % of a period after the grid
    }
    EXPECT(moved);
    TEST("Synced: same Seed twice is identical, another Seed differs");
    const Render again = render(p, 2.0, play);
    EXPECT(again.out == r.out && again.gate == r.gate);
    p.seed = 9;
    EXPECT(render(p, 2.0, play).gate != r.gate);

    TEST("Synced: a seek into the middle of a pulse starts it there");
    PulseGeneratorParams q;
    q.sync = 4;  // 1/4
    q.widthSec = 0.25;
    const Render s = render(q, 0.5, [&](int i, PulseGeneratorInput& in) {
        in.running = true;
        in.started = i == 0;
        in.ppq = (i < 4800 ? 8.0 : 20.1) + i * dppq;  // jump to 0.1 + a little beats into a quarter
        in.ppqPerSample = dppq;
    });
    EXPECT(s.gate[4802] > 0.5f);
    EXPECT(test::allFinite(s.out));
}

static void triggered() {
    TEST("Triggered, Burst 5: five pulses T apart");
    PulseGeneratorParams p;
    p.mode = patch::kPulseTriggered;
    p.burst = 5;
    p.periodSec = 0.01;
    p.widthSec = 0.002;
    const Render r = render(p, 0.3, [](int i, PulseGeneratorInput& in) { in.trigger = i == 1000 ? 1.0f : 0.0f; });
    const auto g = rising(r.gate);
    EXPECT(g.size() == 5);
    for (size_t k = 0; k < g.size(); ++k) EXPECT(g[k] == 1001 + 480 * (int)k);
    EXPECT(rising(r.sync).size() == 5);
    TEST("Triggered: a retrigger restarts the burst");
    const Render t = render(p, 0.3, [](int i, PulseGeneratorInput& in) { in.trigger = i == 1000 || i == 2200 ? 1.0f : 0.0f; });
    const auto h = rising(t.gate);
    EXPECT(h.size() == 8);
    if (h.size() == 8)
        for (int k = 0; k < 5; ++k) EXPECT(h[(size_t)k + 3] == 2201 + 480 * k);
}

static void gated() {
    TEST("Gated: no pulse starts after the falling edge; the last is full width");
    PulseGeneratorParams p;
    p.mode = patch::kPulseGated;
    p.periodSec = 0.01;
    p.widthSec = 0.004;
    const Render r = render(p, 0.2, [](int i, PulseGeneratorInput& in) { in.gate = i >= 1000 && i < 2104 ? 1.0f : 0.0f; });
    const auto g = rising(r.gate), gf = falling(r.gate);
    EXPECT(g.size() == 3 && gf.size() == 3);
    if (g.size() == 3 && gf.size() == 3) {
        EXPECT(g[0] == 1001 && g[2] == 1961);
        EXPECT(gf[2] - g[2] == 192);
    }
    TEST("Gated: a delayed pulse due after the falling edge never starts");
    p.delaySec = 0.003;  // the third period's pulse would start at 2104
    p.widthSec = 0.001;
    const Render d = render(p, 0.2, [](int i, PulseGeneratorInput& in) { in.gate = i >= 1000 && i < 2100 ? 1.0f : 0.0f; });
    EXPECT(rising(d.gate).size() == 2);
}

static void externalWidth() {
    TEST("External Width: Gate out is the Gate in, Delay later, within one sample");
    PulseGeneratorParams p;
    p.mode = patch::kPulseExternalWidth;
    p.delaySec = 158.4 / kSr;
    std::vector<float> gin;
    uint32_t lcg = 12345;
    bool high = false;
    while (gin.size() < 48000) {
        lcg = lcg * 1664525u + 1013904223u;
        const int len = 2 + (int)((lcg >> 8) % 400);
        for (int k = 0; k < len; ++k) gin.push_back(high ? 1.0f : 0.0f);
        high = !high;
    }
    gin.resize(48000);
    const Render r = render(p, 1.0, [&](int i, PulseGeneratorInput& in) {
        in.gatePatched = true;
        in.gate = gin[(size_t)i];
    });
    int bad = 0;
    for (size_t j = 200; j < gin.size(); ++j) {
        auto delayed = [&](size_t k) { return gin[k - 160] > 0.5f; };  // 158.4 + 1 sample late, rounded up
        const bool want = delayed(j), out = r.gate[j] > 0.5f;
        if (want != out && delayed(j - 1) == want && (j + 1 >= gin.size() || delayed(j + 1) == want)) ++bad;
    }
    EXPECT(bad == 0);
    EXPECT(!r.duty);
    TEST("External Width: more than 256 pending edges are dropped and light Duty");
    p.delaySec = 0.5;
    const Render o = render(p, 0.1, [](int i, PulseGeneratorInput& in) {
        in.gatePatched = true;
        in.gate = (i / 2) % 2 && i < 1200 ? 1.0f : 0.0f;
    });
    EXPECT(o.duty);
    TEST("External Width, Gate unpatched: each Trigger is a pulse of Width");
    p.delaySec = 0.001;
    p.widthSec = 0.002;
    const Render t = render(p, 0.1, [](int i, PulseGeneratorInput& in) { in.trigger = i == 500 ? 1.0f : 0.0f; });
    const auto g = rising(t.gate), gf = falling(t.gate);
    EXPECT(g.size() == 1 && gf.size() == 1);
    if (g.size() == 1 && gf.size() == 1) {
        EXPECT(g[0] == 549);
        EXPECT(gf[0] - g[0] == 96);
    }
}

static void doubleAndComplement() {
    TEST("Double: two pulses per period, Delay apart");
    PulseGeneratorParams p;
    p.periodSec = 0.01;
    p.widthSec = 0.001;
    p.delaySec = 0.003;
    p.doublePulse = true;
    const Render r = render(p, 0.1, noInput);
    const auto g = rising(r.gate), s = rising(r.sync);
    EXPECT(g.size() == 2 * s.size());
    for (size_t k = 0; k + 1 < g.size(); k += 2) EXPECT(g[k + 1] - g[k] == 144);
    TEST("Complement: s + s_normal = 1");
    PulseGeneratorParams a;
    a.periodSec = 0.003;
    a.widthSec = 0.0007;
    a.rise = 0.3;
    a.jitter = 0.5;
    PulseGeneratorParams b = a;
    b.complement = true;
    const Render x = render(a, 0.2, noInput), y = render(b, 0.2, noInput);
    for (size_t i = 0; i < x.out.size(); ++i) EXPECT_NEAR(x.out[i] + y.out[i], 1.0, 1e-5);
    for (size_t i = 1; i < x.gate.size(); ++i) EXPECT(x.gate[i] + y.gate[i] == 1.0f);
}

// ---- band-limiting -----------------------------------------------------------

static void fft(std::vector<std::complex<double>>& a) {
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; ++i) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const std::complex<double> w = std::polar(1.0, -2.0 * 3.14159265358979323846 / (double)len);
        for (size_t i = 0; i < n; i += len) {
            std::complex<double> u = 1.0;
            for (size_t k = 0; k < len / 2; ++k, u *= w) {
                const std::complex<double> x = a[i + k], y = a[i + k + len / 2] * u;
                a[i + k] = x + y;
                a[i + k + len / 2] = x - y;
            }
        }
    }
}

/// Power at non-harmonic bins below `maxHz` (aliases), with a Blackman-Harris window.
static double aliasPower(const std::vector<double>& x, size_t from, double f0, double sr, double maxHz) {
    const size_t n = 32768;
    std::vector<std::complex<double>> a(n);
    double mean = 0.0;
    for (size_t i = 0; i < n; ++i) mean += x[from + i];
    mean /= (double)n;
    const double pi = 3.14159265358979323846;
    for (size_t i = 0; i < n; ++i) {
        const double t = 2.0 * pi * (double)i / (double)n;
        const double w = 0.35875 - 0.48829 * std::cos(t) + 0.14128 * std::cos(2 * t) - 0.01168 * std::cos(3 * t);
        a[i] = (x[from + i] - mean) * w;
    }
    fft(a);
    double power = 0.0;
    for (size_t k = 1; k < n / 2; ++k) {
        const double hz = (double)k * sr / (double)n;
        if (hz > maxHz) break;
        const double h = hz / f0;
        if (std::fabs(h - std::round(h)) * f0 < 6.0 * sr / (double)n) continue;  // a harmonic's main lobe
        power += std::norm(a[k]);
    }
    return power;
}

static void bandLimiting() {
    TEST("a 1 kHz zero-rise pulse train aliases below 10 kHz at least 30 dB less than the naive one");
    const double sr = 44100.0;  // 44.1 samples per period: the aliases fall between the harmonics
    PulseGeneratorParams p;
    p.periodSec = 0.001;
    p.widthSec = 0.0003;
    const Render r = render(p, 1.0, noInput, sr);
    std::vector<double> bl(r.out.begin(), r.out.end());
    // Aliases below 10 kHz: the inharmonic tones you hear. Above, a two-sample
    // polyBLEP gains less (about 18 dB over the whole band).
    const double aBl = aliasPower(bl, 2000, 1000.0, sr, 10000.0);
    const double aNaive = aliasPower(r.logical, 2000, 1000.0, sr, 10000.0);
    const double db = 10.0 * std::log10(aNaive / std::max(aBl, 1e-30));
    std::printf("  alias reduction below 10 kHz %.1f dB (all: %.1f dB)\n", db,
                10.0 * std::log10(aliasPower(r.logical, 2000, 1000.0, sr, 22050.0) / aliasPower(bl, 2000, 1000.0, sr, 22050.0)));
    EXPECT(db >= 30.0);

    TEST("a half-sample edge shift moves the centroid 0.5 samples");
    auto centroid = [](double delaySamples) {
        PulseGeneratorParams q;
        q.mode = patch::kPulseTriggered;
        q.widthSec = 0.01;
        q.delaySec = delaySamples / kSr;
        const Render e = render(q, 0.01, [](int i, PulseGeneratorInput& in) { in.trigger = i == 100 ? 1.0f : 0.0f; });
        double m = 0.0, sum = 0.0;
        for (size_t i = 90; i < 130; ++i) {
            const double d = (double)e.out[i] - (double)e.out[i - 1];
            m += d * (double)i;
            sum += d;
        }
        return m / sum;
    };
    const double c0 = centroid(10.0), c1 = centroid(10.5), c2 = centroid(10.25);
    std::printf("  centroids %.4f %.4f %.4f\n", c0, c2, c1);
    EXPECT_NEAR(c1 - c0, 0.5, 0.02);
    EXPECT_NEAR(c2 - c0, 0.25, 0.02);
}

static void ringing() {
    TEST("Ring out is 0 when no edge has occurred");
    PulseGeneratorParams p;
    p.mode = patch::kPulseTriggered;
    p.widthSec = 2.0;
    p.periodSec = 4.0;
    p.ring = 1.0;
    const Render r = render(p, 0.6, [](int i, PulseGeneratorInput& in) { in.trigger = i == 4800 ? 1.0f : 0.0f; });
    for (size_t i = 0; i < 4800; ++i) EXPECT(r.ring[i] == 0.0f);
    PulseGeneratorParams c = p;
    c.complement = true;
    const Render rc = render(c, 0.05, noInput);
    for (float v : rc.ring) EXPECT(std::fabs(v) < 1e-6f);

    TEST("a step at Damping 50 % rings at fr ± 1 % and reaches −60 dB after N cycles ± 10 %");
    const std::vector<float> ring(r.ring.begin() + 4801, r.ring.end());
    const double hz = test::zeroCrossingHz(std::vector<float>(ring.begin(), ring.begin() + 200), kSr);
    std::printf("  ring %.1f Hz\n", hz);
    EXPECT_NEAR(hz, 2000.0, 20.0);
    double peak = 0.0;
    for (float v : ring) peak = std::max(peak, (double)std::fabs(v));
    // A decaying sine of unit height: its first peak, a quarter cycle in, is e^(−π / 4Q).
    EXPECT_NEAR(peak, std::exp(-3.14159265358979323846 / (4.0 * PulseGeneratorDsp::ringQ(0.5))), 0.03);
    // Time of the last local peak at or above −60 dB, interpolated to −60 dB with the next one.
    double t60 = 0.0;
    double lastT = 0.0, lastA = 0.0;
    for (size_t i = 1; i + 1 < ring.size(); ++i) {
        const double a = std::fabs(ring[i]);
        if (a < std::fabs(ring[i - 1]) || a < std::fabs(ring[i + 1]) || a < 1e-7) continue;
        if (lastA >= 1e-3 && a < 1e-3) {
            t60 = lastT + ((double)i - lastT) * std::log(lastA / 1e-3) / std::log(lastA / a);
            break;
        }
        lastT = (double)i;
        lastA = a;
    }
    const double cycles = t60 / kSr * 2000.0, n = PulseGeneratorDsp::ringCycles(0.5);
    std::printf("  -60 dB after %.2f cycles (N = %.2f)\n", cycles, n);
    EXPECT_NEAR(cycles, n, 0.1 * n);
    TEST("Pitch moves the ring an octave");
    const Render o = render(p, 0.2, [](int i, PulseGeneratorInput& in) {
        in.trigger = i == 100 ? 1.0f : 0.0f;
        in.pitch = 1.0f;
    });
    EXPECT_NEAR(test::zeroCrossingHz(std::vector<float>(o.ring.begin() + 101, o.ring.begin() + 400), kSr), 4000.0, 60.0);
    TEST("slow edges ring less");
    PulseGeneratorParams s = p;
    s.rise = 0.002;  // 4 ms over 2 s width ≫ a ring cycle
    const Render sl = render(s, 0.2, [](int i, PulseGeneratorInput& in) { in.trigger = i == 100 ? 1.0f : 0.0f; });
    double slow = 0.0;
    for (float v : sl.ring) slow = std::max(slow, (double)std::fabs(v));
    EXPECT(slow < 0.2);
}

static void warmup() {
    TEST("Warm-up: period 5 % long at start, under 0.1 % after 60 s");
    PulseGeneratorParams p;
    p.warmup = true;
    p.widthSec = 0.001;
    PulseGeneratorDsp d;
    d.prepare(kSr);
    PulseGeneratorFrame f;
    PulseGeneratorInput in;
    std::vector<int64_t> syncs;
    bool warmingEarly = false, warmingLate = true;
    for (int64_t i = 0; i < (int64_t)(62.0 * kSr); ++i) {
        d.tick(p, in, f);
        if (f.sync > 0.5f) syncs.push_back(i);
        if (i == 1000) warmingEarly = f.warming;
        if (i == (int64_t)(61.0 * kSr)) warmingLate = f.warming;
    }
    EXPECT(syncs.size() > 10);
    const double first = (double)(syncs[1] - syncs[0]);
    EXPECT_NEAR(first / 4800.0, 1.05, 0.002);
    size_t k = 0;
    while (k + 1 < syncs.size() && syncs[k] < (int64_t)(60.0 * kSr)) ++k;
    const double late = (double)(syncs[k + 1] - syncs[k]);
    std::printf("  first period %.0f, after 60 s %.0f samples\n", first, late);
    EXPECT(late / 4800.0 - 1.0 < 0.001);
    EXPECT(warmingEarly && !warmingLate);
}

int main() {
    freeRun();
    synced();
    triggered();
    gated();
    externalWidth();
    doubleAndComplement();
    bandLimiting();
    ringing();
    warmup();
    return bleep::test::finish("pulse-generator");
}
