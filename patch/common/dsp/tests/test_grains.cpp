// SPDX-License-Identifier: GPL-3.0-only WITH AdditionRef-Bleep-Module-Exception
#include "dsp/Grains.h"
#include "dsp/tests/TestUtil.h"

#include <memory>
#include <vector>

using namespace bleep::dsp;

static constexpr double kSr = 48000.0;
static constexpr double kPi = 3.14159265358979323846;

// A live stereo buffer the test writes into, as a module would.
struct LiveBuffer {
    std::vector<float> l, r;
    const float* ch[2];
    GrainBuffer view;
    explicit LiveBuffer(int length) : l((size_t)length, 0.0f), r((size_t)length, 0.0f) {
        ch[0] = l.data();
        ch[1] = r.data();
        view.channels = ch;
        view.numChannels = 2;
        view.length = length;
    }
    void write(float a, float b) {
        l[(size_t)view.writePos] = a;
        r[(size_t)view.writePos] = b;
        view.writePos = (view.writePos + 1) % view.length;
        view.filled = std::min(view.filled + 1, view.length);
    }
};

static std::vector<float> render(uint64_t seed, double seconds, const GrainCloudParams& p, int maxGrains = 32,
                                 bool dc = false) {
    LiveBuffer buf((int)(4 * kSr));
    GrainEngine eng;
    eng.prepare(kSr);
    eng.setMaxGrains(maxGrains);
    GrainCloud cloud;
    cloud.prepare(kSr);
    cloud.reset(seed);
    std::vector<float> out;
    const int pre = buf.view.length;  // fill the buffer first
    for (int n = 0; n < pre + (int)(seconds * kSr); ++n) {
        const float x = dc ? 1.0f : (float)std::sin(2.0 * kPi * 220.0 * n / kSr) * 0.5f + (float)(uniform01(9, (uint64_t)n, 1) - 0.5) * 0.2f;
        buf.write(x, dc ? 1.0f : -x);
        if (n < pre) continue;
        cloud.tickContinuous(buf.view, p, eng);
        float l = 0.0f, r = 0.0f;
        eng.process(buf.view, l, r);
        out.push_back(l);
        out.push_back(r);
        if (eng.playing() > maxGrains) out.push_back(1e9f);  // cap broken: poison the render
    }
    return out;
}

static GrainCloudParams cloudParams() {
    GrainCloudParams p;
    p.rate = 40.0;
    p.irregularity = 0.5f;
    p.position = 0.3f;
    p.positionJitter = 0.2f;
    p.sizeSeconds = 0.08f;
    p.pitchJitter = 7.0f;
    p.panSpread = 0.8f;
    p.reverseChance = 0.3f;
    p.texture = 0.4f;
    return p;
}

static void reproducible() {
    TEST("same seed renders identically, another seed differs");
    const auto p = cloudParams();
    const auto a = render(11, 2.0, p), b = render(11, 2.0, p), c = render(12, 2.0, p);
    EXPECT(a.size() == b.size());
    bool same = a.size() == b.size(), differ = false;
    for (size_t i = 0; i < a.size() && i < b.size(); ++i) same = same && !(a[i] < b[i] || a[i] > b[i]);
    for (size_t i = 0; i < a.size() && i < c.size(); ++i) differ = differ || a[i] < c[i] || a[i] > c[i];
    EXPECT(same);
    EXPECT(differ);
    EXPECT(bleep::test::allFinite(a));
    EXPECT(bleep::test::rms(a) > 0.05);
}

static void densityRespected() {
    TEST("density: grains per second");
    LiveBuffer buf(48000);
    for (int i = 0; i < 48000; ++i) buf.write(0.1f, 0.1f);
    GrainEngine eng;
    eng.prepare(kSr);
    GrainCloud cloud;
    cloud.prepare(kSr);
    for (double irr : {0.0, 0.8}) {
        cloud.reset(3);
        GrainCloudParams p;
        p.rate = 25.0;
        p.irregularity = (float)irr;
        p.sizeSeconds = 0.01f;
        int started = 0;
        for (int n = 0; n < (int)(20 * kSr); ++n) {
            started += cloud.tickContinuous(buf.view, p, eng);
            float l = 0.0f, r = 0.0f;
            eng.process(buf.view, l, r);
        }
        std::printf("  irregularity %.1f: %d grains in 20 s\n", irr, started);
        EXPECT_NEAR(started, 500, irr > 0.0 ? 30 : 1);
    }
    TEST("triggered bursts");
    cloud.reset(3);
    eng.reset();
    GrainCloudParams p;
    p.sizeSeconds = 0.01f;
    cloud.trigger(4, 100.0);
    int started = 0, lastAt = -1;
    for (int n = 0; n < 1000; ++n) {
        const int s = cloud.tickTriggered(buf.view, p, eng);
        if (s > 0) lastAt = n;
        started += s;
    }
    EXPECT(started == 4);
    EXPECT(lastAt == 300);
}

