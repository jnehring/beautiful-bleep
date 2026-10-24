// SPDX-License-Identifier: GPL-3.0-only
// XY Scope: frequency estimates, validity and holds, Ratio, figure ratio and
// its hysteresis, Phase at 1:1 and 3:2, the detuned saw, Correlation, Still
// at each tolerance, the Y-T sweep, determinism and the point ring
// (doc/specs/modules/xy-scope.md §8).
#include "XyScopeDsp.h"
#include "dsp/tests/TestUtil.h"

#include <cmath>
#include <functional>
#include <vector>

using namespace bleep;
using patch::XyFraction;
using patch::XyScopeDsp;
using patch::XyScopeFrame;
using patch::XyScopeInput;
using patch::XyScopeParams;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

using Signal = std::function<double(double)>;  // seconds → value

struct Render {
    std::vector<XyScopeFrame> f;
    double fx = 0.0, fy = 0.0;
    bool vx = false, vy = false;
    XyFraction frac;
};

static Render render(XyScopeDsp& d, const XyScopeParams& p, double from, double seconds, const Signal& x, const Signal& y,
                     bool xPatched = true, bool yPatched = true, double sr = kSr) {
    Render r;
    XyScopeFrame f;
    const int64_t n0 = (int64_t)std::llround(from * sr), n1 = n0 + (int64_t)(seconds * sr);
    for (int64_t n = n0; n < n1; ++n) {
        const double t = (double)n / sr;
        XyScopeInput in;
        in.x = xPatched ? (float)x(t) : 0.0f;
        in.y = yPatched ? (float)y(t) : 0.0f;
        in.xPatched = xPatched;
        in.yPatched = yPatched;
        d.tick(p, in, f);
        r.f.push_back(f);
    }
    r.fx = d.fx();
    r.fy = d.fy();
    r.vx = d.validX(xPatched);
    r.vy = d.validY(yPatched);
    r.frac = d.fraction();
    return r;
}
static Render render(const XyScopeParams& p, double seconds, const Signal& x, const Signal& y, bool xPatched = true,
                     bool yPatched = true, double sr = kSr) {
    XyScopeDsp d;
    d.prepare(sr);
    return render(d, p, 0.0, seconds, x, y, xPatched, yPatched, sr);
}
static Signal sine(double hz, double amp = 0.8, double phaseRad = 0.0) {
    return [=](double t) { return amp * std::sin(2.0 * kPi * hz * t + phaseRad); };
}

static void frequencies() {
    TEST("frequency estimates within 0.1 % at 1, 110 and 5000 Hz");
    for (double hz : {1.0, 110.0, 5000.0}) {
        const double secs = hz < 10.0 ? 12.0 : 1.0;
        const Render r = render({}, secs, sine(hz), sine(hz * 1.5));
        EXPECT(r.vx && r.vy);
        EXPECT_NEAR(r.fx / hz, 1.0, 0.001);
        EXPECT_NEAR(r.fy / (hz * 1.5), 1.0, 0.001);
    }
    TEST("also at 96 kHz");
    const Render r96 = render({}, 1.0, sine(440.0), sine(660.0), true, true, 96000.0);
    EXPECT_NEAR(r96.fx / 440.0, 1.0, 0.001);
}

static void validity() {
    TEST("invalid below −60 dBFS");
    const Render quiet = render({}, 1.0, sine(220.0, 0.0005), sine(330.0, 0.0005));
    EXPECT(!quiet.vx && !quiet.vy);

    TEST("Y unpatched: invalid; Ratio and Phase hold, Still low");
    XyScopeDsp d;
    d.prepare(kSr);
    const Render a = render(d, {}, 0.0, 1.0, sine(220.0), sine(330.0, 0.8, 0.5 * kPi));
    EXPECT(a.vy);
    const float ratio = a.f.back().ratio, phase = a.f.back().phase;
    const Render b = render(d, {}, 1.0, 1.0, sine(220.0), sine(330.0), true, false);
    EXPECT(!b.vy && b.vx);
    bool held = true;
    for (size_t i = (size_t)(0.01 * kSr); i < b.f.size(); ++i)
        held = held && std::fabs(b.f[i].ratio - ratio) < 1e-5f && b.f[i].phase == phase;
    EXPECT(held);
    for (size_t i = (size_t)(0.06 * kSr); i < b.f.size(); ++i) EXPECT(b.f[i].still == 0.0f);
}

