// SPDX-License-Identifier: GPL-3.0-or-later
// Chart Recorder: detectors, the pen (overshoot, velocity limit, stiction, end
// stops), paper and record modes, replay of a written ramp, interpolation and
// blank points, markers, saved data (doc/specs/modules/chart-recorder.md §8).
#include "ChartRecorderDsp.h"
#include "dsp/tests/TestUtil.h"

#include <algorithm>
#include <cmath>
#include <vector>

using namespace bleep;
using patch::ChartDetector;
using patch::ChartFrame;
using patch::ChartInput;
using patch::ChartParams;
using patch::ChartPen;
using patch::ChartRecorderDsp;
using patch::ChartStripData;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

/// Runs `samples` samples; `input(i, in)` fills the input.
template <class F>
static void run(ChartRecorderDsp& d, const ChartParams& p, int samples, F&& input, int from = 0) {
    ChartFrame f;
    for (int i = from; i < from + samples; ++i) {
        ChartInput in;
        input(i, in);
        d.tick(p, in, f);
    }
}
static ChartStripData strip(int n, double value) {
    ChartStripData s;
    s.n = n;
    s.points.assign((size_t)n, patch::chartQuantise(value));
    return s;
}

static void detectors() {
    TEST("detectors: a full-scale sine gives RMS 0.707, Peak 1, Log (Range − 3) / Range");
    for (int mode : {ChartDetector::Rectified, ChartDetector::Rms, ChartDetector::Peak, ChartDetector::LogDb}) {
        ChartDetector det;
        det.prepare(kSr);
        double lo = 1e9, hi = -1e9, sum = 0.0;
        int count = 0;
        for (int i = 0; i < (int)kSr; ++i) {
            const double y = det.process(std::sin(2.0 * kPi * 100.0 * i / kSr), mode, 0.05f, 50.0f);
            if (i >= (int)(0.8 * kSr)) {
                lo = std::min(lo, y);
                hi = std::max(hi, y);
                sum += y;
                ++count;
            }
        }
        const double mean = sum / count;
        if (mode == ChartDetector::Rectified) EXPECT_NEAR(mean, 2.0 / kPi, 0.01);
        if (mode == ChartDetector::Rms) EXPECT_NEAR(mean, std::sqrt(0.5), 0.005);
        if (mode == ChartDetector::Peak) {
            EXPECT_NEAR(hi, 1.0, 1e-3);
            EXPECT(lo > 0.9);
        }
        if (mode == ChartDetector::LogDb) EXPECT_NEAR(mean, (50.0 - 10.0 * std::log10(2.0)) / 50.0, 0.004);
    }
    TEST("DC clamps to ±1; unipolar detectors map 0 … 1 onto the paper");
    ChartDetector det;
    det.prepare(kSr);
    EXPECT_NEAR(det.process(3.0, ChartDetector::Dc, 0.05f, 50.0f), 1.0, 1e-12);
    EXPECT_NEAR(det.process(-0.25, ChartDetector::Dc, 0.05f, 50.0f), -0.25, 1e-12);
    EXPECT_NEAR(ChartDetector::target(0.0, ChartDetector::Rms), -1.0, 1e-12);
    EXPECT_NEAR(ChartDetector::target(1.0, ChartDetector::Peak), 1.0, 1e-12);
}

/// The pen's answer to a step from 0 to `target`.
static std::vector<double> penStep(double target, float speed, float damping, float friction, double seconds = 1.0) {
    ChartPen pen;
    pen.setParams(speed, damping, friction);
    std::vector<double> u;
    for (int i = 0; i < (int)(seconds * kSr); ++i) u.push_back(pen.tick(target, kSr));
    return u;
}