static double maxStep(const std::vector<float>& stereo) {
    double m = 0.0;
    for (size_t i = 2; i < stereo.size(); ++i) m = std::max(m, (double)std::fabs(stereo[i] - stereo[i - 2]));
    return m;
}

static void noClicks() {
    TEST("no clicks at grain boundaries (DC source, every window shape)");
    for (float texture : {0.0f, 0.25f, 0.5f, 0.6f, 0.75f, 1.0f}) {
        auto p = cloudParams();
        p.texture = texture;
        p.rate = 60.0;
        p.sizeSeconds = 0.1f;
        p.gain = grainOverlapGain(p.rate, p.sizeSeconds);
        const double step = maxStep(render(5, 3.0, p, 32, true));
        if (step >= 0.03) std::printf("  texture %.2f: max step %.4f\n", texture, step);
        EXPECT(step < 0.03);
    }
    TEST("stealing at the cap fades (no step), cap never exceeded");
    auto p = cloudParams();
    p.rate = 400.0;
    p.sizeSeconds = 0.5f;
    p.texture = 0.0f;  // flat windows: stolen grains are at full level
    p.gain = 0.25f;
    const auto out = render(6, 2.0, p, 4, true);
    EXPECT(out.size() == (size_t)(2.0 * kSr) * 2);
    const double step = maxStep(out);
    std::printf("  steal max step %.4f (gain 0.25 per grain)\n", step);
    EXPECT(step < 0.25 * 0.05);
}

static void rectangleReproducesInput() {
    TEST("single flat grain at pitch 0 reproduces the buffer, sample-exact");
    std::vector<float> data(48000);
    for (size_t i = 0; i < data.size(); ++i) data[i] = (float)(uniform01(1, i, 2) * 2.0 - 1.0);
    const float* ch[1] = {data.data()};
    GrainBuffer b;
    b.channels = ch;
    b.numChannels = 1;
    b.length = 48000;
    b.writePos = 0;
    b.filled = 48000;
    b.live = false;
    GrainEngine eng;
    eng.prepare(kSr);
    GrainSpec s;
    s.start = 1000.0;
    s.size = 4800;
    s.texture = 0.0f;
    EXPECT(eng.start(s));
    double err = 0.0;
    for (int n = 0; n < 4800; ++n) {
        float l = 0.0f, r = 0.0f;
        eng.process(b, l, r);
        if (n >= 300 && n < 4500) err = std::max(err, (double)std::fabs(l - data[1000 + (size_t)n]));
    }
    EXPECT(err < 1e-6);
    EXPECT(eng.busy() == 0);

    TEST("pitch +12 reads at double speed (cubic error below -80 dB on a sine)");
    for (size_t i = 0; i < data.size(); ++i) data[i] = (float)std::sin(2.0 * kPi * 100.0 * (double)i / kSr);
    s.ratio = 2.0;
    s.start = 1000.25;
    EXPECT(eng.start(s));
    err = 0.0;
    for (int n = 0; n < 4800; ++n) {
        float l = 0.0f, r = 0.0f;
        eng.process(b, l, r);
        if (n >= 300 && n < 4500)
            err = std::max(err, std::fabs(l - std::sin(2.0 * kPi * 100.0 * (1000.25 + 2.0 * n) / kSr)));
    }
    EXPECT(err < 1e-4);
}

static void staysBehindWriteHead() {
    TEST("grains never read unwritten audio");
    GrainBuffer b;
    b.length = 96000;
    b.writePos = 50000;
    b.filled = 96000;
    b.live = true;
    for (double ratio : {0.5, 1.0, 2.0, 4.0, -1.0, -2.0}) {
        const int size = 9600;
        for (double pos : {0.0, 0.5, 1.0}) {
            const double start = GrainCloud::startFor(b, pos, ratio, size);
            // Delay behind the moving write head at the grain's first and last sample.
            const double d0 = b.writePos - start, d1 = d0 + size * (1.0 - ratio);
            EXPECT(d0 >= 3.0 && d1 >= 3.0);
            EXPECT(d0 <= b.filled - 3.0 && d1 <= b.filled - 3.0);
        }
    }
}

static void windows() {
    TEST("windows are zero at the ends and peak near one");
    for (float t = 0.0f; t <= 1.0f; t += 0.125f) {
        EXPECT(grainWindow(t, 0.0f) < 1e-3f);
        EXPECT(grainWindow(t, 1.0f) < 1e-3f);
        float peak = 0.0f;
        for (float x = 0.0f; x <= 1.0f; x += 0.001f) peak = std::max(peak, grainWindow(t, x));
        EXPECT(peak > 0.5f && peak <= 1.0001f);
    }
    EXPECT_NEAR(grainWindow(0.5f, 0.5f), 1.0, 1e-4);   // Hann
    EXPECT_NEAR(grainWindow(0.5f, 0.25f), 0.5, 1e-3);
}

int main() {
    windows();
    reproducible();
    densityRespected();
    noClicks();
    rectangleReproducesInput();
    staysBehindWriteHead();
    return bleep::test::finish("grains");
}