static void ratio() {
    TEST("Ratio: a fifth reads 0.585, an octave 1.0");
    const Render fifth = render({}, 1.0, sine(220.0), sine(330.0));
    EXPECT_NEAR(fifth.f.back().ratio, std::log2(1.5), 0.002);
    const Render octave = render({}, 1.0, sine(220.0), sine(440.0));
    EXPECT_NEAR(octave.f.back().ratio, 1.0, 0.002);
    const Render down = render({}, 1.0, sine(440.0), sine(220.0));
    EXPECT_NEAR(down.f.back().ratio, -1.0, 0.002);
}

static void figureRatio() {
    TEST("figure ratio: 3:2 for 1.5, 7:4 for 1.73, 1:1 for 1.07 (nothing within 3 %)");
    EXPECT(patch::xyBestFraction(1.5) == (XyFraction{3, 2}));
    EXPECT(patch::xyBestFraction(1.73) == (XyFraction{7, 4}));
    EXPECT(patch::xyBestFraction(1.07) == (XyFraction{1, 1}));
    EXPECT(patch::xyBestFraction(1.87) == (XyFraction{1, 1}));
    EXPECT(patch::xyBestFraction(0.5) == (XyFraction{1, 2}));
    EXPECT(render({}, 1.0, sine(200.0), sine(300.0)).frac == (XyFraction{3, 2}));
    EXPECT(render({}, 1.0, sine(200.0), sine(214.0)).frac == (XyFraction{1, 1}));

    TEST("no flicker for r swept slowly through 1.49 … 1.51");
    XyScopeDsp d;
    d.prepare(kSr);
    double ph = 0.0;
    int changes = 0;
    XyFraction last{0, 0};
    XyScopeFrame f;
    for (int n = 0; n < (int)(10.0 * kSr); ++n) {
        const double t = n / kSr, r = 1.49 + 0.02 * t / 10.0;
        ph += 2.0 * kPi * 200.0 * r / kSr;
        XyScopeInput in;
        in.x = (float)(0.8 * std::sin(2.0 * kPi * 200.0 * t));
        in.y = (float)(0.8 * std::sin(ph));
        in.xPatched = in.yPatched = true;
        d.tick({}, in, f);
        if (n > (int)(0.2 * kSr) && d.fraction() != last) ++changes;
        last = d.fraction();
    }
    EXPECT(changes == 0 && last == (XyFraction{3, 2}));

    TEST("a new fraction takes over after 200 ms");
    XyScopeDsp e;
    e.prepare(kSr);
    render(e, {}, 0.0, 0.5, sine(200.0), sine(300.0));
    const Render after = render(e, {}, 0.5, 0.15, sine(200.0), sine(400.0));
    EXPECT(after.frac == (XyFraction{3, 2}));
    EXPECT(render(e, {}, 0.65, 0.15, sine(200.0), sine(400.0)).frac == (XyFraction{2, 1}));
}

static double meanTail(const std::vector<XyScopeFrame>& f, double seconds) {
    double s = 0.0;
    const size_t from = f.size() - (size_t)(seconds * kSr);
    for (size_t i = from; i < f.size(); ++i) s += f[i].phase;
    return s / (double)(f.size() - from);
}