static void penModel() {
    TEST("pen: Damping 100 % never overshoots, 0 % overshoots by more than 50 %");
    {
        const auto u = penStep(0.05, 1000.0f, 1.0f, 0.0f);
        EXPECT(*std::max_element(u.begin(), u.end()) <= 0.05 + 1e-12);
        EXPECT_NEAR(u.back(), 0.05, 1e-4);
        const auto w = penStep(0.05, 1000.0f, 0.0f, 0.0f);
        EXPECT(*std::max_element(w.begin(), w.end()) > 0.05 * 1.5);
    }
    TEST("pen: the slope never exceeds vmax = Writing Speed / 50");
    for (float speed : {10.0f, 100.0f, 1000.0f}) {
        const auto u = penStep(0.9, speed, 0.3f, 0.0f, 2.0);
        double slope = 0.0;
        for (size_t i = 1; i < u.size(); ++i) slope = std::max(slope, std::fabs(u[i] - u[i - 1]) * kSr);
        EXPECT(slope <= speed / 50.0 + 1e-9);
        EXPECT(slope > 0.9 * speed / 50.0);  // the limit is reached: straight-sided ramps
    }
    TEST("pen: Friction 100 % ignores a 2 % step and follows a 10 % step");
    {
        const auto small = penStep(0.04, 100.0f, 0.7f, 1.0f);
        EXPECT(std::fabs(small.back()) < 1e-12);
        const auto big = penStep(0.2, 100.0f, 0.7f, 1.0f);
        EXPECT(big.back() > 0.2 - 0.08 - 1e-9);
        EXPECT(big.back() < 0.2 + 0.08);
    }
    TEST("pen: end stops hold ±1.05 and bounce");
    for (double target : {1.0, -1.0}) {
        ChartPen pen;
        pen.setParams(1000.0f, 0.0f, 0.0f);
        double peak = 0.0;
        bool bounced = false;
        for (int i = 0; i < (int)kSr / 4; ++i) {
            const double u = pen.tick(target, kSr) * target;
            if (u >= patch::kChartStop - 1e-12 && pen.velocity() * target < 0.0) bounced = true;
            peak = std::max(peak, u);
        }
        EXPECT_NEAR(peak, patch::kChartStop, 1e-12);
        EXPECT(bounced);
    }
    TEST("pen: no randomness, the same input draws the same line");
    EXPECT(penStep(0.7, 50.0f, 0.2f, 0.3f) == penStep(0.7, 50.0f, 0.2f, 0.3f));
}

static ChartParams transportParams() {
    ChartParams p;
    p.paper = ChartRecorderDsp::TransportPaper;
    p.bars = 4;
    p.record = ChartRecorderDsp::Always;
    return p;
}