static void phase() {
    TEST("Phase at 1:1: 0°, +90°, −90°, 179° read 0, +0.5, −0.5, ≈ +0.99");
    const double cases[][2] = {{0.0, 0.0}, {90.0, 0.5}, {-90.0, -0.5}};
    for (const auto& c : cases) {
        const Render r = render({}, 1.0, sine(220.0), sine(220.0, 0.8, c[0] * kPi / 180.0));
        EXPECT_NEAR(meanTail(r.f, 0.1), c[1], 0.01);
        double worst = 0.0;
        for (size_t i = r.f.size() - 4800; i < r.f.size(); ++i) worst = std::max(worst, std::fabs(r.f[i].phase - c[1]));
        EXPECT(worst < 0.02);  // the demodulator's ripple
    }
    const Render r179 = render({}, 1.0, sine(220.0), sine(220.0, 0.8, 179.0 * kPi / 180.0));
    EXPECT_NEAR(std::fabs(meanTail(r179.f, 0.1)), 179.0 / 180.0, 0.01);
    TEST("Phase: Y leading by 90° reads +0.5 at other amplitudes and 2 kHz");
    EXPECT_NEAR(meanTail(render({}, 1.0, sine(2000.0, 0.05), sine(2000.0, 2.0, 0.5 * kPi)).f, 0.1), 0.5, 0.01);

    TEST("at 3:2 with a fixed offset, Phase is constant over 10 s");
    const Render r = render({}, 11.0, sine(200.0), sine(300.0, 0.8, 1.0));
    double lo = 9, hi = -9;
    for (size_t i = (size_t)(1.0 * kSr); i < r.f.size(); ++i) {
        lo = std::min(lo, (double)r.f[i].phase);
        hi = std::max(hi, (double)r.f[i].phase);
    }
    EXPECT(hi - lo < 0.03);
    // 2·argY − 3·argX with argX = −π/2, argY = 1 − π/2 (sines against cos phasors)
    EXPECT_NEAR(0.5 * (lo + hi), patch::xyWrap(2.0 * (1.0 - kPi / 2) - 3.0 * (-kPi / 2)) / kPi, 0.01);
}

static void detuned() {
    TEST("detuned 1:1 (220 vs 220.5 Hz): Phase is a rising saw at 0.5 Hz");
    const Render r = render({}, 9.0, sine(220.0), sine(220.5));
    std::vector<double> wraps;
    int falling = 0;
    for (size_t i = (size_t)kSr; i < r.f.size(); ++i) {
        const double d = r.f[i].phase - r.f[i - 1].phase;
        if (d < -1.0) wraps.push_back((double)i / kSr);
        if (d < -0.02 && d > -1.0) ++falling;
    }
    EXPECT(wraps.size() == 4);
    for (size_t k = 1; k < wraps.size(); ++k) EXPECT_NEAR(wraps[k] - wraps[k - 1], 2.0, 0.01);
    EXPECT(falling == 0);
}

static void correlation() {
    TEST("Correlation: identical +1, inverted −1, quadrature ≈ 0");
    EXPECT_NEAR(render({}, 1.5, sine(220.0), sine(220.0)).f.back().corr, 1.0, 0.001);
    EXPECT_NEAR(render({}, 1.5, sine(220.0), sine(220.0, -0.8)).f.back().corr, -1.0, 0.001);
    EXPECT_NEAR(render({}, 1.5, sine(220.0), sine(220.0, 0.8, 0.5 * kPi)).f.back().corr, 0.0, 0.02);
    TEST("Correlation: 0 with Y silent");
    EXPECT(render({}, 1.0, sine(220.0), sine(220.0), true, false).f.back().corr == 0.0f);
}

/// First time Still is high (seconds), or −1.
static double firstStill(const Render& r) {
    for (size_t i = 0; i < r.f.size(); ++i)
        if (r.f[i].still > 0.5f) return (double)i / kSr;
    return -1.0;
}
static double stillFraction(const Render& r, double from) {
    size_t on = 0, n = 0;
    for (size_t i = (size_t)(from * kSr); i < r.f.size(); ++i, ++n) on += r.f[i].still > 0.5f;
    return n ? (double)on / (double)n : 0.0;
}

static void still() {
    TEST("Still: high for exact 2:1 within 150 ms");
    const Render oct = render({}, 1.0, sine(220.0), sine(440.0, 0.8, 0.3));
    EXPECT(firstStill(oct) > 0.0 && firstStill(oct) <= 0.15);
    EXPECT(stillFraction(oct, 0.15) == 1.0);

    TEST("Still: low for 220 vs 221 Hz at Normal");
    EXPECT(stillFraction(render({}, 4.0, sine(220.0), sine(221.0)), 0.0) == 0.0);

    TEST("Still: high for 220 vs 220.1 Hz at Normal, low at Tight, high at Loose");
    const Render normal = render({}, 4.0, sine(220.0), sine(220.1));
    EXPECT(stillFraction(normal, 0.5) == 1.0);
    XyScopeParams tight;
    tight.tolerance = 0;
    EXPECT(stillFraction(render(tight, 4.0, sine(220.0), sine(220.1)), 0.0) == 0.0);
    XyScopeParams loose;
    loose.tolerance = 2;
    EXPECT(stillFraction(render(loose, 4.0, sine(220.0), sine(220.4)), 0.5) == 1.0);
    EXPECT(stillFraction(render(loose, 4.0, sine(220.0), sine(221.5)), 0.0) == 0.0);

    TEST("Still: 3:2 locked at 1 kHz and at 30 Hz");
    EXPECT(stillFraction(render({}, 2.0, sine(1000.0), sine(1500.0, 0.8, 2.0)), 0.5) == 1.0);
    EXPECT(stillFraction(render({}, 6.0, sine(30.0), sine(45.0, 0.8, 2.0)), 3.0) == 1.0);

    TEST("Still goes low 50 ms after Y stops");
    XyScopeDsp d;
    d.prepare(kSr);
    render(d, {}, 0.0, 1.0, sine(220.0), sine(440.0));
    const Render off = render(d, {}, 1.0, 0.2, sine(220.0), sine(440.0), true, false);
    EXPECT(off.f[(size_t)(0.04 * kSr)].still == 1.0f);
    EXPECT(off.f[(size_t)(0.06 * kSr)].still == 0.0f);
}

static void yt() {
    TEST("Y-T, Y Rising: each sweep starts at a rising crossing of Y");
    XyScopeParams p;
    p.mode = 1;
    p.timebase = 0.01f;
    const Render r = render(p, 0.5, sine(220.0), sine(150.0));
    int sweeps = 0;
    for (size_t i = 1; i < r.f.size(); ++i)
        if (r.f[i].sweep >= 0.0f && (r.f[i - 1].sweep < 0.0f || r.f[i].sweep < r.f[i - 1].sweep)) {
            ++sweeps;
            const double t = (double)i / kSr, cyc = t * 150.0;
            EXPECT(std::fabs(cyc - std::round(cyc)) * 48000.0 / 150.0 < 1.5);  // within a sample or so
            EXPECT(r.f[i].sweep < 0.01f);
        }
    EXPECT(sweeps >= 37 && sweeps <= 38);  // a sweep of 10 ms, then the next crossing: every 2 periods
    TEST("Y-T, Y Rising: no sweep without Y; Auto free-runs");
    const Render none = render(p, 0.3, sine(220.0), sine(150.0), true, false);
    bool dark = true;
    for (const auto& f : none.f) dark = dark && f.sweep < 0.0f;
    EXPECT(dark);
    p.trigger = 1;
    const Render autoRun = render(p, 0.3, sine(220.0), sine(150.0), true, false);
    size_t lit = 0;
    for (const auto& f : autoRun.f) lit += f.sweep >= 0.0f;
    EXPECT(lit > autoRun.f.size() / 3 && lit < autoRun.f.size() * 2 / 3);

    TEST("Y-T, Beat: a sweep on each beat while playing");
    p.trigger = 2;
    p.timebase = 0.1f;
    XyScopeDsp d;
    d.prepare(kSr);
    XyScopeFrame f;
    int starts = 0;
    float prev = -1.0f;
    for (int n = 0; n < (int)(2.0 * kSr); ++n) {
        XyScopeInput in;
        in.playing = true;
        in.ppq = n / kSr * 2.0;  // 120 bpm
        d.tick(p, in, f);
        if (f.sweep >= 0.0f && (prev < 0.0f || f.sweep < prev)) ++starts;
        prev = f.sweep;
    }
    EXPECT(starts == 4);
    EXPECT(f.sweep < 0.0f);  // 100 ms sweeps, 500 ms beats: dark in between
}