static void paper() {
    TEST("Transport: p is a pure function of ppq");
    {
        const ChartParams p = transportParams();
        const double perSample = 2.0 / kSr;  // 120 BPM
        ChartRecorderDsp a, b;
        a.prepare(kSr);
        b.prepare(kSr);
        a.configure(p, 120.0);
        b.configure(p, 120.0);
        auto playing = [&](double start) {
            return [=](int i, ChartInput& in) {
                in.playing = true;
                in.ppq = start + i * perSample;
            };
        };
        run(a, p, (int)(3 * kSr), playing(1.0));
        const double end = 1.0 + (3 * kSr - 1) * perSample;
        run(b, p, 1, playing(end));
        EXPECT_NEAR(a.writeHead(), b.writeHead(), 1e-12);
        EXPECT_NEAR(a.writeHead(), dsp::wrap01(end / 16.0), 1e-12);
    }
    TEST("Hold freezes p; in Transport it rejoins the song on release");
    {
        ChartParams p;
        p.paper = ChartRecorderDsp::FreePaper;
        p.lengthSeconds = 2.0;
        ChartRecorderDsp d;
        d.prepare(kSr);
        d.configure(p, 120.0);
        run(d, p, 1000, [](int, ChartInput&) {});
        const double p0 = d.writeHead();
        run(d, p, 10000, [](int, ChartInput& in) { in.hold = 1.0f; });
        EXPECT_NEAR(d.writeHead(), p0, 1e-15);

        const ChartParams t = transportParams();
        ChartRecorderDsp e;
        e.prepare(kSr);
        e.configure(t, 120.0);
        const double perSample = 2.0 / kSr;
        run(e, t, 20000, [&](int i, ChartInput& in) {
            in.playing = true;
            in.ppq = i * perSample;
            in.hold = i >= 5000 ? 1.0f : 0.0f;
        });
        EXPECT_NEAR(e.writeHead(), dsp::wrap01(4999 * perSample / 16.0), 1e-12);
        run(e, t, 1, [&](int i, ChartInput& in) {
            in.playing = true;
            in.ppq = i * perSample;
        }, 20000);
        EXPECT_NEAR(e.writeHead(), dsp::wrap01(20000 * perSample / 16.0), 1e-12);
    }
    TEST("Gate writes only while high");
    {
        ChartParams p;
        p.paper = ChartRecorderDsp::FreePaper;
        p.lengthSeconds = 1.0;
        p.record = ChartRecorderDsp::Gate;
        ChartRecorderDsp d;
        d.prepare(kSr);
        d.configure(p, 120.0);
        EXPECT(d.n() == 200);
        run(d, p, (int)kSr - 10, [](int i, ChartInput& in) {
            in.in = 0.3f;
            in.record = i < (int)kSr / 2 - 10 ? 1.0f : 0.0f;
        });
        int inked = 0;
        for (int k = 0; k < 200; ++k) {
            const bool ink = d.point(k) != patch::kChartBlank;
            inked += ink;
            if (k < 100) EXPECT(ink);
            else EXPECT(!ink);
        }
        EXPECT(inked == 100);
    }
    TEST("Armed writes exactly one pass, from the wrap");
    {
        ChartParams p;
        p.paper = ChartRecorderDsp::FreePaper;
        p.lengthSeconds = 1.0;
        p.record = ChartRecorderDsp::ArmedPass;
        p.writingSpeed = 1000.0f;
        p.damping = 1.0f;
        ChartRecorderDsp d;
        d.prepare(kSr);
        d.configure(p, 120.0);
        d.load(strip(200, -0.5));
        int states[4] = {-1, -1, -1, -1};
        run(d, p, (int)(3.5 * kSr), [&](int i, ChartInput& in) {
            const double t = i / kSr;
            in.in = t >= 1.0 && t < 2.0 ? 0.5f : 0.9f;
            in.record = t >= 0.3 && t < 0.4 ? 1.0f : 0.0f;
            if (i == (int)(0.5 * kSr)) states[0] = d.recState();
            if (i == (int)(1.5 * kSr)) states[1] = d.recState();
            if (i == (int)(2.5 * kSr)) states[2] = d.recState();
        });
        EXPECT(states[0] == ChartRecorderDsp::Armed);
        EXPECT(states[1] == ChartRecorderDsp::Writing);
        EXPECT(states[2] == ChartRecorderDsp::Done);
        for (int k = 10; k < 200; ++k) EXPECT_NEAR(patch::chartUnits(d.point(k)), 0.5, 0.01);
    }
}

static void replayRamp() {
    TEST("a written ramp replays at +1× (Song) within one point, reversed at −1×");
    ChartParams p = transportParams();
    p.writingSpeed = 1000.0f;
    p.damping = 0.5f;
    ChartRecorderDsp d;
    d.prepare(kSr);
    d.configure(p, 120.0);
    EXPECT(d.n() == 1600);
    const double perSample = 2.0 / kSr;
    auto ramp = [](double pos) { return -0.9 + 1.8 * pos; };
    const int pass = (int)(8 * kSr);
    run(d, p, 2 * pass, [&](int i, ChartInput& in) {
        in.playing = true;
        in.ppq = i * perSample;
        in.in = (float)ramp(dsp::wrap01(in.ppq / 16.0));
    });
    const double onePoint = 1.8 / 1600.0;
    for (float speed : {1.0f, -1.0f}) {
        p.record = ChartRecorderDsp::Gate;  // record low: replay only
        p.replaySpeed = speed;
        double worst = 0.0;
        ChartFrame f;
        for (int i = 2 * pass; i < 3 * pass; i += 97) {
            ChartInput in;
            in.playing = true;
            in.ppq = i * perSample;
            d.tick(p, in, f);
            const double expect = speed > 0 ? dsp::wrap01(in.ppq / 16.0) : dsp::wrap01(-in.ppq / 16.0);
            EXPECT_NEAR(f.position, expect, 1e-6);
            if (f.position < 0.06 || f.position > 0.995) continue;  // the pen's jump back at the wrap
            worst = std::max(worst, std::fabs(f.replay - ramp(f.position)));
        }
        EXPECT(worst < onePoint);
    }
}

static void interpolation() {
    TEST("Step, Linear and Smooth match their formulas");
    ChartRecorderDsp d;
    d.prepare(kSr);
    ChartStripData s;
    s.n = 16;
    for (int k = 0; k < 16; ++k) s.points.push_back(patch::chartQuantise(std::sin(k * 0.7) * 0.8));
    d.load(s);
    auto pt = [&](int k) { return patch::chartUnits(s.points[(size_t)(((k % 16) + 16) % 16)]); };
    for (double x : {0.0, 2.25, 7.5, 15.6, 15.99}) {
        const double q = x / 16.0;
        const int i = (int)x;
        const double f = x - i;
        EXPECT_NEAR(d.read(q, ChartRecorderDsp::Step), pt(i), 1e-12);
        EXPECT_NEAR(d.read(q, ChartRecorderDsp::Linear), pt(i) + (pt(i + 1) - pt(i)) * f, 1e-9);
        const double ym = pt(i - 1), y0 = pt(i), y1 = pt(i + 1), y2 = pt(i + 2);
        const double hermite = y0 + 0.5 * f * (y1 - ym + f * (2 * ym - 5 * y0 + 4 * y1 - y2 + f * (3 * (y0 - y1) + y2 - ym)));
        EXPECT_NEAR(d.read(q, ChartRecorderDsp::Smooth), hermite, 1e-9);
    }
    TEST("blank points read the previous ink (wrapping); an empty strip reads 0");
    s.points[5] = s.points[6] = patch::kChartBlank;
    s.points[0] = patch::kChartBlank;
    d.load(s);
    EXPECT_NEAR(d.read(5.5 / 16, ChartRecorderDsp::Step), pt(4), 1e-12);
    EXPECT_NEAR(d.read(6.2 / 16, ChartRecorderDsp::Step), pt(4), 1e-12);
    EXPECT_NEAR(d.read(4.5 / 16, ChartRecorderDsp::Linear), pt(4), 1e-12);
    EXPECT_NEAR(d.read(0.3 / 16, ChartRecorderDsp::Step), pt(15), 1e-12);
    d.clear();
    for (int interp = 0; interp < 3; ++interp) EXPECT(d.read(0.4, interp) == 0.0);
    ChartStripData lone = strip(64, 0.0);
    std::fill(lone.points.begin(), lone.points.end(), patch::kChartBlank);
    lone.points[40] = patch::chartQuantise(0.6);
    d.load(lone);
    for (double q : {0.0, 0.3, 0.62, 0.99}) EXPECT_NEAR(d.read(q, ChartRecorderDsp::Smooth), patch::chartUnits(lone.points[40]), 1e-12);
}

static int countMarkers(float speed, double seconds) {
    ChartParams p;
    p.paper = ChartRecorderDsp::FreePaper;
    p.lengthSeconds = 1.0;
    p.replaySync = 0;
    p.replaySpeed = speed;
    p.record = ChartRecorderDsp::Gate;
    ChartRecorderDsp d;
    d.prepare(kSr);
    ChartStripData s = strip(200, 0.2);
    s.marks = {50, 0};
    d.load(s);
    d.configure(p, 120.0);
    ChartFrame f;
    int count = 0;
    for (int i = 0; i < (int)(seconds * kSr); ++i) {
        d.tick(p, ChartInput{}, f);
        count += f.marker > 0.5f;
    }
    return count;
}

static void markers() {
    TEST("Marker fires once per mark crossing, in both directions and on the wrap");
    EXPECT(countMarkers(1.0f, 2.5) == 5);   // 50 at 0.25, 1.25, 2.25 s; 0 at 1, 2 s
    EXPECT(countMarkers(-1.0f, 2.5) == 4);  // 50 at 0.75, 1.75 s; 0 at 1, 2 s
    EXPECT(countMarkers(4.0f, 1.1) == 9);  // 50 five times, 0 four times
    TEST("Mark stores the write head's point; Clear removes the marks");
    ChartParams p;
    p.paper = ChartRecorderDsp::FreePaper;
    p.lengthSeconds = 1.0;
    ChartRecorderDsp d;
    d.prepare(kSr);
    d.configure(p, 120.0);
    run(d, p, (int)kSr / 2, [](int i, ChartInput& in) { in.mark = i == (int)kSr / 4 ? 1.0f : 0.0f; });
    EXPECT(d.markCount() == 1 && d.mark(0) == 50);
    run(d, p, 10, [](int i, ChartInput& in) { in.clear = i == 2 ? 1.0f : 0.0f; });
    EXPECT(d.markCount() == 0 && d.inked() == 0);
}