static void determinism() {
    TEST("two renders of the same input are identical; outputs finite under noise");
    uint32_t s = 1;
    auto noise = [&s](double) { s = s * 1664525u + 1013904223u; return (double)(s >> 8) / 8388608.0 - 1.0; };
    const Render a = render({}, 1.0, noise, sine(330.0));
    s = 1;
    const Render b = render({}, 1.0, noise, sine(330.0));
    bool same = a.f.size() == b.f.size(), finite = true;
    for (size_t i = 0; same && i < a.f.size(); ++i) {
        same = a.f[i].phase == b.f[i].phase && a.f[i].corr == b.f[i].corr && a.f[i].ratio == b.f[i].ratio &&
               a.f[i].still == b.f[i].still;
        finite = finite && std::isfinite(a.f[i].phase) && std::isfinite(a.f[i].ratio) && std::isfinite(a.f[i].corr);
    }
    EXPECT(same && finite);
    TEST("silence and DC: finite, Still low");
    const Render dc = render({}, 1.0, [](double) { return 3.0; }, [](double) { return 0.0; });
    EXPECT(std::isfinite(dc.f.back().phase) && dc.f.back().still == 0.0f && std::isfinite(dc.f.back().ratio));
}

static void ring() {
    TEST("point ring: at most 1024 points per 60 Hz frame (every sample at 44.1 and 48 kHz)");
    EXPECT(patch::xyDecimation(44100.0) == 1 && patch::xyDecimation(48000.0) == 1);
    EXPECT(patch::xyDecimation(96000.0) == 2 && patch::xyDecimation(192000.0) == 4);
    for (double sr : {44100.0, 48000.0, 61440.0, 88200.0, 96000.0, 192000.0})
        EXPECT(sr / patch::xyDecimation(sr) / 60.0 <= 1024.0 + 1e-9);

    TEST("point ring: a frame's points arrive in order");
    patch::XyPointRing r;
    std::vector<float> out;
    uint32_t dropped = 0;
    for (int i = 0; i < 800; ++i) r.push((float)i, -(float)i, 0.5f, -1.0f);
    EXPECT(r.drain(out, dropped) == 0 && dropped == 0 && out.size() == 3200);
    EXPECT(out[4 * 799] == 799.0f && out[4 * 799 + 1] == -799.0f && out[2] == 0.5f && out[3] == -1.0f);
    out.clear();
    EXPECT(r.drain(out, dropped) == 800 && out.empty());

    TEST("point ring: overflow drops the oldest, the writer never waits");
    for (int i = 0; i < 100000; ++i) r.push((float)i, 0.0f, 0.0f, 0.0f);
    const uint32_t first = r.drain(out, dropped);
    EXPECT(out.size() == 4 * patch::XyPointRing::kMaxDrain);
    EXPECT(dropped == 100000 - patch::XyPointRing::kMaxDrain);
    EXPECT(first == 800 + dropped && out[0] == (float)(100000 - 4096) && out[out.size() - 4] == 99999.0f);
}

int main() {
    frequencies();
    validity();
    ratio();
    figureRatio();
    phase();
    detuned();
    correlation();
    still();
    yt();
    determinism();
    ring();
    return bleep::test::finish("xy-scope");
}