static void savedData() {
    TEST("sanitise: pcm16 round-trips bit-exact");
    std::vector<int16_t> pts;
    for (int k = 0; k < 4001; ++k) pts.push_back((int16_t)((k * 7919) % 65536 - 32768));
    pts[3] = patch::kChartBlank;
    const std::string enc = patch::chartEncodePcm16(pts.data(), (int)pts.size());
    ChartStripData d = patch::chartSanitise(4001.0, enc, {120.0, 1800.0});
    EXPECT(d.n == 4001 && d.points == pts);
    EXPECT(d.marks == std::vector<int>({120, 1800}));
    EXPECT(patch::chartEncodePcm16(d.points.data(), d.n) == enc);

    TEST("sanitise: truncated base64, wrong n and bad marks load safely");
    const ChartStripData half = patch::chartSanitise(4001.0, enc.substr(0, 4000), {});
    EXPECT(half.n == 4001 && half.points.size() == 4001);
    for (int k = 0; k < 1500; ++k) EXPECT(half.points[(size_t)k] == pts[(size_t)k]);
    for (int k = 1500; k < 4001; ++k) EXPECT(half.points[(size_t)k] == patch::kChartBlank);
    const ChartStripData junk = patch::chartSanitise(100.0, "AAAA!@#$" + enc, {});
    EXPECT(junk.points[0] == 0 && junk.points[2] == patch::kChartBlank);
    const ChartStripData shorter = patch::chartSanitise(10.0 + 6.0, enc, {});
    EXPECT(shorter.n == 16 && std::equal(shorter.points.begin(), shorter.points.end(), pts.begin()));
    EXPECT(patch::chartSanitise(1e9, enc, {}).n == patch::kChartMaxPoints);
    EXPECT(patch::chartSanitise(std::nan(""), enc, {}).n == 4001);
    EXPECT(patch::chartSanitise(-5.0, "", {}).n == patch::kChartDefaultPoints);
    const ChartStripData marks = patch::chartSanitise(100.0, "", {-1.0, 5.5, 3.0, 3.0, 1e9, std::nan(""), 7.0, 100.0});
    EXPECT(marks.marks == std::vector<int>({3, 7}));
    std::vector<double> many;
    for (int i = 0; i < 300; ++i) many.push_back(i);
    const ChartStripData kept = patch::chartSanitise(400.0, "", many);
    EXPECT(kept.marks.size() == 256 && kept.marks.front() == 44 && kept.marks.back() == 299);

    TEST("resizing Length resamples the strip and rescales marks");
    ChartParams p;
    p.paper = ChartRecorderDsp::FreePaper;
    p.lengthSeconds = 10.0;
    ChartRecorderDsp r;
    r.prepare(kSr);
    ChartStripData s;
    s.n = 2000;
    for (int k = 0; k < 2000; ++k) s.points.push_back(patch::chartQuantise(-1.0 + k / 1000.0));
    s.marks = {1000, 1999, 3};
    r.load(s);
    r.configure(p, 120.0);
    EXPECT(r.n() == 2000);
    p.lengthSeconds = 5.0;
    r.configure(p, 120.0);
    EXPECT(r.n() == 1000);
    EXPECT(r.markCount() == 3 && r.mark(0) == 500 && r.mark(1) == 999 && r.mark(2) == 1);
    EXPECT_NEAR(patch::chartUnits(r.point(500)), -1.0 + 1000.5 / 1000.0, 2e-4);
    TEST("an inked strip keeps its size when the tempo changes; a blank one follows it");
    p.paper = ChartRecorderDsp::TransportPaper;
    r.configure(p, 120.0);  // Paper changed: resampled to 4 bars at 120 BPM
    EXPECT(r.n() == 1600);
    r.configure(p, 90.0);
    EXPECT(r.n() == 1600);
    r.clear();
    r.configure(p, 90.0);
    EXPECT(r.n() == 2133);
}

int main() {
    detectors();
    penModel();
    paper();
    replayRamp();
    interpolation();
    markers();
    savedData();
    return test::finish("chart-recorder");
}
